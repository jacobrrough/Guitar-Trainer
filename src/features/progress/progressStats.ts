import { effectiveRating, masteryBand, stepWithin } from '../../training/learner'
import { CATEGORY_LABELS } from '../../training/skills'
import type { Attempt, LearnerModel, SkillCategory, SkillDef, SkillState } from '../../training/types'

const CATEGORY_ORDER: SkillCategory[] = ['fretting', 'picking', 'chords', 'lead', 'timing', 'ear']

/**
 * Where each category stands on a page: the guitar's six in the order they were always drawn, then the
 * three of singing. A record over every category, so a new one cannot be added without a place here
 * (it would otherwise have no card on the skill map, and its skills would be nowhere).
 */
const CATEGORY_RANK: Record<SkillCategory, number> = { fretting: 0, picking: 1, chords: 2, lead: 3, timing: 4, ear: 5, pitch: 6, range: 7, breath: 8 }

/**
 * The categories a list of skills has, each once, in the order the app shows them. The skill map and
 * the summaries take their cards from this, so they show the instrument whose skills they are given
 * and can never draw an empty card for the other one.
 */
export function categoriesOf(skills: Pick<SkillDef, 'category'>[]): SkillCategory[] {
  return [...new Set(skills.map((s) => s.category))].sort((a, b) => CATEGORY_RANK[a] - CATEGORY_RANK[b])
}

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
    // A run in which the microphone heard the app's own playing was not practice that counted.
    if (a.bleed) continue
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

/**
 * Per category: how its skills stand. `order` is the categories to report, in that order; left out it
 * is the guitar's six, as before singing existed (`categoriesOf(skills)` gives an instrument's own).
 * Only the skills given are counted, whatever else the model holds.
 */
export function categorySummary(
  model: LearnerModel,
  skills: SkillDef[],
  now: number,
  order: SkillCategory[] = CATEGORY_ORDER,
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
  for (const category of order) {
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

/**
 * The numbers of the "Skills" tile: how many of the given skills are mastered, how many solid, and how
 * many there are. A learner model can hold states the list does not name (the other instrument's on a
 * mixed model, a retired skill): those are not counted.
 */
export function bandCounts(model: Pick<LearnerModel, 'skills'>, skills: Pick<SkillDef, 'id'>[], now: number): { mastered: number; solid: number; total: number } {
  let mastered = 0
  let solid = 0
  for (const skill of skills) {
    const st = model.skills[skill.id]
    const band = masteryBand(st ? effectiveRating(st, now) : 0)
    if (band === 'mastered') mastered++
    else if (band === 'solid') solid++
  }
  return { mastered, solid, total: skills.length }
}

/**
 * The small line under a skill's bar that says how far its practice has come; null when there is nothing to say.
 *
 * A skill that speeds up says its tempo ceiling, and only when technical numbers are wanted (`simple`
 * off), as the guitar map always did. A step skill has one tempo for good, so a ceiling would be a
 * number that never moves: it names the step practice starts from instead, in the words the step
 * itself is called by ("6 beats"). Those are the learner's words, so they show in plain mode too.
 *
 * `maxStep` is the highest step this singer's range has room for (`maxStepFor`). The stored step can be
 * above it: the easy notes were made smaller after a slide to the octave was reached. Practice then
 * starts from the highest step that fits, and that is the one named, or the line would promise an
 * exercise the plan will not hold. Left out, or not a number, the ladder goes to its end.
 */
export function skillPaceText(
  skill: Pick<SkillDef, 'steps'>,
  state: Pick<SkillState, 'tempoCeiling' | 'step'> | undefined,
  simple: boolean,
  maxStep?: number,
): string | null {
  if (!state) return null
  const steps = skill.steps ?? []
  if (steps.length > 0) {
    const last = steps.length - 1
    return `now: ${steps[stepWithin(state.step, stepWithin(maxStep, last, last), 0)].label}`
  }
  if (simple || !(state.tempoCeiling > 0)) return null
  return `ceiling ${Math.round(state.tempoCeiling)} bpm`
}

/** Consecutive local days with at least one attempt, ending today or yesterday. */
export function practiceStreakDays(attempts: Attempt[], now: number): number {
  const days = new Set(attempts.filter((a) => !a.bleed).map((a) => dayKey(new Date(a.at))))
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
