import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  attemptsForSkill,
  completeBlock,
  defaultProfile,
  exportTrainingData,
  getSession,
  importTrainingData,
  listTests,
  loadLearnerModel,
  loadProfile,
  localDateString,
  markSessionDay,
  practiceDaysBySkill,
  recentAttempts,
  recordAttempt,
  recordTest,
  resetTrainingData,
  saveLearnerModel,
  saveProfile,
  saveSession,
  skipBlock,
  updateStreak,
} from './store'
import { db } from '../db/db'
import { COURSE, nextAvailableLesson } from '../lessons/course'
import type { LessonProgress } from '../lessons/types'
import type { Attempt, ExerciseBlock, SessionRecord, SkillState, SongItemState, TestRecord } from './types'

const DAY = 24 * 60 * 60 * 1000

function skill(skillId: string, rating = 10): SkillState {
  return { skillId, rating, confidence: 1, tempoCeiling: 60, ease: 2.5, intervalDays: 1, plateauStep: 0, attempts: 1 }
}

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    at: Date.now(),
    kind: 'practice',
    skillId: 'a',
    perfects: 1,
    goods: 0,
    misses: 0,
    total: 1,
    timingMedianMs: null,
    timingStdevMs: null,
    coverage: 1,
    durationSec: 10,
    playedTempo: 60,
    targetTempo: 60,
    speed: 1,
    difficulty: 0.5,
    performance: 0.9,
    accuracy: 0.9,
    reliable: true,
    ...over,
  }
}

function block(id: string): ExerciseBlock {
  return {
    id,
    kind: 'focus',
    status: 'pending',
    minutes: 5,
    skillId: 'a',
    generatorId: 'g',
    params: { tempo: 60, bars: 4 },
    tempo: 60,
    reps: 1,
    reason: 'test',
  }
}

function session(date = '2026-03-10'): SessionRecord {
  return {
    date,
    plan: { date, minutes: 10, dayFactor: 1, blocks: [block('b1'), block('b2')], explanation: [] },
    minutesDone: 0,
    completedBlockIds: [],
    startedAt: 1,
  }
}

function testRecord(at: number): TestRecord {
  return { at, type: 'checkpoint', tasks: [], results: [], report: { headline: 'h', lines: [], ratingDeltas: {}, nextFocus: [] } }
}

beforeEach(async () => {
  await resetTrainingData()
})

describe('profile', () => {
  it('creates and stores the default profile', async () => {
    const p = await loadProfile()
    expect(p).toMatchObject({ id: 1, goals: ['all-round'], dailyMinutes: 20, streak: 0, longestStreak: 0, sessionsSinceTest: 0 })
    expect(await loadProfile()).toEqual(p)
    expect(defaultProfile(5).startedAt).toBe(5)
  })
})

describe('learner model', () => {
  it('round trips skills and song items', async () => {
    const item: SongItemState = { key: '3:2', songId: 3, level: 2, bestAccuracy: 0.8, lastAt: 1, ease: 2.5, intervalDays: 1, weakBars: [1] }
    const profile = { ...defaultProfile(1), streak: 4 }
    await saveLearnerModel({ skills: { a: skill('a'), b: skill('b', 20) }, songItems: { '3:2': item }, profile })
    const model = await loadLearnerModel()
    expect(Object.keys(model.skills).sort()).toEqual(['a', 'b'])
    expect(model.skills.b.rating).toBe(20)
    expect(model.songItems['3:2']).toEqual(item)
    expect(model.profile.streak).toBe(4)
  })
})

describe('attempts', () => {
  it('filters and orders newest first', async () => {
    const now = Date.now()
    await recordAttempt(attempt({ at: now - 10 * DAY, skillId: 'a' }))
    await recordAttempt(attempt({ at: now - 2 * DAY, skillId: 'b', kind: 'review' }))
    const id = await recordAttempt(attempt({ at: now - 1 * DAY, skillId: 'a', songId: 7, kind: 'song' }))
    expect(typeof id).toBe('number')
    const all = await recentAttempts()
    expect(all.map((a) => a.skillId)).toEqual(['a', 'b', 'a'])
    expect((await recentAttempts({ skillId: 'a' })).length).toBe(2)
    expect((await recentAttempts({ songId: 7 })).length).toBe(1)
    expect((await recentAttempts({ sinceDays: 5 })).length).toBe(2)
    expect((await recentAttempts({ kinds: ['review', 'song'] })).length).toBe(2)
    expect((await recentAttempts({ limit: 1 }))[0].id).toBe(id)
    expect((await attemptsForSkill('a', 1)).length).toBe(1)
  })

  it('counts the earlier days on which each skill was practised', async () => {
    const noon = (daysAgo: number) => new Date(2026, 5, 20 - daysAgo, 12).getTime()
    const today = localDateString(new Date(noon(0)))
    await recordAttempt(attempt({ at: noon(3), skillId: 'a' }))
    await recordAttempt(attempt({ at: noon(3) + 60_000, skillId: 'a' }))
    await recordAttempt(attempt({ at: noon(1), skillId: 'a' }))
    await recordAttempt(attempt({ at: noon(1), skillId: 'b' }))
    await recordAttempt(attempt({ at: noon(0), skillId: 'b' }))
    await recordAttempt(attempt({ at: noon(0), skillId: 'c' }))
    await recordAttempt(attempt({ at: noon(2), songId: 7, kind: 'song', skillId: undefined }))
    // Two rounds on one day are one day; what is played today does not count, so the drill stays the same all day.
    expect(await practiceDaysBySkill(today)).toEqual({ a: 2, b: 1 })
  })
})

describe('sessions', () => {
  it('saves and fetches by date', async () => {
    const id = await saveSession(session())
    expect((await getSession('2026-03-10'))?.id).toBe(id)
    expect(await getSession('2026-03-11')).toBeUndefined()
  })

  it('completes blocks and finishes only when all are settled', async () => {
    const id = await saveSession(session())
    let rec = await completeBlock(id, 'b1', 4)
    expect(rec?.finishedAt).toBeUndefined()
    expect(rec?.plan.blocks[0].status).toBe('done')
    rec = await completeBlock(id, 'b1', 1)
    expect(rec?.completedBlockIds).toEqual(['b1'])
    expect(rec?.minutesDone).toBe(5)
    rec = await skipBlock(id, 'b2')
    expect(rec?.plan.blocks[1].status).toBe('skipped')
    expect(rec?.finishedAt).toBeTypeOf('number')
    expect((await getSession('2026-03-10'))?.finishedAt).toBeTypeOf('number')
    expect(await completeBlock(999, 'b1', 1)).toBeUndefined()
  })
})

describe('tests', () => {
  it('lists newest first', async () => {
    await recordTest(testRecord(1))
    await recordTest(testRecord(3))
    await recordTest(testRecord(2))
    expect((await listTests()).map((t) => t.at)).toEqual([3, 2, 1])
    expect((await listTests(1)).length).toBe(1)
  })
})

describe('streak', () => {
  const base = { ...defaultProfile(1) }
  it('formats local dates', () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
  it('handles first, same day, consecutive and gap', () => {
    const first = updateStreak(base, '2026-01-30')
    expect(first.streak).toBe(1)
    expect(updateStreak(first, '2026-01-30')).toBe(first)
    const next = updateStreak(first, '2026-01-31')
    expect(next.streak).toBe(2)
    const month = updateStreak(next, '2026-02-01')
    expect(month).toMatchObject({ streak: 3, longestStreak: 3, lastSessionDate: '2026-02-01' })
    const gap = updateStreak(month, '2026-02-03')
    expect(gap).toMatchObject({ streak: 1, longestStreak: 3 })
  })
  it('markSessionDay increments sessionsSinceTest once per day', async () => {
    await markSessionDay('2026-01-31')
    const p = await markSessionDay('2026-01-31')
    expect(p.sessionsSinceTest).toBe(1)
    expect((await markSessionDay('2026-02-01')).streak).toBe(2)
  })
})

describe('export / import', () => {
  it('round trips counts', async () => {
    await saveLearnerModel({ skills: { a: skill('a'), b: skill('b') }, songItems: {}, profile: defaultProfile(1) })
    await recordAttempt(attempt())
    await recordAttempt(attempt())
    await saveSession(session())
    await recordTest(testRecord(1))
    const json = await exportTrainingData()
    await resetTrainingData()
    expect(await recentAttempts()).toHaveLength(0)
    expect(await importTrainingData(json)).toEqual({ attempts: 2, skills: 2 })
    expect(await recentAttempts()).toHaveLength(2)
    expect(await getSession('2026-03-10')).toBeDefined()
    expect(await listTests()).toHaveLength(1)
    await expect(importTrainingData('{"version":2}')).rejects.toThrow()
  })
})

describe('runs that did not count', () => {
  it('can be left out of a history query, before the limit is applied', async () => {
    const now = Date.now()
    await recordAttempt(attempt({ at: now - 3000, skillId: 'a' }))
    await recordAttempt(attempt({ at: now - 2000, skillId: 'a', bleed: true }))
    await recordAttempt(attempt({ at: now - 1000, skillId: 'a', bleed: true }))
    expect(await recentAttempts({ skillId: 'a' })).toHaveLength(3)
    const counted = await recentAttempts({ skillId: 'a', countedOnly: true, limit: 2 })
    expect(counted.map((a) => a.at)).toEqual([now - 3000])
  })
})

describe('lesson progress is part of the training data', () => {
  const ids = COURSE.map((l) => l.id)
  const midCourse = (): LessonProgress[] =>
    ids.map((id, i) => (i === 0 ? { id, status: 'done', completedAt: 7, drillBestAccuracy: 0.8 } : { id, status: i === 1 ? 'available' : 'locked' }))
  const allDone = (): LessonProgress[] => ids.map((id) => ({ id, status: 'done', completedAt: 7 }))
  const courseProfile = () => ({ ...defaultProfile(1), experience: 'new' as const, firstStepsStartedAt: 5, placementDoneAt: 5 })

  beforeEach(async () => {
    await db.lessons.clear()
  })

  it('reset clears it, so a new start begins at lesson 1', async () => {
    await db.lessons.bulkPut(allDone())
    await resetTrainingData()
    expect(await db.lessons.count()).toBe(0)
  })

  it('round trips through export and import', async () => {
    await saveProfile(courseProfile())
    await db.lessons.bulkPut(midCourse())
    const json = await exportTrainingData()
    await resetTrainingData()
    expect(await db.lessons.count()).toBe(0)
    await importTrainingData(json)
    expect(await db.lessons.toArray()).toEqual(midCourse())
    expect(nextAvailableLesson(await db.lessons.toArray())?.id).toBe(ids[1])
    expect((await loadProfile()).firstStepsDoneAt).toBeUndefined()
  })

  it('an older backup without it still leaves a lesson to start when the course is running', async () => {
    await saveProfile(courseProfile())
    await db.lessons.bulkPut(midCourse())
    const { lessons: _lessons, ...older } = JSON.parse(await exportTrainingData()) as Record<string, unknown>
    expect(_lessons).toBeDefined()
    await resetTrainingData()
    await importTrainingData(JSON.stringify(older))
    const profile = await loadProfile()
    expect(profile.firstStepsStartedAt).toBe(5)
    expect(profile.firstStepsDoneAt).toBeUndefined()
    const rows = await db.lessons.toArray()
    expect(rows).toHaveLength(ids.length)
    expect(nextAvailableLesson(rows)?.id).toBe(ids[0])
  })

  it('an older backup of someone past the course imports as before', async () => {
    await saveProfile({ ...courseProfile(), firstStepsDoneAt: 9 })
    const { lessons: _lessons, ...older } = JSON.parse(await exportTrainingData()) as Record<string, unknown>
    await importTrainingData(JSON.stringify(older))
    expect((await loadProfile()).firstStepsDoneAt).toBe(9)
    expect(await db.lessons.count()).toBe(0)
  })

  it('a backup with every lesson done but the course still marked running ends the course', async () => {
    await saveProfile(courseProfile())
    await db.lessons.bulkPut(allDone())
    const json = await exportTrainingData()
    await resetTrainingData()
    await importTrainingData(json)
    expect((await loadProfile()).firstStepsDoneAt).toBeTypeOf('number')
    expect(await db.lessons.toArray()).toEqual(allDone())
  })

  it('rejects a backup whose lessons are not a list, leaving the data alone', async () => {
    await saveProfile(courseProfile())
    await db.lessons.bulkPut(midCourse())
    const data = JSON.parse(await exportTrainingData()) as Record<string, unknown>
    await expect(importTrainingData(JSON.stringify({ ...data, lessons: 'x' }))).rejects.toThrow()
    expect(await db.lessons.toArray()).toEqual(midCourse())
  })
})

