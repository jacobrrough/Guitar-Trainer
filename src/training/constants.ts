import type { MasteryBand, NoteValue, Prefs } from './types'

/** Tier base difficulty (docs §4.2). */
export const TIER_BASE: Record<0 | 1 | 2 | 3 | 4, number> = { 0: 10, 1: 20, 2: 40, 3: 60, 4: 80 }

/** Density bonus by note value (docs §4.2). */
export const DENSITY_BONUS: Record<NoteValue, number> = { whole: -10, half: -6, quarter: 0, eighth: 8, triplet: 12, sixteenth: 16 }

/** Difficulty points per technique present (bend, slide, hammer/pull, palm mute). */
export const TECHNIQUE_BONUS = 5

/** Difficulty points per octave of tempo relative to the skill's reference tempo. */
export const TEMPO_DIFFICULTY_SLOPE = 30

/** Elo update constants (docs §4.2). */
export const K_PRACTICE = 6
export const K_TEST = 12
export const LOW_CONFIDENCE_ATTEMPTS = 5
export const LOW_CONFIDENCE_MULTIPLIER = 1.5
export const UNRELIABLE_K_DIVISOR = 3
export const ELO_SCALE = 25
/** Rating change = K · (score − expected) · RATING_GAIN */
export const RATING_GAIN = 2
/**
 * A run with at least this performance is a clean run and counts as a full score for the rating.
 * It is the mark that passes a review: about 90 % of the notes with ordinary timing.
 */
export const CLEAN_PERFORMANCE = 0.85
/**
 * A run can lift a rating to this many points above the item's difficulty and no further.
 * It is the distance from a tier 1 exercise at its reference tempo (20) to the unlock line (60):
 * playing a skill cleanly at that tempo is just enough to open what builds on it.
 */
export const RATING_HEADROOM = 40
/**
 * How far clean runs at a skill's start tempo can carry its rating: to "solid", which opens what builds
 * on it. The rest, up to 100, is earned on the way to the skill's target tempo. Without this a hard
 * skill (a high item difficulty already at the slowest tempo) was "mastered" after a few slow rounds
 * and dropped out of the plan before it had ever been played at speed.
 */
export const START_TEMPO_RATING = 75
/**
 * ...and how far rounds below the target tempo can carry it: to just under "mastered" (90). In every
 * tier "mastered" then means the same thing, played cleanly at the tempo the skill aims for, and a
 * skill stays a main exercise until it has been. (With a stop that ran up to 100, a hard skill left
 * the plan 40 % short of its target while an easy one had to reach it.)
 */
export const BELOW_TARGET_RATING = 89
/**
 * A clean practice round at the skill's target tempo adds at least this much. The usual step shrinks as
 * the rating climbs above the item's difficulty, which would make the last points of an easy skill
 * take hundreds of rounds.
 */
export const AT_TARGET_MIN_GAIN = 1

/** Performance weights (docs §4.2). */
export const PERF_WEIGHTS = { acc: 0.6, tim: 0.25, tmp: 0.15 } as const
export const GOOD_HIT_WEIGHT = 0.8
export const TIMING_SIGMA_FULL_MS = 80
export const MIN_HITS_FOR_TIMING = 8

/** Reliability thresholds (docs §5). */
export const MIN_COVERAGE = 0.6
export const CALIBRATION_MAX_AGE_DAYS = 30
export const TIMING_BIAS_WARN_MS = 40

/** Tempo ceiling (docs §4.2). */
export const CEILING_MIN_ACCURACY = 0.85
export const CEILING_WINDOW_ATTEMPTS = 10
export const CEILING_WINDOW_DAYS = 30

/** Rust (docs §4.2). */
export const RUST_GRACE_DAYS = 14
export const RUST_POINTS_PER_WEEK = 2
export const RUST_MAX_POINTS = 20

/** Mastery bands (docs §4.1). */
export const BAND_THRESHOLDS: { band: MasteryBand; min: number }[] = [
  { band: 'mastered', min: 90 },
  { band: 'solid', min: 75 },
  { band: 'developing', min: 50 },
  { band: 'learning', min: 20 },
  { band: 'new', min: 0 },
]
export const UNLOCK_RATING = 60

/** Review scheduling (docs §4.4). */
export const REVIEW_FIRST_INTERVAL_DAYS = 2
export const REVIEW_START_EASE = 2.3
export const REVIEW_MAX_EASE = 2.8
export const REVIEW_MIN_EASE = 1.3
export const REVIEW_PASS_P = 0.85
export const REVIEW_HOLD_P = 0.7

/** Session templates in minutes per block (docs §6.2). */
export const SESSION_TEMPLATES: Record<Prefs['dailyMinutes'], { warmup: number; focus: number; second: number; song: number; review: number; ear: number }> = {
  10: { warmup: 0, focus: 5, second: 0, song: 4, review: 1, ear: 0 },
  20: { warmup: 3, focus: 7, second: 0, song: 7, review: 3, ear: 0 },
  30: { warmup: 3, focus: 8, second: 6, song: 9, review: 4, ear: 0 },
  45: { warmup: 4, focus: 10, second: 8, song: 15, review: 5, ear: 3 },
}
export const CHECKPOINT_MINUTES = 5
export const MONTHLY_MINUTES = 10
export const PLACEMENT_MINUTES = 7

/** In-session adaptation (docs §6.4). */
export const START_TEMPO_FACTOR = 1.05
/**
 * A clean warm-up (the mark that counts for the tempo ceiling) is an ordinary day. The line used to be
 * 0.9: a learner playing a steady 85 to 89 % was slowed by 5 % every day, which cancelled the 5 % step
 * of START_TEMPO_FACTOR, so their tempo never rose and their skills never reached the unlock line.
 */
export const DAY_FACTOR_BY_WARMUP = [
  { minAcc: CEILING_MIN_ACCURACY, factor: 1.0 },
  { minAcc: 0.75, factor: 0.95 },
  { minAcc: 0, factor: 0.9 },
]
export const REP_TEMPO_UP = 0.05
export const REP_TEMPO_DOWN = 0.08
/**
 * Two rounds in a row at one tempo that were neither clean nor rough (between REP_DOWN_ACCURACY and
 * REP_UP_ACCURACY): the tempo is a touch too fast, and the next round eases off by this much. Without
 * it a whole block could go by at such a tempo with nothing getting faster or slower and no clean round.
 */
export const REP_TEMPO_EASE = 0.05
export const MAX_SESSION_TEMPO_GAIN = 0.15
/**
 * A round this clean is followed by a faster one. It is the same line as everywhere else in the Coach
 * (CEILING_MIN_ACCURACY: the tempo ceiling, the day factor, a full score for the rating). It used to be
 * 0.9: a learner playing a steady 85 to 89 % was told the round was clean and then kept at the same
 * tempo, and needed weeks for what a 90 % learner did in days.
 */
export const REP_UP_ACCURACY = CEILING_MIN_ACCURACY
export const REP_DOWN_ACCURACY = 0.75
export const REP_FALLBACK_ACCURACY = 0.6

/** Focus selection (docs §6.3). */
export const GOAL_WEIGHT_MATCH = 1.5
export const GOAL_WEIGHT_OTHER = 0.6
export const GOAL_WEIGHT_ALL_ROUND = 1.0
export const FOCUS_REPEAT_LIMIT_DAYS = 2

/** Song level targeting (docs §6.4). */
export const SONG_LEVEL_UP_ACCURACY = 0.9
export const SONG_TARGET_ACCURACY = 0.85
export const SONG_SLOW_DOWN_ACCURACY = 0.7
/** Song speeds the Coach uses, slowest first. A song moves one step at a time, and only one of level or speed changes. */
export const SONG_SPEED_STEPS = [0.75, 0.85, 1]
/** Speeds from here up count as full speed (rounding in the speed control). */
export const SONG_FULL_SPEED = 0.99
/** This many results in a row under SONG_SLOW_DOWN_ACCURACY on one level send the song back a level. */
export const SONG_LEVEL_DOWN_MISSES = 2
export const WEAK_BAR_ACCURACY = 0.7

/** Tests (docs §7). */
export const CHECKPOINT_MIN_DAYS = 6
export const CHECKPOINT_MIN_SESSIONS = 3
export const MONTHLY_MIN_DAYS = 28
export const TEST_PASS: { minAccuracy: number; maxMedianMs: number; maxStdevMs: number } = { minAccuracy: 0.85, maxMedianMs: 30, maxStdevMs: 60 }
export const PLACEMENT_STOP_AFTER_FAILS = 2
export const PLACEMENT_PASS_OFFSET = 10
export const PLACEMENT_INHERIT_OFFSET = 15
/**
 * A passed placement task rates its skills, and everything they build on, at least this high:
 * above UNLOCK_RATING, so a player is never locked out of something they have just shown they can do.
 */
export const PLACEMENT_PASS_MIN_RATING = 65
/** A placement task that was not passed never rates its skills above this: a miss means "not yet", however hard the task was. */
export const PLACEMENT_MISS_MAX_RATING = 55

/** Plateau detection (docs §8.1). */
export const PLATEAU_MIN_ATTEMPTS = 8
export const PLATEAU_MIN_DAYS = 14
export const PLATEAU_MAX_SLOPE_PER_DAY = 0.3
export const PLATEAU_RATING_BELOW = 75

/** Comeback (docs §8). */
export const COMEBACK_AFTER_DAYS = 7
export const COMEBACK_TEMPO_FACTOR = 0.9

/** Default exercise audio. */
export const BACKING_SAMPLE_RATE = 44100

/** Chroma chord scoring (docs §5; roadmap "chord detection for scoring"). */
export const CHORD_CHROMA_MATCH = 0.75
/** Fraction of a chord's pitch classes that must be present for a hit. */
export const CHORD_MIN_PRESENT = 0.6
/** A chroma bin counts as present when it reaches this fraction of the strongest bin. */
export const CHROMA_PRESENT_RATIO = 0.3
export const CHROMA_MIN_FREQ = 70
export const CHROMA_MAX_FREQ = 1500

/** Bends are judged on the reached pitch within this many semitones (25 cents). */
export const BEND_TOLERANCE_SEMIS = 0.25

/** Ear training (tuneByEar). */
export const EAR_PROMPTS = 8
export const EAR_RESPONSE_SECONDS = 6
export const EAR_PERFECT_CENTS = 25
export const EAR_GOOD_CENTS = 50

/** Milestones. */
export const MILESTONE_TEMPO_STEP = 10
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100]

/**
 * First steps (tier 0). A learner whose best tier 0–1 rating is below BEGINNER_MAX_RATING
 * gets tier 0–1 skills only, the sparsest song level slowed to BEGINNER_SONG_SPEED,
 * and a warm-up on something comfortable rather than the chromatic spider.
 * Only the foundation skills count: one early lesson on a harder skill does not end beginner mode.
 * From this rating on a skill also counts as something the learner "can do" when the planner
 * decides how far up the tiers the next exercise may reach.
 */
export const BEGINNER_MAX_RATING = 25
/** A skill stops being "new to the learner" after this many recorded rounds, or once it reaches UNLOCK_RATING. */
export const FAMILIAR_ATTEMPTS = 10
/** While this many skills are still new to the learner, the planner does not start another brand-new one. */
export const MAX_SKILLS_BEING_LEARNED = 2
export const BEGINNER_SONG_SPEED = 0.75
/** A skill rated at least this is "comfortable" enough to warm up on. */
export const WARMUP_COMFORT_RATING = 40

/**
 * Revision of the default drills. Raised when a drill changes so much that a tempo earned on the old
 * one no longer means the same (migrate.ts corrects the stored tempos once).
 */
export const DRILL_REV = 2
