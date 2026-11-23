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
  REP_FALLBACK_ACCURACY,
  START_TEMPO_RATING,
  REVIEW_START_EASE,
  RUST_GRACE_DAYS,
  RUST_MAX_POINTS,
  RUST_POINTS_PER_WEEK,
  SONG_FULL_SPEED,
  STEP_DOWN_LOW_RUNS,
  STEP_UP_CLEAN_RUNS,
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

/** The last step of a skill's ladder; -1 for a skill without steps. */
function lastStepOf(skill: SkillDef): number {
  return (skill.steps?.length ?? 0) - 1
}

/**
 * A step of a ladder read from a stored value (a state, the params of a block or of a run): a whole
 * number from 0 to `top`, or `fallback` when the value is not a number. Stored steps are read through
 * this everywhere, so a ladder that was shortened, or a row from an old backup, never points past its end.
 */
export function stepWithin(value: unknown, top: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(top, Math.max(0, n))
}

/** The step a run of a step skill was on. A run that does not say counts as the first step: it proves the least. */
function stepOfRun(attempt: Pick<Attempt, 'params'>, lastStep: number): number {
  return stepWithin(attempt.params?.step, lastStep, 0)
}

/**
 * Rating change for a run of a step skill (a skill with `steps`: one tempo, harder content step by
 * step). It is `ratingDelta`, unchanged, with the ladder where the tempos are: the step of the run is
 * the tempo played, the step below the one practice starts from is the ceiling (the highest step
 * already shown), and the ladder runs from 0 to the highest step this learner can reach. So a gain stops
 * RATING_HEADROOM above the difficulty of the step, no step below the top leads further than "solid"
 * to just under "mastered", and only an accurate run on the top step carries the rating all the way.
 *
 * The top is the last step, or the limit the run carries (`params.maxStep`: a small voice range does
 * not hold every step). Without that a singer with a small range could never finish the skill.
 *
 * Why not the tempos: a step skill has one tempo, its start and its target, so by the tempo rule every
 * accurate run would be "at the target" and the easiest step would carry the rating to the top.
 */
function stepRatingDelta(state: SkillState, attempt: Attempt, lastStep: number): number {
  const top = stepWithin(attempt.params?.maxStep, lastStep, lastStep)
  const shown = Math.max(0, stepWithin(state.step, lastStep, 0) - 1)
  return ratingDelta({ ...state, tempoCeiling: shown }, { ...attempt, playedTempo: stepOfRun(attempt, lastStep) }, { start: 0, target: top })
}

/**
 * The step practice starts from, after this run: to a step skill what the tempo ceiling is to the others.
 * Looked at are the CEILING_WINDOW_ATTEMPTS most recent runs of the last CEILING_WINDOW_DAYS that count
 * (not scored from the speaker, not partial), this one included.
 * - Up: this run was clean (CEILING_MIN_ACCURACY, and heard well enough to be relied on) and with it
 *   there are STEP_UP_CLEAN_RUNS such runs on a step or above it: the step after that one is open.
 *   A clean run on a step counts for the steps below it too. One step at a time, never past the top
 *   (the last step, or the limit the run carries), and never down by this rule.
 * - Down: the last STEP_DOWN_LOW_RUNS runs were all under REP_FALLBACK_ACCURACY, each on the step
 *   reached or below it: one step back. Runs on a step above the one reached say nothing against it.
 *   In a block the Coach follows a rough round with the step below, so those runs are on ever easier
 *   steps and each further low one takes another step back: a learner under 60 % all the way down the
 *   ladder starts from its first step next time. The first round that is not low stops it.
 * A warm-up is sung cold and one step easier on purpose: it can raise the step, never lower it.
 */
function nextStep(state: SkillState, attempt: Attempt, lastStep: number, recentAttempts: Attempt[], now: number): number {
  const current = stepWithin(state.step, lastStep, 0)
  if (attempt.partial) return current
  const cutoff = now - CEILING_WINDOW_DAYS * DAY_MS
  const window = [...recentAttempts, attempt]
    .filter((a) => !a.bleed && !a.partial && a.at >= cutoff && a.at <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, CEILING_WINDOW_ATTEMPTS)
  const clean = (a: Attempt) => a.reliable && a.accuracy >= CEILING_MIN_ACCURACY
  if (clean(attempt)) {
    const top = stepWithin(attempt.params?.maxStep, lastStep, lastStep)
    const cleanSteps = window.filter(clean).map((a) => stepOfRun(a, lastStep))
    for (let s = stepOfRun(attempt, lastStep); s >= 0; s--) {
      if (cleanSteps.filter((step) => step >= s).length >= STEP_UP_CLEAN_RUNS) return Math.max(current, Math.min(s + 1, top))
    }
    return current
  }
  if (attempt.kind === 'warmup') return current
  const latest = window.slice(0, STEP_DOWN_LOW_RUNS)
  const low = latest.length === STEP_DOWN_LOW_RUNS && latest.every((a) => a.accuracy < REP_FALLBACK_ACCURACY && stepOfRun(a, lastStep) <= current)
  return low ? Math.max(0, current - 1) : current
}

/**
 * Returns a new state with the attempt applied. Confidence uses the incremental form of the
 * recency-weighted attempt count: c' = c * exp(-daysSinceLastPractice / 30) + 1.
 * A bleed attempt (the microphone heard the app's own guitar part) is no evidence, so the state comes back as it was.
 * A skill with steps is rated on its ladder (`stepRatingDelta`) and keeps the step practice starts from
 * (`nextStep`); for every other skill nothing here has changed, and its state never gets a `step`.
 */
export function applyAttempt(
  state: SkillState,
  attempt: Attempt,
  skill: SkillDef,
  recentAttempts: Attempt[] = [],
  now = attempt.at,
): SkillState {
  if (attempt.bleed) return state
  const lastStep = lastStepOf(skill)
  const delta = lastStep >= 0 ? stepRatingDelta(state, attempt, lastStep) : ratingDelta(state, attempt, { start: skill.startTempo, target: skill.targetTempo })
  const rating = Math.min(100, Math.max(0, state.rating + delta))
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
  if (lastStep >= 0) next.step = nextStep(state, attempt, lastStep, recentAttempts, now)
  if (attempt.kind === 'test') next.lastTestedAt = now
  return next
}

export function applyToModel(model: LearnerModel, attempt: Attempt, skill: SkillDef, recentAttempts: Attempt[] = []): LearnerModel {
  if (attempt.bleed) return model
  const current = model.skills[skill.id] ?? newSkillState(skill.id, 0, attempt.at)
  return { ...model, skills: { ...model.skills, [skill.id]: applyAttempt(current, attempt, skill, recentAttempts) } }
}
