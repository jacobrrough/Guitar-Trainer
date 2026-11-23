/**
 * Shared contracts for the adaptive training system ("Coach").
 * See docs/ADAPTIVE_TRAINING.md for the design these types implement.
 * Every module under src/training imports from here; keep it dependency-free
 * apart from the chart model.
 */
import type { Chart } from '../chart/types'

/**
 * Which side of the app a stored row belongs to. Rows stored before singing existed carry no stamp and
 * read as guitar: always go through `instrumentOf` (src/training/instruments.ts), never compare the field.
 */
export type InstrumentId = 'guitar' | 'voice'

/** The last three are the singing categories ("Staying in tune", "Higher and lower", "Breath"). */
export type SkillCategory = 'fretting' | 'picking' | 'chords' | 'lead' | 'timing' | 'ear' | 'pitch' | 'range' | 'breath'
export type NoteValue = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'triplet'
export type Goal = 'songs' | 'rhythm' | 'lead' | 'technique' | 'all-round'
export type MasteryBand = 'new' | 'learning' | 'developing' | 'solid' | 'mastered'

/**
 * One rung of a step ladder. Where slower is not easier (a held note, a slide, a longer line), a skill
 * keeps one tempo and its content gets harder step by step instead.
 */
export interface SkillStep {
  /** What this step asks for, in the learner's words (e.g. "6 beats"); shown on round cards and milestones. */
  label: string
  /** Generator params that make this step. */
  params: Record<string, unknown>
  /** Added to the item difficulty at this step. */
  bonus: number
  /** Semitones of range the step needs; absent = fits any stored range. */
  span?: number
}

export interface SkillDef {
  id: string
  name: string
  category: SkillCategory
  /** 0 = first steps (open strings, first frets), 1–4 as in docs §3. */
  tier: 0 | 1 | 2 | 3 | 4
  prerequisites: string[]
  /** Tempo (bpm) at which an exercise for this skill has difficulty = tier base. */
  refTempo: number
  /** Tempo used the very first time the skill is practised. */
  startTempo: number
  /** Tempo at which the skill counts as mastered. */
  targetTempo: number
  description: string
  tips: string[]
  /** Exercise generator ids usable for this skill; the first is the default. */
  generators: string[]
  /** The Coach never asks for this skill under this tempo; absent = the planner's general floor. */
  minTempo?: number
  /** Step ladder, easiest first. A skill with steps is practised at one fixed tempo (ref = start = target). */
  steps?: SkillStep[]
}

export interface SkillState {
  skillId: string
  /** 0–100, Elo-style (docs §4.1). */
  rating: number
  /** Recency-weighted attempt count. */
  confidence: number
  /** Highest tempo with ≥ 85 % accuracy recently; 0 = unknown. */
  tempoCeiling: number
  lastPracticedAt?: number
  lastTestedAt?: number
  /** Review scheduling (docs §4.4). */
  ease: number
  intervalDays: number
  nextReviewAt?: number
  /** Last plateau intervention applied (docs §8.1), 0 = none. */
  plateauStep: number
  pinned?: boolean
  attempts: number
  /**
   * Skills with a step ladder: the step practice starts from (index into `SkillDef.steps`), which is to
   * them what the tempo ceiling is to the others. Absent = 0.
   */
  step?: number
}

export type AttemptKind = 'warmup' | 'practice' | 'song' | 'review' | 'test'

/** Raw numbers the scoring engine produces for one block/rep/task. */
export interface AttemptResult {
  perfects: number
  goods: number
  misses: number
  /** Groups that counted (perfects + goods + misses). */
  total: number
  /** Median signed timing error of hits, ms (positive = late); null with < 8 hits. */
  timingMedianMs: number | null
  /** Standard deviation of hit timing errors after removing the median, ms; null with < 8 hits. */
  timingStdevMs: number | null
  /** Fraction (0..1) of expected-note windows in which a clear pitch was heard. */
  coverage: number
  durationSec: number
  /** Effective tempo played (song/exercise bpm × speed). */
  playedTempo: number
  /** Tempo the block asked for. */
  targetTempo: number
  /** Playback speed multiplier used (1 = normal). */
  speed: number
  /** Accuracy per bar index (0..1), when bars are known. */
  perBar?: number[]
  /**
   * How chord groups were judged. Kept for runs stored by earlier versions: the first scorer took any
   * one tone of a chord ('pitch'), and chord skills were capped while it did. Every run is now judged
   * on the whole chord and says 'chroma'; nothing reads this any more.
   */
  chordScoring?: 'pitch' | 'chroma'
  /** The microphone was hearing the device's own playback (speaker bleed): the run scored itself. */
  bleed?: boolean
  /**
   * The run did not cover the whole piece as shown: it began in the middle, was moved or changed
   * speed on the way, or the microphone was off or silent for a stretch. Practice, not a result.
   */
  partial?: boolean
  /**
   * Sung runs only. `medianCents`: median distance from the written notes in cents, octave folded
   * (negative = under the note); null when there was nothing to measure. `topMissed`: missed notes among
   * the top three semitones of the piece that came out low or were not heard, the sign that the key
   * sits too high.
   */
  voice?: { medianCents: number | null; topMissed: number }
}

export interface Performance {
  /** (perfects + 0.8·goods) / total */
  acc: number
  /** Timing precision 0..1 */
  tim: number
  /** Tempo factor 0..1 */
  tmp: number
  /** Combined performance 0..1 */
  p: number
  reliable: boolean
  /** Human-readable reasons when unreliable (e.g. "low coverage"). */
  reasons: string[]
}

export interface Attempt extends AttemptResult {
  id?: number
  at: number
  kind: AttemptKind
  skillId?: string
  songId?: number
  level?: number
  exerciseId?: string
  params?: ExerciseParams
  /** Item difficulty the attempt was judged against (docs §4.2). */
  difficulty: number
  performance: number
  accuracy: number
  reliable: boolean
  sessionId?: number
  /** Skill rating after this attempt was applied (for progress charts and plateau detection). */
  ratingAfter?: number
  /** Absent = guitar. */
  instrument?: InstrumentId
}

export interface ExerciseParams {
  tempo: number
  bars: number
  noteValue?: NoteValue
  /** Key root as a pitch class name, e.g. "A", "E", "G". */
  key?: string
  /** Fretboard position (lowest fret of the hand position). */
  position?: number
  /** Generator-specific extras (chord names, pattern strings, scale ids …). */
  [extra: string]: unknown
}

export interface GeneratedExercise {
  /** Stable id: `${generatorId}:${hash of params}` */
  id: string
  generatorId: string
  skillId: string
  title: string
  chart: Chart
  /** Difficulty d (docs §4.2) for these params. */
  difficulty: number
  params: ExerciseParams
  /** Mono PCM backing track (click and drums, no part) played while the mic scores; null until rendered. */
  backing: Float32Array | null
  /** Same backing with the part's notes played, for listening; null for chord/strum drills and tests. */
  guide?: Float32Array | null
  /** A listening guide should be rendered for this exercise (see `renderExerciseGuide`). */
  wantsGuide?: boolean
  backingSampleRate: number
  /** Short instructions shown before the block. */
  instructions: string
  /**
   * How the exercise is run: on the note highway (default) or by the ear trainer,
   * which plays each chart note as a reference and listens for the player to
   * find and play it back.
   */
  interaction?: 'highway' | 'ear'
}

export interface ExerciseGenerator {
  id: string
  name: string
  /** Sensible params for a skill at a tempo (bars, note value, key …). */
  defaults(skill: SkillDef, tempo: number): ExerciseParams
  /** Deterministic for identical params. */
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise
}

export interface SongItemState {
  /** `${songId}:${level}` */
  key: string
  songId: number
  /** 0-based index into generateLevels(chart) (0 = Level 1 … 5 = Full). Used throughout the training layer. */
  level: number
  bestAccuracy: number | null
  lastAt: number | null
  ease: number
  intervalDays: number
  nextReviewAt?: number
  weakBars: number[]
  /** Best accuracy at full speed only. Absent on items stored before speeds were tracked. */
  fullSpeedBest?: number
  /** Accuracy and speed of the most recent play. */
  lastAccuracy?: number
  lastSpeed?: number
  /** How many plays in a row, up to the most recent, scored under the slow-down accuracy. */
  lowStreak?: number
  /** Absent = guitar. */
  instrument?: InstrumentId
}

export interface SongSummary {
  id: number
  title: string
  artist: string
  duration: number
  bpm: number
  /** Note counts per level index 0..5 (from generateLevels). */
  levelNoteCounts: number[]
  /** Bundled songs: its id, and the lesson after which a beginner can play it (1 = after lesson 1). */
  builtinId?: string
  lessonLevel?: number
  /** Seconds one pass lasts at each level index, where levels differ in length (an echo level lasts about twice the tune); absent = `duration`. */
  levelDurations?: number[]
  /** Absent = guitar. */
  instrument?: InstrumentId
}

export interface Prefs {
  dailyMinutes: 10 | 20 | 30 | 45
  goals: Goal[]
  pinnedSkillId?: string
}

/**
 * A singer's comfortable notes, as MIDI numbers. `low` and `high` are both inclusive: every note the app
 * asks for satisfies low <= midi <= high. The headroom is already taken off, so nothing is added or
 * subtracted when a song or an exercise is placed.
 */
export interface VoiceRange {
  /** Lowest note asked for (inclusive MIDI number). */
  low: number
  /** Highest note asked for (inclusive MIDI number). */
  high: number
  /** The note that feels easiest; exercises start around it. */
  easy: number
  /** The edges the range finder heard, before the headroom was taken off. */
  measuredLow?: number
  measuredHigh?: number
  /** 'measured' by the range finder, 'default' = a starting range the app chose instead, 'manual' = moved by hand ("a bit lower", "a bit higher"). */
  source: 'measured' | 'default' | 'manual'
  /** When it was set, ms since epoch. */
  at: number
}

/** What only the singing profile (row 2) carries. It lives here, not in the settings, because backups do not carry settings. */
export interface VoiceProfile {
  range?: VoiceRange
  /** Semitones a song is moved away from its chosen key, by bundled song id (-3 to +3). */
  keyNudge?: Record<string, number>
  /** The local date (YYYY-MM-DD) on which the singer said "My voice is tired". */
  tiredOn?: string
}

export interface Profile {
  /** Row 1 is the guitar profile, row 2 the singing profile (see `profileIdFor`). */
  id: 1 | 2
  goals: Goal[]
  dailyMinutes: 10 | 20 | 30 | 45
  startedAt: number
  streak: number
  longestStreak: number
  lastSessionDate?: string
  placementDoneAt?: number
  lastCheckpointAt?: number
  lastMonthlyAt?: number
  sessionsSinceTest: number
  pinnedSkillId?: string
  /** 'new' = never played (First steps course), 'some' = a little, 'played' = placement test path. */
  experience?: 'new' | 'some' | 'played'
  firstStepsStartedAt?: number
  firstStepsDoneAt?: number
  /** Built-in song the learner picked as a target during setup. */
  goalSongId?: string
  /** Revision of the drills the stored tempos were earned on (see migrate.ts); missing = before revisions. */
  drillRev?: number
  /** Absent = guitar. */
  instrument?: InstrumentId
  /** Singing profile only: range, key choices and the tired mark. */
  voice?: VoiceProfile
}

export interface LearnerModel {
  skills: Record<string, SkillState>
  songItems: Record<string, SongItemState>
  profile: Profile
}

export type BlockKind = 'warmup' | 'focus' | 'second' | 'song' | 'review' | 'test' | 'ear'
export type BlockStatus = 'pending' | 'active' | 'done' | 'skipped'

export interface ExerciseBlock {
  id: string
  kind: 'warmup' | 'focus' | 'second' | 'review' | 'ear'
  status: BlockStatus
  minutes: number
  skillId: string
  generatorId: string
  params: ExerciseParams
  tempo: number
  reps: number
  reason: string
}

export interface SongBlock {
  id: string
  kind: 'song'
  status: BlockStatus
  minutes: number
  songId: number
  /** 0-based level index (see SongItemState.level). */
  level: number
  speed: number
  /** Inclusive bar range to loop for the first half of the block. */
  loopBars?: [number, number]
  /** How many times the song is played through, so the block lasts about its minutes. Absent = once. */
  passes?: number
  reason: string
}

export interface TestBlock {
  id: string
  kind: 'test'
  status: BlockStatus
  minutes: number
  test: 'placement' | 'checkpoint' | 'monthly'
  reason: string
}

export type Block = ExerciseBlock | SongBlock | TestBlock

export interface SessionPlan {
  /** YYYY-MM-DD in local time. */
  date: string
  minutes: number
  /** Tempo multiplier for the day, set by the warm-up (docs §6.4). */
  dayFactor: number
  blocks: Block[]
  /** Why this session looks the way it does. */
  explanation: string[]
}

export interface SessionRecord {
  id?: number
  date: string
  plan: SessionPlan
  minutesDone: number
  completedBlockIds: string[]
  startedAt: number
  finishedAt?: number
  /**
   * One session per instrument and day (unique index `[instrument+date]`). `saveSession` stamps every row
   * it stores. A row without the stamp sits outside that index: write a session through `saveSession`, or
   * with the stamp already on it.
   */
  instrument?: InstrumentId
}

export type TestType = 'placement' | 'checkpoint' | 'monthly'

export interface PassCriteria {
  minAccuracy: number
  maxMedianMs: number
  maxStdevMs: number
}

export interface TestTask {
  id: string
  title: string
  instructions: string
  /** Skills this task provides evidence for. */
  skillIds: string[]
  generatorId: string
  params: ExerciseParams
  /** Difficulty d of the task (docs §4.2). */
  difficulty: number
  passCriteria: PassCriteria
}

export interface TestTaskResult {
  taskId: string
  attempt: Attempt
  passed: boolean
}

export interface TestRecord {
  id?: number
  at: number
  type: TestType
  tasks: TestTask[]
  results: TestTaskResult[]
  report: TestReport
  /** Absent = guitar. */
  instrument?: InstrumentId
}

export interface TestReport {
  headline: string
  lines: string[]
  /** skillId → rating delta applied by this test. */
  ratingDeltas: Record<string, number>
  /** Suggested focus skills for the coming period. */
  nextFocus: string[]
}

export type RecommendationAction =
  | { type: 'practice'; skillId: string; tempo?: number; generatorId?: string }
  | { type: 'song'; songId: number; level: number; speed: number; loopBars?: [number, number] }
  | { type: 'calibrate' }
  | { type: 'test'; test: TestType }
  | { type: 'rest' }
  | { type: 'mic' }

export interface Recommendation {
  id: string
  /** Higher = shown first. */
  priority: number
  title: string
  reason: string
  action?: RecommendationAction
}

/** Milestones (docs §8, Phase 3): durable "you got somewhere" events shown on Today and Progress. */
export type MilestoneType = 'band' | 'tempo' | 'unlock' | 'streak' | 'song' | 'test'

export interface Milestone {
  id?: number
  at: number
  type: MilestoneType
  skillId?: string
  songId?: number
  /** Short headline, e.g. "Chromatic now clean at 100 bpm". */
  title: string
  /** One sentence of context. */
  detail: string
  /** Numeric payload: band index, tempo, streak length, song level … */
  value?: number
  /** Dedupe key (unique index): the same milestone is stored once, e.g. `band:fret.chromatic:2`. */
  key: string
  /** Absent = guitar. */
  instrument?: InstrumentId
}
