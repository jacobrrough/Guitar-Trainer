import { effectiveRating, masteryBand } from '../../training/learner'
import { CATEGORY_LABELS } from '../../training/skills'
import type { Attempt, LearnerModel, SkillCategory, SkillDef } from '../../training/types'

const CATEGORY_ORDER: SkillCategory[] = ['fretting', 'picking', 'chords', 'lead', 'timing', 'ear']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local midnight of the Monday of the week containing `time`. */
function mondayOf(time: number): Date {
  const d = new Date(time)
  const back = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

/** Minutes practised per local week (Monday start), oldest first, ending with the week containing `now`. */
export function weeklyMinutes(attempts: Attempt[], now: number, weeks = 8): { weekStart: string; minutes: number }[] {
  const current = mondayOf(now)
  const buckets: { start: Date; weekStart: string; minutes: number }[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(current.getFullYear(), current.getMonth(), current.getDate() - i * 7)
    buckets.push({ start, weekStart: dayKey(start), minutes: 0 })
  }
  const index = new Map(buckets.map((b, i) => [b.weekStart, i]))
  for (const a of attempts) {
    const i = index.get(dayKey(mondayOf(a.at)))
    if (i !== undefined) buckets[i].minutes += a.durationSec / 60
  }
  return buckets.map(({ weekStart, minutes }) => ({ weekStart, minutes }))
}

export function ratingSeries(attempts: Attempt[], skillId: string): { at: number; rating: number }[] {
  return attempts
    .filter((a) => a.skillId === skillId && a.ratingAfter !== undefined)
    .map((a) => ({ at: a.at, rating: a.ratingAfter as number }))
    .sort((a, b) => a.at - b.at)
}

export function categorySummary(
  model: LearnerModel,
  skills: SkillDef[],
  now: number,
): {
  category: SkillCategory
  label: string
  mean: number
  mastered: number
  total: number
}[] {
  const result: {
    category: SkillCategory
    label: string
    mean: number
    mastered: number
    total: number
  }[] = []
  for (const category of CATEGORY_ORDER) {
    const list = skills.filter((s) => s.category === category)
    if (list.length === 0) continue
    const ratings = list.map((s) => {
      const st = model.skills[s.id]
      return st ? effectiveRating(st, now) : 0
    })
    result.push({
      category,
      label: CATEGORY_LABELS[category],
      mean: ratings.reduce((sum, r) => sum + r, 0) / ratings.length,
      mastered: ratings.filter((r) => masteryBand(r) === 'mastered').length,
      total: list.length,
    })
  }
  return result
}

/** Consecutive local days with at least one attempt, ending today or yesterday. */
export function practiceStreakDays(attempts: Attempt[], now: number): number {
  const days = new Set(attempts.map((a) => dayKey(new Date(a.at))))
  const today = new Date(now)
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1)
  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak++
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1)
  }
  return streak
}
