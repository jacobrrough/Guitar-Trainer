/**
 * Daily session planner (docs §6, §8). Pure functions over plain data: everything the planner needs
 * (skills, library, effective-rating function) is injected through PlannerInput.
 *
 * The planner plans for two instruments. Whatever is different for singing arrives as an optional
 * field of PlannerInput, or an optional argument, whose default is what the guitar has always had: a
 * guitar plan is the same down to the byte whether or not the other instrument exists (docs/SINGING.md §6).
 */
import type {
  Attempt,
  Block,
  ExerciseBlock,
  ExerciseParams,
  Goal,
  LearnerModel,
  Performance,
  Prefs,
  SessionPlan,
  SkillCategory,
  SkillDef,
  SkillState,
  SongBlock,
  SongItemState,
  SongSummary,
  TestBlock,
  TestType,
  VoiceRange,
} from './types'
import {
  BEGINNER_MAX_RATING,
  BEGINNER_SONG_SPEED,
  CHECKPOINT_MINUTES,
  COMEBACK_AFTER_DAYS,
  COMEBACK_TEMPO_FACTOR,
  DAY_FACTOR_BY_WARMUP,
  FAMILIAR_ATTEMPTS,
  FOCUS_REPEAT_LIMIT_DAYS,
  GOAL_WEIGHT_ALL_ROUND,
  GOAL_WEIGHT_MATCH,
  GOAL_WEIGHT_OTHER,
  MAX_SESSION_TEMPO_GAIN,
  MAX_SKILLS_BEING_LEARNED,
  MONTHLY_MINUTES,
  PLACEMENT_MINUTES,
  REP_DOWN_ACCURACY,
  REP_TEMPO_DOWN,
  REP_TEMPO_EASE,
  REP_TEMPO_UP,
  REP_UP_ACCURACY,
  SESSION_TEMPLATES,
  SONG_FULL_SPEED,
  SONG_LEVEL_DOWN_MISSES,
  SONG_LEVEL_UP_ACCURACY,
  SONG_SLOW_DOWN_ACCURACY,
  SONG_SPEED_STEPS,
  SONG_TARGET_ACCURACY,
  START_TEMPO_FACTOR,
  UNLOCK_RATING,
  WARMUP_COMFORT_RATING,
} from './constants'
import { stepWithin } from './learner'
import { songLowStreak } from './review'
import { prerequisitesSolid } from './skills'
import { skillOpener } from './unlock'

export interface PlannerInput {
  model: LearnerModel
  skills: SkillDef[]
  library: SongSummary[]
  prefs: Prefs
  now: Date
  /** A test that is due today, if any (decided elsewhere). */
  dueTest?: TestType | null
  /** Focus skill ids used on the previous two sessions, most recent first. */
  recentFocusSkillIds?: string[]
  /** Recap skill ids offered in the last few sessions, most recent first, whether or not they were played. */
  recentRecapSkillIds?: string[]
  /** Library id of the song the learner chose to aim for in the set-up. */
  goalSongId?: number
  /** How many lessons of the First steps course the learner has finished. */
  lessonsDone?: number
  /** Skills the finished lessons drilled: a graduate's plan builds on these. */
  lessonSkillIds?: string[]
  /** Days since the last completed session; undefined = first session ever. */
  daysSinceLastSession?: number
  /** For each skill, on how many earlier days it was practised: picks which variation of its drill is shown today. */
  practiceDays?: Record<string, number>
  /** Quick 5-minute session: a single focus block. */
  quick?: boolean
  /** Effective-rating function (rust rule) injected from the learner module. */
  effectiveRating?: (state: SkillState, now: number) => number
  /** Put before every block id, so two instruments can each have a plan for the same day. Default none. */
  idPrefix?: string
  /**
   * Areas a warm-up may come from, most suitable first: the order decides between two skills that are
   * otherwise alike. Default DEFAULT_WARMUP_CATEGORIES (picking, fretting, timing).
   */
  warmupCategories?: SkillCategory[]
  /** The longest an exercise is written out, in bars (see `fitRounds`). Default 32. */
  maxBars?: number
  /** Minutes per block for each daily time; the day lasts what its template adds up to. Default SESSION_TEMPLATES. */
  templates?: Record<Prefs['dailyMinutes'], SessionTemplate>
  /** Speeds a song may be asked for, slowest first. Default SONG_SPEED_STEPS; with a single speed no song is ever slowed down. */
  songSpeeds?: number[]
  /** Areas left out of the whole day: warm-up, main and second exercise, recap, also a pinned skill. Default none. */
  excludeCategories?: SkillCategory[]
  /** Sentences that name the instrument or a speed. What is left out is the guitar's (GUITAR_PLANNER_COPY). */
  copy?: PlannerCopyOverrides
  /**
   * Step skills: for each skill id, the highest step this learner can reach (see `maxStepFor`). A skill
   * that is not named can reach its last step.
   */
  maxSteps?: Record<string, number>
  /**
   * What "never the very same drill twice in one session" compares. By 'generator' (default) two skills
   * written by the same generator count as one drill; by 'skill' they do not, for an instrument whose
   * skills share a few generators. By 'skill' the rule also holds beyond the second exercise: the
   * warm-up moves to another skill when the main exercise is its skill, and the recaps of a comeback
   * day leave the warm-up skill out, each where another skill will do.
   */
  sameDrillBy?: 'generator' | 'skill'
  /** false: song blocks carry no loop of the bars that went badly. Default true. */
  loopWeakBars?: boolean
}

/** Minutes per block of one session length. */
export interface SessionTemplate {
  warmup: number
  focus: number
  second: number
  song: number
  review: number
  ear?: number
}

/** The sentences of a song block's reason. Levels are numbered as the learner sees them (1 = the easiest). */
export interface SongCopy {
  movedUp: (level: number) => string
  wentBack: (level: number, to: number) => string
  hardLastTime: (level: number) => string
  wellBelowFullSpeed: (level: number) => string
  cleared: (level: number) => string
  morePractice: (level: number) => string
  firstSong: string
  newSong: string
  mediumLevel: string
  /** Added to any of the above on a day that is one level easier. */
  easierToday: string
  /** Added when the song is below full speed and the sentence before it does not say so. */
  belowFullSpeed: string
  weakBars: (first: number, last: number) => string
}

/**
 * Every sentence of a plan that names the instrument, the hands, or a speed. The other sentences
 * ("Your main exercise today", "A recap of something you already know") are the same for any instrument.
 */
export interface PlannerCopy {
  /** Explanation line of a beginner's plan. */
  firstSteps: string
  /** How the reason of a second exercise begins. */
  secondLead: string
  /** Reason of the warm-up block. */
  warmup: string
  /** How the reason of an ear-training block begins. */
  ear: (skillName: string) => string
  /** Explanation line of a quick session after a break. */
  comebackQuick: string
  /** Explanation line of a comeback day; `percent` is how much slower tempos are. */
  comebackDay: (percent: number) => string
  severalSongs: (count: number) => string
  song: SongCopy
}

export type PlannerCopyOverrides = Partial<Omit<PlannerCopy, 'song'>> & { song?: Partial<SongCopy> }

/**
 * The words every plan had before there was a second instrument, moved here unchanged. They are the
 * default, so a guitar plan reads as it always did (the planner tests hold recorded plans against them).
 */
export const GUITAR_PLANNER_COPY: PlannerCopy = {
  firstSteps: 'First steps: open strings and the first frets before anything faster.',
  secondLead: 'Another exercise, to use your hands in a new way',
  warmup: 'An easy first exercise to get your fingers used to the strings',
  ear: (skillName) => `Ear training: ${skillName}. Listen, then find the note on your guitar`,
  comebackQuick: 'Welcome back after a break: everything starts a little slower.',
  comebackDay: (percent) => `Everything is ${percent} % slower and there are no skill checks today.`,
  severalSongs: (count) => `${count} songs today, so you do not play one song over and over.`,
  song: {
    movedUp: (level) => `You played level ${level} well at full speed, so we are moving up a level`,
    wentBack: (level, to) => `Level ${level} was too hard twice in a row, so we are going back to level ${to}`,
    hardLastTime: (level) => `Level ${level} was hard last time, so we are taking it slower`,
    wellBelowFullSpeed: (level) => `You played level ${level} well at a slower speed, so today it is a little faster`,
    cleared: (level) => `You cleared level ${level}`,
    morePractice: (level) => `Level ${level} still needs a bit more practice`,
    firstSong: 'A song at an easy level, played slowly',
    newSong: 'A song you have not played yet, at the level of your other songs',
    mediumLevel: 'A song at a medium level',
    easierToday: ' (one level easier today)',
    belowFullSpeed: '; played a bit slower',
    weakBars: (first, last) => ` We practise the tricky bars (${first}-${last}) first.`,
  },
}

/**
 * The same sentences for a singer. Nothing is "played", there are no hands, strings or frets, and a
 * song has one speed, so no sentence promises a slower or a faster one: an easier day is "easier"
 * (tempo skills slow down a little, step skills go one step back; "easier" is true of both).
 */
export const VOICE_PLANNER_COPY: PlannerCopy = {
  firstSteps: 'First steps: easy notes in the middle of your voice before anything else.',
  secondLead: 'Another exercise, to use your voice in a new way',
  warmup: 'An easy first exercise to wake your voice up gently',
  ear: (skillName) => `Listening: ${skillName}. Listen, then sing the note back`,
  comebackQuick: 'Welcome back after a break: everything starts a little easier.',
  comebackDay: () => 'Everything is a little easier and there are no skill checks today.',
  severalSongs: (count) => `${count} songs today, so you do not sing one song over and over.`,
  song: {
    movedUp: (level) => `You sang level ${level} well, so we are moving up a level`,
    wentBack: (level, to) => `Level ${level} was too hard twice in a row, so we are going back to level ${to}`,
    hardLastTime: (level) => `Level ${level} was hard last time, so we are taking it once more`,
    wellBelowFullSpeed: (level) => `You sang level ${level} well, so here it is once more`,
    cleared: (level) => `You cleared level ${level}`,
    morePractice: (level) => `Level ${level} still needs a bit more practice`,
    firstSong: 'A song at an easy level, one line at a time',
    newSong: 'A song you have not sung yet, at the level of your other songs',
    mediumLevel: 'A song at a medium level',
    easierToday: ' (one level easier today)',
    belowFullSpeed: '; at an easier pace',
    weakBars: (first, last) => ` We practise the tricky bars (${first}-${last}) first.`,
  },
}

/** `given` on top of `defaults`; an entry given as undefined is an entry not given. */
function withDefaults<T extends object>(defaults: T, given: Partial<T> | undefined): T {
  const out = { ...defaults }
  for (const [key, value] of Object.entries(given ?? {})) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}

function plannerCopy(given: PlannerCopyOverrides | undefined): PlannerCopy {
  const { song, ...sentences } = given ?? {}
  return { ...withDefaults<Omit<PlannerCopy, 'song'>>(GUITAR_PLANNER_COPY, sentences), song: withDefaults(GUITAR_PLANNER_COPY.song, song) }
}

const DAY_MS = 86_400_000
const QUICK_MINUTES = 5
const MIN_TEMPO = 40
const WARMUP_TEMPO_FACTOR = 0.9
const WARMUP_MIN_TEMPO = 40
const MASTERED_RATING = 90
const REVIEW_RUST_RATING = 75
const DEFAULT_SONG_LEVEL = 2
const DEFAULT_MAX_LEVEL = 5
const EXERCISE_BARS = 4
const RECENCY_CAP_DAYS = 7
const READINESS_MIN = 0.6
const READINESS_MAX = 1.0
/** A recap does not come back while it was offered in one of this many sessions before today. */
const RECAP_ROTATION_SESSIONS = 3
/**
 * A first-steps skill that other skills build on is the warm-up again after this many days without
 * practice: half the time a skill may rest before it starts to go rusty (RUST_GRACE_DAYS), so a learner
 * who practises only now and then still meets it in time.
 */
const BASICS_REFRESH_DAYS = 7
/**
 * The areas a guitar warm-up comes from, and the tie-break for the warm-up fallback: open-string
 * picking is gentler than first fretting.
 */
export const DEFAULT_WARMUP_CATEGORIES: SkillCategory[] = ['picking', 'fretting', 'timing']
const BEATS_PER_BAR = 4
/** The click counts this many beats before every round and every song pass. */
const COUNT_IN_BEATS = 4
/** Silence after the last bar of an exercise, in seconds. */
const ROUND_TAIL_SECONDS = 1
/** An exercise is written out over this many bars: longer before it is repeated more often. */
const ROUND_BARS = [4, 8, 16, 32]
/** The longest an exercise is written out when the caller sets no limit. */
const DEFAULT_MAX_BARS = 32
/** Most rounds of one exercise in a block: past this a teacher would change the exercise, not repeat it. */
export const MAX_ROUNDS = 6
/** Ear training plays and waits for a fixed number of notes: about this long per round. */
const EAR_ROUND_SECONDS = 60
/** A song is played through at most this often in one block; with more time another song joins. */
export const MAX_SONG_PASSES = 3
export const MAX_SONGS_PER_SESSION = 3

const GOAL_CATEGORIES: Record<Exclude<Goal, 'all-round'>, SkillCategory[]> = {
  songs: ['chords', 'picking'],
  rhythm: ['picking', 'timing', 'chords'],
  lead: ['lead'],
  technique: ['fretting', 'picking', 'timing'],
}

type ExerciseKind = ExerciseBlock['kind']

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function daysAgoText(state: SkillState | undefined, nowMs: number): string {
  if (!state?.lastPracticedAt) return 'it is new for you'
  const d = Math.max(0, Math.floor((nowMs - state.lastPracticedAt) / DAY_MS))
  if (d === 0) return 'you practised it earlier today'
  return `you last practised it ${d} day${d === 1 ? '' : 's'} ago`
}

function goalWeight(skill: SkillDef, prefs: Prefs): number {
  if (prefs.goals.length === 0 || prefs.goals.includes('all-round')) return GOAL_WEIGHT_ALL_ROUND
  const match = prefs.goals.some((g) => g !== 'all-round' && GOAL_CATEGORIES[g].includes(skill.category))
  return match ? GOAL_WEIGHT_MATCH : GOAL_WEIGHT_OTHER
}

/**
 * priority = goalWeight × (1 − r/100) × recency × readiness (docs §6.3).
 * `started` marks a skill whose prerequisites no longer hold it back (the learner is already practising it,
 * or everything under it is solid), otherwise it would rank below any skill without prerequisites.
 */
export function focusPriority(
  skill: SkillDef,
  state: SkillState | undefined,
  prefs: Prefs,
  now: number,
  ratings: Record<string, number>,
  started = false,
): number {
  const r = ratings[skill.id] ?? state?.rating ?? 0
  const days = state?.lastPracticedAt ? Math.max(0, (now - state.lastPracticedAt) / DAY_MS) : Infinity
  const recency = 1 + Math.min(days, RECENCY_CAP_DAYS) / RECENCY_CAP_DAYS
  let readiness = READINESS_MAX
  if (skill.prerequisites.length > 0 && !started) {
    const mean = skill.prerequisites.reduce((s, p) => s + (ratings[p] ?? 0), 0) / skill.prerequisites.length
    readiness = clamp(mean / 100, READINESS_MIN, READINESS_MAX)
  }
  return goalWeight(skill, prefs) * (1 - r / 100) * recency * readiness
}

/**
 * Tempo for the next rep (docs §6.4). `maxTempo` is the tempo the skill aims for: an exercise is never
 * asked for faster than that. Played cleanly there, the skill is done and the time belongs to the next one.
 * `heldBefore`: the round before this one was at the same tempo and in the in-between band as well.
 * `minTempo` is the floor of the skill (`SkillDef.minTempo`) where it has one: a rough round at the
 * floor is repeated at the floor. For a step skill floor, target and tempo are one number, so the
 * tempo stays where it is whatever the round was like (its step moves instead: `nextRepStep`).
 */
export function nextRepTempo(currentTempo: number, accuracy: number, sessionStartTempo: number, maxTempo = Infinity, heldBefore = false, minTempo = MIN_TEMPO): number {
  let t = currentTempo
  if (accuracy >= REP_UP_ACCURACY) {
    const cap = sessionStartTempo * (1 + MAX_SESSION_TEMPO_GAIN)
    t = Math.min(currentTempo * (1 + REP_TEMPO_UP), Math.max(cap, currentTempo))
  } else if (accuracy < REP_DOWN_ACCURACY) {
    t = currentTempo * (1 - REP_TEMPO_DOWN)
  } else if (heldBefore) {
    t = currentTempo * (1 - REP_TEMPO_EASE)
  }
  return Math.max(minTempo, Math.round(Math.min(t, maxTempo)))
}

/**
 * Step for the next rep of a step skill, the same rule as `nextRepTempo` on the ladder: a clean round
 * is followed by the next step, at most one above the step the block started on (as the tempo gains at
 * most 15 % in a session); a rough round by the step below, easier and never slower. `maxStep` is the
 * highest step this learner can reach: the last of the ladder, or less where the voice's range is small.
 * `heldBefore`: the round before this one was on the same step and in the in-between band as well. Then
 * this one is followed by the step below, as the tempo eases after two such rounds: a learner who is
 * clean on one step and nearly there on the next would otherwise spend every round of every block on the
 * harder one, with no clean round at all. A caller that does not say gets the same step again.
 */
export function nextRepStep(currentStep: number, accuracy: number, startStep: number, maxStep = Infinity, heldBefore = false): number {
  let step = currentStep
  if (accuracy >= REP_UP_ACCURACY) step = Math.min(currentStep + 1, Math.max(startStep + 1, currentStep))
  else if (accuracy < REP_DOWN_ACCURACY || heldBefore) step = currentStep - 1
  return Math.max(0, Math.min(step, maxStep))
}

/**
 * The highest step of a skill that a voice range can hold. Each step may say how many semitones it
 * needs (`SkillStep.span`; a step that says nothing fits any range), and both ends of a range are notes
 * that may be asked for, so a range holds a step when high - low is at least that span. A ladder is
 * climbed one step at a time: nothing above the first step that does not fit can be reached. The first
 * step is always within reach (it is built to fit the smallest range the app stores). Without a range
 * every step is. A skill without steps has none: 0.
 */
export function maxStepFor(skill: SkillDef, range?: Pick<VoiceRange, 'low' | 'high'>): number {
  const steps = skill.steps ?? []
  if (steps.length === 0) return 0
  if (!range) return steps.length - 1
  const room = range.high - range.low
  let reach = 0
  for (let i = 1; i < steps.length; i++) {
    if ((steps[i].span ?? 0) > room) break
    reach = i
  }
  return reach
}

/** True for a round that was neither clean nor rough: the tempo neither rises nor falls after it. */
export function inHoldBand(accuracy: number): boolean {
  return accuracy >= REP_DOWN_ACCURACY && accuracy < REP_UP_ACCURACY
}

/** The fastest an exercise block may be asked for: the target tempo of its skill, stored with the block. */
function maxTempoOf(block: ExerciseBlock): number {
  return typeof block.params.maxTempo === 'number' && block.params.maxTempo > 0 ? block.params.maxTempo : Infinity
}

/** The slowest an exercise block may be asked for, where its skill has a floor (stored with the block). */
function minTempoOf(block: ExerciseBlock): number | undefined {
  return typeof block.params.minTempo === 'number' && block.params.minTempo > 0 ? block.params.minTempo : undefined
}

/** Where a block of a step skill stands on its ladder; undefined for any other block. */
function ladderOf(block: ExerciseBlock): { step: number; startStep: number; maxStep?: number } | undefined {
  const { step, startStep, maxStep } = block.params
  if (typeof step !== 'number') return undefined
  return { step, startStep: typeof startStep === 'number' ? startStep : step, maxStep: typeof maxStep === 'number' ? maxStep : undefined }
}

/** Seconds one round of an exercise takes: the count-in, the bars, and the silence after them. */
export function roundSeconds(tempo: number, bars: number): number {
  return ((bars * BEATS_PER_BAR + COUNT_IN_BEATS) * 60) / Math.max(1, tempo) + ROUND_TAIL_SECONDS
}

/**
 * Bars and rounds that fill `minutes` at `tempo`, so a block lasts about as long as it says.
 * The exercise gets longer before it gets more rounds, and never more than MAX_ROUNDS.
 * `maxBars` is the longest one round may be: a voice needs its rests, so a sung round stops at 8 bars
 * and a long block repeats it up to the round limit (the block is then shorter than its minutes).
 */
export function fitRounds(minutes: number, tempo: number, maxBars = DEFAULT_MAX_BARS): { bars: number; reps: number } {
  const seconds = minutes * 60
  const fitting = ROUND_BARS.filter((bars) => bars <= maxBars)
  // A limit under the shortest exercise there is still gets the shortest one.
  const lengths = fitting.length > 0 ? fitting : [ROUND_BARS[0]]
  for (const bars of lengths) {
    const reps = Math.round(seconds / roundSeconds(tempo, bars))
    if (reps <= MAX_ROUNDS) return { bars, reps: Math.max(1, reps) }
  }
  return { bars: lengths[lengths.length - 1], reps: MAX_ROUNDS }
}

/** Seconds one pass through a song takes at a speed, with its count-in. */
export function songPassSeconds(song: Pick<SongSummary, 'duration' | 'bpm'>, speed: number): number {
  const s = Math.max(0.25, speed)
  return song.duration / s + (COUNT_IN_BEATS * 60) / (Math.max(1, song.bpm) * s)
}

/** How often a song is played through in a block of `minutes`: at least once, at most MAX_SONG_PASSES. */
export function fitSongPasses(minutes: number, song: Pick<SongSummary, 'duration' | 'bpm'>, speed: number): number {
  return clamp(Math.round((minutes * 60) / songPassSeconds(song, speed)), 1, MAX_SONG_PASSES)
}

/**
 * The song as long as one pass of a level lasts. Where the levels of a song differ in length (a level
 * that echoes each line lasts about twice the tune) the summary says so; otherwise it is the song's own length.
 */
function atLevel(song: SongSummary, level: number): Pick<SongSummary, 'duration' | 'bpm'> {
  const seconds = song.levelDurations?.[level]
  return { duration: typeof seconds === 'number' && seconds > 0 ? seconds : song.duration, bpm: song.bpm }
}

/** True for an ear-training exercise, in the ear block or as any other exercise: its rounds are questions, not bars. */
function isEarExercise(block: ExerciseBlock, skills: SkillDef[]): boolean {
  return block.kind === 'ear' || skills.some((s) => s.id === block.skillId && s.category === 'ear')
}

/**
 * How long a plan takes to play, in minutes: every round and every song pass with its count-in.
 * `skills` tells which exercises are ear training (timed by their questions).
 */
export function planPlayingMinutes(plan: Pick<SessionPlan, 'blocks'>, library: SongSummary[], skills: SkillDef[] = []): number {
  let seconds = 0
  for (const b of plan.blocks) {
    if (b.kind === 'test') seconds += b.minutes * 60
    else if (b.kind === 'song') {
      const song = library.find((x) => x.id === b.songId)
      seconds += song ? (b.passes ?? 1) * songPassSeconds(atLevel(song, b.level), b.speed) : b.minutes * 60
    } else if (isEarExercise(b, skills)) seconds += b.reps * EAR_ROUND_SECONDS
    else seconds += b.reps * roundSeconds(b.tempo, typeof b.params.bars === 'number' ? b.params.bars : EXERCISE_BARS)
  }
  return seconds / 60
}

/** The ladder speed at or just below `speed`, moved `steps` places (negative = slower). With one speed on the ladder it is always that speed. */
function songSpeedStep(speed: number, steps: number, ladder: number[] = SONG_SPEED_STEPS): number {
  let index = 0
  ladder.forEach((step, i) => {
    if (step <= speed + 1e-6) index = i
  })
  return ladder[clamp(index + steps, 0, ladder.length - 1)]
}

/** What the most recent play of a level says. Items stored before speeds were tracked only know their best result. */
function lastSongPlay(item: SongItemState): { accuracy: number; speed: number; misses: number } {
  return { accuracy: item.lastAccuracy ?? item.bestAccuracy ?? 0, speed: item.lastSpeed ?? 1, misses: songLowStreak(item) }
}

/** Speed for another go at a level: slower after a hard run, faster after a good one, otherwise the same. */
function nextSongSpeed(item: SongItemState, ladder: number[] = SONG_SPEED_STEPS): number {
  const last = lastSongPlay(item)
  if (last.accuracy < SONG_SLOW_DOWN_ACCURACY) return songSpeedStep(last.speed, -1, ladder)
  if (last.accuracy >= SONG_TARGET_ACCURACY) return songSpeedStep(last.speed, 1, ladder)
  return songSpeedStep(last.speed, 0, ladder)
}

/** When a song was last played at any level; -1 when never. */
function lastPlayedAt(songItems: Record<string, SongItemState>, songId: number): number {
  return Object.values(songItems).reduce((m, i) => (i.songId === songId ? Math.max(m, i.lastAt ?? -1) : m), -1)
}

export interface SongBlockOptions {
  /** Nothing played yet and new to the instrument: the first song starts at the sparsest level, at the gentlest speed. */
  beginner?: boolean
  /** The song of the block; without it the block carries on with the song played most recently. */
  song?: SongSummary
  /** Where a song that has never been played starts for a learner who has played others. */
  startLevel?: number
  /** Speeds a song may be asked for, slowest first. Default SONG_SPEED_STEPS. */
  speeds?: number[]
  /** Words of the reason; what is left out is the guitar's. */
  copy?: Partial<SongCopy>
  /** false: no loop of the bars that went badly, and no sentence about one. Default true. */
  loopWeakBars?: boolean
}

export interface SongChoice {
  /** Library id of the song the learner chose to aim for. */
  goalSongId?: number
  /** Beginner mode: only bundled songs, and only those the finished lessons have prepared. */
  beginner?: boolean
  /** Lessons of the First steps course the learner has finished; 0 or absent = never took them. */
  lessonsDone?: number
}

/**
 * The songs for today, in playing order. A song must be one the learner can play: for a beginner, and
 * for anyone who has taken lessons of the course, a bundled song counts once its lesson is finished
 * (leaving the course half way does not open the chord songs of the later lessons). A player who never
 * took the lessons and is past beginner mode gets every song. Among those the songs take turns, the one
 * that has waited longest first (never played before anything else), so the daily song changes.
 * The goal song from the set-up goes first whenever it is playable and was not the last song played,
 * which brings it back every second day at least.
 */
export function pickSongs(library: SongSummary[], songItems: Record<string, SongItemState>, count: number, choice: SongChoice = {}): SongSummary[] {
  if (library.length === 0 || count <= 0) return []
  const lessonsDone = choice.lessonsDone ?? 0
  const reach = Math.max(1, lessonsDone)
  const byLessons = choice.beginner || lessonsDone > 0
  const playable = (s: SongSummary) => (s.lessonLevel === undefined ? !choice.beginner : !byLessons || s.lessonLevel <= reach)
  const suitable = library.filter(playable)
  const pool = suitable.length > 0 ? suitable : library
  const last = (s: SongSummary) => lastPlayedAt(songItems, s.id)
  // Array.sort is stable: songs that have never been played keep their library order.
  const waiting = [...pool].sort((a, b) => last(a) - last(b))
  const newest = waiting[waiting.length - 1]
  const goal = pool.find((s) => s.id === choice.goalSongId)
  const goalFirst = goal && (pool.length === 1 || goal.id !== newest.id || last(goal) < 0)
  const order = goalFirst ? [goal, ...waiting.filter((s) => s.id !== goal.id)] : waiting
  return order.slice(0, count)
}

/**
 * Picks the song, level, speed and loop range for a song block. `levelOffset` shifts the level (comeback = -1).
 * With `options.beginner` and nothing played yet, the first song starts at the sparsest level, slowed down.
 * `options.song` names the song; without it the block carries on with the song played most recently.
 * `options.startLevel` is where a song that has never been played starts for a learner who has played others.
 *
 * The song moves one step at a time, in both directions, from the level played most recently:
 * a good run at reduced speed makes it faster, a good run at full speed moves up a level,
 * a hard run slows it down, and two hard runs in a row go back one level. Plays below a level
 * that is cleared at full speed are left out, so replaying an easy version changes nothing.
 *
 * `options.speeds` are the speeds a song may be asked for; with a single speed the same rules move the
 * level only, on a first day and on a comeback day too. `options.copy` words the reason, and
 * `options.loopWeakBars: false` leaves out the loop of the bars that went badly. The passes are fitted
 * to the level about to be played, where the levels of a song differ in length.
 */
export function pickSongBlock(
  library: SongSummary[],
  songItems: Record<string, SongItemState>,
  minutes: number,
  levelOffset = 0,
  options: SongBlockOptions = {},
): SongBlock | null {
  if (library.length === 0) return null
  const ladder = options.speeds && options.speeds.length > 0 ? options.speeds : SONG_SPEED_STEPS
  const fullSpeedOf = ladder[ladder.length - 1]
  const copy = withDefaults(GUITAR_PLANNER_COPY.song, options.copy)
  const itemsOf = (songId: number): SongItemState[] => Object.values(songItems).filter((i) => i.songId === songId)
  const lastActivity = (songId: number): number => lastPlayedAt(songItems, songId)

  let song = options.song ?? library[0]
  let best = lastActivity(song.id)
  for (const s of options.song ? [] : library) {
    const a = lastActivity(s.id)
    if (a > best) {
      best = a
      song = s
    }
  }
  const items = itemsOf(song.id)
  const byLevel = new Map<number, SongItemState>()
  for (const i of items) byLevel.set(i.level, i)
  const maxLevel = Math.max(0, (song.levelNoteCounts.length || DEFAULT_MAX_LEVEL + 1) - 1)

  const played = items.filter((i) => i.bestAccuracy !== null)
  const byRecent = [...played].sort((a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1) || b.level - a.level)
  // A level cleared at full speed is the floor until it goes wrong twice in a row. The plan follows the
  // latest play from the floor up, so a run on an easier level, just for fun, does not pull it down.
  const fullSpeedBest = (i: SongItemState) => i.fullSpeedBest ?? (i.lastSpeed === undefined ? (i.bestAccuracy ?? 0) : 0)
  const holds = (i: SongItemState) => fullSpeedBest(i) >= SONG_TARGET_ACCURACY && songLowStreak(i) < SONG_LEVEL_DOWN_MISSES
  const floor = Math.max(-1, ...played.filter(holds).map((i) => i.level))
  const current = byRecent.find((i) => i.level >= floor)

  let level: number
  let why: string
  let speed = fullSpeedOf
  let firstSong = false
  // The sentence already says what the speed is doing, so nothing about it is added after it.
  let saysSpeed = false
  if (current) {
    const last = lastSongPlay(current)
    const here = current.level
    const fullSpeed = last.speed >= SONG_FULL_SPEED
    if (last.accuracy >= SONG_LEVEL_UP_ACCURACY && fullSpeed && here < maxLevel) {
      level = here + 1
      why = copy.movedUp(here + 1)
      const above = byLevel.get(level)
      speed = above ? nextSongSpeed(above, ladder) : fullSpeedOf
    } else if (last.accuracy < SONG_SLOW_DOWN_ACCURACY && last.misses >= SONG_LEVEL_DOWN_MISSES && here > 0) {
      level = here - 1
      why = copy.wentBack(here + 1, here)
      // Only the level changes: the speed stays where it was.
      speed = songSpeedStep(last.speed, 0, ladder)
    } else {
      level = here
      speed = nextSongSpeed(current, ladder)
      if (last.accuracy < SONG_SLOW_DOWN_ACCURACY) {
        why = copy.hardLastTime(here + 1)
        saysSpeed = true
      } else if (last.accuracy >= SONG_TARGET_ACCURACY && !fullSpeed) {
        why = copy.wellBelowFullSpeed(here + 1)
        saysSpeed = true
      } else if (last.accuracy >= SONG_TARGET_ACCURACY) why = copy.cleared(here + 1)
      else why = copy.morePractice(here + 1)
    }
  } else if (options.beginner) {
    level = 0
    why = copy.firstSong
    // The gentlest speed there is for a first song: three quarters, or the only speed of a one-speed ladder.
    speed = songSpeedStep(BEGINNER_SONG_SPEED, 0, ladder)
    firstSong = true
  } else if (options.startLevel !== undefined) {
    level = clamp(options.startLevel, 0, maxLevel)
    why = copy.newSong
  } else {
    level = DEFAULT_SONG_LEVEL
    why = copy.mediumLevel
  }
  const shifted = clamp(level + levelOffset, 0, maxLevel)
  if (shifted !== level) {
    level = shifted
    const easier = byLevel.get(level)
    if (easier && easier.bestAccuracy !== null) speed = Math.min(speed, nextSongSpeed(easier, ladder))
  }
  if (levelOffset < 0 && !firstSong) why += copy.easierToday

  const item = byLevel.get(level)
  const block: SongBlock = {
    id: '',
    kind: 'song',
    status: 'pending',
    minutes,
    songId: song.id,
    level,
    speed,
    passes: fitSongPasses(minutes, atLevel(song, level), speed),
    reason: `${song.title}: ${why}${speed < 1 && !firstSong && !saysSpeed ? copy.belowFullSpeed : ''}.`,
  }
  if (options.loopWeakBars !== false && item && item.weakBars.length > 0) {
    block.loopBars = [Math.min(...item.weakBars), Math.max(...item.weakBars)]
    block.reason += copy.weakBars(block.loopBars[0], block.loopBars[1])
  }
  return block
}

function startTempoOf(skill: SkillDef, state: SkillState | undefined): number {
  return state && state.tempoCeiling > 0 ? state.tempoCeiling * START_TEMPO_FACTOR : skill.startTempo
}

/** Where a block of a step skill starts, and how far up its ladder this learner can go. */
interface LadderStart {
  step: number
  maxStep: number
  lastStep: number
}

/**
 * `tempo` is what the rule that called asks for (a start tempo, nine tenths of it for a warm-up or
 * after a break, a stored tempo for a recap). Every one of them ends here, so the limits of the skill
 * hold whichever rule it was: never above the target, never under the floor, and for a step skill
 * (`ladder`) the one tempo it has, because slower is not easier there. The step makes it easier instead.
 */
function makeExercise(
  kind: ExerciseKind,
  skill: SkillDef,
  minutes: number,
  tempo: number,
  reason: string,
  ladder?: LadderStart,
): ExerciseBlock {
  if (ladder) tempo = skill.startTempo
  // Never faster than the skill aims for, whatever an old ceiling says.
  tempo = Math.min(tempo, skill.targetTempo)
  if (skill.minTempo !== undefined) tempo = Math.max(tempo, skill.minTempo)
  const params: ExerciseParams = { tempo, bars: EXERCISE_BARS, startTempo: tempo, maxTempo: skill.targetTempo }
  // The floor and the step are stored only for a skill that has them: every other block is as it always was.
  if (skill.minTempo !== undefined) params.minTempo = skill.minTempo
  if (ladder) {
    params.step = ladder.step
    params.startStep = ladder.step
    // Only a real limit is stored: without one the ladder ends at its last step.
    if (ladder.maxStep < ladder.lastStep) params.maxStep = ladder.maxStep
  }
  return {
    id: '',
    kind,
    status: 'pending',
    minutes,
    skillId: skill.id,
    generatorId: skill.generators[0] ?? '',
    params,
    tempo,
    reps: 1,
    reason,
  }
}

/** Sets the rounds, and the length of the exercise, from the block's minutes and tempo. */
function withRounds(b: ExerciseBlock, ear: boolean, maxBars?: number): ExerciseBlock {
  if (ear) return { ...b, reps: clamp(Math.round((b.minutes * 60) / EAR_ROUND_SECONDS), 1, MAX_ROUNDS) }
  const { bars, reps } = fitRounds(b.minutes, b.tempo, maxBars)
  return { ...b, reps, params: { ...b.params, bars } }
}

function reviewTempo(skill: SkillDef, state: SkillState | undefined, dayFactor: number): number {
  const base = state && state.tempoCeiling > 0 ? state.tempoCeiling : skill.startTempo
  return Math.max(MIN_TEMPO, Math.round(base * dayFactor))
}

/**
 * Warm-up skill that respects ability: the easiest comfortable (rated at least WARMUP_COMFORT_RATING) tier 0-1
 * fretting, picking or timing skill, otherwise the gentlest skill without prerequisites.
 * `categories` names other areas to warm up in, most suitable first (the order breaks a tie between two
 * skills that are otherwise alike).
 */
export function pickWarmupSkill(skills: SkillDef[], ratings: Record<string, number>, categories: SkillCategory[] = DEFAULT_WARMUP_CATEGORIES): SkillDef | undefined {
  const pool = skills.filter((s) => categories.includes(s.category))
  const rated = (s: SkillDef) => ratings[s.id] ?? 0
  const comfortable = pool
    .filter((s) => s.tier <= 1 && rated(s) >= WARMUP_COMFORT_RATING)
    .sort((a, b) => a.tier - b.tier || rated(b) - rated(a) || a.id.localeCompare(b.id))
  if (comfortable.length > 0) return comfortable[0]
  const gentle = pool
    .filter((s) => s.prerequisites.length === 0)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.startTempo - b.startTempo ||
        categories.indexOf(a.category) - categories.indexOf(b.category) ||
        a.id.localeCompare(b.id),
    )
  return gentle[0] ?? skills.find((s) => s.tier <= 1)
}

interface Draft {
  kind: BlockKindDraft
  minutes: number
  block?: Block
}
type BlockKindDraft = Block['kind']

function rebalance(drafts: Draft[], target: number): void {
  const sum = () => drafts.reduce((s, d) => s + d.minutes, 0)
  while (sum() > target) {
    const cand = drafts.filter((d) => d.kind !== 'test' && d.kind !== 'warmup' && d.minutes > 1)
    if (cand.length === 0) break
    cand.sort((a, b) => b.minutes - a.minutes)
    cand[0].minutes -= 1
  }
  const sink = drafts.find((d) => d.kind === 'focus') ?? drafts.find((d) => d.kind !== 'test')
  if (sink) while (sum() < target) sink.minutes += 1
}

export function planSession(input: PlannerInput): SessionPlan {
  const { model, skills, library, prefs, now } = input
  const nowMs = now.getTime()
  const date = localDate(now)
  const comeback = input.daysSinceLastSession !== undefined && input.daysSinceLastSession >= COMEBACK_AFTER_DAYS
  const dayFactor = comeback ? COMEBACK_TEMPO_FACTOR : 1
  // A day that slows tempo skills down takes step skills one step back: for them slower is not easier.
  const dayStepsEasier = dayFactor < 1 ? 1 : 0
  const explanation: string[] = []
  const idPrefix = input.idPrefix ?? ''
  const copy = plannerCopy(input.copy)
  const songOptions: SongBlockOptions = { speeds: input.songSpeeds, copy: copy.song, loopWeakBars: input.loopWeakBars }
  const warmupCategories = input.warmupCategories ?? DEFAULT_WARMUP_CATEGORIES
  // "The same drill" is the same skill, not the same generator (see `PlannerInput.sameDrillBy`).
  const bySkill = input.sameDrillBy === 'skill'
  const excluded = new Set(input.excludeCategories ?? [])
  const allowed = (s: SkillDef) => !excluded.has(s.category)
  // A table that lacks the learner's daily time falls back to the built-in one for it.
  const tpl: SessionTemplate = input.templates?.[prefs.dailyMinutes] ?? SESSION_TEMPLATES[prefs.dailyMinutes]
  const earMinutes = tpl.ear ?? 0
  // The day lasts what its template adds up to. For the built-in templates that is the daily time the
  // learner chose; an instrument that does not offer every length maps the others to one it does.
  const dayMinutes = tpl.warmup + tpl.focus + tpl.second + tpl.song + tpl.review + earMinutes

  const finish = (blocks: Block[], factor: number): SessionPlan => {
    // Rounds and song passes are set last, from the minutes each block ended up with.
    const timed = (b: Block): Block => {
      if (b.kind === 'test') return b
      if (b.kind !== 'song') {
        // The same variation of a drill all day (and at every tempo), the next one the next day the skill comes up.
        const seeded = { ...b, params: { ...b.params, seed: input.practiceDays?.[b.skillId] ?? 0 } }
        return withRounds(seeded, isEarExercise(b, skills), input.maxBars)
      }
      const song = library.find((x) => x.id === b.songId)
      return song ? { ...b, passes: fitSongPasses(b.minutes, atLevel(song, b.level), b.speed) } : b
    }
    const out = blocks.map((b, i) => ({ ...timed(b), id: `${idPrefix}${date}-${i}-${b.kind}` }) as Block)
    return { date, minutes: out.reduce((s, b) => s + b.minutes, 0), dayFactor: factor, blocks: out, explanation: explanation.slice(0, 6) }
  }

  if (input.dueTest === 'placement' && !input.quick && !comeback) {
    explanation.push('First session: a quick check of what you can already do sets your starting point.')
    const test: TestBlock = {
      id: '',
      kind: 'test',
      status: 'pending',
      minutes: PLACEMENT_MINUTES,
      test: 'placement',
      reason: 'A quick check of what you can already do',
    }
    explanation.push('Your daily practice, with a warm-up, exercises and songs, starts after it.')
    explanation.push('You can stop the check at any time; anything you skip starts from the basics.')
    return finish([test], 1)
  }

  const stateOf = (id: string): SkillState | undefined => model.skills[id]
  /**
   * Where a block of a step skill starts: the step the learner has reached, as far as this learner can
   * go (`maxSteps`: a small range does not hold every step), `easier` steps back and never under the
   * first. Undefined for a skill without steps.
   */
  const ladderStart = (skill: SkillDef, easier: number): LadderStart | undefined => {
    const lastStep = (skill.steps?.length ?? 0) - 1
    if (lastStep < 0) return undefined
    const maxStep = stepWithin(input.maxSteps?.[skill.id], lastStep, lastStep)
    const reached = stepWithin(stateOf(skill.id)?.step, lastStep, 0)
    return { step: Math.max(0, Math.min(reached, maxStep) - easier), maxStep, lastStep }
  }
  const ratings: Record<string, number> = {}
  const rawRatings: Record<string, number> = {}
  for (const s of skills) {
    const st = stateOf(s.id)
    rawRatings[s.id] = st ? st.rating : 0
    ratings[s.id] = st ? (input.effectiveRating ? input.effectiveRating(st, nowMs) : st.rating) : 0
  }
  const skillById = new Map(skills.map((s) => [s.id, s]))
  const attemptsOf = (id: string) => stateOf(id)?.attempts ?? 0
  // One rule for "open", shared with the milestones and the skill map (see unlock.ts).
  const earned = (s: SkillDef) => prerequisitesSolid(s, ratings, skillById)
  const taught = new Set(input.lessonSkillIds ?? [])
  const attemptCounts = Object.fromEntries(skills.map((s) => [s.id, attemptsOf(s.id)]))
  const unlocked = skillOpener(skills, { ratings, rawRatings, attempts: attemptCounts, taught })
  const unlockedSkills = skills.filter(unlocked)
  // Beginner mode: until a foundation (tier 0-1) rating reaches BEGINNER_MAX_RATING, only tier 0-1 skills
  // are trained. A good first try at something harder does not end it.
  // Someone whose finished lessons went past the first basics is not a beginner either, whatever the
  // ratings say: they carry on with what the lessons taught instead of going back to open strings.
  const graduate = skills.some((s) => s.tier >= 1 && taught.has(s.id))
  const beginner = !graduate && Math.max(0, ...skills.filter((s) => s.tier <= 1).map((s) => ratings[s.id])) < BEGINNER_MAX_RATING
  // Past beginner mode the tier 0 basics are behind the learner: they stay as warm-ups only.
  const inScope = (s: SkillDef) => (beginner ? s.tier <= 1 : s.tier >= 1)
  // One new thing at a time: while a few skills are still new to the learner, nothing brand-new is started.
  const known = (s: SkillDef) => attemptsOf(s.id) > 0 || ratings[s.id] > 0
  const beingLearned = unlockedSkills.filter(
    (s) => inScope(s) && known(s) && ratings[s.id] < UNLOCK_RATING && attemptsOf(s.id) < FAMILIAR_ATTEMPTS,
  ).length
  const roomForNew = beingLearned < MAX_SKILLS_BEING_LEARNED
  // An area that is left out today is left out of every choice below (and of the warm-up, the recap and the pin).
  const choosable = unlockedSkills.filter(allowed)
  const open = choosable.filter((s) => inScope(s) && ratings[s.id] < MASTERED_RATING)
  let candidates = open.filter((s) => roomForNew || known(s))
  if (candidates.length === 0) candidates = open
  if (candidates.length === 0) candidates = choosable.filter(inScope)
  if (candidates.length === 0) candidates = choosable
  // Prerequisites hold a skill back only while some of them are still shaky: not once the learner is practising it,
  // and not once everything under it is solid. Otherwise a first skill the player has just passed in a check
  // outranks the next thing to learn.
  const priority = (s: SkillDef) => focusPriority(s, stateOf(s.id), prefs, nowMs, ratings, attemptsOf(s.id) > 0 || earned(s))
  // Beginners do the tier 0 basics first, until they have had a fair amount of practice on them.
  const basicsFirst = (s: SkillDef) => (beginner && s.tier === 0 && attemptsOf(s.id) < FAMILIAR_ATTEMPTS ? 0 : 1)
  const ranked = [...candidates].sort((a, b) => basicsFirst(a) - basicsFirst(b) || priority(b) - priority(a))
  const firstSteps = copy.firstSteps

  // Focus selection
  const recent = input.recentFocusSkillIds ?? []
  const repeated = (id: string) =>
    recent.length >= FOCUS_REPEAT_LIMIT_DAYS && recent.slice(0, FOCUS_REPEAT_LIMIT_DAYS).every((r) => r === id)
  const pinned = prefs.pinnedSkillId ? skillById.get(prefs.pinnedSkillId) : undefined
  // The warm-up skill is chosen first so the focus and second blocks never repeat it.
  // Past beginner mode a comfortable tier 1 skill makes a better warm-up than the very first basics.
  // The areas a warm-up comes from, and the areas left out today, hold in both places a warm-up is looked for.
  const warmupPool = skills.filter(allowed)
  const comfortable = beginner
    ? []
    : warmupPool.filter((s) => s.tier === 1 && warmupCategories.includes(s.category) && ratings[s.id] >= WARMUP_COMFORT_RATING)
  // A first-steps skill that other skills build on is behind the learner as a main exercise, and it is
  // no longer the warm-up once a skill one tier up is comfortable. Left alone it goes rusty, and a rusty
  // prerequisite closes everything built on it (unlock.ts) with nothing in the plan to bring it back: a
  // short day has no recap, and on a long one the recap goes to a review that is due first. So when it
  // has not been practised for a week it is the warm-up of the day, well before any rust sets in.
  // No first-steps skill of the guitar has anything built on it, so nothing changes there.
  const builtOn = new Set(skills.flatMap((s) => s.prerequisites))
  // Never practised (rated by a check, or in the set-up) is not "long ago": nothing has had time to fade.
  const restingSince = (s: SkillDef) => stateOf(s.id)?.lastPracticedAt ?? Infinity
  const fading = warmupPool
    .filter((s) => s.tier === 0 && builtOn.has(s.id) && warmupCategories.includes(s.category) && nowMs - restingSince(s) > BASICS_REFRESH_DAYS * DAY_MS)
    .sort((a, b) => restingSince(a) - restingSince(b))[0]
  let warmSkill = fading ?? (comfortable.length > 0 ? pickWarmupSkill(comfortable, ratings, warmupCategories) : undefined) ?? pickWarmupSkill(warmupPool, ratings, warmupCategories)
  const sessionHasWarmup = !input.quick && tpl.warmup > 0
  const notWarmup = (s: SkillDef) => !sessionHasWarmup || s.id !== warmSkill?.id
  // The longest session has a block of its own for ear training, so it does not also take the main or second exercise.
  const sessionHasEar = !input.quick && earMinutes > 0
  const mainExercise = (s: SkillDef) => notWarmup(s) && !(sessionHasEar && s.category === 'ear')
  let focus: SkillDef | undefined
  let focusNote = ''
  if (pinned && unlocked(pinned) && allowed(pinned)) {
    focus = pinned
    focusNote = 'You pinned it'
  } else {
    focus = ranked.find((s) => mainExercise(s) && !repeated(s.id)) ?? ranked.find(mainExercise) ?? ranked.find(notWarmup) ?? ranked[0]
    focusNote = ranked[0] && focus && ranked[0].id !== focus.id ? 'Next in line, so your practice stays varied' : 'It is the best fit for your goals'
  }
  // Where "the same drill" means the same skill, the main exercise may still be the skill of the
  // warm-up: it is pinned, or it is all that is in line (a day that leaves an area out, a learner with
  // one skill past the basics). Then the warm-up moves to another skill, if one will do: one the
  // learner is comfortable with, or one that builds on nothing. Only those: the last resort of
  // `pickWarmupSkill` could name a skill that is not open yet.
  if (bySkill && sessionHasWarmup && focus && focus.id === warmSkill?.id) {
    const main = focus.id
    const others = warmupPool.filter(
      (s) => s.id !== main && s.tier <= 1 && warmupCategories.includes(s.category) && (ratings[s.id] >= WARMUP_COMFORT_RATING || s.prerequisites.length === 0),
    )
    const upper = beginner ? [] : others.filter((s) => s.tier === 1 && ratings[s.id] >= WARMUP_COMFORT_RATING)
    warmSkill = pickWarmupSkill(upper.length > 0 ? upper : others, ratings, warmupCategories) ?? warmSkill
  }

  const focusReason = (kind: 'focus' | 'second', skill: SkillDef, note: string): string => {
    const st = stateOf(skill.id)
    const lead = kind === 'focus' ? 'Your main exercise today' : copy.secondLead
    return `${lead}; ${daysAgoText(st, nowMs)}. ${note}.`
  }

  const mkFocusLike = (kind: 'focus' | 'second', skill: SkillDef, minutes: number, note: string): ExerciseBlock => {
    const tempo = Math.max(MIN_TEMPO, Math.round(startTempoOf(skill, stateOf(skill.id)) * dayFactor))
    return makeExercise(kind, skill, minutes, tempo, focusReason(kind, skill, note), ladderStart(skill, dayStepsEasier))
  }

  // Songs: the time is shared between up to MAX_SONGS_PER_SESSION songs, each played a few times.
  const songChoice: SongChoice = { goalSongId: input.goalSongId, beginner, lessonsDone: input.lessonsDone }
  // A song that is new to a learner who has played others starts where their easiest song stands.
  const topLevels = new Map<number, number>()
  for (const i of Object.values(model.songItems)) {
    if (i.bestAccuracy !== null) topLevels.set(i.songId, Math.max(topLevels.get(i.songId) ?? 0, i.level))
  }
  const startLevel = topLevels.size > 0 ? Math.min(DEFAULT_SONG_LEVEL, ...topLevels.values()) : undefined
  const songBlocks = (minutes: number): SongBlock[] => {
    const first = pickSongs(library, model.songItems, 1, songChoice)[0]
    if (!first) return []
    const passes = (minutes * 60) / songPassSeconds(first, 1)
    const count = clamp(Math.floor(passes / MAX_SONG_PASSES), 1, MAX_SONGS_PER_SESSION)
    const chosen = pickSongs(library, model.songItems, count, songChoice)
    return chosen.flatMap((s, i) => {
      const share = Math.floor(minutes / chosen.length) + (i < minutes % chosen.length ? 1 : 0)
      const block = pickSongBlock(library, model.songItems, share, 0, { ...songOptions, beginner, song: s, startLevel })
      return block ? [block] : []
    })
  }

  // Quick session
  if (input.quick) {
    explanation.push('Quick session: just one exercise.')
    if (!focus) return finish([], dayFactor)
    explanation.push(`Main exercise: ${focus.name}. ${focusNote}.`)
    if (beginner) explanation.push(firstSteps)
    if (comeback) explanation.push(copy.comebackQuick)
    return finish([mkFocusLike('focus', focus, QUICK_MINUTES, focusNote)], dayFactor)
  }

  const mkWarmup = (minutes: number): ExerciseBlock | null => {
    if (!warmSkill) return null
    const st = stateOf(warmSkill.id)
    const base = st && st.tempoCeiling > 0 ? st.tempoCeiling : warmSkill.startTempo
    const tempo = Math.max(WARMUP_MIN_TEMPO, Math.round(WARMUP_TEMPO_FACTOR * base))
    // A step skill warms up one step easier, on a comeback day as on any other: it is eased once, as the tempo is.
    return makeExercise('warmup', warmSkill, minutes, tempo, copy.warmup, ladderStart(warmSkill, 1))
  }

  // Comeback session
  if (comeback) {
    const drafts: Block[] = []
    const w = mkWarmup(tpl.warmup || 1)
    if (w) drafts.push(w)
    const practised = skills.filter((s) => stateOf(s.id) && allowed(s))
    const scoped = practised.filter(inScope)
    // A learner who so far knows only the very first skill has nothing above it to recap. Where drills
    // are told apart by skill, that skill is recapped rather than leaving a day that is its warm-up
    // alone (two or three minutes of a ten-minute day). Other plans keep the scoped list as it was.
    const best = (scoped.length > 0 || !bySkill ? scoped : practised).sort((a, b) => ratings[b.id] - ratings[a.id] || a.tier - b.tier)
    // Where "the same drill" means the same skill, the warm-up skill is not recapped as well while
    // the learner knows two others: it would be the same exercise twice in a row.
    const apart = bySkill && w ? best.filter((s) => s.id !== w.skillId) : best
    const strongest = (apart.length >= 2 ? apart : best).slice(0, 2)
    const total = dayMinutes
    const song = pickSongBlock(library, model.songItems, tpl.song, -1, { ...songOptions, beginner })
    const songMin = song ? tpl.song : 0
    const pool = Math.max(strongest.length, total - (w ? w.minutes : 0) - songMin)
    strongest.forEach((s, i) => {
      const share = Math.floor(pool / strongest.length) + (i < pool % strongest.length ? 1 : 0)
      const st = stateOf(s.id)
      drafts.push(
        makeExercise(
          'review',
          s,
          share,
          reviewTempo(s, st, dayFactor),
          `A recap of something you are good at; ${daysAgoText(st, nowMs)}.`,
          ladderStart(s, dayStepsEasier),
        ),
      )
    })
    if (song) drafts.push(song)
    explanation.push(`Welcome back after ${input.daysSinceLastSession} days away: an easy day to get back into it.`)
    explanation.push(copy.comebackDay(Math.round((1 - COMEBACK_TEMPO_FACTOR) * 100)))
    if (strongest.length > 0) explanation.push(`Recapping what you are best at: ${strongest.map((s) => s.name).join(', ')}.`)
    if (beginner) explanation.push(firstSteps)
    if (song) explanation.push(`A song one level easier than usual (level ${song.level + 1}).`)
    return finish(drafts, dayFactor)
  }

  // Regular session
  const inPlan = new Set<string>()
  const drafts: Draft[] = []
  const push = (kind: BlockKindDraft, minutes: number, block?: Block) => drafts.push({ kind, minutes, block })

  const warm = tpl.warmup > 0 ? mkWarmup(tpl.warmup) : null
  let extra = tpl.warmup > 0 && !warm ? tpl.warmup : 0
  if (warm) inPlan.add(warm.skillId)
  const monthly = input.dueTest === 'monthly'
  const checkpoint = input.dueTest === 'checkpoint'

  let second: SkillDef | undefined
  if (tpl.second > 0 && focus) {
    const others = ranked.filter((s) => s.id !== focus.id && mainExercise(s))
    // A different area, and never the very same drill twice in one session. Where many skills are
    // written by one generator, another skill is another drill (`others` never holds the main skill).
    const otherDrill = (s: SkillDef) => input.sameDrillBy === 'skill' || s.generators[0] !== focus.generators[0]
    second = others.find((s) => s.category !== focus.category && otherDrill(s)) ?? others.find(otherDrill) ?? others[0]
  }
  if (tpl.second > 0 && !second) extra += tpl.second
  if (focus) inPlan.add(focus.id)
  if (second) inPlan.add(second.id)

  const songs = tpl.song > 0 ? songBlocks(tpl.song) : []
  const song = songs[0] ?? null
  if (tpl.song > 0 && !song) extra += tpl.song

  let ear: SkillDef | undefined
  if (earMinutes > 0) {
    ear = choosable.find((s) => s.category === 'ear' && !inPlan.has(s.id))
    if (!ear) extra += earMinutes
    // It has its own block: not the recap of the same day as well.
    else inPlan.add(ear.id)
  }

  const testBlock = (test: TestType, minutes: number): TestBlock => ({
    id: '',
    kind: 'test',
    status: 'pending',
    minutes,
    test: test as TestBlock['test'],
    reason: test === 'monthly' ? 'A check on how far you have come this month' : 'A quick check on what you learned this week',
  })

  if (warm) push('warmup', warm.minutes, warm)
  if (monthly) {
    push('test', MONTHLY_MINUTES, testBlock('monthly', MONTHLY_MINUTES))
  } else {
    if (focus) push('focus', tpl.focus + extra, mkFocusLike('focus', focus, tpl.focus + extra, focusNote))
    if (second) {
      if (checkpoint) push('test', CHECKPOINT_MINUTES, testBlock('checkpoint', CHECKPOINT_MINUTES))
      else push('second', tpl.second, mkFocusLike('second', second, tpl.second, 'It works a different area from your main exercise'))
    }
  }
  for (const b of songs) push('song', b.minutes, b)

  // Review block
  const reviewMinutes = tpl.review
  const needReview = reviewMinutes > 0 && !(checkpoint && !second)
  if (needReview) {
    // Anything the learner has practised can come back as a recap, also a harder skill met in a lesson.
    // So can a first-steps skill that other skills build on, although it is behind the learner as a main
    // exercise: the warm-up keeps it from going rusty (see `fading` above), and a recap now and then, at
    // full length and on the step the learner has reached, is how it is finished like any other skill.
    // No first-steps skill of the guitar has anything built on it, so nothing changes there.
    const recapScope = (s: SkillDef) => inScope(s) || (beginner && attemptsOf(s.id) > 0 && unlocked(s)) || (s.tier === 0 && builtOn.has(s.id))
    const all = skills.filter((s) => stateOf(s.id) && !inPlan.has(s.id) && recapScope(s) && allowed(s))
    // A recap that was offered in the last few sessions waits its turn, also when it was skipped:
    // skipping leaves no trace in the practice dates, so they alone would offer it again and again.
    const offered = new Set((input.recentRecapSkillIds ?? []).slice(0, RECAP_ROTATION_SESSIONS))
    const fresh = all.filter((s) => !offered.has(s.id))
    const pool = fresh.length > 0 ? fresh : all
    const due = pool
      .filter((s) => (stateOf(s.id)?.nextReviewAt ?? Infinity) <= nowMs)
      .sort((a, b) => (stateOf(a.id)?.nextReviewAt ?? 0) - (stateOf(b.id)?.nextReviewAt ?? 0))[0]
    const rustOf = (s: SkillDef) => rawRatings[s.id] - ratings[s.id]
    const rusty = pool
      .filter((s) => rawRatings[s.id] >= REVIEW_RUST_RATING && rustOf(s) > 0)
      .sort((a, b) => rustOf(b) - rustOf(a))[0]
    // Otherwise take turns: the known skill that has waited longest, so the recap is not the same every day.
    const lastPractised = (s: SkillDef) => stateOf(s.id)?.lastPracticedAt ?? -Infinity
    const waiting = pool
      .filter((s) => (attemptsOf(s.id) > 0 || ratings[s.id] >= UNLOCK_RATING) && unlocked(s))
      .sort((a, b) => lastPractised(a) - lastPractised(b) || ratings[b.id] - ratings[a.id] || a.tier - b.tier)[0]
    const pick = due ?? rusty ?? waiting
    if (pick) {
      const st = stateOf(pick.id)
      const why = due
        ? 'Time for a recap of something you learned'
        : rusty
          ? 'A recap, because this one has got a bit rusty'
          : 'A recap of something you already know'
      // A skill rated by the first check has no practice date yet, so there is nothing to add.
      const reason = st?.lastPracticedAt ? `${why}; ${daysAgoText(st, nowMs)}.` : `${why}.`
      push('review', reviewMinutes, makeExercise('review', pick, reviewMinutes, reviewTempo(pick, st, dayFactor), reason, ladderStart(pick, dayStepsEasier)))
    } else {
      const sink = drafts.find((d) => d.kind === 'focus')
      if (sink) sink.minutes += reviewMinutes
    }
  } else if (reviewMinutes > 0) {
    // checkpoint replaces the review block when there is no second block
    push('test', CHECKPOINT_MINUTES, testBlock('checkpoint', CHECKPOINT_MINUTES))
  }
  if (ear) {
    const st = stateOf(ear.id)
    const reason = `${copy.ear(ear.name)}; ${daysAgoText(st, nowMs)}.`
    push('ear', earMinutes, makeExercise('ear', ear, earMinutes, reviewTempo(ear, st, dayFactor), reason, ladderStart(ear, dayStepsEasier)))
  }
  if (checkpoint && !drafts.some((d) => d.kind === 'test')) {
    push('test', CHECKPOINT_MINUTES, testBlock('checkpoint', CHECKPOINT_MINUTES))
  }

  rebalance(drafts, dayMinutes)
  const blocks = drafts.map((d) => ({ ...(d.block as Block), minutes: d.minutes }) as Block)

  if (monthly) explanation.push('Monthly skill check today: it replaces the main and second exercises.')
  else if (focus) explanation.push(`Main exercise: ${focus.name}. ${focusNote}.`)
  if (beginner) explanation.push(firstSteps)
  if (second && !checkpoint && !monthly) explanation.push(`Another exercise: ${second.name}, from a different area.`)
  if (song) explanation.push(song.reason)
  else explanation.push('No songs in your library yet, so that time goes to exercises.')
  if (songs.length > 1) explanation.push(copy.severalSongs(songs.length))
  if (checkpoint) explanation.push('A quick weekly skill check is part of today.')
  if (input.daysSinceLastSession === undefined) explanation.push('First session: starting gently.')
  return finish(blocks, dayFactor)
}

function isExercise(b: Block): b is ExerciseBlock {
  return b.kind !== 'song' && b.kind !== 'test'
}

function dayFactorFor(acc: number): number {
  return (DAY_FACTOR_BY_WARMUP.find((r) => acc >= r.minAcc) ?? DAY_FACTOR_BY_WARMUP[DAY_FACTOR_BY_WARMUP.length - 1]).factor
}

function withTempo(b: ExerciseBlock, tempo: number, startTempo: number): ExerciseBlock {
  return { ...b, tempo, params: { ...b.params, tempo, startTempo } }
}

function withStep(b: ExerciseBlock, step: number, startStep: number): ExerciseBlock {
  return { ...b, params: { ...b.params, step, startStep } }
}

/**
 * Marks a block done and adapts the remaining pending blocks (docs §6.4). Returns a new plan.
 *
 * Tempo blocks follow the day factor and the result of an earlier block of the same skill, as before,
 * and now stop at the floor of their skill as they stop at its target. Step blocks never change tempo:
 * - after a rough warm-up (under REP_DOWN_ACCURACY) on a day that was not planned easier already, they
 *   start one step easier. A warm-up that was only in between slows tempos by a few bpm; a whole step
 *   would be too much for that, and a clean warm-up after a break does not put a step back either: the
 *   first clean round does (`nextRepStep`);
 * - after a block of the same skill they move as the next round would. A step is raised only up to a
 *   limit that is known: the one stored with the block (`params.maxStep`), else the last step of the
 *   skill found in `skills`. With neither, a clean block leaves the step where it is, so no block is
 *   ever asked for a step its ladder does not have.
 */
export function adaptAfterBlock(plan: SessionPlan, blockId: string, attempt: Attempt, performance: Performance, skills: SkillDef[] = []): SessionPlan {
  void attempt
  const done = plan.blocks.find((b) => b.id === blockId)
  if (!done) return { ...plan, blocks: plan.blocks.map((b) => ({ ...b })), explanation: [...plan.explanation] }

  let dayFactor = plan.dayFactor
  const isWarmup = done.kind === 'warmup'
  if (isWarmup) dayFactor = dayFactorFor(performance.acc)
  const ratio = plan.dayFactor > 0 ? dayFactor / plan.dayFactor : 1
  const stepsEasier = isWarmup && ratio < 1 && performance.acc < REP_DOWN_ACCURACY ? 1 : 0

  const blocks = plan.blocks.map((b): Block => {
    if (b.id === blockId) return { ...b, status: 'done' }
    if (!isExercise(b) || b.status !== 'pending') return { ...b }
    const ladder = ladderOf(b)
    if (ladder) {
      if (isWarmup) return stepsEasier > 0 ? withStep(b, Math.max(0, ladder.step - stepsEasier), Math.max(0, ladder.startStep - stepsEasier)) : { ...b }
      if (isExercise(done) && b.skillId === done.skillId) {
        const steps = skills.find((s) => s.id === b.skillId)?.steps
        const top = ladder.maxStep ?? (steps && steps.length > 0 ? steps.length - 1 : ladder.step)
        return withStep(b, nextRepStep(ladder.step, performance.acc, ladder.startStep, top), ladder.startStep)
      }
      return { ...b }
    }
    const start = typeof b.params.startTempo === 'number' ? b.params.startTempo : b.tempo
    if (isWarmup) {
      const max = maxTempoOf(b)
      // No floor stored = no floor here, as before (the general floor is applied where a tempo is first set).
      const min = minTempoOf(b) ?? -Infinity
      return withTempo(b, Math.max(min, Math.min(max, Math.round(b.tempo * ratio))), Math.max(min, Math.min(max, Math.round(start * ratio))))
    }
    if (isExercise(done) && b.skillId === done.skillId) {
      return withTempo(b, nextRepTempo(b.tempo, performance.acc, start, maxTempoOf(b), false, minTempoOf(b)), start)
    }
    return { ...b }
  })

  return { ...plan, dayFactor, blocks, explanation: [...plan.explanation] }
}
