/**
 * Orchestration for the Coach: turns the pure planning/learning modules and
 * the store into the few operations the UI needs. Everything here is async
 * because it reads and writes IndexedDB; the maths lives in the pure modules.
 */
import type { AppSettings } from '../app/settings'
import { generateLevels } from '../chart/difficulty'
import { db, type SongRecord } from '../db/db'
import { applyPlacement, applyTestResults, isTestDue } from './assessment'
import { exerciseParams, generateExercise, resolveGeneratorId } from './exercises'
import { renderExerciseBacking } from './exercises/backing'
import { DEFAULT_TUNING } from './exercises/builder'
import { applyAttempt, effectiveRating, newSkillState } from './learner'
import { COURSE } from '../lessons/course'
import { initialiseCourse } from '../lessons/store'
import { installBuiltInSongs } from '../songs'
import { updateSettings } from '../app/settings'
import { recordMilestones } from './milestoneStore'
import { skillMilestones, songMilestone, streakMilestone, testMilestone, unlockMilestones } from './milestones'
import { attemptPerformance } from './performance'
import { adaptAfterBlock, nextRepTempo, planSession } from './planner'
import { recommendations } from './recommend'
import { applySongAttempt, newSongItem, nextReview, songItemKey, startReview } from './review'
import { SKILLS, SKILLS_BY_ID } from './skills'
import {
  getSession,
  loadLearnerModel,
  loadProfile,
  localDateString,
  markSessionDay,
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
  }))
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

/** Returns today's session, planning and storing it on first call. */
export async function getOrCreateTodaySession(opts: TodayOptions): Promise<SessionRecord> {
  const now = opts.now ?? new Date()
  const date = localDateString(now)
  const existing = await getSession(date)
  if (existing && !opts.forceNew) return existing
  const [model, library, profile, recentFocus] = await Promise.all([loadLearnerModel(), songSummaries(), loadProfile(), recentFocusSkillIds(date)])
  const prefs: Prefs = { dailyMinutes: profile.dailyMinutes, goals: profile.goals, pinnedSkillId: profile.pinnedSkillId }
  const plan = planSession({
    model,
    skills: SKILLS,
    library,
    prefs,
    now,
    dueTest: isTestDue(profile, now.getTime(), calibrationAgeDays(opts.settings, now.getTime())),
    recentFocusSkillIds: recentFocus,
    daysSinceLastSession: daysSinceDate(profile.lastSessionDate, now),
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
  const id = await saveSession(record)
  return { ...record, id }
}

const CLICK_ONLY_GENERATORS = new Set(['chordChanges', 'strumPattern', 'powerChordRiff'])

/** Builds the playable exercise (chart + backing audio) for an exercise block. */
export function exerciseForBlock(block: ExerciseBlock, tuning: number[] = DEFAULT_TUNING): GeneratedExercise {
  const skill = SKILLS_BY_ID[block.skillId]
  if (!skill) throw new Error(`Unknown skill ${block.skillId}`)
  const params = exerciseParams(skill, block.generatorId, block.tempo, block.params)
  const exercise = generateExercise(skill, block.generatorId, params, tuning)
  return withBacking(exercise, block.generatorId)
}

/**
 * Ear exercises play their own reference tones, so they get no rendered backing.
 * Everything else gets a click-only backing for scoring plus, unless the drill is
 * about the player's own strumming or this is a test, a guide track with the part.
 */
function withBacking(exercise: GeneratedExercise, generatorId: string, allowGuide = true): GeneratedExercise {
  if (exercise.interaction === 'ear') return exercise
  return renderExerciseBacking(exercise, { guide: allowGuide && !CLICK_ONLY_GENERATORS.has(resolveGeneratorId(generatorId)) })
}

/** Builds the playable exercise for a test task (null for song tasks, which load the song instead). */
export function exerciseForTask(task: TestTask, tuning: number[] = DEFAULT_TUNING): GeneratedExercise | null {
  if (task.generatorId === 'song') return null
  const skill = SKILLS_BY_ID[task.skillIds[0]] ?? SKILLS[0]
  const exercise = generateExercise(skill, task.generatorId, task.params, tuning)
  return withBacking(exercise, task.generatorId, false)
}

const KIND_BY_BLOCK: Record<ExerciseBlock['kind'], AttemptKind> = { warmup: 'warmup', focus: 'practice', second: 'practice', review: 'review', ear: 'practice' }

export interface BlockOutcome {
  session: SessionRecord
  attempt: Attempt
  performance: Performance
  state?: SkillState
  /** Skill rating before this block (exercise blocks). */
  ratingBefore?: number
  songItem?: SongItemState
}

async function persistBlockDone(session: SessionRecord, blockId: string, minutes: number, attempt: Attempt, performance: Performance, now: number): Promise<SessionRecord> {
  const plan = adaptAfterBlock(session.plan, blockId, attempt, performance)
  const completedBlockIds = session.completedBlockIds.includes(blockId) ? session.completedBlockIds : [...session.completedBlockIds, blockId]
  const allDone = plan.blocks.every((b) => b.status === 'done' || b.status === 'skipped')
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

function ratingMap(model: LearnerModel): Record<string, number> {
  return Object.fromEntries(Object.values(model.skills).map((s) => [s.skillId, s.rating]))
}

/** Milestones from one skill update: band and tempo for the skill, plus any skills the new rating unlocks. */
function skillUpdateMilestones(model: LearnerModel, skill: SkillDef, before: SkillState | null, after: SkillState, now: number): Milestone[] {
  const ratingsBefore = ratingMap(model)
  const ratingsAfter = { ...ratingsBefore, [skill.id]: after.rating }
  return [...skillMilestones(skill, before, after, now), ...unlockMilestones(SKILLS, ratingsBefore, ratingsAfter, now)]
}

export interface RepOutcome {
  attempt: Attempt
  performance: Performance
  state: SkillState
  /** Skill rating before this rep. */
  ratingBefore: number
  /** Suggested tempo for the next rep (docs §6.4). */
  nextTempo: number
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
  const history = await recentAttempts({ skillId: block.skillId, sinceDays: 30, limit: 20 })
  let state = applyAttempt(previous, attempt, skill, history, now)
  if (isLastRep) {
    if (block.kind === 'review' && state.nextReviewAt) state = { ...state, ...nextReview(state, performance.p, now) }
    else if (!state.nextReviewAt && state.rating >= 75) state = { ...state, ...startReview(now) }
  }
  attempt.ratingAfter = state.rating
  const id = await recordAttempt(attempt)
  await saveSkillState(state)
  await recordMilestones(skillUpdateMilestones(model, skill, model.skills[block.skillId] ?? null, state, now))
  const startTempo = typeof block.params.startTempo === 'number' ? block.params.startTempo : block.tempo
  return {
    attempt: { ...attempt, id },
    performance,
    state,
    ratingBefore: previous.rating,
    nextTempo: nextRepTempo(block.tempo, performance.acc, startTempo),
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
  const updated = await persistBlockDone(session, block.id, block.minutes, rep.attempt, rep.performance, now)
  return { session: updated, attempt: rep.attempt, performance: rep.performance, state: rep.state, ratingBefore: rep.ratingBefore }
}

/**
 * Closes an exercise block early from the last recorded rep: no new attempt,
 * just the review scheduling and the plan/session bookkeeping.
 */
export async function finishExerciseBlock(session: SessionRecord, block: ExerciseBlock, lastRep: RepOutcome, now = Date.now()): Promise<BlockOutcome> {
  const model = await loadLearnerModel()
  let state = model.skills[block.skillId] ?? lastRep.state
  if (block.kind === 'review' && state.nextReviewAt) state = { ...state, ...nextReview(state, lastRep.performance.p, now) }
  else if (!state.nextReviewAt && state.rating >= 75) state = { ...state, ...startReview(now) }
  await saveSkillState(state)
  const updated = await persistBlockDone(session, block.id, block.minutes, lastRep.attempt, lastRep.performance, now)
  return { session: updated, attempt: lastRep.attempt, performance: lastRep.performance, state, ratingBefore: lastRep.ratingBefore }
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

/** Records a song play (inside or outside a session) and updates the song item. */
export async function recordSongPlay(
  song: SongRecord,
  level: number,
  result: AttemptResult,
  settings: Pick<AppSettings, 'calibratedAt'>,
  now = Date.now(),
  sessionId?: number,
): Promise<{ attempt: Attempt; songItem: SongItemState; performance: Performance }> {
  const performance = attemptPerformance(result, { calibrationAgeDays: calibrationAgeDays(settings, now) })
  const attempt = buildSongAttempt(song, level, result, performance, now, sessionId)
  const key = songItemKey(song.id, level)
  const existing = await db.songItems.get(key)
  const songItem = applySongAttempt(existing ?? newSongItem(song.id, level), attempt, now)
  const id = await recordAttempt(attempt)
  await saveSongItem(songItem)
  await recordMilestones(compact([songMilestone(song.title, existing ?? null, songItem, now)]))
  return { attempt: { ...attempt, id }, songItem, performance }
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
  const { attempt, songItem, performance } = await recordSongPlay(song, block.level, result, settings, now, session.id)
  const updated = await persistBlockDone(session, block.id, block.minutes, attempt, performance, now)
  return { session: updated, attempt, performance, songItem }
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

/** Applies a finished test to the learner model, stores the record and the attempts. */
export async function finishTest(type: TestType, tasks: TestTask[], results: TestTaskResult[], now = Date.now()): Promise<TestRecord> {
  const model = await loadLearnerModel()
  const applied =
    type === 'placement'
      ? applyPlacement(model, tasks, results, SKILLS, now)
      : applyTestResults(model, type, tasks, results, SKILLS, (state, attempt, skill) => applyAttempt(state, attempt, skill, [], attempt.at), now)
  await saveLearnerModel(applied.model)
  for (const r of results) await recordAttempt(r.attempt)
  const record: TestRecord = { at: now, type, tasks, results, report: applied.report }
  const id = await recordTest(record)
  const changed = SKILLS.filter((s) => applied.model.skills[s.id] && applied.model.skills[s.id].rating !== model.skills[s.id]?.rating)
  await recordMilestones([
    ...changed.flatMap((s) => skillMilestones(s, model.skills[s.id] ?? null, applied.model.skills[s.id], now)),
    ...unlockMilestones(SKILLS, ratingMap(model), ratingMap(applied.model), now),
    ...compact([testMilestone({ ...record, id }, now)]),
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
  const [model, library, attempts] = await Promise.all([loadLearnerModel(), songSummaries(), recentAttempts({ sinceDays: 30, limit: 300 })])
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
 */
export async function startFirstSteps(setup: FirstStepsSetup, now = Date.now()): Promise<Profile> {
  updateSettings({ handedness: setup.handedness, guitarType: setup.guitarType })
  const current = await loadProfile()
  const course = setup.experience !== 'played'
  const profile: Profile = {
    ...current,
    experience: setup.experience,
    dailyMinutes: setup.dailyMinutes,
    goalSongId: setup.goalSongId,
    firstStepsStartedAt: course ? (current.firstStepsStartedAt ?? now) : current.firstStepsStartedAt,
    placementDoneAt: course ? (current.placementDoneAt ?? now) : current.placementDoneAt,
  }
  await saveProfile(profile)
  await installBuiltInSongs()
  if (course) await initialiseCourse(COURSE.map((l) => l.id))
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

