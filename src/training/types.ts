/**
 * Shared contracts for the adaptive training system ("Coach").
 * See docs/ADAPTIVE_TRAINING.md for the design these types implement.
 * Every module under src/training imports from here; keep it dependency-free
 * apart from the chart model.
 */
import type { Chart } from '../chart/types'

export type SkillCategory = 'fretting' | 'picking' | 'chords' | 'lead' | 'timing' | 'ear'
export type NoteValue = 'quarter' | 'eighth' | 'sixteenth' | 'triplet'
export type Goal = 'songs' | 'rhythm' | 'lead' | 'technique' | 'all-round'
export type MasteryBand = 'new' | 'learning' | 'developing' | 'solid' | 'mastered'

export interface SkillDef {
  id: string
  name: string
  category: SkillCategory
  tier: 1 | 2 | 3 | 4
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
  /** Chord skills stay provisional (rating capped) until chroma chord scoring exists. */
  provisional?: boolean
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
   * How chord groups were judged. 'chroma' means polyphonic chroma matching was
   * active, so chord skills count fully; 'pitch' (or absent) is the lenient
   * any-chord-tone path and keeps provisional chord skills capped.
   */
  chordScoring?: 'pitch' | 'chroma'
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
  /** Mono PCM backing track; null means "metronome click only". */
  backing: Float32Array | null
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
}

export interface SongSummary {
  id: number
  title: string
  artist: string
  duration: number
  bpm: number
  /** Note counts per level index 0..5 (from generateLevels). */
  levelNoteCounts: number[]
}

export interface Prefs {
  dailyMinutes: 10 | 20 | 30 | 45
  goals: Goal[]
  pinnedSkillId?: string
}

export interface Profile {
  id: 1
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
}
