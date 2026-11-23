import { db } from '../db/db'
import { COURSE } from '../lessons/course'
import { initialiseCourse } from '../lessons/store'
import type { LessonProgress } from '../lessons/types'
import { DRILL_REV } from './constants'
import { instrumentOfBlockId } from './instruments'
import { migrateStoredTempos } from './migrate'
import type { Attempt, InstrumentId, LearnerModel, Milestone, Profile, SessionRecord, SkillState, SongItemState, TestRecord } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
// Lesson progress belongs here too: the profile says whether the course is running, and the two must be reset, saved and restored together.
const TRAINING_TABLES = [db.skillStates, db.songItems, db.attempts, db.sessions, db.tests, db.profile, db.milestones, db.lessons]

function clearTrainingTables(): Promise<unknown> {
  return Promise.all(TRAINING_TABLES.map((t) => t.clear()))
}

export function defaultProfile(now = Date.now()): Profile {
  return {
    id: 1,
    goals: ['all-round'],
    dailyMinutes: 20,
    startedAt: now,
    streak: 0,
    longestStreak: 0,
    sessionsSinceTest: 0,
    drillRev: DRILL_REV,
  }
}

export async function loadProfile(): Promise<Profile> {
  const existing = await db.profile.get(1)
  if (existing) return existing
  const created = defaultProfile()
  await db.profile.put(created)
  return created
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.profile.put(profile)
}

export async function loadLearnerModel(): Promise<LearnerModel> {
  const profile = await loadProfile()
  const [skillRows, itemRows] = await Promise.all([db.skillStates.toArray(), db.songItems.toArray()])
  const skills: Record<string, SkillState> = {}
  for (const s of skillRows) skills[s.skillId] = s
  const songItems: Record<string, SongItemState> = {}
  for (const i of itemRows) songItems[i.key] = i
  return { skills, songItems, profile }
}

export async function saveSkillState(state: SkillState): Promise<void> {
  await db.skillStates.put(state)
}

export async function saveSkillStates(states: SkillState[]): Promise<void> {
  await db.skillStates.bulkPut(states)
}

export async function saveSongItem(item: SongItemState): Promise<void> {
  await db.songItems.put(item)
}

export async function saveLearnerModel(model: LearnerModel): Promise<void> {
  await db.transaction('rw', db.skillStates, db.songItems, db.profile, async () => {
    await db.skillStates.bulkPut(Object.values(model.skills))
    await db.songItems.bulkPut(Object.values(model.songItems))
    await db.profile.put(model.profile)
  })
}

export async function recordAttempt(attempt: Attempt): Promise<number> {
  const { id: _id, ...rest } = attempt
  return (await db.attempts.add(rest as Attempt)) as number
}

/**
 * Newest first. `countedOnly` leaves out runs that did not count (the microphone was hearing the
 * app's own guitar part); they stay in the history but nothing may be worked out from them.
 */
export async function recentAttempts(
  opts: { skillId?: string; songId?: number; sinceDays?: number; limit?: number; kinds?: Attempt['kind'][]; countedOnly?: boolean } = {},
): Promise<Attempt[]> {
  const { skillId, songId, sinceDays, limit, kinds, countedOnly } = opts
  const since = sinceDays === undefined ? undefined : Date.now() - sinceDays * DAY_MS
  let collection = db.attempts.orderBy('at').reverse().filter((a) => {
    if (countedOnly && a.bleed) return false
    if (skillId !== undefined && a.skillId !== skillId) return false
    if (songId !== undefined && a.songId !== songId) return false
    if (since !== undefined && a.at < since) return false
    if (kinds && !kinds.includes(a.kind)) return false
    return true
  })
  if (limit !== undefined) collection = collection.limit(limit)
  return collection.toArray()
}

export function attemptsForSkill(skillId: string, limit = 50): Promise<Attempt[]> {
  return recentAttempts({ skillId, limit })
}

/**
 * For each skill, on how many days before `date` (a local date, YYYY-MM-DD) it was practised. The
 * planner walks a drill through its variations with this number: the same notes all day, the next
 * variation on the next day the skill comes up.
 */
export async function practiceDaysBySkill(date: string): Promise<Record<string, number>> {
  const days = new Map<string, Set<string>>()
  await db.attempts
    .where('skillId')
    .above('')
    .each((a) => {
      if (!a.skillId) return
      const day = localDateString(new Date(a.at))
      if (day >= date) return
      let set = days.get(a.skillId)
      if (!set) days.set(a.skillId, (set = new Set()))
      set.add(day)
    })
  return Object.fromEntries([...days].map(([id, set]) => [id, set.size]))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function previousDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDateString(new Date(y, m - 1, d - 1, 12))
}

export function getSession(date: string): Promise<SessionRecord | undefined> {
  return db.sessions.where('date').equals(date).first()
}

/**
 * The instrument a session belongs to: what the record says, else what the ids of its blocks say (singing
 * blocks carry a prefix; a plan without blocks is a guitar plan). The two have to agree. A record stamped
 * for one instrument with the other's blocks was put together wrongly, and saving it would show a plan
 * to the wrong side of the app.
 */
function sessionInstrument(record: SessionRecord): InstrumentId {
  const first = record.plan.blocks[0]
  const fromBlocks = first ? instrumentOfBlockId(first.id) : undefined
  if (record.instrument !== undefined && fromBlocks !== undefined && record.instrument !== fromBlocks) {
    throw new Error(`Session of ${record.date} is stamped ${record.instrument} but holds ${fromBlocks} blocks`)
  }
  return record.instrument ?? fromBlocks ?? 'guitar'
}

/**
 * Every saved session says which instrument it belongs to: the index that keeps one plan per instrument
 * and day only sees rows that do, so an unstamped row would let a second plan for the same day in.
 * The stamp is written onto the record itself, the way Dexie writes a new id onto it, so the record the
 * caller goes on with and the stored row stay the same. A record that cannot be written on (a frozen one)
 * is stored as a stamped copy instead: saving one worked before sessions were stamped, and still has to.
 */
export async function saveSession(record: SessionRecord): Promise<number> {
  const instrument = sessionInstrument(record)
  let row = record
  if (record.instrument !== instrument) {
    if (Object.isExtensible(record)) record.instrument = instrument
    else row = { ...record, instrument }
  }
  return (await db.sessions.put(row)) as number
}

async function updateBlock(
  sessionId: number,
  blockId: string,
  apply: (record: SessionRecord) => void,
): Promise<SessionRecord | undefined> {
  return db.transaction('rw', db.sessions, async () => {
    const record = await db.sessions.get(sessionId)
    if (!record) return undefined
    if (!record.plan.blocks.some((b) => b.id === blockId)) return record
    apply(record)
    const settled = record.plan.blocks.every((b) => b.status === 'done' || b.status === 'skipped')
    if (settled && record.finishedAt === undefined) record.finishedAt = Date.now()
    await db.sessions.put(record)
    return record
  })
}

export function completeBlock(sessionId: number, blockId: string, minutes: number): Promise<SessionRecord | undefined> {
  return updateBlock(sessionId, blockId, (record) => {
    if (!record.completedBlockIds.includes(blockId)) record.completedBlockIds.push(blockId)
    record.minutesDone += minutes
    for (const b of record.plan.blocks) if (b.id === blockId) b.status = 'done'
  })
}

export function skipBlock(sessionId: number, blockId: string): Promise<SessionRecord | undefined> {
  return updateBlock(sessionId, blockId, (record) => {
    for (const b of record.plan.blocks) if (b.id === blockId) b.status = 'skipped'
  })
}

export async function recordTest(record: TestRecord): Promise<number> {
  return (await db.tests.put(record)) as number
}

export function listTests(limit = 20): Promise<TestRecord[]> {
  return db.tests.orderBy('at').reverse().limit(limit).toArray()
}

export function updateStreak(profile: Profile, date: string): Profile {
  if (profile.lastSessionDate === date) return profile
  const streak = profile.lastSessionDate === previousDay(date) ? profile.streak + 1 : 1
  return { ...profile, streak, longestStreak: Math.max(profile.longestStreak, streak), lastSessionDate: date }
}

export async function markSessionDay(date: string): Promise<Profile> {
  return db.transaction('rw', db.profile, async () => {
    const profile = await loadProfile()
    if (profile.lastSessionDate === date) return profile
    const next = updateStreak(profile, date)
    next.sessionsSinceTest = profile.sessionsSinceTest + 1
    await db.profile.put(next)
    return next
  })
}

export async function exportTrainingData(): Promise<string> {
  const profile = await loadProfile()
  const [skillStates, songItems, attempts, sessions, tests, milestones, lessons] = await Promise.all([
    db.skillStates.toArray(),
    db.songItems.toArray(),
    db.attempts.toArray(),
    db.sessions.toArray(),
    db.tests.toArray(),
    db.milestones.toArray(),
    db.lessons.toArray(),
  ])
  return JSON.stringify({ version: 1, exportedAt: Date.now(), profile, skillStates, songItems, attempts, sessions, tests, milestones, lessons })
}

function asArray<T>(value: unknown, name: string): T[] {
  if (!Array.isArray(value)) throw new Error(`Invalid training data: ${name} must be an array`)
  return value as T[]
}

export async function importTrainingData(json: string): Promise<{ attempts: number; skills: number }> {
  const data = JSON.parse(json) as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || data.version !== 1) throw new Error('Unsupported training data version')
  const skillStates = asArray<SkillState>(data.skillStates, 'skillStates')
  const songItems = asArray<SongItemState>(data.songItems, 'songItems')
  const attempts = asArray<Attempt>(data.attempts, 'attempts')
  const sessions = asArray<SessionRecord>(data.sessions, 'sessions')
  const tests = asArray<TestRecord>(data.tests, 'tests')
  // Milestones arrived after the first exports; older backups simply have none.
  const milestones = data.milestones === undefined ? [] : asArray<Milestone>(data.milestones, 'milestones')
  // So did lesson progress.
  const lessons = data.lessons === undefined ? [] : asArray<LessonProgress>(data.lessons, 'lessons')
  const profile = data.profile as Profile | undefined
  if (!profile || typeof profile !== 'object') throw new Error('Invalid training data: profile missing')
  await db.transaction('rw', TRAINING_TABLES, async () => {
    await clearTrainingTables()
    await db.skillStates.bulkPut(skillStates)
    await db.songItems.bulkPut(songItems)
    await db.attempts.bulkPut(attempts)
    await db.sessions.bulkPut(sessions)
    await db.tests.bulkPut(tests)
    await db.milestones.bulkPut(milestones)
    await db.lessons.bulkPut(lessons)
    await db.profile.put({ ...profile, id: 1 })
    // A backup taken mid-course may carry no lesson rows (older backups) or rows with nothing left to
    // start; Today would then show the course with no lesson. Give the course a lesson, or end it.
    if (profile.firstStepsStartedAt && !profile.firstStepsDoneAt) await initialiseCourse(COURSE.map((l) => l.id))
  })
  // A backup from an earlier version carries tempos earned on that version's drills.
  await migrateStoredTempos()
  return { attempts: attempts.length, skills: skillStates.length }
}

export async function resetTrainingData(): Promise<void> {
  await db.transaction('rw', TRAINING_TABLES, async () => {
    await clearTrainingTables()
  })
}
