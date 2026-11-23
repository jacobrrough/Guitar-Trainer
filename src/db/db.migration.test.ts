import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Chart } from '../chart/types'
import type { LessonProgress } from '../lessons/types'
import type { Attempt, ExerciseBlock, Milestone, Profile, SessionRecord, SkillState, SongItemState, TestRecord } from '../training/types'

/**
 * The update to schema version 5 on a device that already holds version 4 data.
 *
 * The old database is built by a separate Dexie instance that only knows versions 1 to 4, filled and
 * closed, and only then opened by the app's own module. The four schemas are copied here as they
 * shipped, not imported: a test that read them from db.ts would agree with whatever db.ts says.
 */
const SHIPPED: Record<number, Record<string, string>> = {
  1: { songs: '++id, title, artist, createdAt, updatedAt' },
  2: {
    songs: '++id, title, artist, createdAt, updatedAt',
    skillStates: 'skillId, rating, nextReviewAt',
    attempts: '++id, at, kind, skillId, songId, sessionId',
    sessions: '++id, &date',
    tests: '++id, at, type',
    songItems: 'key, songId, nextReviewAt',
    profile: 'id',
  },
  3: {
    songs: '++id, title, artist, createdAt, updatedAt',
    skillStates: 'skillId, rating, nextReviewAt',
    attempts: '++id, at, kind, skillId, songId, sessionId',
    sessions: '++id, &date',
    tests: '++id, at, type',
    songItems: 'key, songId, nextReviewAt',
    profile: 'id',
    milestones: '++id, &key, at, type, skillId',
  },
  4: {
    songs: '++id, title, artist, createdAt, updatedAt, builtinId',
    skillStates: 'skillId, rating, nextReviewAt',
    attempts: '++id, at, kind, skillId, songId, sessionId',
    sessions: '++id, &date',
    tests: '++id, at, type',
    songItems: 'key, songId, nextReviewAt',
    profile: 'id',
    milestones: '++id, &key, at, type, skillId',
    lessons: 'id, status',
  },
}

const TABLES = ['songs', 'skillStates', 'attempts', 'sessions', 'tests', 'songItems', 'profile', 'milestones', 'lessons'] as const
type TableName = (typeof TABLES)[number]
type Rows = Record<TableName, Record<string, unknown>[]>

const YESTERDAY = '2026-11-22'
const TODAY = '2026-11-23'
const AUDIO_BYTES = [82, 73, 70, 70, 0, 1, 2, 3, 250, 251, 252, 253, 254, 255]

const chart: Chart = {
  version: 1,
  title: 'Ode to Joy',
  artist: 'Beethoven',
  source: 'builtin',
  tuning: [40, 45, 50, 55, 59, 64],
  capo: 0,
  duration: 12,
  notes: [
    { id: 0, time: 1, duration: 0.5, midi: 64, string: 5, fret: 0, velocity: 0.8, chordId: 0 },
    { id: 1, time: 1.5, duration: 0.5, midi: 65, string: 5, fret: 1, finger: 1, velocity: 0.8, chordId: 1 },
  ],
  beats: [{ time: 0, bar: 0, beatInBar: 0, isDownbeat: true }],
  tempos: [{ time: 0, bpm: 100 }],
  timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
}

function song(title: string, builtinId: string | undefined, bytes: number[]) {
  return {
    title,
    artist: 'Beethoven',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    audioData: new Uint8Array(bytes).buffer,
    audioType: 'audio/wav',
    audioName: `${title}.wav`,
    duration: 12,
    chart: { ...chart, title },
    source: builtinId ? 'builtin' : 'midi',
    bpm: 100,
    ...(builtinId ? { builtinId, builtinRev: 'abc123' } : {}),
    bestScores: { '2': { level: 2, score: 1800, accuracy: 0.9, maxStreak: 12, perfects: 16, goods: 2, misses: 2, speed: 1, date: 1_700_000_400_000 } },
    lastLevel: 2,
    lastSpeed: 0.85,
    playCount: 3,
  }
}

function block(id: string, kind: ExerciseBlock['kind'], status: ExerciseBlock['status']): ExerciseBlock {
  return { id, kind, status, minutes: 5, skillId: 'fret.chromatic', generatorId: 'chromatic', params: { tempo: 72, bars: 4, startTempo: 72 }, tempo: 72, reps: 3, reason: 'Your main skill for today' }
}

function session(date: string, done: boolean): Omit<SessionRecord, 'id'> {
  const blocks = [block(`${date}-0-warmup`, 'warmup', done ? 'done' : 'pending'), block(`${date}-1-focus`, 'focus', done ? 'done' : 'pending')]
  return {
    date,
    plan: { date, minutes: 10, dayFactor: 1, blocks, explanation: ['A short day: one warm-up and one skill.'] },
    minutesDone: done ? 9 : 0,
    completedBlockIds: done ? blocks.map((b) => b.id) : [],
    startedAt: 1_700_000_000_000,
    ...(done ? { finishedAt: 1_700_000_600_000 } : {}),
  }
}

function attempt(over: Partial<Attempt>): Omit<Attempt, 'id'> {
  return {
    at: 1_700_000_100_000,
    kind: 'practice',
    perfects: 14,
    goods: 4,
    misses: 2,
    total: 20,
    timingMedianMs: 12,
    timingStdevMs: 28,
    coverage: 0.95,
    durationSec: 40,
    playedTempo: 72,
    targetTempo: 72,
    speed: 1,
    perBar: [1, 0.75, 1, 0.5],
    difficulty: 22,
    performance: 0.81,
    accuracy: 0.86,
    reliable: true,
    ratingAfter: 31,
    ...over,
  }
}

const PROFILE: Profile = {
  id: 1,
  goals: ['songs', 'rhythm'],
  dailyMinutes: 20,
  startedAt: 1_690_000_000_000,
  streak: 3,
  longestStreak: 9,
  lastSessionDate: YESTERDAY,
  placementDoneAt: 1_690_000_100_000,
  sessionsSinceTest: 4,
  experience: 'new',
  firstStepsStartedAt: 1_690_000_000_000,
  goalSongId: 'ode-to-joy',
  drillRev: 2,
}

const SKILL_STATES: SkillState[] = [
  { skillId: 'fret.chromatic', rating: 31, confidence: 4.2, tempoCeiling: 72, lastPracticedAt: 1_700_000_100_000, ease: 2.5, intervalDays: 3, nextReviewAt: 1_700_300_000_000, plateauStep: 0, attempts: 9 },
  { skillId: 'chord.open', rating: 12, confidence: 1, tempoCeiling: 0, ease: 2.3, intervalDays: 1, plateauStep: 1, pinned: true, attempts: 2 },
]

const SONG_ITEMS: SongItemState[] = [
  { key: '1:2', songId: 1, level: 2, bestAccuracy: 0.9, lastAt: 1_700_000_400_000, ease: 2.5, intervalDays: 2, nextReviewAt: 1_700_200_000_000, weakBars: [3, 7], fullSpeedBest: 0.82, lastAccuracy: 0.9, lastSpeed: 0.85, lowStreak: 0 },
]

const TEST_RECORD: Omit<TestRecord, 'id'> = {
  at: 1_690_000_100_000,
  type: 'placement',
  tasks: [{ id: 't1', title: 'Open strings', instructions: 'Play each note as it reaches the line.', skillIds: ['fret.chromatic'], generatorId: 'chromatic', params: { tempo: 60, bars: 4 }, difficulty: 15, passCriteria: { minAccuracy: 0.8, maxMedianMs: 60, maxStdevMs: 70 } }],
  results: [{ taskId: 't1', attempt: { ...attempt({ kind: 'test', skillId: 'fret.chromatic' }), id: 1 }, passed: true }],
  report: { headline: 'A good start', lines: ['Open strings are clean.'], ratingDeltas: { 'fret.chromatic': 6 }, nextFocus: ['fret.chromatic'] },
}

const MILESTONES: Omit<Milestone, 'id'>[] = [
  { at: 1_700_000_200_000, type: 'streak', title: '3 days in a row', detail: 'Short and often is what works.', value: 3, key: 'streak:3' },
  { at: 1_700_000_300_000, type: 'band', skillId: 'fret.chromatic', title: 'Chromatic is coming along', detail: 'It moved up a band.', value: 1, key: 'band:fret.chromatic:1' },
]

const LESSONS: LessonProgress[] = [
  { id: 'l01-hold', status: 'done', startedAt: 1_690_000_000_000, completedAt: 1_690_000_900_000, learnSeen: true, drillDone: true, drillBestAccuracy: 0.9, playDone: true, playBestAccuracy: 0.8 },
  { id: 'l02-tune', status: 'available', learnSeen: true },
]

async function readAll(database: Dexie): Promise<Rows> {
  const out = {} as Rows
  for (const table of TABLES) out[table] = await database.table(table).toArray()
  return out
}

interface StoreShape {
  keyPath: unknown
  autoIncrement: boolean
  indexes: Record<string, { keyPath: unknown; unique: boolean; multiEntry: boolean }>
}

/**
 * The stores and indexes the browser itself holds, read from IndexedDB and not from what a Dexie instance
 * declares: a line of the version 5 schema that lost an index would leave every row in place and still
 * make the queries on that index fail.
 */
function shapeOf(database: Dexie): Record<string, StoreShape> {
  const idb = database.backendDB()
  const tx = idb.transaction(Array.from(idb.objectStoreNames), 'readonly')
  const out: Record<string, StoreShape> = {}
  for (const name of Array.from(idb.objectStoreNames)) {
    const store = tx.objectStore(name)
    const indexes: StoreShape['indexes'] = {}
    for (const indexName of Array.from(store.indexNames)) {
      const index = store.index(indexName)
      indexes[indexName] = { keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }
    }
    out[name] = { keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes }
  }
  return out
}

type AppDb = (typeof import('./db'))['db']

/** A database as an earlier release left it: only the schemas up to `lastVersion` are known to it. */
function olderRelease(lastVersion: number): Dexie {
  const old = new Dexie('guitar-trainer')
  for (let version = 1; version <= lastVersion; version++) old.version(version).stores(SHIPPED[version])
  return old
}

/** The app's own database module, loaded afresh, as at a launch after the update. */
async function launchApp(): Promise<AppDb> {
  vi.resetModules()
  const { db } = await import('./db')
  await db.open()
  return db
}

describe('updating a device from schema version 4', () => {
  let db: AppDb
  let before: Rows
  let after: Rows
  let shapeBefore: Record<string, StoreShape>

  beforeAll(async () => {
    const old = olderRelease(4)
    await old.table('songs').bulkAdd([song('Ode to Joy', 'ode-to-joy', AUDIO_BYTES), song('My own song', undefined, [1, 2, 3])])
    await old.table('skillStates').bulkPut(SKILL_STATES)
    const sessionIds = (await old.table('sessions').bulkAdd([session(YESTERDAY, true), session(TODAY, false)], { allKeys: true })) as number[]
    await old.table('attempts').bulkAdd([attempt({ skillId: 'fret.chromatic', sessionId: sessionIds[0], exerciseId: 'chromatic:abc', params: { tempo: 72, bars: 4 } }), attempt({ kind: 'song', songId: 1, level: 2, speed: 0.85, bleed: true })])
    await old.table('tests').add(TEST_RECORD)
    await old.table('songItems').bulkPut(SONG_ITEMS)
    await old.table('profile').put(PROFILE)
    await old.table('milestones').bulkAdd(MILESTONES)
    await old.table('lessons').bulkPut(LESSONS)
    before = await readAll(old)
    shapeBefore = shapeOf(old)
    expect(old.verno).toBe(4)
    old.close()
    db = await launchApp()
    after = await readAll(db)
  })

  afterAll(() => {
    db.close()
  })

  it('starts from real version 4 data: all nine tables filled, no session stamped', () => {
    for (const table of TABLES) expect(before[table].length, table).toBeGreaterThan(0)
    expect(before.sessions).toHaveLength(2)
    expect(before.sessions.some((s) => 'instrument' in s)).toBe(false)
  })

  it('opens at version 5', () => {
    expect(db.verno).toBe(5)
  })

  it('changes the stores and indexes of the sessions table only', () => {
    const shapeAfter = shapeOf(db)
    expect(Object.keys(shapeAfter).sort()).toEqual([...TABLES].sort())
    for (const table of TABLES) {
      if (table === 'sessions') continue
      expect(shapeAfter[table], table).toEqual(shapeBefore[table])
    }
    expect(shapeBefore.sessions.indexes).toEqual({ date: { keyPath: 'date', unique: true, multiEntry: false } })
    expect(shapeAfter.sessions).toEqual({
      keyPath: 'id',
      autoIncrement: true,
      indexes: {
        date: { keyPath: 'date', unique: false, multiEntry: false },
        '[instrument+date]': { keyPath: ['instrument', 'date'], unique: true, multiEntry: false },
      },
    })
  })

  it('leaves every row of the other eight tables exactly as it was', () => {
    for (const table of TABLES) {
      if (table === 'sessions') continue
      expect(after[table], table).toStrictEqual(before[table])
    }
  })

  it('keeps the audio bytes of a stored song', () => {
    const stored = after.songs.find((s) => s.builtinId === 'ode-to-joy')
    expect(Array.from(new Uint8Array(stored?.audioData as ArrayBuffer))).toEqual(AUDIO_BYTES)
  })

  it('stamps both sessions as guitar and changes nothing else in them', () => {
    expect(after.sessions).toStrictEqual(before.sessions.map((s) => ({ ...s, instrument: 'guitar' })))
  })

  it('still finds a session by its date alone, the way the guitar code reads it', async () => {
    expect((await db.sessions.where('date').equals(TODAY).first())?.plan.blocks[0].id).toBe(`${TODAY}-0-warmup`)
    expect((await db.sessions.orderBy('date').reverse().toArray()).map((s) => s.date)).toEqual([TODAY, YESTERDAY])
  })

  it('finds the stamped sessions by instrument and date', async () => {
    expect((await db.sessions.where('[instrument+date]').equals(['guitar', YESTERDAY]).toArray()).map((s) => s.date)).toEqual([YESTERDAY])
    expect(await db.sessions.where('[instrument+date]').equals(['voice', YESTERDAY]).count()).toBe(0)
  })

  it('lets the guitar side carry on with the day it had already planned', async () => {
    // The store as the app uses it, on the rows the update left behind (loaded after the app's database, so it shares it).
    const { completeBlock, getSession, saveSession } = await import('../training/store')
    const today = (await getSession(TODAY))!
    expect(today).toStrictEqual(after.sessions.find((s) => s.date === TODAY))
    const done = (await completeBlock(today.id!, `${TODAY}-0-warmup`, 3))!
    expect(done.plan.blocks.map((b) => b.status)).toEqual(['done', 'pending'])
    expect(await saveSession({ ...done, minutesDone: 5 })).toBe(today.id)
    expect(await db.sessions.where('date').equals(TODAY).toArray()).toEqual([{ ...done, minutesDone: 5 }])
    expect((await db.sessions.where('[instrument+date]').equals(['guitar', TODAY]).toArray()).map((s) => s.id)).toEqual([today.id])
  })

  it('accepts a singing session on a day that already has a guitar session', async () => {
    const id = await db.sessions.add({ ...session(TODAY, false), instrument: 'voice' })
    const rows = await db.sessions.where('date').equals(TODAY).toArray()
    expect(rows.map((s) => s.instrument).sort()).toEqual(['guitar', 'voice'])
    expect((await db.sessions.where('[instrument+date]').equals(['voice', TODAY]).first())?.id).toBe(id)
  })

  it('rejects a second guitar session on the same day', async () => {
    await expect(db.sessions.add({ ...session(YESTERDAY, false), instrument: 'guitar' })).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await db.sessions.where('date').equals(YESTERDAY).count()).toBe(1)
  })

  it('changes nothing more at the next launch: a guitar and a singing session of one day stay as they are', async () => {
    // The update runs once. Whatever a launch does to the sessions after it must leave both alone: a singing
    // session stamped again as guitar would be a second guitar session for the day, which the index refuses.
    const stored = await readAll(db)
    expect(stored.sessions.map((s) => s.instrument).sort()).toEqual(['guitar', 'guitar', 'voice'])
    db.close()
    db = await launchApp()
    expect(db.verno).toBe(5)
    expect(await readAll(db)).toStrictEqual(stored)
  })
})

describe('updating a device that last ran schema version 2', () => {
  // A phone that has not opened the app since the first training release walks every version in one go:
  // the stamp must still land, on a database that has never had the tables added in between.
  const OLD_TABLES = ['sessions', 'skillStates', 'profile'] as const
  let db: AppDb
  let before: Pick<Rows, (typeof OLD_TABLES)[number]>

  beforeAll(async () => {
    await Dexie.delete('guitar-trainer')
    const old = olderRelease(2)
    await old.table('sessions').bulkAdd([session(YESTERDAY, true), session(TODAY, false)])
    await old.table('skillStates').bulkPut(SKILL_STATES)
    await old.table('profile').put(PROFILE)
    before = { sessions: await old.table('sessions').toArray(), skillStates: await old.table('skillStates').toArray(), profile: await old.table('profile').toArray() }
    expect(old.verno).toBe(2)
    old.close()
    db = await launchApp()
  })

  afterAll(() => {
    db.close()
  })

  it('opens at version 5 with its sessions stamped as guitar', async () => {
    expect(db.verno).toBe(5)
    expect(before.sessions).toHaveLength(2)
    expect(await db.sessions.toArray()).toStrictEqual(before.sessions.map((s) => ({ ...s, instrument: 'guitar' })))
  })

  it('keeps its other rows and gains the newer tables, empty', async () => {
    expect(before.skillStates).toHaveLength(SKILL_STATES.length)
    expect(await db.skillStates.toArray()).toStrictEqual(before.skillStates)
    expect(await db.profile.toArray()).toStrictEqual([PROFILE])
    expect(await db.milestones.count()).toBe(0)
    expect(await db.lessons.count()).toBe(0)
  })
})

describe('updating a device that only ever stored songs (schema version 1)', () => {
  // The first builds had the song library and nothing else. Here the sessions table is created and has its
  // indexes changed within the one update, with no row in it.
  let db: AppDb
  let songsBefore: Record<string, unknown>[]

  beforeAll(async () => {
    await Dexie.delete('guitar-trainer')
    const old = olderRelease(1)
    await old.table('songs').add(song('Ode to Joy', undefined, AUDIO_BYTES))
    songsBefore = await old.table('songs').toArray()
    expect(old.verno).toBe(1)
    expect(Object.keys(shapeOf(old))).toEqual(['songs'])
    old.close()
    db = await launchApp()
  })

  afterAll(() => {
    db.close()
  })

  it('keeps its songs, audio bytes included', async () => {
    const songs = (await db.songs.toArray()) as unknown as Record<string, unknown>[]
    expect(songs).toHaveLength(1)
    expect(songs).toStrictEqual(songsBefore)
    expect(Array.from(new Uint8Array(songs[0].audioData as ArrayBuffer))).toEqual(AUDIO_BYTES)
  })

  it('ends with the same stores and indexes as a device updated from version 4', async () => {
    const shape = shapeOf(db)
    expect(Object.keys(shape).sort()).toEqual([...TABLES].sort())
    expect(shape.sessions.indexes).toEqual({
      date: { keyPath: 'date', unique: false, multiEntry: false },
      '[instrument+date]': { keyPath: ['instrument', 'date'], unique: true, multiEntry: false },
    })
    expect(Object.keys(shape.songs.indexes).sort()).toEqual(['artist', 'builtinId', 'createdAt', 'title', 'updatedAt'])
    await db.sessions.add({ ...session(TODAY, false), instrument: 'guitar' })
    await db.sessions.add({ ...session(TODAY, false), instrument: 'voice' })
    await expect(db.sessions.add({ ...session(TODAY, false), instrument: 'voice' })).rejects.toMatchObject({ name: 'ConstraintError' })
  })
})

describe('a copy of the app that still runs the old code, after the update', () => {
  // A second tab or the installed copy can keep the old code in memory for a while, and a release can be
  // taken back. Dexie lets code that only knows version 4 open the newer database (it raises the browser's
  // own version number by one each time and leaves the indexes alone). That code saves sessions without a
  // stamp, so rows without one can turn up at any time, not only at the update.
  const TOMORROW = '2026-11-24'
  const NEW_SESSIONS = {
    date: { keyPath: 'date', unique: false, multiEntry: false },
    '[instrument+date]': { keyPath: ['instrument', 'date'], unique: true, multiEntry: false },
  }
  let db: AppDb
  let updated: Record<string, unknown>[]

  beforeAll(async () => {
    await Dexie.delete('guitar-trainer')
    const seed = olderRelease(4)
    await seed.table('sessions').bulkAdd([session(YESTERDAY, true), session(TODAY, false)])
    await seed.table('profile').put(PROFILE)
    seed.close()
    db = await launchApp()
    await db.sessions.add({ ...session(TODAY, false), instrument: 'voice' })
    updated = await db.table('sessions').toArray()
    db.close()
  })

  afterAll(() => {
    db.close()
  })

  it('opens the updated database, reads every session and cannot undo the new indexes', async () => {
    const old = olderRelease(4)
    await old.open()
    expect(updated.map((s) => s.instrument)).toEqual(['guitar', 'guitar', 'voice'])
    expect(await old.table('sessions').toArray()).toStrictEqual(updated)
    expect(await old.table('profile').toArray()).toStrictEqual([PROFILE])
    expect(shapeOf(old).sessions.indexes).toEqual(NEW_SESSIONS)
    // What the old code does on a new day: a session with no stamp.
    await old.table('sessions').add(session(TOMORROW, false))
    old.close()
  })

  it('leaves the new code a database it still opens, with nothing lost', async () => {
    db = await launchApp()
    expect(db.verno).toBe(5)
    expect(Object.keys(shapeOf(db)).sort()).toEqual([...TABLES].sort())
    expect(shapeOf(db).sessions.indexes).toEqual(NEW_SESSIONS)
    const sessions = await db.table('sessions').toArray()
    expect(sessions.slice(0, updated.length)).toStrictEqual(updated)
    expect(sessions.slice(updated.length).map((s) => [s.date, s.instrument])).toEqual([[TOMORROW, undefined]])
  })

  it('finds the session the old code saved by its date, and stamps it the next time it is saved', async () => {
    const { getSession, saveSession } = await import('../training/store')
    expect(await db.sessions.where('[instrument+date]').equals(['guitar', TOMORROW]).count()).toBe(0)
    const found = (await getSession(TOMORROW))!
    expect(found.plan.blocks[0].id).toBe(`${TOMORROW}-0-warmup`)
    expect(await saveSession(found)).toBe(found.id)
    expect((await db.sessions.where('[instrument+date]').equals(['guitar', TOMORROW]).toArray()).map((s) => s.id)).toEqual([found.id])
    expect(await db.sessions.where('date').equals(TOMORROW).count()).toBe(1)
  })
})
