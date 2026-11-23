/**
 * Milestone detectors (pure): compare learner state before/after an event and
 * return durable "you got somewhere" records. `now` is always passed in.
 *
 * Where a sentence would not suit a singer (something "played", a rating, a percentage) the detector
 * takes the instrument and words it for them. That argument chooses words only: keys, kinds and values
 * are the same, and the record is not stamped here. The Coach stamps a voice milestone and prefixes the
 * keys that would otherwise clash with the guitar's (streaks and checks), see docs/SINGING.md §6.
 */
import { BAND_THRESHOLDS, MILESTONE_TEMPO_STEP, STREAK_MILESTONES } from './constants'
import { effectiveRating, masteryBand, stepWithin } from './learner'
import { prerequisitesSolid } from './skills'
import type { InstrumentId, MasteryBand, Milestone, SkillDef, SkillState, SongItemState, TestRecord, TestType } from './types'
import { skillOpener, type OpenContext } from './unlock'

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
export function bandMilestone(skill: SkillDef, before: SkillState | null, after: SkillState, now: number, instrument: InstrumentId = 'guitar'): Milestone | null {
  const from = stateBand(before, now)
  const to = stateBand(after, now)
  if (to <= from) return null
  const label = BAND_LABELS[BAND_ORDER[to]]
  return {
    at: now,
    type: 'band',
    skillId: skill.id,
    title: `${skill.name}: ${label}`,
    detail:
      instrument === 'voice'
        ? `You have moved up to ${label.toLowerCase()} in ${skill.name}.`
        : `Your ${skill.name} rating reached ${Math.round(effectiveRating(after, now))}, now ${label.toLowerCase()}.`,
    value: to,
    key: `band:${skill.id}:${to}`,
  }
}

function hasSteps(skill: SkillDef): boolean {
  return (skill.steps?.length ?? 0) > 0
}

/**
 * The tempo ceiling crossed a new multiple of MILESTONE_TEMPO_STEP at or above the skill's start tempo.
 * Never for a step skill: it has one tempo, so its first clean round would "reach" it and nothing after
 * that ever could. Its milestones are its steps (`stepMilestone`).
 */
export function tempoMilestone(skill: SkillDef, before: SkillState | null, after: SkillState, now: number, instrument: InstrumentId = 'guitar'): Milestone | null {
  if (hasSteps(skill)) return null
  const multiple = Math.floor(after.tempoCeiling / MILESTONE_TEMPO_STEP) * MILESTONE_TEMPO_STEP
  const previous = Math.floor((before?.tempoCeiling ?? 0) / MILESTONE_TEMPO_STEP) * MILESTONE_TEMPO_STEP
  if (multiple < skill.startTempo || multiple <= previous || multiple <= 0) return null
  return {
    at: now,
    type: 'tempo',
    skillId: skill.id,
    title: `${skill.name} clean at ${multiple} bpm`,
    detail: `You ${instrument === 'voice' ? 'sang' : 'played'} ${skill.name} cleanly at ${multiple} bpm.`,
    value: multiple,
    key: `tempo:${skill.id}:${multiple}`,
  }
}

/**
 * A step skill reached a step it starts from for the first time: to it what "clean at N bpm" is to a
 * tempo skill, so it is the same kind of milestone ('tempo'), under a key of its own. The key carries
 * the step, and a key is stored once: a step lost and won back is not announced again.
 * The title names the step in the learner's words; there is no tempo in it to name, and nothing in
 * it that is said differently to a singer, so it takes no instrument.
 */
export function stepMilestone(skill: SkillDef, before: SkillState | null, after: SkillState, now: number): Milestone | null {
  const steps = skill.steps ?? []
  if (steps.length === 0) return null
  const last = steps.length - 1
  const reached = stepWithin(after.step, last, 0)
  if (reached <= stepWithin(before?.step, last, 0)) return null
  const label = steps[reached].label
  return {
    at: now,
    type: 'tempo',
    skillId: skill.id,
    title: `${skill.name}: ${label}`,
    detail: `You reached the next step of ${skill.name}: ${label}.`,
    value: reached,
    key: `step:${skill.id}:${reached}`,
  }
}

/**
 * Skills that build on others and are open with `ratingsAfter` but were not with `ratingsBefore`.
 * "Open" is the planner's own rule (unlock.ts): the whole chain under the skill counts, and a skill the
 * learner is already practising was open before, so nothing is announced that the plan keeps closed.
 * `known` carries what the ratings do not say: practice rounds per skill and what the lessons taught.
 */
export function unlockMilestones(
  skills: SkillDef[],
  ratingsBefore: Record<string, number>,
  ratingsAfter: Record<string, number>,
  now: number,
  known: Pick<OpenContext, 'attempts' | 'taught'> = {},
): Milestone[] {
  return unlockMilestonesBetween(skills, { ...known, ratings: ratingsBefore }, { ...known, ratings: ratingsAfter }, now)
}

/**
 * The same with everything the rule looks at given for both moments (see `openContextOf`), so rust counts
 * here exactly as it does in the plan. The text only says "everything it builds on is solid" when that is
 * why the skill opened: a skill can also open because a skill check rated it solid by itself.
 */
export function unlockMilestonesBetween(skills: SkillDef[], contextBefore: OpenContext, contextAfter: OpenContext, now: number): Milestone[] {
  const before = skillOpener(skills, contextBefore)
  const after = skillOpener(skills, contextAfter)
  const byId = new Map(skills.map((s) => [s.id, s]))
  return skills
    .filter((s) => s.prerequisites.length > 0 && after(s) && !before(s))
    .map((s) => ({
      at: now,
      type: 'unlock' as const,
      skillId: s.id,
      title: `${s.name} unlocked`,
      detail: prerequisitesSolid(s, contextAfter.ratings, byId)
        ? `Everything ${s.name} builds on is solid now, so it can appear in your practice.`
        : `You are ready for ${s.name}, so it can appear in your practice.`,
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
export function songMilestone(songTitle: string, before: SongItemState | null, after: SongItemState, now: number, instrument: InstrumentId = 'guitar'): Milestone | null {
  const was = before?.bestAccuracy ?? 0
  const is = after.bestAccuracy ?? 0
  if (was >= SONG_MASTERED_ACCURACY || is < SONG_MASTERED_ACCURACY) return null
  return {
    at: now,
    type: 'song',
    songId: after.songId,
    title: `${songTitle} · Level ${after.level + 1} mastered`,
    detail: instrument === 'voice' ? `You sang nearly every note of level ${after.level + 1} in tune.` : `You reached ${Math.round(is * 100)}% accuracy on level ${after.level + 1}.`,
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

/** Band, tempo and step milestones for one skill update: a skill gets tempo milestones or step milestones, never both. */
export function skillMilestones(skill: SkillDef, before: SkillState | null, after: SkillState, now: number, instrument: InstrumentId = 'guitar'): Milestone[] {
  return [
    bandMilestone(skill, before, after, now, instrument),
    tempoMilestone(skill, before, after, now, instrument),
    stepMilestone(skill, before, after, now),
  ].filter((m): m is Milestone => m !== null)
}
