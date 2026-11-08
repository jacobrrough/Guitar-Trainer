import {
  BAND_THRESHOLDS,
  CEILING_MIN_ACCURACY,
  CEILING_WINDOW_ATTEMPTS,
  CEILING_WINDOW_DAYS,
  ELO_SCALE,
  K_PRACTICE,
  K_TEST,
  LOW_CONFIDENCE_ATTEMPTS,
  LOW_CONFIDENCE_MULTIPLIER,
  PROVISIONAL_RATING_CAP,
  RATING_GAIN,
  REVIEW_START_EASE,
  RUST_GRACE_DAYS,
  RUST_MAX_POINTS,
  RUST_POINTS_PER_WEEK,
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

export function ratingDelta(
  state: SkillState,
  attempt: Pick<Attempt, 'kind' | 'performance' | 'difficulty' | 'reliable'>,
): number {
  let k = attempt.kind === 'test' ? K_TEST : K_PRACTICE
  if (state.confidence < LOW_CONFIDENCE_ATTEMPTS) k *= LOW_CONFIDENCE_MULTIPLIER
  if (!attempt.reliable) k /= UNRELIABLE_K_DIVISOR
  return k * (attempt.performance - expectedScore(state.rating, attempt.difficulty)) * RATING_GAIN
}

/**
 * Among attempts in the last CEILING_WINDOW_DAYS, take the CEILING_WINDOW_ATTEMPTS most recent.
 * Ceiling = highest playedTempo with accuracy >= CEILING_MIN_ACCURACY; otherwise 0.8 x the slowest tempo; 0 when empty.
 */
export function updateTempoCeiling(attempts: Attempt[], now = Date.now()): number {
  const cutoff = now - CEILING_WINDOW_DAYS * DAY_MS
  const window = attempts
    .filter((a) => a.at >= cutoff && a.at <= now)
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
 */
export function applyAttempt(
  state: SkillState,
  attempt: Attempt,
  skill: SkillDef,
  recentAttempts: Attempt[] = [],
  now = attempt.at,
): SkillState {
  let rating = Math.min(100, Math.max(0, state.rating + ratingDelta(state, attempt)))
  // Chroma-scored attempts judge whole chords reliably, so the provisional cap only guards pitch-scored ones.
  if (skill.provisional && attempt.chordScoring !== 'chroma') rating = Math.min(rating, PROVISIONAL_RATING_CAP)
  const days = state.lastPracticedAt === undefined ? 0 : Math.max(0, (now - state.lastPracticedAt) / DAY_MS)
  const next: SkillState = {
    ...state,
    rating,
    confidence: state.confidence * Math.exp(-days / 30) + 1,
    attempts: state.attempts + 1,
    lastPracticedAt: now,
    tempoCeiling: updateTempoCeiling([...recentAttempts, attempt], now),
  }
  if (attempt.kind === 'test') next.lastTestedAt = now
  return next
}

export function applyToModel(model: LearnerModel, attempt: Attempt, skill: SkillDef, recentAttempts: Attempt[] = []): LearnerModel {
  const current = model.skills[skill.id] ?? newSkillState(skill.id, 0, attempt.at)
  return { ...model, skills: { ...model.skills, [skill.id]: applyAttempt(current, attempt, skill, recentAttempts) } }
}
