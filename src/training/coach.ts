/**
 * Orchestration for the Coach: turns the pure planning/learning modules and
 * the store into the few operations the UI needs. Everything here is async
 * because it reads and writes IndexedDB; the maths lives in the pure modules.
 */
import type { AppSettings } from '../app/settings'
import { generateLevels } from '../chart/difficulty'
import { db, type SongRecord } from '../db/db'
import { applyPlacement, applyTestResults, isTestDue } from './assessment'
import { exerciseParams, generateExercise } from './exercises'
import { renderExerciseBacking } from './exercises/backing'
import { DEFAULT_TUNING } from './exercises/builder'
import { applyAttempt, effectiveRating, newSkillState } from './learner'
import { COURSE } from '../lessons/course'
import { allLessonsDone, courseProgress, initialiseCourse, restartCourse } from '../lessons/store'
import { BUILT_IN_SONGS, installBuiltInSongs } from '../songs'
import { updateSettings } from '../app/settings'
import { recordMilestones } from './milestoneStore'
import { migrateStoredTempos } from './migrate'
import { skillMilestones, songMilestone, streakMilestone, testMilestone, unlockMilestonesBetween } from './milestones'
import { attemptPerformance } from './performance'
import { adaptAfterBlock, nextRepTempo, planSession } from './planner'
import { recommendations } from './recommend'
import { applySongAttempt, newSongItem, nextReview, songItemKey, startReview } from './review'
import { SKILLS, SKILLS_BY_ID } from './skills'
import { openContextOf, taughtSkillIds } from './unlock'
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
  ExerciseBlock,
  GeneratedExercise,
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

export async function songSummaries(): Promise<SongSummary[]> {
  const songs = await db.songs.toArray()
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

/** How many past sessions the recap looks back on, so a skipped recap is not offered again the next day. */
const RECENT_RECAP_SESSIONS = 3

/** Recap skills of the last few sessions before today, most recent first, played or not. */
async function recentRecapSkillIds(todayDate: string): Promise<string[]> {
  const sessions = await db.sessions.orderBy('date').reverse().limit(RECENT_RECAP_SESSIONS + 1).toArray()
  return sessions
    .filter((s) => s.date !== todayDate)
    .slice(0, RECENT_RECAP_SESSIONS)
    .flatMap((s) => s.plan.blocks.filter((b): b is ExerciseBlock => b.kind === 'review').map((b) => b.skillId))
}

/** What the learner really finished in the First steps course: the lesson count and the skills those lessons drilled. */
export async function finishedLessons(): Promise<{ lessonsDone: number; lessonSkillIds: string[] }> {
  const progress = await courseProgress()
  const done = new Set(progress.filter((p) => p.status === 'done').map((p) => p.id))
  return { lessonsDone: COURSE.filter((l) => done.has(l.id)).length, lessonSkillIds: taughtSkillIds(progress) }
}

async function recentFocusSkillIds(todayDate: string): Promise<string[]> {
  const sessions = await db.sessions.orderBy('date').reverse().limit(3).toArray()
  return sessions
    .filter((s) => s.date !== todayDate)
    .slice(0, 2)
    .map((s) => s.plan.blocks.find((b): b is ExerciseBlock => b.kind === 'focus')?.skillId)
    .filter((id): id is string => !!id)
}

export interface TodayOptions {
  settings: Pick<AppSettings, 'calibratedAt'>
  now?: Date
  quick?: boolean
  /** Re-plan even if a session already exists for the day (keeps completed minutes). */
  forceNew?: boolean
}

/** Calls for a day's session that are still being planned: a second call for the same day joins the first. */
const planning = new Map<string, Promise<SessionRecord>>()

/**
 * Returns today's session, planning and storing it on first call. Two calls at once (a screen that
 * mounts twice, a second tab) end up with the same stored session: there is one per day.
 */
export function getOrCreateTodaySession(opts: TodayOptions): Promise<SessionRecord> {
  const date = localDateString(opts.now ?? new Date())
  const running = planning.get(date)
  // A re-plan waits for the plan in progress and then replaces it; anything else shares it.
  if (running && !opts.forceNew) return running
  const job = (running ? running.catch(() => undefined) : Promise.resolve())
    .then(() => planTodaySession(opts))
    .finally(() => {
      if (planning.get(date) === job) planning.delete(date)
    })
  planning.set(date, job)
  return job
}

async function planTodaySession(opts: TodayOptions): Promise<SessionRecord> {
  const now = opts.now ?? new Date()
  const date = localDateString(now)
  // Before anything is planned from them: tempos stored by an earlier version, corrected once.
  await migrateStoredTempos()
  const existing = await getSession(date)
  if (existing && !opts.forceNew) return existing
  const [model, library, profile, recentFocus, recentRecap, lessons, practiceDays] = await Promise.all([
    loadLearnerModel(),
    songSummaries(),
    loadProfile(),
    recentFocusSkillIds(date),
    recentRecapSkillIds(date),
    finishedLessons(),
    practiceDaysBySkill(date),
  ])
  const prefs: Prefs = { dailyMinutes: profile.dailyMinutes, goals: profile.goals, pinnedSkillId: profile.pinnedSkillId }
  const plan = planSession({
    model,
    skills: SKILLS,
    library,
    prefs,
    now,
    dueTest: isTestDue(profile, now.getTime(), calibrationAgeDays(opts.settings, now.getTime())),
    recentFocusSkillIds: recentFocus,
    recentRecapSkillIds: recentRecap,
    goalSongId: library.find((s) => s.builtinId !== undefined && s.builtinId === profile.goalSongId)?.id,
    lessonsDone: lessons.lessonsDone,
    lessonSkillIds: lessons.lessonSkillIds,
    daysSinceLastSession: daysSinceDate(profile.lastSessionDate, now),
    practiceDays,
    quick: opts.quick,
    effectiveRating,
  })
  const record: SessionRecord = {
    ...(existing?.id !== undefined ? { id: existing.id } : {}),
    date,
    plan,
    minutesDone: existing?.minutesDone ?? 0,
    completedBlockIds: existing?.completedBlockIds ?? [],
    startedAt: existing?.startedAt ?? now.getTime(),
  }
  try {
    const id = await saveSession(record)
    return { ...record, id }
  } catch (err) {
    // Another tab stored the day's session in the meantime (the date is unique): use that one.
    const stored = await getSession(date)
    if (stored && existing?.id === undefined) return stored
    throw err
  }
}

/** Builds the playable exercise (chart + backing audio) for an exercise block. */
export function exerciseForBlock(block: ExerciseBlock, tuning: number[] = DEFAULT_TUNING): GeneratedExercise {
  const skill = SKILLS_BY_ID[block.skillId]
  if (!skill) throw new Error(`Unknown skill ${block.skillId}`)
  const params = exerciseParams(skill, block.generatorId, block.tempo, block.params)
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

/** Builds the playable exercise for a test task (null for song tasks, which load the song instead). */
export function exerciseForTask(task: TestTask, tuning: number[] = DEFAULT_TUNING): GeneratedExercise | null {
  if (task.generatorId === 'song') return null
  const skill = SKILLS_BY_ID[task.skillIds[0]] ?? SKILLS[0]
  const exercise = generateExercise(skill, task.generatorId, task.params, tuning)
  return withBacking(exercise, false)
}

const KIND_BY_BLOCK: Record<ExerciseBlock['kind'], AttemptKind> = { warmup: 'warmup', focus: 'practice', second: 'practice', review: 'review', ear: 'practice' }

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
  const plan = adaptAfterBlock(session.plan, blockId, attempt, performance)
  const already = session.completedBlockIds.includes(blockId)
  const completedBlockIds = already ? session.completedBlockIds : [...session.completedBlockIds, blockId]
  const allDone = plan.blocks.every((b) => b.status === 'done' || b.status === 'skipped')
  // Time done is the time on the clock: what was played in this block, not the minutes the plan gave it.
  const minutes = already ? 0 : minutesPlayed(await blockRuns(session, attempt))
  const record: SessionRecord = { ...session, plan, completedBlockIds, minutesDone: session.minutesDone + minutes, finishedAt: allDone ? now : session.finishedAt }
  const id = await saveSession(record)
  if (completedBlockIds.length === 1) {
    const before = await loadProfile()
    const after = await markSessionDay(session.date)
    await recordMilestones(compact([streakMilestone(before.streak, after.streak, now)]))
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
function unlocksBetween(before: LearnerModel, after: LearnerModel, taught: string[], now: number): Milestone[] {
  const was = openContextOf(before, now, taught)
  return unlockMilestonesBetween(SKILLS, was, { ...openContextOf(after, now, taught), attempts: was.attempts }, now)
}

/** Milestones from one skill update: band and tempo for the skill, plus any skills the new rating unlocks. */
function skillUpdateMilestones(model: LearnerModel, skill: SkillDef, before: SkillState | null, after: SkillState, taught: string[], now: number): Milestone[] {
  const updated = { ...model, skills: { ...model.skills, [skill.id]: after } }
  return [...skillMilestones(skill, before, after, now), ...unlocksBetween(model, updated, taught, now)]
}

export interface RepOutcome {
  attempt: Attempt
  performance: Performance
  state: SkillState
  /** Skill rating before this rep. */
  ratingBefore: number
  /** Suggested tempo for the next rep (docs §6.4). */
  nextTempo: number
  /** False when the run did not count: nothing but the history changed and the rep should be played again. */
  counted?: boolean
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
  const skill = SKILLS_BY_ID[block.skillId]
  if (!skill) throw new Error(`Unknown skill ${block.skillId}`)
  const performance = attemptPerformance(result, { calibrationAgeDays: calibrationAgeDays(settings, now) })
  const model = await loadLearnerModel()
  const previous = model.skills[block.skillId] ?? newSkillState(block.skillId, 0, now)
  const attempt: Attempt = {
    ...result,
    at: now,
    kind: KIND_BY_BLOCK[block.kind],
    skillId: block.skillId,
    exerciseId: exercise.id,
    params: exercise.params,
    difficulty: exercise.difficulty,
    performance: performance.p,
    accuracy: performance.acc,
    reliable: performance.reliable,
    sessionId,
  }
  if (!runCounts(result)) {
    // History only: no rating, tempo ceiling, review date or milestone, and the next rep stays at this tempo.
    const id = await recordAttempt(attempt)
    return { attempt: { ...attempt, id }, performance, state: previous, ratingBefore: previous.rating, nextTempo: block.tempo, counted: false }
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
  const taught = (await finishedLessons()).lessonSkillIds
  await recordMilestones(skillUpdateMilestones(model, skill, model.skills[block.skillId] ?? null, state, taught, now))
  const startTempo = typeof block.params.startTempo === 'number' ? block.params.startTempo : block.tempo
  return {
    attempt: { ...attempt, id },
    performance,
    state,
    ratingBefore: previous.rating,
    nextTempo: nextRepTempo(block.tempo, performance.acc, startTempo),
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
  const model = await loadLearnerModel()
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
  }
}

export interface SongPlayOutcome {
  attempt: Attempt
  /** The song item after the play; unchanged (and not stored if new) when the run did not count. */
  songItem: SongItemState
  performance: Performance
  /** False when the run did not count: nothing but the history changed. */
  counted?: boolean
}

/** Records a song play (inside or outside a session) and updates the song item. */
export async function recordSongPlay(
  song: SongRecord,
  level: number,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
  sessionId?: number,
): Promise<SongPlayOutcome> {
  const performance = attemptPerformance(result, { calibrationAgeDays: calibrationAgeDays(settings, now) })
  const attempt = buildSongAttempt(song, level, result, performance, now, sessionId)
  const key = songItemKey(song.id, level)
  const existing = await db.songItems.get(key)
  if (!runCounts(result)) {
    // History only: no best result, review date or milestone.
    const id = await recordAttempt(attempt)
    return { attempt: { ...attempt, id }, songItem: existing ?? newSongItem(song.id, level), performance, counted: false }
  }
  const songItem = applySongAttempt(existing ?? newSongItem(song.id, level), attempt, now)
  const id = await recordAttempt(attempt)
  await saveSongItem(songItem)
  await recordMilestones(compact([songMilestone(song.title, existing ?? null, songItem, now)]))
  return { attempt: { ...attempt, id }, songItem, performance, counted: true }
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
  const { attempt, songItem, performance, counted } = await recordSongPlay(song, block.level, result, settings, now, session.id)
  // A run that did not count leaves the block open.
  if (counted === false) return { session, attempt, performance, songItem, counted: false }
  const updated = await persistBlockDone(session, block.id, attempt, performance, now)
  return { session: updated, attempt, performance, songItem, counted: true }
}

/** Marks a block skipped without recording an attempt. */
export async function skipSessionBlock(session: SessionRecord, blockId: string): Promise<SessionRecord> {
  const plan = { ...session.plan, blocks: session.plan.blocks.map((b) => (b.id === blockId ? { ...b, status: 'skipped' as const } : b)) }
  const allDone = plan.blocks.every((b) => b.status === 'done' || b.status === 'skipped')
  const record: SessionRecord = { ...session, plan, finishedAt: allDone ? Date.now() : session.finishedAt }
  const id = await saveSession(record)
  return { ...record, id }
}

/** Builds the attempt for a test task result (kind 'test'). */
export function attemptForTask(task: TestTask, result: AttemptResult, settings: Pick<AppSettings, 'calibratedAt'>, now = Date.now()): Attempt {
  const performance = attemptPerformance(result, { calibrationAgeDays: calibrationAgeDays(settings, now), isTest: true })
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
  }
}

/**
 * Applies a finished test to the learner model, stores the record and the attempts.
 * Tasks that did not count (see `runCounts`) go into the attempt history and nowhere else: they are
 * judged as not attempted. A test made of nothing else is not saved at all.
 */
export async function finishTest(type: TestType, tasks: TestTask[], allResults: TestTaskResult[], now = Date.now()): Promise<TestRecord> {
  const results = allResults.filter((r) => runCounts(r.attempt))
  const dropped = allResults.length - results.length
  if (dropped > 0 && results.length === 0) {
    for (const r of allResults) await recordAttempt(r.attempt)
    throw new Error('The microphone was only hearing the app, not your guitar, so this check was not saved. Use headphones, then try again.')
  }
  const model = await loadLearnerModel()
  const applied =
    type === 'placement'
      ? applyPlacement(model, tasks, results, SKILLS, now)
      : applyTestResults(model, type, tasks, results, SKILLS, (state, attempt, skill) => applyAttempt(state, attempt, skill, [], attempt.at), now)
  await saveLearnerModel(applied.model)
  for (const r of allResults) await recordAttempt(r.attempt)
  const record: TestRecord = { at: now, type, tasks, results, report: applied.report }
  const id = await recordTest(record)
  const changed = SKILLS.filter((s) => applied.model.skills[s.id] && applied.model.skills[s.id].rating !== model.skills[s.id]?.rating)
  const taught = (await finishedLessons()).lessonSkillIds
  await recordMilestones([
    ...changed.flatMap((s) => skillMilestones(s, model.skills[s.id] ?? null, applied.model.skills[s.id], now)),
    ...unlocksBetween(model, applied.model, taught, now),
    // "Passed every task" is only true when every task was judged.
    ...(dropped === 0 ? compact([testMilestone({ ...record, id }, now)]) : []),
  ])
  return { ...record, id }
}

/** "Start as a beginner": skips the placement test; ratings start at zero and climb quickly. */
export async function skipPlacement(now = Date.now()): Promise<Profile> {
  const profile = { ...(await loadProfile()), placementDoneAt: now }
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

export async function updatePrefs(patch: Partial<Pick<Profile, 'goals' | 'dailyMinutes' | 'pinnedSkillId'>>): Promise<Profile> {
  const profile = { ...(await loadProfile()), ...patch }
  await saveProfile(profile)
  return profile
}

export async function coachRecommendations(settings: Pick<AppSettings, 'calibratedAt'>, now = Date.now()): Promise<Recommendation[]> {
  // Advice is worked out from counted runs only.
  const [model, library, attempts] = await Promise.all([loadLearnerModel(), songSummaries(), recentAttempts({ sinceDays: 30, limit: 300, countedOnly: true })])
  return recommendations({
    model,
    skills: SKILLS,
    library,
    recentAttempts: attempts,
    now,
    calibrationAgeDays: calibrationAgeDays(settings, now),
    daysSinceLastSession: daysSinceDate(model.profile.lastSessionDate, new Date(now)),
    lastSongPlayedAt: attempts.find((a) => a.kind === 'song')?.at,
  })
}

/** What the Start Here wizard collects. */
export interface FirstStepsSetup {
  experience: 'new' | 'some' | 'played'
  handedness: 'right' | 'left'
  guitarType: 'acoustic' | 'electric'
  dailyMinutes: Profile['dailyMinutes']
  goalSongId?: string
}

/**
 * Applies the wizard's answers. New and "a little" players skip the placement
 * test and start the First steps course; players who have played before go to
 * the normal setup card (placement test) with their preferences filled in.
 *
 * The profile and the lesson rows are saved together, before the slow song install: Today shows
 * only the next lesson while the course is running, so the course must never be marked as running
 * without a lesson to start, even if the app is closed half way through setup.
 */
export async function startFirstSteps(setup: FirstStepsSetup, now = Date.now()): Promise<Profile> {
  updateSettings({ handedness: setup.handedness, guitarType: setup.guitarType })
  const course = setup.experience !== 'played'
  const lessonIds = COURSE.map((l) => l.id)
  const profile = await db.transaction('rw', db.profile, db.lessons, async () => {
    const current = await loadProfile()
    const next: Profile = {
      ...current,
      experience: setup.experience,
      dailyMinutes: setup.dailyMinutes,
      goalSongId: setup.goalSongId,
      firstStepsStartedAt: course ? (current.firstStepsStartedAt ?? now) : current.firstStepsStartedAt,
      placementDoneAt: course ? (current.placementDoneAt ?? now) : current.placementDoneAt,
    }
    await saveProfile(next)
    if (course || (next.firstStepsStartedAt && !next.firstStepsDoneAt)) {
      // Every lesson done while the profile knows of no course: rows left over from before a reset.
      // Someone who has just said they are starting out gets the course from lesson 1.
      const leftovers = !current.firstStepsStartedAt && !current.firstStepsDoneAt && allLessonsDone(await courseProgress(), lessonIds)
      if (leftovers) await restartCourse(lessonIds)
      else await initialiseCourse(lessonIds, now)
    }
    // Read back: initialising can end a course whose lessons were all done already.
    return loadProfile()
  })
  await installBuiltInSongs()
  return profile
}

/** Marks the First steps course finished; Today shows the Coach's daily plan from here on. */
export async function completeFirstSteps(now = Date.now()): Promise<Profile> {
  const profile = { ...(await loadProfile()), firstStepsDoneAt: now }
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
  return applyExerciseAttempt(block, exercise, result, settings, now, undefined, true)
}

