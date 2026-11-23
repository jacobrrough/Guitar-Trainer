import { db } from '../db/db'
import { initialiseCourse } from '../lessons/store'
import type { LessonProgress } from '../lessons/types'
import { DRILL_REV } from './constants'
import { courseFor, instrumentOf, instrumentOfBlockId, instrumentOfLessonId, instrumentOfSkillId, profileIdFor } from './instruments'
import { migrateStoredTempos } from './migrate'
import type { Attempt, InstrumentId, LearnerModel, Milestone, Profile, SessionRecord, SkillState, SongItemState, TestRecord } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
// Lesson progress belongs here too: the profile says whether the course is running, and the two must be reset, saved and restored together.
const TRAINING_TABLES = [db.skillStates, db.songItems, db.attempts, db.sessions, db.tests, db.profile, db.milestones, db.lessons]

function clearTrainingTables(): Promise<unknown> {
  return Promise.all(TRAINING_TABLES.map((t) => t.clear()))
}

/** What the first block of a plan says about its side; nothing when the plan has no blocks. */
function sideOfBlocks(record: SessionRecord): InstrumentId | undefined {
  const first = record.plan.blocks[0]
  return first ? instrumentOfBlockId(first.id) : undefined
}

/**
 * Which side a stored session is on: its stamp, or without one the side `saveSession` would stamp it for.
 * Rows without a stamp are left behind by a copy of the app that still runs the code from before singing,
 * so they are guitar plans; the block ids are asked all the same, so that a singing plan can never be
 * handed to the guitar side. Never throws: this reads what is stored, it does not judge it.
 */
function sideOfSession(record: SessionRecord): InstrumentId {
  return record.instrument ?? sideOfBlocks(record) ?? 'guitar'
}

/**
 * Which side a row of each table is on. The one place that decides it, for loading, backup, restore and
 * reset alike: a skill state and a lesson by their id (a guitar state whose skill was retired is still a
 * guitar state), everything else by its stamp, and no stamp means guitar (a session without one is first
 * asked for its block ids, see `sideOfSession`). Profiles are not here: they are told apart by their row
 * number (`profileIdFor`).
 */
const SIDE_OF = {
  skillStates: (row: SkillState) => instrumentOfSkillId(row.skillId),
  lessons: (row: LessonProgress) => instrumentOfLessonId(row.id),
  songItems: (row: SongItemState) => instrumentOf(row),
  attempts: (row: Attempt) => instrumentOf(row),
  sessions: sideOfSession,
  tests: (row: TestRecord) => instrumentOf(row),
  milestones: (row: Milestone) => instrumentOf(row),
}

/** Deletes everything one instrument has stored and nothing of the other. Run it inside a transaction over the training tables. */
function deleteSide(instrument: InstrumentId): Promise<unknown> {
  return Promise.all([
    db.skillStates.filter((row) => SIDE_OF.skillStates(row) === instrument).delete(),
    db.lessons.filter((row) => SIDE_OF.lessons(row) === instrument).delete(),
    db.songItems.filter((row) => SIDE_OF.songItems(row) === instrument).delete(),
    db.attempts.filter((row) => SIDE_OF.attempts(row) === instrument).delete(),
    db.sessions.filter((row) => SIDE_OF.sessions(row) === instrument).delete(),
    db.tests.filter((row) => SIDE_OF.tests(row) === instrument).delete(),
    db.milestones.filter((row) => SIDE_OF.milestones(row) === instrument).delete(),
    db.profile.delete(profileIdFor(instrument)),
  ])
}

export function defaultProfile(now = Date.now(), instrument: InstrumentId = 'guitar'): Profile {
  return {
    id: profileIdFor(instrument),
    goals: ['all-round'],
    dailyMinutes: 20,
    startedAt: now,
    streak: 0,
    longestStreak: 0,
    sessionsSinceTest: 0,
    drillRev: DRILL_REV,
    // The guitar row is written exactly as it always was. Only the singing row says what it is.
    ...(instrument === 'voice' ? { instrument } : {}),
  }
}

/**
 * The profile of one instrument: row 1 for guitar, row 2 for singing. A missing row is created and
 * stored, as the guitar row always was. Where nothing may be written (a live query, a screen that only
 * looks), use `peekProfile`.
 */
export async function loadProfile(instrument: InstrumentId = 'guitar'): Promise<Profile> {
  const existing = await db.profile.get(profileIdFor(instrument))
  if (existing) return existing
  const created = defaultProfile(Date.now(), instrument)
  await db.profile.put(created)
  return created
}

/** The stored profile, or the default one without storing it. */
export async function peekProfile(instrument: InstrumentId = 'guitar'): Promise<Profile> {
  return (await db.profile.get(profileIdFor(instrument))) ?? defaultProfile(Date.now(), instrument)
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.profile.put(profile)
}

/** The skill states and song items of one instrument around its profile. The two tables hold both sides. */
async function learnerModelAround(profile: Profile, instrument: InstrumentId): Promise<LearnerModel> {
  const [skillRows, itemRows] = await Promise.all([db.skillStates.toArray(), db.songItems.toArray()])
  const skills: Record<string, SkillState> = {}
  for (const s of skillRows) if (SIDE_OF.skillStates(s) === instrument) skills[s.skillId] = s
  const songItems: Record<string, SongItemState> = {}
  for (const i of itemRows) if (SIDE_OF.songItems(i) === instrument) songItems[i.key] = i
  return { skills, songItems, profile }
}

export async function loadLearnerModel(instrument: InstrumentId = 'guitar'): Promise<LearnerModel> {
  return learnerModelAround(await loadProfile(instrument), instrument)
}

/** The same model without creating the profile row: for live queries, which must never write. */
export async function peekLearnerModel(instrument: InstrumentId = 'guitar'): Promise<LearnerModel> {
  return learnerModelAround(await peekProfile(instrument), instrument)
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
 *
 * `instrument`: the runs of one side. A history across skills and songs is the guitar history unless
 * singing is asked for. Asked for one skill or one song, every run of it is returned whether or not a
 * side is named: a skill and a song belong to one side already, and a caller that forgot to name it
 * must not be told that nothing was ever played. Either way the other side is left out before the limit.
 */
export async function recentAttempts(
  opts: {
    skillId?: string
    songId?: number
    sinceDays?: number
    limit?: number
    kinds?: Attempt['kind'][]
    countedOnly?: boolean
    instrument?: InstrumentId
  } = {},
): Promise<Attempt[]> {
  const { skillId, songId, sinceDays, limit, kinds, countedOnly } = opts
  const instrument = opts.instrument ?? (skillId === undefined && songId === undefined ? 'guitar' : undefined)
  const since = sinceDays === undefined ? undefined : Date.now() - sinceDays * DAY_MS
  let collection = db.attempts.orderBy('at').reverse().filter((a) => {
    if (instrument !== undefined && SIDE_OF.attempts(a) !== instrument) return false
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

/**
 * The plan of one instrument for one day, read without writing anything (live queries must never write;
 * everything else uses `getSession`).
 *
 * A stamped row is found through the index that allows one per instrument and day. Not finding one there
 * does not mean the day has no plan: a copy of the app that still runs the code from before singing can
 * open this database at any time and save a session without a stamp, or save one again and lose its
 * stamp, and it can leave more than one such row for a day. So the day is then searched by its date, for
 * rows without a stamp that are on this side, and the oldest wins (the lowest id; rows of one date come
 * back in id order). Whatever else the day holds is left exactly as it is: nothing here deletes or throws.
 */
export async function peekSession(date: string, instrument: InstrumentId = 'guitar'): Promise<SessionRecord | undefined> {
  const stamped = await db.sessions.where('[instrument+date]').equals([instrument, date]).first()
  if (stamped) return stamped
  return db.sessions
    .where('date')
    .equals(date)
    .filter((row) => row.instrument === undefined && sideOfSession(row) === instrument)
    .first()
}

/**
 * The plan of one instrument for one day. A row found without a stamp is stamped on the way out, so the
 * next read finds it through the index and no second plan for the day can be saved beside it. If the
 * stamp cannot be written (inside a read-only transaction, or because another row took it in the
 * meantime) the row is returned as it is stored: reading a plan never fails over its stamp.
 */
export async function getSession(date: string, instrument: InstrumentId = 'guitar'): Promise<SessionRecord | undefined> {
  const found = await peekSession(date, instrument)
  if (!found || found.instrument !== undefined || found.id === undefined) return found
  try {
    const stamped = await db.sessions.update(found.id, { instrument })
    return stamped ? { ...found, instrument } : found
  } catch {
    return found
  }
}

/**
 * The instrument a session belongs to: what the record says, else what the ids of its blocks say (singing
 * blocks carry a prefix; a plan without blocks is a guitar plan). The two have to agree. A record stamped
 * for one instrument with the other's blocks was put together wrongly, and saving it would show a plan
 * to the wrong side of the app.
 */
function sessionInstrument(record: SessionRecord): InstrumentId {
  const fromBlocks = sideOfBlocks(record)
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

/**
 * Stores a session that was read from the table, inside the caller's transaction. A row without a stamp
 * (see `peekSession` for where those come from) gets it now. Should the stamp for its day already be held
 * by another row, it is stored as it was read: the block the learner has just finished matters more than
 * the stamp, and the row is no worse off than before.
 */
async function putStored(record: SessionRecord): Promise<void> {
  if (record.instrument !== undefined) {
    await db.sessions.put(record)
    return
  }
  const instrument = sideOfSession(record)
  try {
    await db.sessions.put({ ...record, instrument })
    record.instrument = instrument
  } catch (err) {
    if ((err as { name?: string } | null)?.name !== 'ConstraintError') throw err
    await db.sessions.put(record)
  }
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
    await putStored(record)
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

/** Newest first, for one instrument. The other side's checks are left out before the limit is applied. */
export function listTests(limit = 20, instrument: InstrumentId = 'guitar'): Promise<TestRecord[]> {
  return db.tests
    .orderBy('at')
    .reverse()
    .filter((row) => SIDE_OF.tests(row) === instrument)
    .limit(limit)
    .toArray()
}

export function updateStreak(profile: Profile, date: string): Profile {
  if (profile.lastSessionDate === date) return profile
  const streak = profile.lastSessionDate === previousDay(date) ? profile.streak + 1 : 1
  return { ...profile, streak, longestStreak: Math.max(profile.longestStreak, streak), lastSessionDate: date }
}

/** Counts the day for the streak of one instrument: a day of singing is not a day of guitar practice. */
export async function markSessionDay(date: string, instrument: InstrumentId = 'guitar'): Promise<Profile> {
  return db.transaction('rw', db.profile, async () => {
    const profile = await loadProfile(instrument)
    if (profile.lastSessionDate === date) return profile
    const next = updateStreak(profile, date)
    next.sessionsSinceTest = profile.sessionsSinceTest + 1
    await db.profile.put(next)
    return next
  })
}

/**
 * Version 2 holds both instruments. It is the version 1 object as it always was, guitar profile included,
 * with `profiles` beside it: every profile row, the singing one among them.
 */
export async function exportTrainingData(): Promise<string> {
  const profile = await loadProfile()
  const [profiles, skillStates, songItems, attempts, sessions, tests, milestones, lessons] = await Promise.all([
    db.profile.toArray(),
    db.skillStates.toArray(),
    db.songItems.toArray(),
    db.attempts.toArray(),
    db.sessions.toArray(),
    db.tests.toArray(),
    db.milestones.toArray(),
    db.lessons.toArray(),
  ])
  return JSON.stringify({ version: 2, exportedAt: Date.now(), profile, profiles, skillStates, songItems, attempts, sessions, tests, milestones, lessons })
}

function asArray<T>(value: unknown, name: string): T[] {
  if (!Array.isArray(value)) throw new Error(`Invalid training data: ${name} must be an array`)
  return value as T[]
}

/** The rows of a backup, table by table (profiles apart). */
interface BackupRows {
  skillStates: SkillState[]
  songItems: SongItemState[]
  attempts: Attempt[]
  sessions: SessionRecord[]
  tests: TestRecord[]
  milestones: Milestone[]
  lessons: LessonProgress[]
}

interface Backup extends BackupRows {
  version: 1 | 2
  /** The guitar profile (row 1). */
  profile: Profile
  /** The singing profile (row 2), when the backup holds one. */
  voiceProfile?: Profile
}

/**
 * The sessions of a backup. Each has to carry its plan, with blocks that have ids: the side of a session
 * without a stamp is read from them, and a day stored without a plan could not be opened afterwards.
 * Said here in words, before anything is deleted, rather than left to fail half way with a message that
 * means nothing to the person holding the file.
 */
function asSessions(value: unknown): SessionRecord[] {
  const sessions = asArray<SessionRecord | null>(value, 'sessions')
  const whole = (session: SessionRecord | null): session is SessionRecord => {
    const blocks: unknown = session?.plan?.blocks
    return Array.isArray(blocks) && blocks.every((block: { id?: unknown } | null) => typeof block?.id === 'string')
  }
  if (!sessions.every(whole)) throw new Error('Invalid training data: every session needs its plan')
  return sessions
}

function readBackup(json: string): Backup {
  const data = JSON.parse(json) as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || (data.version !== 1 && data.version !== 2)) throw new Error('Unsupported training data version')
  const profile = data.profile as Profile | undefined
  if (!profile || typeof profile !== 'object') throw new Error('Invalid training data: profile missing')
  // Only version 2 knows of a second profile; what a version 1 file may carry under that name is not looked at.
  const profiles = data.version === 2 && data.profiles !== undefined ? asArray<Profile | null>(data.profiles, 'profiles') : []
  return {
    version: data.version,
    profile,
    voiceProfile: profiles.find((p) => !!p && typeof p === 'object' && p.id === 2) ?? undefined,
    skillStates: asArray<SkillState>(data.skillStates, 'skillStates'),
    songItems: asArray<SongItemState>(data.songItems, 'songItems'),
    attempts: asArray<Attempt>(data.attempts, 'attempts'),
    sessions: asSessions(data.sessions),
    tests: asArray<TestRecord>(data.tests, 'tests'),
    // Milestones arrived after the first exports; older backups simply have none.
    milestones: data.milestones === undefined ? [] : asArray<Milestone>(data.milestones, 'milestones'),
    // So did lesson progress.
    lessons: data.lessons === undefined ? [] : asArray<LessonProgress>(data.lessons, 'lessons'),
  }
}

/** The rows of one instrument out of a backup, by the same rules that decide it for stored rows. */
function rowsOfSide(rows: BackupRows, instrument: InstrumentId): BackupRows {
  return {
    skillStates: rows.skillStates.filter((row) => SIDE_OF.skillStates(row) === instrument),
    songItems: rows.songItems.filter((row) => SIDE_OF.songItems(row) === instrument),
    attempts: rows.attempts.filter((row) => SIDE_OF.attempts(row) === instrument),
    sessions: rows.sessions.filter((row) => SIDE_OF.sessions(row) === instrument),
    tests: rows.tests.filter((row) => SIDE_OF.tests(row) === instrument),
    milestones: rows.milestones.filter((row) => SIDE_OF.milestones(row) === instrument),
    lessons: rows.lessons.filter((row) => SIDE_OF.lessons(row) === instrument),
  }
}

/** Oldest first, by the id the row had where the backup was made; rows without one keep their place at the end. */
function inStoredOrder<T extends { id?: number }>(rows: T[]): T[] {
  const idOf = (row: T) => (typeof row.id === 'number' ? row.id : Number.MAX_SAFE_INTEGER)
  return [...rows].sort((a, b) => idOf(a) - idOf(b))
}

/**
 * The sessions of a backup, oldest first, each with the stamp of its side. One instrument and day holds
 * one stamp. A device that an older copy of the app left with two unstamped plans for a day wrote both
 * into its backup: the older one takes the stamp, as it does when the day is read (`peekSession`), and
 * the other goes back in the way it was, outside the index. Its backup must not be the one that cannot
 * be restored.
 */
function stampedSessions(sessions: SessionRecord[]): SessionRecord[] {
  const taken = new Set(sessions.filter((s) => s.instrument !== undefined).map((s) => `${s.instrument}:${s.date}`))
  return inStoredOrder(sessions).map((session) => {
    if (session.instrument !== undefined) return session
    const instrument = sideOfSession(session)
    const day = `${instrument}:${session.date}`
    if (taken.has(day)) return session
    taken.add(day)
    return { ...session, instrument }
  })
}

function withoutId<T extends { id?: number }>(row: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = row
  return rest
}

/** Puts back a backup that replaces everything: every row under the key it had. */
async function putEverything(rows: BackupRows): Promise<void> {
  await db.skillStates.bulkPut(rows.skillStates)
  await db.songItems.bulkPut(rows.songItems)
  await db.attempts.bulkPut(rows.attempts)
  await db.sessions.bulkPut(rows.sessions)
  await db.tests.bulkPut(rows.tests)
  await db.milestones.bulkPut(rows.milestones)
  await db.lessons.bulkPut(rows.lessons)
}

/**
 * Adds the rows of a guitar backup beside the singing rows that stay on the device.
 *
 * Attempts, sessions, checks and milestones share their numbered tables with the singing rows, and the
 * numbers in the backup were given by another table (or by this one before singing existed): the same
 * number can be a singing row here. So the stored ids are dropped and the database gives new ones, in
 * the old order. Each run is then pointed at the new id of its session, also the copies of runs that a
 * check keeps. A run whose session did not come along loses the link, rather than point at whatever
 * holds that number now.
 *
 * Song ids belong to the device that gave them too, so a song item or a song milestone of the backup can
 * carry a key that a singing row holds here. The singing row stays and the row of the backup is left out.
 */
async function addBesideTheOtherSide(rows: BackupRows): Promise<void> {
  await db.skillStates.bulkPut(rows.skillStates)
  await db.lessons.bulkPut(rows.lessons)
  const heldItems = new Set(await db.songItems.toCollection().primaryKeys())
  await db.songItems.bulkPut(rows.songItems.filter((item) => !heldItems.has(item.key)))
  const heldMilestones = new Set((await db.milestones.toArray()).map((m) => m.key))
  await db.milestones.bulkAdd(inStoredOrder(rows.milestones.filter((m) => !heldMilestones.has(m.key))).map(withoutId))
  const sessions = inStoredOrder(rows.sessions)
  const newIds = await db.sessions.bulkAdd(sessions.map(withoutId), { allKeys: true })
  const movedTo = new Map(sessions.map((session, i) => [session.id, newIds[i]]))
  const relinked = <T extends Attempt>(run: T): T => {
    const { sessionId, ...rest } = run
    const moved = sessionId === undefined ? undefined : movedTo.get(sessionId)
    return (moved === undefined ? rest : { ...rest, sessionId: moved }) as T
  }
  await db.attempts.bulkAdd(inStoredOrder(rows.attempts).map((run) => relinked(withoutId(run))))
  await db.tests.bulkAdd(
    inStoredOrder(rows.tests).map((test) => ({
      ...withoutId(test),
      results: Array.isArray(test.results) ? test.results.map((r) => ({ ...r, attempt: relinked(r.attempt) })) : test.results,
    })),
  )
}

/**
 * A backup taken mid-course may carry no lesson rows (older backups) or rows with nothing left to
 * start; Today would then show the course with no lesson. Give the course a lesson, or end it.
 */
async function mendCourse(profile: Profile, instrument: InstrumentId): Promise<void> {
  if (!profile.firstStepsStartedAt || profile.firstStepsDoneAt) return
  await initialiseCourse(courseFor(instrument).map((l) => l.id), Date.now(), profileIdFor(instrument))
}

/**
 * Restores a backup. Version 2 holds both instruments and replaces everything. Version 1 was written
 * before singing existed and is a guitar backup: it replaces the guitar rows and leaves every singing
 * row exactly as it is. Only its guitar rows are taken: a copy of the app that still runs the old code
 * on a device that already sings writes version 1 with the singing rows in it, and those must not come
 * back over the ones stored here. Either way every session goes in stamped.
 * The numbers returned are the rows that were put in.
 */
export async function importTrainingData(json: string): Promise<{ attempts: number; skills: number }> {
  const backup = readBackup(json)
  const guitarOnly = backup.version === 1
  const taken: BackupRows = guitarOnly ? rowsOfSide(backup, 'guitar') : backup
  const rows: BackupRows = { ...taken, sessions: stampedSessions(taken.sessions) }
  await db.transaction('rw', TRAINING_TABLES, async () => {
    if (guitarOnly) {
      await deleteSide('guitar')
      await addBesideTheOtherSide(rows)
    } else {
      await clearTrainingTables()
      await putEverything(rows)
    }
    await db.profile.put({ ...backup.profile, id: 1 })
    await mendCourse(backup.profile, 'guitar')
    if (!guitarOnly && backup.voiceProfile) {
      await db.profile.put({ ...backup.voiceProfile, id: 2 })
      await mendCourse(backup.voiceProfile, 'voice')
    }
  })
  // A backup from an earlier version carries tempos earned on that version's drills.
  await migrateStoredTempos()
  return { attempts: rows.attempts.length, skills: rows.skillStates.length }
}

/** Deletes the training data of one instrument and leaves the other's alone, or of both when none is named. */
export async function resetTrainingData(instrument?: InstrumentId): Promise<void> {
  await db.transaction('rw', TRAINING_TABLES, async () => {
    if (instrument === undefined) await clearTrainingTables()
    else await deleteSide(instrument)
  })
}
