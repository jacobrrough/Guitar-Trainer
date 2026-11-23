/**
 * Orchestration for the Coach: turns the pure planning/learning modules and
 * the store into the few operations the UI needs. Everything here is async
 * because it reads and writes IndexedDB; the maths lives in the pure modules.
 *
 * The Coach works for two instruments (docs/SINGING.md §2 and §6). Which one an operation is for is
 * said by what it is given, wherever that can be read: a skill id, a song record, a stored session.
 * Where nothing says it, the instrument is a last parameter that defaults to guitar, so every caller
 * written before singing existed does exactly what it did. What a guitar stores carries no stamp, as
 * ever; what a singer stores is stamped here, because the store tells the two sides apart by it.
 */
import type { AppSettings } from '../app/settings'
import { generateLevels } from '../chart/difficulty'
import { db, type SongRecord } from '../db/db'
import { MIN_RANGE_SPAN } from '../music/keys'
import { applyPlacement, applyTestResults, isTestDue } from './assessment'
import { exerciseParams, generateExercise } from './exercises'
import { renderExerciseBacking } from './exercises/backing'
import { DEFAULT_TUNING } from './exercises/builder'
import { courseFor, instrumentOf, instrumentOfBlockId, instrumentOfSkillId, skillById, skillsFor } from './instruments'
import { applyAttempt, effectiveRating, newSkillState, stepWithin } from './learner'
import { allLessonsDone, courseProgress, initialiseCourse, restartCourse } from '../lessons/store'
import { BUILT_IN_SONGS, installBuiltInSongs } from '../songs'
import { VOCAL_SONGS, VOICE_LEVELS, levelDurations, vocalSong } from '../songs/vocal'
import { installVocalSongs, vocalSongRecord } from '../songs/vocal/install'
import { updateSettings } from '../app/settings'
import { recordMilestones } from './milestoneStore'
import { migrateStoredTempos } from './migrate'
import { skillMilestones, songMilestone, streakMilestone, testMilestone, unlockMilestonesBetween } from './milestones'
import { attemptPerformance } from './performance'
import { adaptAfterBlock, inHoldBand, nextRepStep, nextRepTempo, planSession } from './planner'
import { recommendations } from './recommend'
import { applySongAttempt, newSongItem, nextReview, songItemKey, startReview } from './review'
import { openContextOf, taughtSkillIds } from './unlock'
import {
  VOICE_CHECK_HEARD_ITSELF,
  VOICE_FIRST_SKILL_ID,
  VOICE_ONLY_WEEKLY_CHECK,
  VOICE_SHORTEST_DAY,
  coachOffersSong,
  isGentleDay,
  keyLoweredAt,
  lowerKeyNudge,
  milestonesFor,
  runsInPresentKey,
  satHigh,
  seededFirstSkill,
  voiceCheckDue,
  voicePlanOptions,
  withGentleDayLine,
  withKeyReasons,
} from './voicePlan'
import { loadVoiceProfile, markTiredOn, saveVoiceRange, setKeyNudge } from './voiceProfile'
import {
  getSession,
  loadLearnerModel,
  loadProfile,
  localDateString,
  markSessionDay,
  practiceDaysBySkill,
  recentAttempts,
  recordAttempt,
  recordTest,
  saveLearnerModel,
  saveProfile,
  saveSession,
  saveSkillState,
  saveSongItem,
} from './store'
import type {
  Attempt,
  AttemptKind,
  AttemptResult,
  Block,
  ExerciseBlock,
  ExerciseParams,
  GeneratedExercise,
  InstrumentId,
  LearnerModel,
  Milestone,
  Performance,
  Prefs,
  Profile,
  Recommendation,
  SessionRecord,
  SkillDef,
  SkillState,
  SongBlock,
  SongItemState,
  SongSummary,
  TestRecord,
  TestTask,
  TestTaskResult,
  TestType,
  VoiceProfile,
  VoiceRange,
} from './types'

const DAY_MS = 86_400_000

/** Difficulty of a song level on the 0–100 skill scale (level index 0..5). */
export function songLevelDifficulty(levelIndex: number): number {
  return 30 + 10 * Math.max(0, Math.min(5, levelIndex))
}

export function calibrationAgeDays(settings: Pick<AppSettings, 'calibratedAt'>, now = Date.now()): number | null {
  return settings.calibratedAt ? (now - settings.calibratedAt) / DAY_MS : null
}

/** Whole local days between a stored YYYY-MM-DD and `now`; undefined when never. */
export function daysSinceDate(dateStr: string | undefined, now: Date): number | undefined {
  if (!dateStr) return undefined
  const [y, m, d] = dateStr.split('-').map(Number)
  const then = new Date(y, m - 1, d).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((today - then) / DAY_MS)
}

/** The songs of one instrument as the Coach sees them: what it may put in a plan, a check or a piece of advice. */
export function songSummaries(instrument: InstrumentId = 'guitar'): Promise<SongSummary[]> {
  return instrument === 'voice' ? voiceSongSummaries() : guitarSongSummaries()
}

async function guitarSongSummaries(): Promise<SongSummary[]> {
  // The song table holds the songs to sing as well. Their notes have no string and no fret: they are not guitar songs.
  const songs = (await db.songs.toArray()).filter((s) => instrumentOf(s) === 'guitar')
  return songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    duration: s.duration,
    bpm: s.bpm,
    levelNoteCounts: generateLevels(s.chart).map((l) => l.notes.length),
    ...(s.builtinId ? { builtinId: s.builtinId, lessonLevel: BUILT_IN_SONGS.find((b) => b.id === s.builtinId)?.lessonLevel } : {}),
  }))
}

/**
 * The songs the Coach offers a singer: those that fit the range in some key and whose skills are under
 * way (`coachOffersSong`), in the order of the course. The library is wider and does not read this list.
 *
 * Every level of a song to sing scores the same notes, so the six counts are equal; what differs is how
 * long a level lasts (an echo level about twice the tune), which the planner needs for the passes.
 * The row of a song is written when it is first needed (`vocalSongRecord`), so nothing here depends on
 * the songs having been installed. Never call this from a live query: it may write.
 */
async function voiceSongSummaries(): Promise<SongSummary[]> {
  const [voice, states] = await Promise.all([loadVoiceProfile(), db.skillStates.toArray()])
  const ratings = new Map(states.map((s) => [s.skillId, s.rating]))
  const out: SongSummary[] = []
  for (const song of VOCAL_SONGS) {
    if (!coachOffersSong(song, voice, (id) => ratings.get(id) ?? 0)) continue
    const row = await vocalSongRecord(song.id)
    out.push({
      id: row.id,
      title: row.title,
      artist: row.artist,
      duration: row.duration,
      bpm: row.bpm,
      levelNoteCounts: VOICE_LEVELS.map(() => row.chart.notes.length),
      builtinId: song.id,
      lessonLevel: song.lessonLevel,
      levelDurations: levelDurations(song),
      instrument: 'voice',
    })
  }
  return out
}

/**
 * Which side a stored session is on: its stamp, and for a row an older copy of the app left without
 * one, what the ids of its blocks say (the store reads such rows the same way).
 */
function sessionSide(session: SessionRecord): InstrumentId {
  return session.instrument ?? instrumentOfBlockId(session.plan.blocks[0]?.id ?? '')
}

/**
 * The last few sessions of one instrument before today, most recent first. The session table holds the
 * days of both instruments: the other side's are left out before anything is counted, so three days of
 * singing never hide what the guitar practised last, nor the other way round.
 */
async function sessionsBefore(todayDate: string, instrument: InstrumentId, count: number): Promise<SessionRecord[]> {
  const sessions = await db.sessions
    .orderBy('date')
    .reverse()
    .filter((s) => sessionSide(s) === instrument)
    .limit(count + 1)
    .toArray()
  return sessions.filter((s) => s.date !== todayDate).slice(0, count)
}

/** How many past sessions the recap looks back on, so a skipped recap is not offered again the next day. */
const RECENT_RECAP_SESSIONS = 3

/** Recap skills of the last few sessions before today, most recent first, played or not. */
async function recentRecapSkillIds(todayDate: string, instrument: InstrumentId): Promise<string[]> {
  const sessions = await sessionsBefore(todayDate, instrument, RECENT_RECAP_SESSIONS)
  return sessions.flatMap((s) => s.plan.blocks.filter((b): b is ExerciseBlock => b.kind === 'review').map((b) => b.skillId))
}

/**
 * What the learner really finished in the First steps course of one instrument: the lesson count and
 * the skills those lessons drilled. Each instrument has its own course; a lesson of the other one
 * counts for nothing here.
 */
export async function finishedLessons(instrument: InstrumentId = 'guitar'): Promise<{ lessonsDone: number; lessonSkillIds: string[] }> {
  const course = courseFor(instrument)
  const progress = await courseProgress()
  const done = new Set(progress.filter((p) => p.status === 'done').map((p) => p.id))
  return { lessonsDone: course.filter((l) => done.has(l.id)).length, lessonSkillIds: taughtSkillIds(progress, course) }
}

async function recentFocusSkillIds(todayDate: string, instrument: InstrumentId): Promise<string[]> {
  const sessions = await sessionsBefore(todayDate, instrument, 2)
  return sessions.map((s) => s.plan.blocks.find((b): b is ExerciseBlock => b.kind === 'focus')?.skillId).filter((id): id is string => !!id)
}

export interface TodayOptions {
  settings: Pick<AppSettings, 'calibratedAt'>
  now?: Date
  /** Guitar: a five-minute session of one exercise. Singing has none (a voice is always warmed up first): it gets its shortest day. */
  quick?: boolean
  /** Re-plan even if a session already exists for the day (keeps completed minutes). */
  forceNew?: boolean
  /** Whose day it is. Default guitar. Each instrument has its own session for a date. */
  instrument?: InstrumentId
}

/**
 * Calls for a day's session that are still being planned: a second call for the same instrument and
 * day joins the first. The two instruments never join each other: each has its own plan for the day.
 */
const planning = new Map<string, Promise<SessionRecord>>()

/**
 * Returns today's session, planning and storing it on first call. Two calls at once (a screen that
 * mounts twice, a second tab) end up with the same stored session: there is one per instrument and day.
 */
export function getOrCreateTodaySession(opts: TodayOptions): Promise<SessionRecord> {
  const key = `${opts.instrument ?? 'guitar'}:${localDateString(opts.now ?? new Date())}`
  const running = planning.get(key)
  // A re-plan waits for the plan in progress and then replaces it; anything else shares it.
  if (running && !opts.forceNew) return running
  const job = (running ? running.catch(() => undefined) : Promise.resolve())
    .then(() => planTodaySession(opts))
    .finally(() => {
      if (planning.get(key) === job) planning.delete(key)
    })
  planning.set(key, job)
  return job
}

/**
 * A plan stored by an earlier version can ask for more than a skill's target tempo, where the Coach
 * now stops. Its exercises that are still to come are brought down to the target, so the day does not
 * start with a round the next one has to undo ("a bit slower", after a clean round).
 *
 * A skill with a floor (every sung skill: too slowly, a line outlasts the breath) is held at its floor
 * in the same way. No guitar skill has one, so nothing changes for a guitar plan.
 */
async function withinTargets(record: SessionRecord): Promise<SessionRecord> {
  let changed = false
  const blocks = record.plan.blocks.map((b): Block => {
    if (b.kind === 'song' || b.kind === 'test' || b.status !== 'pending') return b
    const skill = skillById(b.skillId)
    const max = skill?.targetTempo
    const min = typeof b.params.minTempo === 'number' ? b.params.minTempo : skill?.minTempo
    const aboveFloor = min === undefined || b.tempo >= min
    if (max === undefined || (b.tempo <= max && b.params.maxTempo === max && aboveFloor)) return b
    changed = true
    const within = (tempo: number) => Math.max(min ?? -Infinity, Math.min(tempo, max))
    const tempo = within(b.tempo)
    const startTempo = typeof b.params.startTempo === 'number' ? within(b.params.startTempo) : tempo
    return { ...b, tempo, params: { ...b.params, tempo, startTempo, maxTempo: max } }
  })
  if (!changed) return record
  const next: SessionRecord = { ...record, plan: { ...record.plan, blocks } }
  await saveSession(next)
  return next
}

async function planTodaySession(opts: TodayOptions): Promise<SessionRecord> {
  const instrument = opts.instrument ?? 'guitar'
  const voice = instrument === 'voice'
  const now = opts.now ?? new Date()
  const date = localDateString(now)
  // Before anything is planned from them: tempos stored by an earlier version, corrected once.
  // They are guitar tempos; a singing plan reads none of them.
  if (!voice) await migrateStoredTempos()
  const existing = await getSession(date, instrument)
  if (existing && !opts.forceNew) return withinTargets(existing)
  const [model, library, profile, recentFocus, recentRecap, lessons, practiceDays] = await Promise.all([
    loadLearnerModel(instrument),
    songSummaries(instrument),
    loadProfile(instrument),
    recentFocusSkillIds(date, instrument),
    recentRecapSkillIds(date, instrument),
    finishedLessons(instrument),
    practiceDaysBySkill(date),
  ])
  // A voice: the day of "My voice is tired" and the day after it are short and leave the range alone.
  const gentle = voice && isGentleDay(daysSinceDate(profile.voice?.tiredOn, now))
  const dailyMinutes = voice && (gentle || opts.quick) ? VOICE_SHORTEST_DAY : profile.dailyMinutes
  const prefs: Prefs = { dailyMinutes, goals: profile.goals, pinnedSkillId: profile.pinnedSkillId }
  const planned = planSession({
    model,
    skills: skillsFor(instrument),
    library,
    prefs,
    now,
    dueTest: voice ? voiceCheckDue(profile, now.getTime(), gentle) : isTestDue(profile, now.getTime(), calibrationAgeDays(opts.settings, now.getTime())),
    recentFocusSkillIds: recentFocus,
    recentRecapSkillIds: recentRecap,
    goalSongId: library.find((s) => s.builtinId !== undefined && s.builtinId === profile.goalSongId)?.id,
    lessonsDone: lessons.lessonsDone,
    lessonSkillIds: lessons.lessonSkillIds,
    daysSinceLastSession: daysSinceDate(profile.lastSessionDate, now),
    practiceDays,
    quick: voice ? false : opts.quick,
    effectiveRating,
    ...(voice ? voicePlanOptions(profile.voice?.range, gentle) : {}),
  })
  const worded = voice ? withKeyReasons(planned, library, model.songItems) : planned
  const plan = gentle ? withGentleDayLine(worded) : worded
  const record: SessionRecord = {
    ...(existing?.id !== undefined ? { id: existing.id } : {}),
    date,
    plan,
    minutesDone: existing?.minutesDone ?? 0,
    completedBlockIds: existing?.completedBlockIds ?? [],
    startedAt: existing?.startedAt ?? now.getTime(),
    // Said here, not left to the block ids: a plan without blocks would otherwise be saved as a guitar day.
    instrument,
  }
  try {
    const id = await saveSession(record)
    return { ...record, id }
  } catch (err) {
    // Another tab stored the day's session in the meantime (one per instrument and date): use that one.
    const stored = await getSession(date, instrument)
    if (stored && existing?.id === undefined) return stored
    throw err
  }
}

/** A skill of either instrument. An id in neither list is an error wherever something is built or rated from it. */
function knownSkill(id: string | undefined): SkillDef {
  const skill = id === undefined ? undefined : skillById(id)
  if (!skill) throw new Error(`Unknown skill ${id}`)
  return skill
}

/** The part of a singer's range an exercise is placed by. */
export type ExerciseRange = Pick<VoiceRange, 'low' | 'high' | 'easy'>

/**
 * The params an exercise is built from. A sung exercise is placed in the singer's range as it is at
 * this moment, never as it was when the block was stored: a range made smaller in the middle of a day
 * is honoured by the very next exercise. The range goes last, so nothing stored can override it.
 * Without a range nothing is guessed here; the generator then uses its own starting range and says so
 * in the params it returns. A guitar exercise is built from its stored params alone, as ever.
 */
function paramsInRange<T extends Partial<ExerciseParams>>(skill: SkillDef, stored: T, range: ExerciseRange | undefined): T {
  if (!range || instrumentOfSkillId(skill.id) !== 'voice') return stored
  return { ...stored, low: range.low, high: range.high, easy: range.easy }
}

/**
 * Builds the playable exercise (chart + backing audio) for an exercise block. `range` is the singer's
 * range for a sung exercise (see `paramsInRange`); a guitar exercise does not read it.
 */
export function exerciseForBlock(block: ExerciseBlock, tuning: number[] = DEFAULT_TUNING, range?: ExerciseRange): GeneratedExercise {
  const skill = knownSkill(block.skillId)
  // A skill with a floor is never built under it, whatever a stored block says.
  const tempo = skill.minTempo === undefined ? block.tempo : Math.max(block.tempo, skill.minTempo)
  const params = exerciseParams(skill, block.generatorId, tempo, paramsInRange(skill, block.params, range))
  const exercise = generateExercise(skill, block.generatorId, params, tuning)
  return withBacking(exercise)
}

/**
 * Ear exercises play their own reference tones, so they get no rendered backing.
 * Everything else gets a click-only backing for scoring plus, unless this is a test,
 * a listening guide with the part played on the guitar (chords included: a beginner
 * needs to hear what a chord change should sound like).
 */
function withBacking(exercise: GeneratedExercise, allowGuide = true): GeneratedExercise {
  if (exercise.interaction === 'ear') return exercise
  return renderExerciseBacking(exercise, { guide: allowGuide })
}

/**
 * Builds the playable exercise for a test task (null for song tasks, which load the song instead).
 * `range` places a sung task in the singer's range of this moment, as for a block.
 * A task for a skill nobody knows is an error. (It used to be built as the first guitar skill, which
 * would hand a singer a guitar melody.)
 */
export function exerciseForTask(task: TestTask, tuning: number[] = DEFAULT_TUNING, range?: ExerciseRange): GeneratedExercise | null {
  if (task.generatorId === 'song') return null
  const skill = knownSkill(task.skillIds[0])
  const exercise = generateExercise(skill, task.generatorId, paramsInRange(skill, task.params, range), tuning)
  return withBacking(exercise, false)
}

const KIND_BY_BLOCK: Record<ExerciseBlock['kind'], AttemptKind> = { warmup: 'warmup', focus: 'practice', second: 'practice', review: 'review', ear: 'practice' }

/** What a stored row of a singer carries so that the store finds it on the singing side. A guitar row carries nothing, as ever. */
function stampOf(instrument: InstrumentId): { instrument?: InstrumentId } {
  return instrument === 'voice' ? { instrument } : {}
}

/**
 * How old the sound-sync measurement is, for judging a run. A sung run does not depend on it (when a
 * note begins is no part of its result), so for a voice it is always fresh: a singer's checks and
 * results never wait for a measurement, and never count for less without one.
 */
function syncAgeDays(instrument: InstrumentId, settings: Pick<AppSettings, 'calibratedAt'>, now: number): number | null {
  return instrument === 'voice' ? 0 : calibrationAgeDays(settings, now)
}

/**
 * True when a run counts towards progress. A bleed run (the microphone was hearing the app's own
 * guitar part) does not: the app would be marking its own playing. Such a run is kept in the attempt
 * history and changes nothing else. Neither does a partial run (begun in the middle, moved, or with
 * the microphone gone for part of it). Screens normally stop these before they get here; this is the
 * safety net. A run that was only hard to hear (low coverage) still counts, with less weight.
 */
function runCounts(result: Pick<AttemptResult, 'bleed' | 'partial'>): boolean {
  return result.bleed !== true && result.partial !== true
}

export interface BlockOutcome {
  session: SessionRecord
  attempt: Attempt
  performance: Performance
  state?: SkillState
  /** Skill rating before this block (exercise blocks). */
  ratingBefore?: number
  songItem?: SongItemState
  /** False when the run did not count: the block is not finished and the learner should play it again. */
  counted?: boolean
  /** Song blocks of a singer: true when this run moved the song to a lower key (see `SongPlayOutcome.keyLowered`). */
  keyLowered?: boolean
}

/**
 * Minutes really played: the lengths of the recorded runs, not the planned length of a block.
 * Runs that did not count (the app heard itself) are left out, as in the weekly total.
 * Whole minutes, and at least one once something was played, so the figure reads naturally.
 */
export function minutesPlayed(attempts: Pick<Attempt, 'durationSec' | 'bleed'>[]): number {
  const seconds = attempts.reduce((sum, a) => sum + (!a.bleed && Number.isFinite(a.durationSec) ? Math.max(0, a.durationSec) : 0), 0)
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0
}

/** The runs recorded for one block of a session: every round of an exercise, or the play of a song. */
async function blockRuns(session: SessionRecord, last: Attempt): Promise<Attempt[]> {
  if (session.id === undefined) return [last]
  const runs = await db.attempts.where('sessionId').equals(session.id).toArray()
  const same = runs.filter((a) => a.kind === last.kind && a.skillId === last.skillId && a.songId === last.songId && a.level === last.level)
  return same.length > 0 ? same : [last]
}

async function persistBlockDone(session: SessionRecord, blockId: string, attempt: Attempt, performance: Performance, now: number): Promise<SessionRecord> {
  const instrument = sessionSide(session)
  // The skills tell a later block of the same step exercise where its ladder ends (a guitar plan has no ladders).
  const plan = adaptAfterBlock(session.plan, blockId, attempt, performance, skillsFor(instrument))
  const already = session.completedBlockIds.includes(blockId)
  const completedBlockIds = already ? session.completedBlockIds : [...session.completedBlockIds, blockId]
  const allDone = plan.blocks.every((b) => b.status === 'done' || b.status === 'skipped')
  // Time done is the time on the clock: what was played in this block, not the minutes the plan gave it.
  const minutes = already ? 0 : minutesPlayed(await blockRuns(session, attempt))
  const record: SessionRecord = { ...session, plan, completedBlockIds, minutesDone: session.minutesDone + minutes, finishedAt: allDone ? now : session.finishedAt, instrument }
  const id = await saveSession(record)
  if (completedBlockIds.length === 1) {
    // A day of singing counts for the singing streak and for no other.
    const before = await loadProfile(instrument)
    const after = await markSessionDay(session.date, instrument)
    await recordMilestones(milestonesFor(instrument, compact([streakMilestone(before.streak, after.streak, now)])))
  }
  return { ...record, id }
}

function compact<T>(items: Array<T | null | undefined>): T[] {
  return items.filter((m): m is T => m !== null && m !== undefined)
}

/**
 * Skills that opened between two states of the model, by the planner's own rule and with its numbers:
 * ratings with rust taken off and the skills the finished lessons taught (the plan keeps those open, so
 * they are never news). The practice rounds are those from before the update: a skill the learner already
 * practises was open, and the first round of a skill must not announce the skill itself.
 */
function unlocksBetween(before: LearnerModel, after: LearnerModel, taught: string[], now: number, instrument: InstrumentId): Milestone[] {
  const was = openContextOf(before, now, taught)
  return unlockMilestonesBetween(skillsFor(instrument), was, { ...openContextOf(after, now, taught), attempts: was.attempts }, now)
}

/**
 * Milestones from one skill update: band and tempo (or step) for the skill, plus any skills the new
 * rating unlocks, worded and stamped for the instrument of the skill.
 */
function skillUpdateMilestones(model: LearnerModel, skill: SkillDef, before: SkillState | null, after: SkillState, taught: string[], now: number): Milestone[] {
  const instrument = instrumentOfSkillId(skill.id)
  const updated = { ...model, skills: { ...model.skills, [skill.id]: after } }
  return milestonesFor(instrument, [...skillMilestones(skill, before, after, now, instrument), ...unlocksBetween(model, updated, taught, now, instrument)])
}

export interface RepOutcome {
  attempt: Attempt
  performance: Performance
  state: SkillState
  /** Skill rating before this rep. */
  ratingBefore: number
  /** Suggested tempo for the next rep (docs §6.4). A step exercise has one tempo: it stays the block's. */
  nextTempo: number
  /**
   * Step exercises only: the step for the next rep. The block runner merges it into the params of the
   * next round as it takes over `nextTempo`. Absent for every exercise that moves by tempo.
   */
  nextParams?: { step: number }
  /** False when the run did not count: nothing but the history changed and the rep should be played again. */
  counted?: boolean
}

/** Where a round of a step exercise stood, read from what was really built and sung, and where the block began. */
function ladderOfRound(skill: SkillDef, block: ExerciseBlock, exercise: GeneratedExercise): { step: number; startStep: number; maxStep: number } | undefined {
  const last = (skill.steps?.length ?? 0) - 1
  if (last < 0) return undefined
  // The exercise, not the block: when the range got smaller after the day was planned, the exercise
  // was built on the highest step that still fits, and says so. No step above that may be announced.
  const maxStep = stepWithin(exercise.params.maxStep, last, stepWithin(block.params.maxStep, last, last))
  const step = Math.min(stepWithin(exercise.params.step, last, 0), maxStep)
  const startStep = stepWithin(block.params.startStep, last, stepWithin(block.params.step, last, step))
  return { step, startStep, maxStep }
}

async function applyExerciseAttempt(
  block: ExerciseBlock,
  exercise: GeneratedExercise,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now: number,
  sessionId: number | undefined,
  isLastRep: boolean,
): Promise<RepOutcome> {
  const skill = knownSkill(block.skillId)
  // By the skill, never by the block id: a lesson round comes through a stand-in block whose id says nothing.
  const instrument = instrumentOfSkillId(block.skillId)
  const performance = attemptPerformance(result, { calibrationAgeDays: syncAgeDays(instrument, settings, now) })
  const model = await loadLearnerModel(instrument)
  const previous = model.skills[block.skillId] ?? newSkillState(block.skillId, 0, now)
  const ladder = ladderOfRound(skill, block, exercise)
  const attempt: Attempt = {
    ...result,
    at: now,
    kind: KIND_BY_BLOCK[block.kind],
    skillId: block.skillId,
    exerciseId: exercise.id,
    // What was built and sung, not what the block asked for: the rating reads the step from here.
    params: exercise.params,
    difficulty: exercise.difficulty,
    performance: performance.p,
    accuracy: performance.acc,
    reliable: performance.reliable,
    sessionId,
    ...stampOf(instrument),
  }
  if (!runCounts(result)) {
    // History only: no rating, tempo ceiling, review date or milestone, and the next rep stays at this tempo (and step).
    const id = await recordAttempt(attempt)
    return {
      attempt: { ...attempt, id },
      performance,
      state: previous,
      ratingBefore: previous.rating,
      nextTempo: block.tempo,
      ...(ladder ? { nextParams: { step: ladder.step } } : {}),
      counted: false,
    }
  }
  const history = await recentAttempts({ skillId: block.skillId, sinceDays: 30, limit: 20, countedOnly: true })
  let state = applyAttempt(previous, attempt, skill, history, now)
  if (isLastRep) {
    if (block.kind === 'review' && state.nextReviewAt) state = { ...state, ...nextReview(state, performance.p, now) }
    else if (!state.nextReviewAt && state.rating >= 75) state = { ...state, ...startReview(now) }
  }
  attempt.ratingAfter = state.rating
  const id = await recordAttempt(attempt)
  await saveSkillState(state)
  const taught = (await finishedLessons(instrument)).lessonSkillIds
  await recordMilestones(skillUpdateMilestones(model, skill, model.skills[block.skillId] ?? null, state, taught, now))
  // The round before this one, if it belongs to the same sitting and was neither clean nor rough.
  const before = history[0]
  const inBetweenBefore = !!before && sessionId !== undefined && before.sessionId === sessionId && inHoldBand(before.accuracy)
  if (ladder) {
    // A step exercise never changes tempo: it has one, and slower is not easier. Its step moves instead.
    // "The same place as the round before" is the same step (the tempo is the same on every round, so
    // it cannot tell two rounds on one step from two rounds on different steps).
    const heldBefore = inBetweenBefore && stepWithin(before.params?.step, ladder.maxStep, 0) === ladder.step
    return {
      attempt: { ...attempt, id },
      performance,
      state,
      ratingBefore: previous.rating,
      nextTempo: block.tempo,
      nextParams: { step: nextRepStep(ladder.step, performance.acc, ladder.startStep, ladder.maxStep, heldBefore) },
      counted: true,
    }
  }
  const startTempo = typeof block.params.startTempo === 'number' ? block.params.startTempo : block.tempo
  // ...and was at this tempo.
  const heldBefore = inBetweenBefore && Math.abs(before.playedTempo - result.playedTempo) < 0.5
  return {
    attempt: { ...attempt, id },
    performance,
    state,
    ratingBefore: previous.rating,
    // Never under the floor of a skill that has one (`skill.minTempo`; no guitar skill does).
    nextTempo: nextRepTempo(block.tempo, performance.acc, startTempo, skill.targetTempo, heldBefore, skill.minTempo),
    counted: true,
  }
}

/** Records one rep of an exercise block (not the last): attempt + rating, and suggests the next rep's tempo. */
export function recordExerciseRep(
  session: SessionRecord,
  block: ExerciseBlock,
  exercise: GeneratedExercise,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
): Promise<RepOutcome> {
  return applyExerciseAttempt(block, exercise, result, settings, now, session.id, false)
}

/** Records the result of an exercise block: attempt, skill rating, review schedule, adapted plan, streak. */
export async function completeExerciseBlock(
  session: SessionRecord,
  block: ExerciseBlock,
  exercise: GeneratedExercise,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
): Promise<BlockOutcome> {
  const rep = await applyExerciseAttempt(block, exercise, result, settings, now, session.id, true)
  const outcome = { attempt: rep.attempt, performance: rep.performance, state: rep.state, ratingBefore: rep.ratingBefore }
  // A run that did not count leaves the block open: the plan, the minutes and the streak stay as they were.
  if (rep.counted === false) return { session, ...outcome, counted: false }
  const updated = await persistBlockDone(session, block.id, rep.attempt, rep.performance, now)
  return { session: updated, ...outcome, counted: true }
}

/**
 * Closes an exercise block early from the last recorded rep: no new attempt,
 * just the review scheduling and the plan/session bookkeeping.
 * A rep that did not count cannot close a block.
 */
export async function finishExerciseBlock(session: SessionRecord, block: ExerciseBlock, lastRep: RepOutcome, now = Date.now()): Promise<BlockOutcome> {
  if (lastRep.counted === false || !runCounts(lastRep.attempt)) {
    return { session, attempt: lastRep.attempt, performance: lastRep.performance, state: lastRep.state, ratingBefore: lastRep.ratingBefore, counted: false }
  }
  const model = await loadLearnerModel(instrumentOfSkillId(block.skillId))
  let state = model.skills[block.skillId] ?? lastRep.state
  if (block.kind === 'review' && state.nextReviewAt) state = { ...state, ...nextReview(state, lastRep.performance.p, now) }
  else if (!state.nextReviewAt && state.rating >= 75) state = { ...state, ...startReview(now) }
  await saveSkillState(state)
  const updated = await persistBlockDone(session, block.id, lastRep.attempt, lastRep.performance, now)
  return { session: updated, attempt: lastRep.attempt, performance: lastRep.performance, state, ratingBefore: lastRep.ratingBefore, counted: true }
}

function buildSongAttempt(song: SongRecord, level: number, result: AttemptResult, performance: Performance, now: number, sessionId?: number): Attempt {
  return {
    ...result,
    at: now,
    kind: 'song',
    songId: song.id,
    level,
    difficulty: songLevelDifficulty(level),
    performance: performance.p,
    accuracy: performance.acc,
    reliable: performance.reliable,
    sessionId,
    ...stampOf(instrumentOf(song)),
  }
}

export interface SongPlayOutcome {
  attempt: Attempt
  /** The song item after the play; unchanged (and not stored if new) when the run did not count. */
  songItem: SongItemState
  performance: Performance
  /** False when the run did not count: nothing but the history changed. */
  counted?: boolean
  /**
   * Songs to sing: true when this run was the second in a row whose top notes were missed, and the song
   * was moved a semitone down for it. The next time it is opened it is in the lower key, and the result
   * screen can say so: "That one sat high for you, so we moved the song down a little."
   */
  keyLowered?: boolean
}

/** How many of a song's recent runs are looked through for the one before the last. Runs that did not count are passed over. */
const SONG_RUNS_LOOKED_AT = 8

/**
 * A song to sing whose top notes were missed twice in a row is too high, not too hard: its key goes
 * down a semitone before its level may (docs/SINGING.md §5). Called with a counted run, before that run
 * is stored; resolves to true when the key was lowered.
 *
 * Both runs have to be in the key the song has now. A run from before the key was last lowered says
 * nothing about the new key, or one more high run right after a move would move the song again.
 * Without a stored range the song is sung as written and no key choice applies, so nothing is lowered.
 */
async function lowerKeyIfTooHigh(song: SongRecord, run: Attempt, items: SongItemState[]): Promise<boolean> {
  if (!satHigh(run)) return false
  const tune = song.builtinId === undefined ? undefined : vocalSong(song.builtinId)
  if (!tune) return false
  const earlier = await recentAttempts({ songId: song.id, kinds: ['song'], countedOnly: true, limit: SONG_RUNS_LOOKED_AT })
  const before = earlier.find((a) => !a.partial)
  const since = keyLoweredAt(items) ?? -Infinity
  if (!before || before.at <= since || !satHigh(before)) return false
  const voice = await loadVoiceProfile()
  if (!voice.range) return false
  const lower = lowerKeyNudge(tune, voice.range, voice.keyNudge?.[tune.id])
  if (lower === null) return false
  await setKeyNudge(tune.id, lower)
  return true
}

/**
 * Records a song play (inside or outside a session) and updates the song item.
 * The instrument is the song's own: a song to sing is stamped on its run, its item and its milestone,
 * and may be moved to a lower key (`lowerKeyIfTooHigh`).
 */
export async function recordSongPlay(
  song: SongRecord,
  level: number,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
  sessionId?: number,
): Promise<SongPlayOutcome> {
  const instrument = instrumentOf(song)
  const performance = attemptPerformance(result, { calibrationAgeDays: syncAgeDays(instrument, settings, now) })
  const attempt = buildSongAttempt(song, level, result, performance, now, sessionId)
  const key = songItemKey(song.id, level)
  const existing = await db.songItems.get(key)
  // The item of a song to sing is stamped from its first run: the store sorts items to a side by the stamp alone.
  const fresh = (): SongItemState => ({ ...newSongItem(song.id, level), ...stampOf(instrument) })
  if (!runCounts(result)) {
    // History only: no best result, review date or milestone.
    const id = await recordAttempt(attempt)
    return { attempt: { ...attempt, id }, songItem: existing ?? fresh(), performance, counted: false }
  }
  let songItem = applySongAttempt(existing ?? fresh(), attempt, now)
  let keyLowered = false
  if (instrument === 'voice') {
    // Every level of the song: the key belongs to the song, and it may have been lowered on another level.
    const levels = await db.songItems.where('songId').equals(song.id).toArray()
    keyLowered = await lowerKeyIfTooHigh(song, attempt, levels)
    // The hard runs were the key's doing: they are not held against the level as well, so key and
    // level never go down on the same day.
    if (keyLowered) songItem = { ...songItem, lowStreak: 0, keyLoweredAt: now }
  }
  const id = await recordAttempt(attempt)
  await saveSongItem(songItem)
  await recordMilestones(milestonesFor(instrument, compact([songMilestone(song.title, existing ?? null, songItem, now, instrument)])))
  return { attempt: { ...attempt, id }, songItem, performance, counted: true, ...(keyLowered ? { keyLowered } : {}) }
}

/** Records the result of a song block within a session. */
export async function completeSongBlock(
  session: SessionRecord,
  block: SongBlock,
  song: SongRecord,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
): Promise<BlockOutcome> {
  const { attempt, songItem, performance, counted, keyLowered } = await recordSongPlay(song, block.level, result, settings, now, session.id)
  // A run that did not count leaves the block open.
  if (counted === false) return { session, attempt, performance, songItem, counted: false }
  const updated = await persistBlockDone(session, block.id, attempt, performance, now)
  return { session: updated, attempt, performance, songItem, counted: true, ...(keyLowered ? { keyLowered } : {}) }
}

/** Marks a block skipped without recording an attempt. */
export async function skipSessionBlock(session: SessionRecord, blockId: string, now = Date.now()): Promise<SessionRecord> {
  const plan = { ...session.plan, blocks: session.plan.blocks.map((b) => (b.id === blockId ? { ...b, status: 'skipped' as const } : b)) }
  const allDone = plan.blocks.every((b) => b.status === 'done' || b.status === 'skipped')
  const record: SessionRecord = { ...session, plan, finishedAt: allDone ? now : session.finishedAt }
  const id = await saveSession(record)
  return { ...record, id }
}

/**
 * The instrument a check is for, read from its tasks: one task on a singing skill makes it a sung
 * check. A song task names no skill, so here a check made of song tasks alone says nothing and reads
 * as guitar. (A whole check that is being saved is asked through `instrumentOfCheck`, which looks at
 * its songs as well. One run of a song task cannot be: whoever builds it says whose it is.)
 */
export function instrumentOfTasks(tasks: Pick<TestTask, 'skillIds'>[]): InstrumentId {
  return tasks.some((t) => t.skillIds.some((id) => instrumentOfSkillId(id) === 'voice')) ? 'voice' : 'guitar'
}

/**
 * The instrument of a whole check when nobody says whose it is. Its skills say it, if a task names one
 * (`instrumentOfTasks`, and nothing is read). A check made of song tasks alone names no skill, so its
 * songs are asked: a song to sing makes it a sung check. Without this, such a check handed in without
 * its instrument would be saved as a guitar check, on the guitar profile, and would close the guitar's
 * open check of that day. A song that cannot be found, or read, says nothing: guitar, as before.
 */
export async function instrumentOfCheck(tasks: Pick<TestTask, 'skillIds' | 'generatorId' | 'params'>[]): Promise<InstrumentId> {
  if (tasks.some((t) => t.skillIds.length > 0)) return instrumentOfTasks(tasks)
  for (const task of tasks) {
    const songId = task.generatorId === 'song' ? task.params.songId : undefined
    if (typeof songId !== 'number') continue
    const song = await db.songs.get(songId).catch(() => undefined)
    if (song && instrumentOf(song) === 'voice') return 'voice'
  }
  return 'guitar'
}

/**
 * Builds the attempt for a test task result (kind 'test'). `instrument` is read from the task's skill
 * when it is left out; a song task of a sung check has no skill, so there it has to be given.
 */
export function attemptForTask(
  task: TestTask,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
  instrument: InstrumentId = instrumentOfTasks([task]),
): Attempt {
  const performance = attemptPerformance(result, { calibrationAgeDays: syncAgeDays(instrument, settings, now), isTest: true })
  return {
    ...result,
    at: now,
    kind: 'test',
    skillId: task.generatorId === 'song' ? undefined : task.skillIds[0],
    songId: task.generatorId === 'song' ? (task.params.songId as number | undefined) : undefined,
    level: task.generatorId === 'song' ? (task.params.level as number | undefined) : undefined,
    exerciseId: `${task.generatorId}:${task.id}`,
    params: task.params,
    difficulty: task.difficulty,
    performance: performance.p,
    accuracy: performance.acc,
    reliable: performance.reliable,
    ...stampOf(instrument),
  }
}

/**
 * Applies a finished test to the learner model, stores the record and the attempts.
 * Tasks that did not count (see `runCounts`) go into the attempt history and nowhere else: they are
 * judged as not attempted. A test made of nothing else is not saved at all.
 *
 * `whose`: whose check it is (read from the tasks when left out, see `instrumentOfCheck`). A sung
 * check is rated on the singing skills, stored on the singing profile, and stamped: the record, every
 * run of it, and its milestones. Singing has the weekly check and no other: a starting check or a
 * monthly check rates every skill of an instrument from a fixed list of guitar tasks, so one handed in
 * for a voice is refused before anything is stored.
 */
export async function finishTest(type: TestType, tasks: TestTask[], allResults: TestTaskResult[], now = Date.now(), whose?: InstrumentId): Promise<TestRecord> {
  const instrument = whose ?? (await instrumentOfCheck(tasks))
  const voice = instrument === 'voice'
  if (voice && type !== 'checkpoint') throw new Error(VOICE_ONLY_WEEKLY_CHECK)
  // Every run of a sung check is a singing run, whatever the task it was built from could say about it.
  const stamped = voice ? allResults.map((r) => ({ ...r, attempt: { ...r.attempt, ...stampOf(instrument) } })) : allResults
  const results = stamped.filter((r) => runCounts(r.attempt))
  const dropped = stamped.length - results.length
  if (dropped > 0 && results.length === 0) {
    for (const r of stamped) await recordAttempt(r.attempt)
    throw new Error(voice ? VOICE_CHECK_HEARD_ITSELF : 'The microphone was only hearing the app, not your guitar, so this check was not saved. Use headphones, then try again.')
  }
  const skills = skillsFor(instrument)
  const model = await loadLearnerModel(instrument)
  const applied =
    type === 'placement'
      ? applyPlacement(model, tasks, results, skills, now)
      : applyTestResults(model, type, tasks, results, skills, (state, attempt, skill) => applyAttempt(state, attempt, skill, [], attempt.at), now)
  await saveLearnerModel(applied.model)
  for (const r of stamped) await recordAttempt(r.attempt)
  const record: TestRecord = { at: now, type, tasks, results, report: applied.report, ...stampOf(instrument) }
  const id = await recordTest(record)
  const changed = skills.filter((s) => applied.model.skills[s.id] && applied.model.skills[s.id].rating !== model.skills[s.id]?.rating)
  const taught = (await finishedLessons(instrument)).lessonSkillIds
  await recordMilestones(
    milestonesFor(instrument, [
      ...changed.flatMap((s) => skillMilestones(s, model.skills[s.id] ?? null, applied.model.skills[s.id], now, instrument)),
      ...unlocksBetween(model, applied.model, taught, now, instrument),
      // "Passed every task" is only true when every task was judged.
      ...(dropped === 0 ? compact([testMilestone({ ...record, id }, now)]) : []),
    ]),
  )
  return { ...record, id }
}

/**
 * "Start as a beginner": skips the placement test; ratings start at zero and climb quickly.
 * (Singing has no placement test to skip: its set-up marks it done whatever is answered. Asked for a
 * voice, this marks the same thing on the singing profile.)
 */
export async function skipPlacement(now = Date.now(), instrument: InstrumentId = 'guitar'): Promise<Profile> {
  const profile = { ...(await loadProfile(instrument)), placementDoneAt: now }
  await saveProfile(profile)
  return profile
}

/** Id of the next pending block after `afterId` (or the first pending one). */
export function nextPendingBlockId(session: SessionRecord, afterId?: string): string | null {
  const blocks = session.plan.blocks
  const from = afterId ? blocks.findIndex((b) => b.id === afterId) + 1 : 0
  const next = blocks.slice(from).find((b) => b.status === 'pending') ?? blocks.find((b) => b.status === 'pending')
  return next?.id ?? null
}

export async function updatePrefs(patch: Partial<Pick<Profile, 'goals' | 'dailyMinutes' | 'pinnedSkillId'>>, instrument: InstrumentId = 'guitar'): Promise<Profile> {
  const profile = { ...(await loadProfile(instrument)), ...patch }
  await saveProfile(profile)
  return profile
}

/**
 * The Coach's advice for one instrument, worked out from that instrument's own runs, skills and songs.
 * For a voice there is no sound-sync card (see `syncAgeDays`), and no card about a song the Coach does
 * not offer itself: a song sung from the library before its skills are under way is left to the singer.
 * Nor is anything said about the runs a song was moved to a lower key for (`runsInPresentKey`): the
 * plan keeps the level of that song, so no card may say it is going back one.
 */
export async function coachRecommendations(settings: Pick<AppSettings, 'calibratedAt'>, now = Date.now(), instrument: InstrumentId = 'guitar'): Promise<Recommendation[]> {
  // Advice is worked out from counted runs only.
  const [model, library, runs] = await Promise.all([
    loadLearnerModel(instrument),
    songSummaries(instrument),
    recentAttempts({ sinceDays: 30, limit: 300, countedOnly: true, instrument }),
  ])
  const offered = new Set(library.map((s) => s.id))
  const attempts =
    instrument === 'voice' ? runsInPresentKey(runs, Object.values(model.songItems)).filter((a) => a.kind !== 'song' || a.songId === undefined || offered.has(a.songId)) : runs
  return recommendations(
    {
      model,
      skills: skillsFor(instrument),
      library,
      recentAttempts: attempts,
      now,
      calibrationAgeDays: syncAgeDays(instrument, settings, now),
      daysSinceLastSession: daysSinceDate(model.profile.lastSessionDate, new Date(now)),
      lastSongPlayedAt: runs.find((a) => a.kind === 'song')?.at,
    },
    { instrument },
  )
}

/** What the singing set-up collects. Nothing about a hand or a guitar: those are not a singer's to set. */
export interface VoiceFirstStepsSetup {
  /** 'new' = never sung, 'some' = a little, 'played' = "Yes, often". */
  experience: 'new' | 'some' | 'played'
  dailyMinutes: Profile['dailyMinutes']
  goalSongId?: string
}

/** What the Start Here wizard collects. */
export interface FirstStepsSetup extends VoiceFirstStepsSetup {
  handedness: 'right' | 'left'
  guitarType: 'acoustic' | 'electric'
}

/** True when every lesson of an instrument's course is done: a graduate, as opposed to someone who left the course. */
async function courseFinished(instrument: InstrumentId): Promise<boolean> {
  const ids = courseFor(instrument).map((l) => l.id)
  return allLessonsDone(await courseProgress(ids), ids)
}

/**
 * Gives a singer who skips the first steps their starting point: "Match a note" at the unlock line on
 * its second step (`seededFirstSkill`). Never lowers anything, so it can be applied more than once.
 */
async function seedFirstVoiceSkill(profile: Profile, now: number): Promise<void> {
  const existing = await db.skillStates.get(VOICE_FIRST_SKILL_ID)
  const seeded = seededFirstSkill(existing, profile.voice?.range, now)
  if (!existing || seeded.rating !== existing.rating || seeded.step !== existing.step) await saveSkillState(seeded)
}

/**
 * Applies the wizard's answers. New and "a little" players skip the placement
 * test and start the First steps course; players who have played before go to
 * the normal setup card (placement test) with their preferences filled in.
 *
 * The profile and the lesson rows are saved together, before the slow song install: Today shows
 * only the next lesson while the course is running, so the course must never be marked as running
 * without a lesson to start, even if the app is closed half way through setup.
 *
 * `instrument` 'voice' is the singing set-up. It writes the singing profile (row 2), the lesson rows
 * of the singing course and the songs to sing, and nothing of the guitar: not its profile, not its
 * lessons, and never the hand or the guitar type in the settings (a full guitar answer handed over by
 * mistake is read for what a singer answers and no more). Two things differ for a singer:
 * - there is no starting check, so it is marked done whatever was answered;
 * - "Yes, often" needs no first steps: the course is ended on the spot, and "Match a note" starts at
 *   the unlock line so the skills after it are open on the first day. The lesson rows are written all
 *   the same, so the lessons can still be opened from the menu.
 */
export function startFirstSteps(setup: FirstStepsSetup, now?: number, instrument?: InstrumentId): Promise<Profile>
export function startFirstSteps(setup: VoiceFirstStepsSetup, now: number | undefined, instrument: 'voice'): Promise<Profile>
export async function startFirstSteps(setup: FirstStepsSetup | VoiceFirstStepsSetup, now = Date.now(), instrument: InstrumentId = 'guitar'): Promise<Profile> {
  const voice = instrument === 'voice'
  if (!voice) {
    const { handedness, guitarType } = setup as FirstStepsSetup
    updateSettings({ handedness, guitarType })
  }
  const course = setup.experience !== 'played'
  const lessonIds = courseFor(instrument).map((l) => l.id)
  // The singer's starting point is a skill state: only the singing set-up needs that table.
  const tables = voice ? [db.profile, db.lessons, db.skillStates] : [db.profile, db.lessons]
  const profile = await db.transaction('rw', tables, async () => {
    const current = await loadProfile(instrument)
    const next: Profile = {
      ...current,
      experience: setup.experience,
      dailyMinutes: setup.dailyMinutes,
      goalSongId: setup.goalSongId,
      firstStepsStartedAt: course ? (current.firstStepsStartedAt ?? now) : current.firstStepsStartedAt,
      placementDoneAt: course || voice ? (current.placementDoneAt ?? now) : current.placementDoneAt,
      ...(voice && !course ? { firstStepsDoneAt: current.firstStepsDoneAt ?? now } : {}),
    }
    await saveProfile(next)
    if (course || voice || (next.firstStepsStartedAt && !next.firstStepsDoneAt)) {
      // Every lesson done while the profile knows of no course: rows left over from before a reset.
      // Someone who has just said they are starting out gets the course from lesson 1.
      const leftovers = course && !current.firstStepsStartedAt && !current.firstStepsDoneAt && allLessonsDone(await courseProgress(lessonIds), lessonIds)
      if (leftovers) await restartCourse(lessonIds)
      else await initialiseCourse(lessonIds, now)
    }
    if (voice && !course) await seedFirstVoiceSkill(next, now)
    // Read back: initialising can end a course whose lessons were all done already.
    return loadProfile(instrument)
  })
  if (voice) await installVocalSongs()
  else await installBuiltInSongs()
  return profile
}

/**
 * Marks the First steps course of one instrument finished; Today shows the Coach's daily plan from
 * here on.
 *
 * A singer who leaves the course before its last lesson gets the starting point of one who skipped it
 * (`seedFirstVoiceSkill`). A graduate does not: they are rated by what they sang in the lessons.
 * The lesson screen ends a finished course from inside a transaction over the lessons and the profile.
 * That is why the starting point, which is a skill state, is only touched when lessons remain.
 */
export async function completeFirstSteps(now = Date.now(), instrument: InstrumentId = 'guitar'): Promise<Profile> {
  const current = await loadProfile(instrument)
  // The starting point before the end of the course, not after it. They are two writes, and the app can
  // be closed between them. A starting point without the end is harmless: the course is still there to
  // be left again. The end without the starting point would leave a singer with daily plans and nothing
  // open above the first exercise.
  if (instrument === 'voice' && !(await courseFinished(instrument))) await seedFirstVoiceSkill(current, now)
  const profile = { ...current, firstStepsDoneAt: now }
  await saveProfile(profile)
  return profile
}

/**
 * Records one round of a lesson drill outside a session: the attempt, the
 * skill rating and milestones update exactly as for a Coach block.
 */
export function recordLessonDrill(
  skillId: string,
  exercise: GeneratedExercise,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
): Promise<RepOutcome> {
  const block: ExerciseBlock = {
    id: `lesson-${skillId}`,
    kind: 'focus',
    status: 'active',
    minutes: 3,
    skillId,
    generatorId: exercise.generatorId,
    params: exercise.params,
    tempo: exercise.params.tempo,
    reps: 1,
    reason: 'First steps lesson',
  }
  // The id of this stand-in block reads as guitar whatever the skill. The run is stamped by its skill.
  return applyExerciseAttempt(block, exercise, result, settings, now, undefined, true)
}

/**
 * "My voice is tired": ends the singer's day. Every block that is still open is skipped, exactly as a
 * single skipped block is: nothing is recorded, no rating moves, and the streak, the end of the session
 * and the count of days since the last check follow the rules they follow for any skipped block.
 * The day is marked on the singing profile, so the Coach plans the next one short and gentle, and a
 * range changed later that day does not bring up a fresh plan.
 * Resolves to the session as it is stored afterwards. Only a singing session can be ended this way.
 */
export async function markVoiceTired(session: SessionRecord, now = Date.now()): Promise<SessionRecord> {
  if (sessionSide(session) !== 'voice') throw new Error('Only a day of singing can be ended this way.')
  // The mark first, under the date the plan carries: should the app close half way, the day is still
  // known as a tired one, and that is the part the next day's plan depends on.
  await markTiredOn(session.date)
  // From the plan that is stored for that day, not from the copy a screen holds: the copy may be a block
  // or two behind, or a plan that was made again since (a range changed before anything was sung takes
  // the day's plan away, and Today makes another). Putting the old copy back would be refused, as a
  // second singing plan for one day, with the mark already set and nothing skipped.
  let current = (await getSession(session.date, 'voice')) ?? session
  for (const block of current.plan.blocks) {
    if (block.status === 'pending' || block.status === 'active') current = await skipSessionBlock(current, block.id, now)
  }
  return current
}

/** How a round felt to the singer, asked after an exercise that goes high. */
export type Felt = 'easy' | 'ok' | 'tight'

/**
 * Records the singer's answer to "Easy, OK or Tight?". "Tight" always wins over the numbers: the top
 * of the range comes down by one note, whatever the round scored, so the next exercise and the next
 * song stay under it. The range is never made smaller than the smallest one the app stores (eight
 * notes), and never wider here: "Easy" and "OK" change nothing.
 * Resolves to the voice part of the singing profile as it is stored afterwards.
 */
export async function recordFelt(felt: Felt, now = Date.now()): Promise<VoiceProfile> {
  const voice = await loadVoiceProfile()
  const range = voice.range
  if (felt !== 'tight' || !range) return voice
  const high = Math.max(range.low + MIN_RANGE_SPAN, range.high - 1)
  if (high >= range.high) return voice
  // The store moves an easy note that was the top note down with it, and plans an untouched day again.
  return saveVoiceRange({ ...range, high, source: 'manual', at: now }, now)
}

