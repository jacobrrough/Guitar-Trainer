/**
 * Milestone detectors (pure): compare learner state before/after an event and
 * return durable "you got somewhere" records. `now` is always passed in.
 */
import { BAND_THRESHOLDS, MILESTONE_TEMPO_STEP, STREAK_MILESTONES, UNLOCK_RATING } from './constants'
import { effectiveRating, masteryBand } from './learner'
import type { MasteryBand, Milestone, SkillDef, SkillState, SongItemState, TestRecord, TestType } from './types'

/** Accuracy at which a song level counts as mastered. */
const SONG_MASTERED_ACCURACY = 0.9

/** Band order, lowest first: new, learning, developing, solid, mastered. */
const BAND_ORDER: MasteryBand[] = BAND_THRESHOLDS.map((t) => t.band).reverse()

const BAND_LABELS: Record<MasteryBand, string> = {
  new: 'New',
  learning: 'Learning',
  developing: 'Developing',
  solid: 'Solid',
  mastered: 'Mastered',
}

/** Index of a band in ascending order (0 = new … 4 = mastered). */
export function bandIndex(band: MasteryBand): number {
  return BAND_ORDER.indexOf(band)
}

function stateBand(state: SkillState | null, now: number): number {
  return state ? bandIndex(masteryBand(effectiveRating(state, now))) : 0
}

/** A skill's mastery band rose from `before` to `after`. */
export function bandMilestone(skill: SkillDef, before: SkillState | null, after: SkillState, now: number): Milestone | null {
  const from = stateBand(before, now)
  const to = stateBand(after, now)
  if (to <= from) return null
  const label = BAND_LABELS[BAND_ORDER[to]]
  return {
    at: now,
    type: 'band',
    skillId: skill.id,
    title: `${skill.name}: ${label}`,
    detail: `Your ${skill.name} rating reached ${Math.round(effectiveRating(after, now))}, now ${label.toLowerCase()}.`,
    value: to,
    key: `band:${skill.id}:${to}`,
  }
}

/** The tempo ceiling crossed a new multiple of MILESTONE_TEMPO_STEP at or above the skill's start tempo. */
export function tempoMilestone(skill: SkillDef, before: SkillState | null, after: SkillState, now: number): Milestone | null {
  const multiple = Math.floor(after.tempoCeiling / MILESTONE_TEMPO_STEP) * MILESTONE_TEMPO_STEP
  const previous = Math.floor((before?.tempoCeiling ?? 0) / MILESTONE_TEMPO_STEP) * MILESTONE_TEMPO_STEP
  if (multiple < skill.startTempo || multiple <= previous || multiple <= 0) return null
  return {
    at: now,
    type: 'tempo',
    skillId: skill.id,
    title: `${skill.name} clean at ${multiple} bpm`,
    detail: `You played ${skill.name} cleanly at ${multiple} bpm.`,
    value: multiple,
    key: `tempo:${skill.id}:${multiple}`,
  }
}

/** Skills with prerequisites that are unlocked by `ratingsAfter` but were not by `ratingsBefore`. */
export function unlockMilestones(
  skills: SkillDef[],
  ratingsBefore: Record<string, number>,
  ratingsAfter: Record<string, number>,
  now: number,
): Milestone[] {
  const open = (skill: SkillDef, ratings: Record<string, number>) =>
    skill.prerequisites.every((p) => (ratings[p] ?? 0) >= UNLOCK_RATING)
  return skills
    .filter((s) => s.prerequisites.length > 0 && open(s, ratingsAfter) && !open(s, ratingsBefore))
    .map((s) => ({
      at: now,
      type: 'unlock' as const,
      skillId: s.id,
      title: `${s.name} unlocked`,
      detail: `You have met the prerequisites for ${s.name}; it can now appear in your plan.`,
      key: `unlock:${s.id}`,
    }))
}

/** The largest streak milestone crossed going from `before` to `after` days. */
export function streakMilestone(before: number, after: number, now: number): Milestone | null {
  const crossed = STREAK_MILESTONES.filter((n) => before < n && n <= after)
  if (crossed.length === 0) return null
  const n = Math.max(...crossed)
  return {
    at: now,
    type: 'streak',
    title: `${n}-day streak`,
    detail: `You have practised ${n} days in a row.`,
    value: n,
    key: `streak:${n}`,
  }
}

/** First time a song level reaches 90 % best accuracy. */
export function songMilestone(songTitle: string, before: SongItemState | null, after: SongItemState, now: number): Milestone | null {
  const was = before?.bestAccuracy ?? 0
  const is = after.bestAccuracy ?? 0
  if (was >= SONG_MASTERED_ACCURACY || is < SONG_MASTERED_ACCURACY) return null
  return {
    at: now,
    type: 'song',
    songId: after.songId,
    title: `${songTitle} · Level ${after.level + 1} mastered`,
    detail: `You reached ${Math.round(is * 100)}% accuracy on level ${after.level + 1}.`,
    value: after.level,
    key: `song:${after.songId}:${after.level}`,
  }
}

const TEST_LABELS: Record<TestType, string> = { placement: 'Placement', checkpoint: 'Checkpoint', monthly: 'Monthly' }

function isoDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A test where every task passed. */
export function testMilestone(record: TestRecord, now: number): Milestone | null {
  if (record.results.length === 0 || !record.results.every((r) => r.passed)) return null
  return {
    at: now,
    type: 'test',
    title: `${TEST_LABELS[record.type]} test passed`,
    detail: `You passed all ${record.results.length} tasks.`,
    value: record.results.length,
    key: `test:${record.type}:${isoDate(record.at)}`,
  }
}

/** Band and tempo milestones for one skill update. */
export function skillMilestones(skill: SkillDef, before: SkillState | null, after: SkillState, now: number): Milestone[] {
  return [bandMilestone(skill, before, after, now), tempoMilestone(skill, before, after, now)].filter(
    (m): m is Milestone => m !== null,
  )
}
