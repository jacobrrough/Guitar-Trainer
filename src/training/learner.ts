import {
  AT_TARGET_MIN_GAIN,
  BAND_THRESHOLDS,
  BELOW_TARGET_RATING,
  CEILING_MIN_ACCURACY,
  CEILING_WINDOW_ATTEMPTS,
  CEILING_WINDOW_DAYS,
  CLEAN_PERFORMANCE,
  ELO_SCALE,
  K_PRACTICE,
  K_TEST,
  LOW_CONFIDENCE_ATTEMPTS,
  LOW_CONFIDENCE_MULTIPLIER,
  RATING_GAIN,
  RATING_HEADROOM,
  START_TEMPO_RATING,
  REVIEW_START_EASE,
  RUST_GRACE_DAYS,
  RUST_MAX_POINTS,
  RUST_POINTS_PER_WEEK,
  SONG_FULL_SPEED,
  UNRELIABLE_K_DIVISOR,
} from './constants'
import type { Attempt, LearnerModel, MasteryBand, SkillDef, SkillState } from './types'

const DAY_MS = 86400000

export function newSkillState(skillId: string, initialRating = 0, now = Date.now()): SkillState {
  void now
  return {
    skillId,
    rating: initialRating,
    confidence: 0,
    tempoCeiling: 0,
    ease: REVIEW_START_EASE,
    intervalDays: 0,
    plateauStep: 0,
    attempts: 0,
  }
}

export function masteryBand(rating: number): MasteryBand {
  for (const { band, min } of BAND_THRESHOLDS) {
    if (rating >= min) return band
  }
  return 'new'
}

/** Rating minus rust: after the grace period, RUST_POINTS_PER_WEEK per week, capped at RUST_MAX_POINTS. */
export function effectiveRating(state: SkillState, now = Date.now()): number {
  if (state.lastPracticedAt === undefined) return state.rating
  const days = (now - state.lastPracticedAt) / DAY_MS
  let rust = 0
  if (days > RUST_GRACE_DAYS) rust = Math.min(RUST_MAX_POINTS, (RUST_POINTS_PER_WEEK * (days - RUST_GRACE_DAYS)) / 7)
  return Math.max(0, state.rating - rust)
}

export function expectedScore(rating: number, difficulty: number): number {
  return 1 / (1 + Math.pow(10, (difficulty - rating) / ELO_SCALE))
}

/**
 * How a run counts for the rating, 0..1. Real playing never reaches a performance of 1 (timing always
 * spreads a little), so a clean run, CLEAN_PERFORMANCE and up, is a full score. Without this the
 * expected score of an easy item (close to 1) was out of reach and every good run on it cost points.
 */
export function runScore(performance: number): number {
  return Math.min(1, Math.max(0, performance / CLEAN_PERFORMANCE))
}

/** What the rating needs to know about a run. The optional fields are there on every run the app records. */
type RatedRun = Pick<Attempt, 'kind' | 'performance' | 'difficulty' | 'reliable'> & Partial<Pick<Attempt, 'accuracy' | 'speed' | 'playedTempo'>>

/**
 * A practice run that hit enough notes to raise the tempo (CEILING_MIN_ACCURACY) is a clean run, whatever
 * the spread of its timing: a note only counts as hit when it was in time, and the Coach itself calls this
 * run "played cleanly" and asks for more speed after it. Counting it as less than clean kept such a
 * learner under the unlock line for good. Not when the learner slowed the exercise down (the item was
 * rated for the tempo that was asked), and not in a skill check, which keeps the whole measure.
 */
function cleanPractice(run: RatedRun): boolean {
  if (run.kind === 'test' || run.accuracy === undefined) return false
  return run.accuracy >= CEILING_MIN_ACCURACY && (run.speed ?? 1) >= SONG_FULL_SPEED
}

/**
 * Rating change for one run: K · (score − expected) · gain.
 * A clean run scores 1, which is never below what was expected, so it never lowers a rating.
 * A weaker run still lowers it when the rating promised more. A gain stops RATING_HEADROOM points
 * above the item's difficulty: easy material, however often and however well it is played, proves no more.
 * With the skill's own tempos (`tempos`: where its exercise starts and where it aims) two more things hold:
 * - slow rounds prove the skill up to "solid" and no further: the rest, up to just under "mastered", is
 *   earned on the way from the start tempo to the target tempo (START_TEMPO_RATING, BELOW_TARGET_RATING).
 *   What counts is the tempo the learner has shown: this run's own if it was accurate (85 % of the notes,
 *   not slowed down), otherwise no more than the fastest tempo already played that well. A rough round
 *   at a fast tempo proves nothing about that tempo;
 * - the Coach never asks for faster than the target tempo, so an accurate run there is all the skill
 *   can show: it may carry the rating all the way up, whatever the item's difficulty, and a clean
 *   practice round adds at least a point.
 */
export function ratingDelta(state: SkillState, attempt: RatedRun, tempos?: { start: number; target: number }): number {
  let k = attempt.kind === 'test' ? K_TEST : K_PRACTICE
  if (state.confidence < LOW_CONFIDENCE_ATTEMPTS) k *= LOW_CONFIDENCE_MULTIPLIER
  if (!attempt.reliable) k /= UNRELIABLE_K_DIVISOR
  const clean = cleanPractice(attempt)
  const score = clean ? 1 : runScore(attempt.performance)
  let delta = k * (score - expectedScore(state.rating, attempt.difficulty)) * RATING_GAIN
  let top = attempt.difficulty + RATING_HEADROOM
  // A run or a state stored without a tempo that can be read (an old backup) is rated by difficulty alone.
  if (tempos && attempt.playedTempo !== undefined && Number.isFinite(attempt.playedTempo)) {
    const accurate = (attempt.accuracy ?? 0) >= CEILING_MIN_ACCURACY && (attempt.speed ?? 1) >= SONG_FULL_SPEED
    const ceiling = Number.isFinite(state.tempoCeiling) ? state.tempoCeiling : 0
    const shown = accurate ? attempt.playedTempo : Math.min(attempt.playedTempo, ceiling)
    if (accurate && shown >= tempos.target) {
      top = 100
      if (clean) delta = Math.max(delta, attempt.reliable ? AT_TARGET_MIN_GAIN : 0)
    } else {
      top = Math.min(top, tempoProgressRating(shown, tempos))
    }
  }
  if (delta <= 0) return delta
  return Math.min(delta, Math.max(0, top - state.rating))
}

/**
 * The highest rating that playing shown at `tempo` can lead to while the target has not been played
 * accurately: START_TEMPO_RATING at the skill's start tempo (or below), BELOW_TARGET_RATING from its target up.
 */
export function tempoProgressRating(tempo: number, tempos: { start: number; target: number }): number {
  const span = tempos.target - tempos.start
  const progress = span > 0 ? Math.min(1, Math.max(0, (tempo - tempos.start) / span)) : tempo >= tempos.target ? 1 : 0
  return START_TEMPO_RATING + (BELOW_TARGET_RATING - START_TEMPO_RATING) * progress
}

/**
 * Among attempts in the last CEILING_WINDOW_DAYS, take the CEILING_WINDOW_ATTEMPTS most recent.
 * Ceiling = highest playedTempo with accuracy >= CEILING_MIN_ACCURACY; otherwise 0.8 x the slowest tempo; 0 when empty.
 * Runs the app scored from its own speaker (bleed) are left out: they say nothing about the player.
 */
export function updateTempoCeiling(attempts: Attempt[], now = Date.now()): number {
  const cutoff = now - CEILING_WINDOW_DAYS * DAY_MS
  const window = attempts
    .filter((a) => !a.bleed && a.at >= cutoff && a.at <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, CEILING_WINDOW_ATTEMPTS)
  if (window.length === 0) return 0
  const good = window.filter((a) => a.accuracy >= CEILING_MIN_ACCURACY)
  if (good.length > 0) return Math.max(...good.map((a) => a.playedTempo))
  return 0.8 * Math.min(...window.map((a) => a.playedTempo))
}

/**
 * Returns a new state with the attempt applied. Confidence uses the incremental form of the
 * recency-weighted attempt count: c' = c * exp(-daysSinceLastPractice / 30) + 1.
 * A bleed attempt (the microphone heard the app's own guitar part) is no evidence, so the state comes back as it was.
 */
export function applyAttempt(
  state: SkillState,
  attempt: Attempt,
  skill: SkillDef,
  recentAttempts: Attempt[] = [],
  now = attempt.at,
): SkillState {
  if (attempt.bleed) return state
  const rating = Math.min(100, Math.max(0, state.rating + ratingDelta(state, attempt, { start: skill.startTempo, target: skill.targetTempo })))
  const days = state.lastPracticedAt === undefined ? 0 : Math.max(0, (now - state.lastPracticedAt) / DAY_MS)
  const measured = updateTempoCeiling([...recentAttempts, attempt], now)
  // A warm-up is played cold and below the ceiling on purpose: it says nothing against the ceiling, so it
  // can raise it but never lower it. Clean ones would otherwise push every faster run out of the recent
  // window, and each rough one cut the ceiling to nine tenths with no way back up (the skill a learner
  // plays best is the daily warm-up and is not a main exercise): 100 bpm became 53 in a month. A rough
  // warm-up slows the rest of that day instead (the day factor), and still costs rating points.
  const warmup = attempt.kind === 'warmup'
  const next: SkillState = {
    ...state,
    rating,
    confidence: state.confidence * Math.exp(-days / 30) + 1,
    attempts: state.attempts + 1,
    lastPracticedAt: now,
    tempoCeiling: warmup ? Math.max(state.tempoCeiling, measured) : measured,
  }
  if (attempt.kind === 'test') next.lastTestedAt = now
  return next
}

export function applyToModel(model: LearnerModel, attempt: Attempt, skill: SkillDef, recentAttempts: Attempt[] = []): LearnerModel {
  if (attempt.bleed) return model
  const current = model.skills[skill.id] ?? newSkillState(skill.id, 0, attempt.at)
  return { ...model, skills: { ...model.skills, [skill.id]: applyAttempt(current, attempt, skill, recentAttempts) } }
}
