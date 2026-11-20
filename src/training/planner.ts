/**
 * Daily session planner (docs §6, §8). Pure functions over plain data: everything the planner needs
 * (skills, library, effective-rating function) is injected through PlannerInput.
 */
import type {
  Attempt,
  Block,
  ExerciseBlock,
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
/** Tie-break for the warm-up fallback: open-string picking is gentler than first fretting. */
const WARMUP_CATEGORY_ORDER: SkillCategory[] = ['picking', 'fretting', 'timing']
const BEATS_PER_BAR = 4
/** The click counts this many beats before every round and every song pass. */
const COUNT_IN_BEATS = 4
/** Silence after the last bar of an exercise, in seconds. */
const ROUND_TAIL_SECONDS = 1
/** An exercise is written out over this many bars: longer before it is repeated more often. */
const ROUND_BARS = [4, 8, 16, 32]
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
 */
export function nextRepTempo(currentTempo: number, accuracy: number, sessionStartTempo: number, maxTempo = Infinity, heldBefore = false): number {
  let t = currentTempo
  if (accuracy >= REP_UP_ACCURACY) {
    const cap = sessionStartTempo * (1 + MAX_SESSION_TEMPO_GAIN)
    t = Math.min(currentTempo * (1 + REP_TEMPO_UP), Math.max(cap, currentTempo))
  } else if (accuracy < REP_DOWN_ACCURACY) {
    t = currentTempo * (1 - REP_TEMPO_DOWN)
  } else if (heldBefore) {
    t = currentTempo * (1 - REP_TEMPO_EASE)
  }
  return Math.max(MIN_TEMPO, Math.round(Math.min(t, maxTempo)))
}

/** True for a round that was neither clean nor rough: the tempo neither rises nor falls after it. */
export function inHoldBand(accuracy: number): boolean {
  return accuracy >= REP_DOWN_ACCURACY && accuracy < REP_UP_ACCURACY
}

/** The fastest an exercise block may be asked for: the target tempo of its skill, stored with the block. */
function maxTempoOf(block: ExerciseBlock): number {
  return typeof block.params.maxTempo === 'number' && block.params.maxTempo > 0 ? block.params.maxTempo : Infinity
}

/** Seconds one round of an exercise takes: the count-in, the bars, and the silence after them. */
export function roundSeconds(tempo: number, bars: number): number {
  return ((bars * BEATS_PER_BAR + COUNT_IN_BEATS) * 60) / Math.max(1, tempo) + ROUND_TAIL_SECONDS
}

/**
 * Bars and rounds that fill `minutes` at `tempo`, so a block lasts about as long as it says.
 * The exercise gets longer before it gets more rounds, and never more than MAX_ROUNDS.
 */
export function fitRounds(minutes: number, tempo: number): { bars: number; reps: number } {
  const seconds = minutes * 60
  for (const bars of ROUND_BARS) {
    const reps = Math.round(seconds / roundSeconds(tempo, bars))
    if (reps <= MAX_ROUNDS) return { bars, reps: Math.max(1, reps) }
  }
  return { bars: ROUND_BARS[ROUND_BARS.length - 1], reps: MAX_ROUNDS }
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
      seconds += song ? (b.passes ?? 1) * songPassSeconds(song, b.speed) : b.minutes * 60
    } else if (isEarExercise(b, skills)) seconds += b.reps * EAR_ROUND_SECONDS
    else seconds += b.reps * roundSeconds(b.tempo, typeof b.params.bars === 'number' ? b.params.bars : EXERCISE_BARS)
  }
  return seconds / 60
}

/** The ladder speed at or just below `speed`, moved `steps` places (negative = slower). */
function songSpeedStep(speed: number, steps: number): number {
  let index = 0
  SONG_SPEED_STEPS.forEach((step, i) => {
    if (step <= speed + 1e-6) index = i
  })
  return SONG_SPEED_STEPS[clamp(index + steps, 0, SONG_SPEED_STEPS.length - 1)]
}

/** What the most recent play of a level says. Items stored before speeds were tracked only know their best result. */
function lastSongPlay(item: SongItemState): { accuracy: number; speed: number; misses: number } {
  return { accuracy: item.lastAccuracy ?? item.bestAccuracy ?? 0, speed: item.lastSpeed ?? 1, misses: songLowStreak(item) }
}

/** Speed for another go at a level: slower after a hard run, faster after a good one, otherwise the same. */
function nextSongSpeed(item: SongItemState): number {
  const last = lastSongPlay(item)
  if (last.accuracy < SONG_SLOW_DOWN_ACCURACY) return songSpeedStep(last.speed, -1)
  if (last.accuracy >= SONG_TARGET_ACCURACY) return songSpeedStep(last.speed, 1)
  return songSpeedStep(last.speed, 0)
}

/** When a song was last played at any level; -1 when never. */
function lastPlayedAt(songItems: Record<string, SongItemState>, songId: number): number {
  return Object.values(songItems).reduce((m, i) => (i.songId === songId ? Math.max(m, i.lastAt ?? -1) : m), -1)
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
 */
export function pickSongBlock(
  library: SongSummary[],
  songItems: Record<string, SongItemState>,
  minutes: number,
  levelOffset = 0,
  options: { beginner?: boolean; song?: SongSummary; startLevel?: number } = {},
): SongBlock | null {
  if (library.length === 0) return null
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
  let speed = 1
  let firstSong = false
  if (current) {
    const last = lastSongPlay(current)
    const here = current.level
    const fullSpeed = last.speed >= SONG_FULL_SPEED
    if (last.accuracy >= SONG_LEVEL_UP_ACCURACY && fullSpeed && here < maxLevel) {
      level = here + 1
      why = `You played level ${here + 1} well at full speed, so we are moving up a level`
      const above = byLevel.get(level)
      speed = above ? nextSongSpeed(above) : 1
    } else if (last.accuracy < SONG_SLOW_DOWN_ACCURACY && last.misses >= SONG_LEVEL_DOWN_MISSES && here > 0) {
      level = here - 1
      why = `Level ${here + 1} was too hard twice in a row, so we are going back to level ${here}`
      // Only the level changes: the speed stays where it was.
      speed = songSpeedStep(last.speed, 0)
    } else {
      level = here
      speed = nextSongSpeed(current)
      if (last.accuracy < SONG_SLOW_DOWN_ACCURACY) why = `Level ${here + 1} was hard last time, so we are taking it slower`
      else if (last.accuracy >= SONG_TARGET_ACCURACY && !fullSpeed) why = `You played level ${here + 1} well at a slower speed, so today it is a little faster`
      else if (last.accuracy >= SONG_TARGET_ACCURACY) why = `You cleared level ${here + 1}`
      else why = `Level ${here + 1} still needs a bit more practice`
    }
  } else if (options.beginner) {
    level = 0
    why = 'A song at an easy level, played slowly'
    speed = BEGINNER_SONG_SPEED
    firstSong = true
  } else if (options.startLevel !== undefined) {
    level = clamp(options.startLevel, 0, maxLevel)
    why = 'A song you have not played yet, at the level of your other songs'
  } else {
    level = DEFAULT_SONG_LEVEL
    why = 'A song at a medium level'
  }
  const shifted = clamp(level + levelOffset, 0, maxLevel)
  if (shifted !== level) {
    level = shifted
    const easier = byLevel.get(level)
    if (easier && easier.bestAccuracy !== null) speed = Math.min(speed, nextSongSpeed(easier))
  }
  if (levelOffset < 0 && !firstSong) why += ' (one level easier today)'

  const item = byLevel.get(level)
  const block: SongBlock = {
    id: '',
    kind: 'song',
    status: 'pending',
    minutes,
    songId: song.id,
    level,
    speed,
    passes: fitSongPasses(minutes, song, speed),
    reason: `${song.title}: ${why}${speed < 1 && !firstSong && !/slower|faster/.test(why) ? '; played a bit slower' : ''}.`,
  }
  if (item && item.weakBars.length > 0) {
    block.loopBars = [Math.min(...item.weakBars), Math.max(...item.weakBars)]
    block.reason += ` We practise the tricky bars (${block.loopBars[0]}-${block.loopBars[1]}) first.`
  }
  return block
}

function startTempoOf(skill: SkillDef, state: SkillState | undefined): number {
  return state && state.tempoCeiling > 0 ? state.tempoCeiling * START_TEMPO_FACTOR : skill.startTempo
}

function makeExercise(
  kind: ExerciseKind,
  skill: SkillDef,
  minutes: number,
  tempo: number,
  reason: string,
): ExerciseBlock {
  // Never faster than the skill aims for, whatever an old ceiling says.
  tempo = Math.min(tempo, skill.targetTempo)
  return {
    id: '',
    kind,
    status: 'pending',
    minutes,
    skillId: skill.id,
    generatorId: skill.generators[0] ?? '',
    params: { tempo, bars: EXERCISE_BARS, startTempo: tempo, maxTempo: skill.targetTempo },
    tempo,
    reps: 1,
    reason,
  }
}

/** Sets the rounds, and the length of the exercise, from the block's minutes and tempo. */
function withRounds(b: ExerciseBlock, ear: boolean): ExerciseBlock {
  if (ear) return { ...b, reps: clamp(Math.round((b.minutes * 60) / EAR_ROUND_SECONDS), 1, MAX_ROUNDS) }
  const { bars, reps } = fitRounds(b.minutes, b.tempo)
  return { ...b, reps, params: { ...b.params, bars } }
}

function reviewTempo(skill: SkillDef, state: SkillState | undefined, dayFactor: number): number {
  const base = state && state.tempoCeiling > 0 ? state.tempoCeiling : skill.startTempo
  return Math.max(MIN_TEMPO, Math.round(base * dayFactor))
}

/**
 * Warm-up skill that respects ability: the easiest comfortable (rated at least WARMUP_COMFORT_RATING) tier 0-1
 * fretting, picking or timing skill, otherwise the gentlest skill without prerequisites.
 */
export function pickWarmupSkill(skills: SkillDef[], ratings: Record<string, number>): SkillDef | undefined {
  const pool = skills.filter((s) => s.category === 'fretting' || s.category === 'picking' || s.category === 'timing')
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
        WARMUP_CATEGORY_ORDER.indexOf(a.category) - WARMUP_CATEGORY_ORDER.indexOf(b.category) ||
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
  const explanation: string[] = []

  const finish = (blocks: Block[], factor: number): SessionPlan => {
    // Rounds and song passes are set last, from the minutes each block ended up with.
    const timed = (b: Block): Block => {
      if (b.kind === 'test') return b
      if (b.kind !== 'song') {
        // The same variation of a drill all day (and at every tempo), the next one the next day the skill comes up.
        const seeded = { ...b, params: { ...b.params, seed: input.practiceDays?.[b.skillId] ?? 0 } }
        return withRounds(seeded, isEarExercise(b, skills))
      }
      const song = library.find((x) => x.id === b.songId)
      return song ? { ...b, passes: fitSongPasses(b.minutes, song, b.speed) } : b
    }
    const out = blocks.map((b, i) => ({ ...timed(b), id: `${date}-${i}-${b.kind}` }) as Block)
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
  const open = unlockedSkills.filter((s) => inScope(s) && ratings[s.id] < MASTERED_RATING)
  let candidates = open.filter((s) => roomForNew || known(s))
  if (candidates.length === 0) candidates = open
  if (candidates.length === 0) candidates = unlockedSkills.filter(inScope)
  if (candidates.length === 0) candidates = unlockedSkills
  // Prerequisites hold a skill back only while some of them are still shaky: not once the learner is practising it,
  // and not once everything under it is solid. Otherwise a first skill the player has just passed in a check
  // outranks the next thing to learn.
  const priority = (s: SkillDef) => focusPriority(s, stateOf(s.id), prefs, nowMs, ratings, attemptsOf(s.id) > 0 || earned(s))
  // Beginners do the tier 0 basics first, until they have had a fair amount of practice on them.
  const basicsFirst = (s: SkillDef) => (beginner && s.tier === 0 && attemptsOf(s.id) < FAMILIAR_ATTEMPTS ? 0 : 1)
  const ranked = [...candidates].sort((a, b) => basicsFirst(a) - basicsFirst(b) || priority(b) - priority(a))
  const firstSteps = 'First steps: open strings and the first frets before anything faster.'

  // Focus selection
  const recent = input.recentFocusSkillIds ?? []
  const repeated = (id: string) =>
    recent.length >= FOCUS_REPEAT_LIMIT_DAYS && recent.slice(0, FOCUS_REPEAT_LIMIT_DAYS).every((r) => r === id)
  const pinned = prefs.pinnedSkillId ? skillById.get(prefs.pinnedSkillId) : undefined
  // The warm-up skill is chosen first so the focus and second blocks never repeat it.
  // Past beginner mode a comfortable tier 1 skill makes a better warm-up than the very first basics.
  const comfortable = beginner
    ? []
    : skills.filter((s) => s.tier === 1 && WARMUP_CATEGORY_ORDER.includes(s.category) && ratings[s.id] >= WARMUP_COMFORT_RATING)
  const warmSkill = (comfortable.length > 0 ? pickWarmupSkill(comfortable, ratings) : undefined) ?? pickWarmupSkill(skills, ratings)
  const sessionHasWarmup = !input.quick && SESSION_TEMPLATES[prefs.dailyMinutes].warmup > 0
  const notWarmup = (s: SkillDef) => !sessionHasWarmup || s.id !== warmSkill?.id
  // The longest session has a block of its own for ear training, so it does not also take the main or second exercise.
  const sessionHasEar = !input.quick && SESSION_TEMPLATES[prefs.dailyMinutes].ear > 0
  const mainExercise = (s: SkillDef) => notWarmup(s) && !(sessionHasEar && s.category === 'ear')
  let focus: SkillDef | undefined
  let focusNote = ''
  if (pinned && unlocked(pinned)) {
    focus = pinned
    focusNote = 'You pinned it'
  } else {
    focus = ranked.find((s) => mainExercise(s) && !repeated(s.id)) ?? ranked.find(mainExercise) ?? ranked.find(notWarmup) ?? ranked[0]
    focusNote = ranked[0] && focus && ranked[0].id !== focus.id ? 'Next in line, so your practice stays varied' : 'It is the best fit for your goals'
  }

  const focusReason = (kind: 'focus' | 'second', skill: SkillDef, note: string): string => {
    const st = stateOf(skill.id)
    const lead = kind === 'focus' ? 'Your main exercise today' : 'Another exercise, to use your hands in a new way'
    return `${lead}; ${daysAgoText(st, nowMs)}. ${note}.`
  }

  const mkFocusLike = (kind: 'focus' | 'second', skill: SkillDef, minutes: number, note: string): ExerciseBlock => {
    const tempo = Math.max(MIN_TEMPO, Math.round(startTempoOf(skill, stateOf(skill.id)) * dayFactor))
    return makeExercise(kind, skill, minutes, tempo, focusReason(kind, skill, note))
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
      const block = pickSongBlock(library, model.songItems, share, 0, { beginner, song: s, startLevel })
      return block ? [block] : []
    })
  }

  // Quick session
  if (input.quick) {
    explanation.push('Quick session: just one exercise.')
    if (!focus) return finish([], dayFactor)
    explanation.push(`Main exercise: ${focus.name}. ${focusNote}.`)
    if (beginner) explanation.push(firstSteps)
    if (comeback) explanation.push('Welcome back after a break: everything starts a little slower.')
    return finish([mkFocusLike('focus', focus, QUICK_MINUTES, focusNote)], dayFactor)
  }

  const tpl = SESSION_TEMPLATES[prefs.dailyMinutes]
  const mkWarmup = (minutes: number): ExerciseBlock | null => {
    if (!warmSkill) return null
    const st = stateOf(warmSkill.id)
    const base = st && st.tempoCeiling > 0 ? st.tempoCeiling : warmSkill.startTempo
    const tempo = Math.max(WARMUP_MIN_TEMPO, Math.round(WARMUP_TEMPO_FACTOR * base))
    return makeExercise('warmup', warmSkill, minutes, tempo, 'An easy first exercise to get your fingers used to the strings')
  }

  // Comeback session
  if (comeback) {
    const drafts: Block[] = []
    const w = mkWarmup(tpl.warmup || 1)
    if (w) drafts.push(w)
    const strongest = [...skills]
      .filter((s) => stateOf(s.id) && inScope(s))
      .sort((a, b) => ratings[b.id] - ratings[a.id] || a.tier - b.tier)
      .slice(0, 2)
    const total = prefs.dailyMinutes
    const song = pickSongBlock(library, model.songItems, tpl.song, -1, { beginner })
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
        ),
      )
    })
    if (song) drafts.push(song)
    explanation.push(`Welcome back after ${input.daysSinceLastSession} days away: an easy day to get back into it.`)
    explanation.push(`Everything is ${Math.round((1 - COMEBACK_TEMPO_FACTOR) * 100)} % slower and there are no skill checks today.`)
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
    // A different area, and never the very same drill twice in one session.
    const otherDrill = (s: SkillDef) => s.generators[0] !== focus.generators[0]
    second = others.find((s) => s.category !== focus.category && otherDrill(s)) ?? others.find(otherDrill) ?? others[0]
  }
  if (tpl.second > 0 && !second) extra += tpl.second
  if (focus) inPlan.add(focus.id)
  if (second) inPlan.add(second.id)

  const songs = tpl.song > 0 ? songBlocks(tpl.song) : []
  const song = songs[0] ?? null
  if (tpl.song > 0 && !song) extra += tpl.song

  let ear: SkillDef | undefined
  if (tpl.ear > 0) {
    ear = unlockedSkills.find((s) => s.category === 'ear' && !inPlan.has(s.id))
    if (!ear) extra += tpl.ear
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
    const recapScope = (s: SkillDef) => inScope(s) || (beginner && attemptsOf(s.id) > 0 && unlocked(s))
    const all = skills.filter((s) => stateOf(s.id) && !inPlan.has(s.id) && recapScope(s))
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
      push('review', reviewMinutes, makeExercise('review', pick, reviewMinutes, reviewTempo(pick, st, dayFactor), reason))
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
    const reason = `Ear training: ${ear.name}. Listen, then find the note on your guitar; ${daysAgoText(st, nowMs)}.`
    push('ear', tpl.ear, makeExercise('ear', ear, tpl.ear, reviewTempo(ear, st, dayFactor), reason))
  }
  if (checkpoint && !drafts.some((d) => d.kind === 'test')) {
    push('test', CHECKPOINT_MINUTES, testBlock('checkpoint', CHECKPOINT_MINUTES))
  }

  const target = prefs.dailyMinutes
  rebalance(drafts, target)
  const blocks = drafts.map((d) => ({ ...(d.block as Block), minutes: d.minutes }) as Block)

  if (monthly) explanation.push('Monthly skill check today: it replaces the main and second exercises.')
  else if (focus) explanation.push(`Main exercise: ${focus.name}. ${focusNote}.`)
  if (beginner) explanation.push(firstSteps)
  if (second && !checkpoint && !monthly) explanation.push(`Another exercise: ${second.name}, from a different area.`)
  if (song) explanation.push(song.reason)
  else explanation.push('No songs in your library yet, so that time goes to exercises.')
  if (songs.length > 1) explanation.push(`${songs.length} songs today, so you do not play one song over and over.`)
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

/** Marks a block done and adapts the remaining pending blocks (docs §6.4). Returns a new plan. */
export function adaptAfterBlock(plan: SessionPlan, blockId: string, attempt: Attempt, performance: Performance): SessionPlan {
  void attempt
  const done = plan.blocks.find((b) => b.id === blockId)
  if (!done) return { ...plan, blocks: plan.blocks.map((b) => ({ ...b })), explanation: [...plan.explanation] }

  let dayFactor = plan.dayFactor
  const isWarmup = done.kind === 'warmup'
  if (isWarmup) dayFactor = dayFactorFor(performance.acc)
  const ratio = plan.dayFactor > 0 ? dayFactor / plan.dayFactor : 1

  const blocks = plan.blocks.map((b): Block => {
    if (b.id === blockId) return { ...b, status: 'done' }
    if (!isExercise(b) || b.status !== 'pending') return { ...b }
    const start = typeof b.params.startTempo === 'number' ? b.params.startTempo : b.tempo
    if (isWarmup) {
      const max = maxTempoOf(b)
      return withTempo(b, Math.min(max, Math.round(b.tempo * ratio)), Math.min(max, Math.round(start * ratio)))
    }
    if (isExercise(done) && b.skillId === done.skillId) {
      return withTempo(b, nextRepTempo(b.tempo, performance.acc, start, maxTempoOf(b)), start)
    }
    return { ...b }
  })

  return { ...plan, dayFactor, blocks, explanation: [...plan.explanation] }
}
