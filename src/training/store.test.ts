import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  peekLearnerModel,
  peekProfile,
  peekSession,
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
import { db, type SongRecord } from '../db/db'
import { listSongs } from '../db/useSongs'
import { COURSE, nextAvailableLesson } from '../lessons/course'
import type { LessonProgress } from '../lessons/types'
import { listMilestones, milestonesSince } from './milestoneStore'
import type { Attempt, ExerciseBlock, Milestone, Profile, SessionRecord, SkillState, SongItemState, TestRecord } from './types'

// Restoring a backup mends a course that is running, and for that the store asks which lessons the
// singing course has. Two lessons stand in for it, so these tests do not depend on what the course holds.
vi.mock('../lessons/voiceCourse', () => ({ VOICE_COURSE: [{ id: 'v01-voice' }, { id: 'v02-meet' }] }))

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

/**
 * Two instruments in one database. The guitar rows are the rows that were always there: profile row 1,
 * ids without a prefix, no stamp. The singing rows sit beside them (profile row 2, ids that start with
 * "voice" or "v01-", a stamp on everything else), and neither side may see, change or lose a row of the other.
 */
const DAY_ONE = '2026-03-10'
const VOICE_SKILL = 'voice.pitch.match'
const VOICE_LESSONS = ['v01-voice', 'v02-meet']
const TABLES = ['skillStates', 'songItems', 'attempts', 'sessions', 'tests', 'profile', 'milestones', 'lessons'] as const
type Dump = Record<(typeof TABLES)[number], unknown[]>

function voiceProfile(over: Partial<Profile> = {}): Profile {
  return { ...defaultProfile(1), id: 2, instrument: 'voice', voice: { range: { low: 55, high: 62, easy: 58, source: 'default', at: 3 } }, ...over }
}

function voiceSession(date = DAY_ONE): SessionRecord {
  const blocks = [block(`voice-${date}-0-warmup`), block(`voice-${date}-1-focus`)]
  return { date, plan: { date, minutes: 10, dayFactor: 1, blocks, explanation: [] }, minutesDone: 0, completedBlockIds: [], startedAt: 2 }
}

function songItem(songId: number, level: number, over: Partial<SongItemState> = {}): SongItemState {
  return { key: `${songId}:${level}`, songId, level, bestAccuracy: 0.8, lastAt: 1, ease: 2.5, intervalDays: 1, weakBars: [], ...over }
}

function milestone(key: string, at: number, over: Partial<Milestone> = {}): Milestone {
  return { at, type: 'streak', title: key, detail: 'd', key, ...over }
}

async function dump(): Promise<Dump> {
  const out = {} as Dump
  for (const t of TABLES) out[t] = await db.table(t).toArray()
  return out
}

/** Every row of `before` is still stored, exactly as it was. */
async function expectKept(before: Dump): Promise<void> {
  const after = await dump()
  for (const t of TABLES) for (const row of before[t]) expect(after[t], t).toContainEqual(row)
}

interface Seeded {
  sessionId: number
  attemptIds: number[]
  testId: number
  milestoneId: number
}

/** A singer's rows, at least one in every table. */
async function seedVoice(): Promise<Seeded> {
  await saveProfile(voiceProfile({ streak: 5 }))
  await db.skillStates.put(skill(VOICE_SKILL, 30))
  await db.songItems.put(songItem(9, 0, { instrument: 'voice' }))
  await db.lessons.bulkPut([
    { id: VOICE_LESSONS[0], status: 'done', completedAt: 4 },
    { id: VOICE_LESSONS[1], status: 'available' },
  ])
  const sessionId = await saveSession(voiceSession())
  const attemptIds = [
    await recordAttempt(attempt({ at: 1000, skillId: VOICE_SKILL, instrument: 'voice', sessionId })),
    await recordAttempt(attempt({ at: 2000, kind: 'song', skillId: undefined, songId: 9, instrument: 'voice', sessionId })),
  ]
  const testId = await recordTest({ ...testRecord(1500), instrument: 'voice' })
  const milestoneId = (await db.milestones.add(milestone('voice:streak:3', 1600, { instrument: 'voice' }))) as number
  return { sessionId, attemptIds, testId, milestoneId }
}

/** A guitarist's rows, written the way they always were: apart from the session, nothing says "guitar". */
async function seedGuitar(): Promise<Seeded> {
  await saveProfile({ ...defaultProfile(1), streak: 3 })
  // The second skill is no longer in the skill list. It is a guitar row all the same.
  await db.skillStates.bulkPut([skill('fret.chromatic', 40), skill('retired.skill', 15)])
  await db.songItems.put(songItem(3, 2))
  await db.lessons.bulkPut([
    { id: COURSE[0].id, status: 'done', completedAt: 6 },
    { id: COURSE[1].id, status: 'available' },
  ])
  const sessionId = await saveSession(session())
  const attemptIds = [
    await recordAttempt(attempt({ at: 1100, skillId: 'fret.chromatic', sessionId })),
    await recordAttempt(attempt({ at: 2100, kind: 'song', skillId: undefined, songId: 3, sessionId })),
  ]
  const testId = await recordTest(testRecord(1700))
  const milestoneId = (await db.milestones.add(milestone('streak:3', 1800))) as number
  return { sessionId, attemptIds, testId, milestoneId }
}

describe('two profiles', () => {
  it('keeps the singing profile in row 2 and leaves row 1 alone', async () => {
    const guitar = await loadProfile()
    const voice = await loadProfile('voice')
    expect(voice).toMatchObject({ id: 2, instrument: 'voice', streak: 0, dailyMinutes: 20 })
    expect(await db.profile.get(2)).toEqual(voice)
    expect(await db.profile.get(1)).toEqual(guitar)
    expect(await loadProfile('voice')).toEqual(voice)
  })

  it('writes the guitar profile exactly as before singing existed', async () => {
    const { startedAt: _startedAt, ...row } = await loadProfile()
    expect(row).toEqual({ id: 1, goals: ['all-round'], dailyMinutes: 20, streak: 0, longestStreak: 0, sessionsSinceTest: 0, drillRev: defaultProfile().drillRev })
  })

  it('counts a day of singing on the singing profile only', async () => {
    await saveProfile({ ...defaultProfile(1), streak: 3, longestStreak: 3, lastSessionDate: '2026-01-30' })
    const voice = await markSessionDay('2026-01-31', 'voice')
    expect(voice).toMatchObject({ id: 2, streak: 1, sessionsSinceTest: 1, lastSessionDate: '2026-01-31' })
    expect(await db.profile.get(1)).toMatchObject({ streak: 3, sessionsSinceTest: 0, lastSessionDate: '2026-01-30' })
    expect((await markSessionDay('2026-01-31')).streak).toBe(4)
    expect((await db.profile.get(2))?.streak).toBe(1)
  })

  it('can be looked at without being created', async () => {
    expect(await peekProfile('voice')).toMatchObject({ id: 2, instrument: 'voice' })
    expect(await peekProfile()).toMatchObject({ id: 1 })
    expect(await db.profile.count()).toBe(0)
    await saveProfile(voiceProfile({ streak: 8 }))
    expect((await peekProfile('voice')).streak).toBe(8)
  })
})

describe('the learner model of one instrument', () => {
  beforeEach(async () => {
    await seedGuitar()
    await seedVoice()
  })

  it('gives guitar its own skills, song items and profile, and never a singing one', async () => {
    const model = await loadLearnerModel()
    expect(Object.keys(model.skills).sort()).toEqual(['fret.chromatic', 'retired.skill'])
    expect(Object.keys(model.songItems)).toEqual(['3:2'])
    expect(model.profile).toMatchObject({ id: 1, streak: 3 })
    expect(await loadLearnerModel('guitar')).toEqual(model)
  })

  it('gives singing its own, and never a guitar one', async () => {
    const model = await loadLearnerModel('voice')
    expect(Object.keys(model.skills)).toEqual([VOICE_SKILL])
    expect(Object.keys(model.songItems)).toEqual(['9:0'])
    expect(model.profile).toMatchObject({ id: 2, streak: 5 })
  })

  it('reads the same model for a screen, without writing', async () => {
    expect(await peekLearnerModel()).toEqual(await loadLearnerModel())
    expect(await peekLearnerModel('voice')).toEqual(await loadLearnerModel('voice'))
    await db.profile.clear()
    const model = await peekLearnerModel('voice')
    expect(model.profile).toMatchObject({ id: 2, instrument: 'voice' })
    expect(Object.keys(model.skills)).toEqual([VOICE_SKILL])
    expect(await db.profile.count()).toBe(0)
  })
})

describe('attempts, checks and milestones of one instrument', () => {
  beforeEach(async () => {
    await seedGuitar()
    await seedVoice()
  })

  it('lists guitar runs unless singing is asked for', async () => {
    expect((await recentAttempts()).map((a) => a.at)).toEqual([2100, 1100])
    expect((await recentAttempts({ instrument: 'guitar' })).map((a) => a.at)).toEqual([2100, 1100])
    expect((await recentAttempts({ instrument: 'voice' })).map((a) => a.at)).toEqual([2000, 1000])
    expect((await recentAttempts({ instrument: 'voice', kinds: ['song'] })).map((a) => a.at)).toEqual([2000])
  })

  it('leaves the other side out before the limit is applied', async () => {
    // The two newest runs are sung ones: a limit taken first would leave guitar with nothing.
    await recordAttempt(attempt({ at: 5000, skillId: VOICE_SKILL, instrument: 'voice' }))
    await recordAttempt(attempt({ at: 6000, skillId: VOICE_SKILL, instrument: 'voice' }))
    expect((await recentAttempts({ limit: 1 })).map((a) => a.at)).toEqual([2100])
    expect((await recentAttempts({ instrument: 'voice', limit: 1 })).map((a) => a.at)).toEqual([6000])
    await recordTest({ ...testRecord(8000), instrument: 'voice' })
    expect((await listTests(1)).map((t) => t.at)).toEqual([1700])
    expect((await listTests(1, 'voice')).map((t) => t.at)).toEqual([8000])
    await db.milestones.add(milestone('voice:streak:7', 9000, { instrument: 'voice' }))
    expect((await listMilestones(1)).map((m) => m.key)).toEqual(['streak:3'])
    expect((await listMilestones(1, 'voice')).map((m) => m.key)).toEqual(['voice:streak:7'])
  })

  it('finds the runs of one skill or one song without being told the side', async () => {
    // A skill and a song each belong to one side already; leaving the side out must not hide their runs.
    expect((await recentAttempts({ skillId: VOICE_SKILL })).map((a) => a.at)).toEqual([1000])
    expect((await attemptsForSkill(VOICE_SKILL)).map((a) => a.at)).toEqual([1000])
    expect((await recentAttempts({ songId: 9 })).map((a) => a.at)).toEqual([2000])
    expect((await recentAttempts({ skillId: 'fret.chromatic' })).map((a) => a.at)).toEqual([1100])
    // Told the other side, it finds nothing.
    expect(await recentAttempts({ skillId: VOICE_SKILL, instrument: 'guitar' })).toEqual([])
  })

  it('lists checks and milestones by side, guitar unless told otherwise', async () => {
    expect((await listTests()).map((t) => t.at)).toEqual([1700])
    expect((await listTests(20, 'voice')).map((t) => t.at)).toEqual([1500])
    expect((await listMilestones()).map((m) => m.key)).toEqual(['streak:3'])
    expect((await listMilestones(20, 'voice')).map((m) => m.key)).toEqual(['voice:streak:3'])
    expect((await milestonesSince(0)).map((m) => m.key)).toEqual(['streak:3'])
    expect((await milestonesSince(0, 'voice')).map((m) => m.key)).toEqual(['voice:streak:3'])
    expect(await milestonesSince(1700, 'voice')).toEqual([])
  })
})

describe('the session of one instrument and day', () => {
  const stampedAs = (instrument: 'guitar' | 'voice', date = DAY_ONE) => db.sessions.where('[instrument+date]').equals([instrument, date]).primaryKeys()
  /** A session the way an older copy of the app stores it: straight into the table, no stamp. */
  const addUnstamped = async (record = session()) => (await db.sessions.add(record)) as number

  it('gives each side its own plan for the same day', async () => {
    // Singing first: a lookup by the date alone would hand the guitar side the singing plan.
    const voice = await saveSession(voiceSession())
    const guitar = await saveSession(session())
    expect((await getSession(DAY_ONE))?.id).toBe(guitar)
    expect((await getSession(DAY_ONE, 'guitar'))?.id).toBe(guitar)
    expect((await getSession(DAY_ONE, 'voice'))?.id).toBe(voice)
    expect((await peekSession(DAY_ONE))?.id).toBe(guitar)
    expect((await peekSession(DAY_ONE, 'voice'))?.id).toBe(voice)
    expect(await getSession('2026-03-11', 'voice')).toBeUndefined()
  })

  it('finds a session stored without a stamp and stamps it', async () => {
    const id = await addUnstamped()
    expect(await stampedAs('guitar')).toEqual([])
    const found = await getSession(DAY_ONE)
    expect(found).toEqual({ ...session(), id, instrument: 'guitar' })
    expect(await db.sessions.get(id)).toEqual(found)
    expect(await stampedAs('guitar')).toEqual([id])
  })

  it('never hands an unstamped guitar plan to the singing side, and leaves it as it is', async () => {
    const id = await addUnstamped()
    expect(await getSession(DAY_ONE, 'voice')).toBeUndefined()
    expect(await peekSession(DAY_ONE, 'voice')).toBeUndefined()
    expect(await db.sessions.get(id)).toEqual({ ...session(), id })
  })

  it('with a stamped and an unstamped row for one day, returns the stamped one and leaves the other alone', async () => {
    const loose = await addUnstamped({ ...session(), minutesDone: 9 })
    const stamped = await saveSession(session())
    expect((await getSession(DAY_ONE))?.id).toBe(stamped)
    expect(await db.sessions.get(loose)).toEqual({ ...session(), minutesDone: 9, id: loose })
    expect(await db.sessions.count()).toBe(2)
  })

  it('with several unstamped rows for one day, settles on the oldest and deletes nothing', async () => {
    const first = await addUnstamped({ ...session(), minutesDone: 1 })
    const second = await addUnstamped({ ...session(), minutesDone: 2 })
    expect((await getSession(DAY_ONE))?.id).toBe(first)
    // The first now holds the stamp; the second cannot get it, and asking again must not throw or change the answer.
    expect((await getSession(DAY_ONE))?.id).toBe(first)
    expect(await stampedAs('guitar')).toEqual([first])
    expect(await db.sessions.get(second)).toEqual({ ...session(), minutesDone: 2, id: second })
  })

  it('still answers when the stamp cannot be written', async () => {
    const id = await addUnstamped()
    const found = await db.transaction('r', db.sessions, () => getSession(DAY_ONE))
    expect(found?.id).toBe(id)
    expect((await db.sessions.get(id))?.instrument).toBeUndefined()
  })

  it('looks for a screen without writing anything', async () => {
    const id = await addUnstamped()
    expect((await peekSession(DAY_ONE))?.id).toBe(id)
    expect(await db.sessions.get(id)).toEqual({ ...session(), id })
  })

  it('stamps an unstamped session when one of its blocks is finished or skipped', async () => {
    const done = await addUnstamped()
    expect((await completeBlock(done, 'b1', 2))?.instrument).toBe('guitar')
    expect(await stampedAs('guitar')).toEqual([done])
    const skipped = await addUnstamped(session('2026-03-11'))
    await skipBlock(skipped, 'b1')
    expect(await stampedAs('guitar', '2026-03-11')).toEqual([skipped])
  })

  it('finishes a block of an unstamped session even when the stamp for its day is taken', async () => {
    const stamped = await saveSession(session())
    const loose = await addUnstamped()
    const record = await completeBlock(loose, 'b1', 3)
    expect(record?.plan.blocks[0].status).toBe('done')
    expect(await db.sessions.get(loose)).toMatchObject({ minutesDone: 3, completedBlockIds: ['b1'] })
    expect((await db.sessions.get(stamped))?.plan.blocks[0].status).toBe('pending')
    expect(await stampedAs('guitar')).toEqual([stamped])
  })
})

describe('backup holds both instruments (version 2)', () => {
  it('exports the guitar profile where it always was, and every profile beside it', async () => {
    await seedGuitar()
    await seedVoice()
    const data = JSON.parse(await exportTrainingData()) as { version: number; profile: Profile; profiles: Profile[] }
    expect(data.version).toBe(2)
    expect(data.profile).toMatchObject({ id: 1, streak: 3 })
    expect(data.profiles.map((p) => [p.id, p.streak])).toEqual([
      [1, 3],
      [2, 5],
    ])
  })

  it('round trips every row of both sides', async () => {
    await seedGuitar()
    await seedVoice()
    const before = await dump()
    for (const t of TABLES) expect(before[t].length, t).toBeGreaterThanOrEqual(2)
    const json = await exportTrainingData()
    await resetTrainingData()
    expect(await importTrainingData(json)).toEqual({ attempts: 4, skills: 3 })
    expect(await dump()).toEqual(before)
  })

  it('replaces both sides', async () => {
    await seedGuitar()
    await seedVoice()
    const before = await dump()
    const json = await exportTrainingData()
    await db.skillStates.bulkPut([skill('voice.pitch.hold', 60), skill('lead.bends', 60)])
    await recordAttempt(attempt({ at: 9000, skillId: 'voice.pitch.hold', instrument: 'voice' }))
    await saveProfile(voiceProfile({ streak: 40 }))
    await importTrainingData(json)
    expect(await dump()).toEqual(before)
  })

  it('removes the singing side when the backup holds none', async () => {
    await seedGuitar()
    const before = await dump()
    const json = await exportTrainingData()
    await seedVoice()
    await importTrainingData(json)
    expect(await dump()).toEqual(before)
    expect(await db.profile.get(2)).toBeUndefined()
  })

  it('stamps sessions that were saved in the backup without a stamp', async () => {
    await saveSession(session())
    await saveSession(voiceSession())
    const data = JSON.parse(await exportTrainingData()) as { sessions: SessionRecord[] }
    for (const s of data.sessions) delete s.instrument
    await resetTrainingData()
    await importTrainingData(JSON.stringify(data))
    expect((await getSession(DAY_ONE))?.plan.blocks[0].id).toBe('b1')
    expect((await getSession(DAY_ONE, 'voice'))?.plan.blocks[0].id).toBe(`voice-${DAY_ONE}-0-warmup`)
    expect((await db.sessions.toArray()).map((s) => s.instrument).sort()).toEqual(['guitar', 'voice'])
  })

  it('restores a device that held two unstamped plans for one day', async () => {
    // An older copy of the app can leave that behind. Its backup must still go back in: both rows, one stamp.
    await db.sessions.add({ ...session(), minutesDone: 1 })
    await db.sessions.add({ ...session(), minutesDone: 2 })
    const json = await exportTrainingData()
    await resetTrainingData()
    await importTrainingData(json)
    expect((await db.sessions.toArray()).map((s) => [s.minutesDone, s.instrument])).toEqual([
      [1, 'guitar'],
      [2, undefined],
    ])
    expect((await getSession(DAY_ONE))?.minutesDone).toBe(1)
  })

  it('leaves a singing course that is running with a lesson to start', async () => {
    await saveProfile(voiceProfile({ experience: 'new', firstStepsStartedAt: 5, placementDoneAt: 5 }))
    const data = JSON.parse(await exportTrainingData()) as Record<string, unknown>
    expect(data.lessons).toEqual([])
    await resetTrainingData()
    await importTrainingData(JSON.stringify(data))
    expect(await db.lessons.toArray()).toEqual([
      { id: VOICE_LESSONS[0], status: 'available' },
      { id: VOICE_LESSONS[1], status: 'locked' },
    ])
    expect((await db.profile.get(2))?.firstStepsDoneAt).toBeUndefined()
  })

  it('ends a singing course whose lessons are all done, on the singing profile only', async () => {
    await saveProfile({ ...defaultProfile(1), experience: 'new', firstStepsStartedAt: 5, placementDoneAt: 5 })
    await saveProfile(voiceProfile({ experience: 'new', firstStepsStartedAt: 5, placementDoneAt: 5 }))
    await db.lessons.bulkPut(VOICE_LESSONS.map((id): LessonProgress => ({ id, status: 'done', completedAt: 7 })))
    await db.lessons.bulkPut(COURSE.map((l, i): LessonProgress => ({ id: l.id, status: i === 0 ? 'available' : 'locked' })))
    const json = await exportTrainingData()
    await resetTrainingData()
    await importTrainingData(json)
    expect((await db.profile.get(2))?.firstStepsDoneAt).toBeTypeOf('number')
    expect((await db.profile.get(1))?.firstStepsDoneAt).toBeUndefined()
  })

  it('refuses a version it does not know and leaves the data alone', async () => {
    await seedGuitar()
    const before = await dump()
    const data = JSON.parse(await exportTrainingData()) as Record<string, unknown>
    await expect(importTrainingData(JSON.stringify({ ...data, version: 3 }))).rejects.toThrow(/version/)
    expect(await dump()).toEqual(before)
  })
})

describe('a guitar backup (version 1) on a device that also holds singing', () => {
  /**
   * What a device wrote before singing existed. Attempts, sessions, checks and milestones carry the ids
   * that device gave them, and here they are the very numbers the singing rows hold on this one.
   */
  function guitarBackup(voice: Seeded) {
    const [first, second] = voice.attemptIds
    return {
      version: 1,
      exportedAt: 1,
      profile: { ...defaultProfile(1), streak: 9 },
      skillStates: [skill('fret.chromatic', 77), skill('pick.alternate', 12)],
      songItems: [songItem(3, 1)],
      attempts: [
        attempt({ id: first, at: 500, skillId: 'fret.chromatic', sessionId: voice.sessionId }),
        attempt({ id: second, at: 600, skillId: 'pick.alternate', sessionId: voice.sessionId }),
        // Its session is not in the backup.
        attempt({ id: second + 1, at: 700, skillId: 'pick.alternate', sessionId: voice.sessionId + 40 }),
      ],
      sessions: [{ ...session(), id: voice.sessionId, minutesDone: 6 }],
      tests: [{ ...testRecord(7), id: voice.testId, results: [{ taskId: 't', passed: true, attempt: attempt({ at: 7, kind: 'test', sessionId: voice.sessionId }) }] }],
      milestones: [{ ...milestone('streak:7', 8), id: voice.milestoneId }],
      lessons: [
        { id: COURSE[0].id, status: 'done', completedAt: 11 },
        { id: COURSE[1].id, status: 'done', completedAt: 12 },
        { id: COURSE[2].id, status: 'available' },
      ],
    }
  }

  let voice: Seeded
  let voiceOnly: Dump

  beforeEach(async () => {
    voice = await seedVoice()
    voiceOnly = await dump()
    for (const t of TABLES) expect(voiceOnly[t].length, t).toBeGreaterThanOrEqual(1)
    await seedGuitar()
  })

  it('leaves every singing row exactly as it was', async () => {
    await importTrainingData(JSON.stringify(guitarBackup(voice)))
    await expectKept(voiceOnly)
  })

  it('replaces the guitar rows, and only those', async () => {
    const backup = guitarBackup(voice)
    expect(await importTrainingData(JSON.stringify(backup))).toEqual({ attempts: 3, skills: 2 })
    const after = await dump()
    // What is stored is the singing rows plus the rows of the backup: the guitar rows from before are gone.
    expect(after.profile).toHaveLength(2)
    expect(await db.profile.get(1)).toMatchObject({ id: 1, streak: 9 })
    expect(Object.keys((await loadLearnerModel()).skills).sort()).toEqual(['fret.chromatic', 'pick.alternate'])
    expect((await loadLearnerModel()).skills['fret.chromatic'].rating).toBe(77)
    expect(after.skillStates).toHaveLength(voiceOnly.skillStates.length + 2)
    expect(Object.keys((await loadLearnerModel()).songItems)).toEqual(['3:1'])
    expect(after.songItems).toHaveLength(voiceOnly.songItems.length + 1)
    expect((await recentAttempts()).map((a) => a.at)).toEqual([700, 600, 500])
    expect(after.attempts).toHaveLength(voiceOnly.attempts.length + 3)
    expect((await listTests()).map((t) => t.at)).toEqual([7])
    expect(after.tests).toHaveLength(voiceOnly.tests.length + 1)
    expect((await listMilestones()).map((m) => m.key)).toEqual(['streak:7'])
    expect(after.milestones).toHaveLength(voiceOnly.milestones.length + 1)
    expect(after.sessions).toHaveLength(voiceOnly.sessions.length + 1)
    expect((await db.lessons.bulkGet(COURSE.slice(0, 3).map((l) => l.id))).map((l) => l?.status)).toEqual(['done', 'done', 'available'])
    expect(after.lessons).toHaveLength(voiceOnly.lessons.length + 3)
  })

  it('stamps the imported session as guitar, beside the singing session of the same day', async () => {
    await importTrainingData(JSON.stringify(guitarBackup(voice)))
    const guitar = (await getSession(DAY_ONE))!
    expect(guitar).toMatchObject({ instrument: 'guitar', minutesDone: 6 })
    expect(guitar.id).not.toBe(voice.sessionId)
    expect(await getSession(DAY_ONE, 'voice')).toEqual(voiceOnly.sessions[0])
  })

  it('points each imported run at the new id of its own session, and a sung run still at its singing session', async () => {
    await importTrainingData(JSON.stringify(guitarBackup(voice)))
    const guitar = (await getSession(DAY_ONE))!
    const runs = await recentAttempts()
    expect(runs.filter((a) => a.at !== 700).map((a) => a.sessionId)).toEqual([guitar.id, guitar.id])
    // The check keeps a copy of each of its runs; that copy follows its session as well.
    expect((await listTests())[0].results.map((r) => r.attempt.sessionId)).toEqual([guitar.id])
    // A run whose session did not come along points at nothing, rather than at whatever holds that number here.
    expect(runs.find((a) => a.at === 700)).not.toHaveProperty('sessionId')
    const sung = await recentAttempts({ instrument: 'voice' })
    expect(sung.map((a) => a.sessionId)).toEqual([voice.sessionId, voice.sessionId])
    expect((await db.sessions.get(voice.sessionId))?.instrument).toBe('voice')
    expect((await db.sessions.get(voice.sessionId))?.plan.blocks[0].id).toBe(`voice-${DAY_ONE}-0-warmup`)
  })

  it('takes no singing row out of a guitar backup', async () => {
    // An older copy of the app, still open on a device that already sings, writes version 1 with every row it finds.
    const backup = guitarBackup(voice)
    const mixed = {
      ...backup,
      skillStates: [...backup.skillStates, skill(VOICE_SKILL, 99)],
      songItems: [...backup.songItems, songItem(9, 0, { instrument: 'voice', bestAccuracy: 0.1 })],
      attempts: [...backup.attempts, attempt({ id: 900, at: 3000, skillId: VOICE_SKILL, instrument: 'voice' })],
      sessions: [...backup.sessions, { ...voiceSession(), id: 901, instrument: 'voice', minutesDone: 99 }],
      tests: [...backup.tests, { ...testRecord(3100), id: 902, instrument: 'voice' }],
      milestones: [...backup.milestones, { ...milestone('voice:streak:3', 3200, { instrument: 'voice' }), id: 903 }],
      lessons: [...backup.lessons, { id: VOICE_LESSONS[1], status: 'locked' }],
    }
    expect(await importTrainingData(JSON.stringify(mixed))).toEqual({ attempts: 3, skills: 2 })
    await expectKept(voiceOnly)
    const after = await dump()
    for (const t of TABLES) expect(after[t], t).toHaveLength(voiceOnly[t].length + guitarRowsIn(backup, t))
  })

  it('never overwrites a singing row that holds the same key', async () => {
    // Song ids belong to the device that gave them: song 9 was a guitar song where this backup was made.
    const sungId = await db.milestones.add(milestone('song:9:0', 1650, { type: 'song', songId: 9, instrument: 'voice' }))
    const sungMilestone = await db.milestones.get(sungId)
    const sungItem = await db.songItems.get('9:0')
    expect(sungItem?.instrument).toBe('voice')
    const backup = guitarBackup(voice)
    const clashing = {
      ...backup,
      songItems: [...backup.songItems, songItem(9, 0, { bestAccuracy: 0.2 })],
      milestones: [...backup.milestones, { ...milestone('song:9:0', 9, { type: 'song', songId: 9 }), id: 77 }],
    }
    // The rest of the backup still goes in: one clash must not turn the whole file away.
    expect(await importTrainingData(JSON.stringify(clashing))).toEqual({ attempts: 3, skills: 2 })
    expect(await db.songItems.get('9:0')).toEqual(sungItem)
    expect(await db.milestones.where('key').equals('song:9:0').toArray()).toEqual([sungMilestone])
    expect((await listMilestones()).map((m) => m.key)).toEqual(['streak:7'])
    expect(Object.keys((await loadLearnerModel()).songItems)).toEqual(['3:1'])
  })

  it('restores a guitar-only device as it always did', async () => {
    await resetTrainingData()
    const backup = guitarBackup(voice)
    await importTrainingData(JSON.stringify(backup))
    const after = await dump()
    expect(after.profile).toEqual([backup.profile])
    expect(after.skillStates).toEqual(backup.skillStates)
    expect(after.songItems).toEqual(backup.songItems)
    expect(after.lessons).toEqual(backup.lessons)
    expect((after.attempts as Attempt[]).map((a) => a.at)).toEqual([500, 600, 700])
    expect((after.sessions as SessionRecord[]).map((s) => [s.date, s.instrument, s.minutesDone])).toEqual([[DAY_ONE, 'guitar', 6]])
    expect((after.tests as TestRecord[]).map((t) => t.at)).toEqual([7])
    expect((after.milestones as Milestone[]).map((m) => m.key)).toEqual(['streak:7'])
  })

  it('leaves everything alone when the backup cannot be read', async () => {
    const before = await dump()
    await expect(importTrainingData(JSON.stringify({ ...guitarBackup(voice), sessions: 'x' }))).rejects.toThrow()
    expect(await dump()).toEqual(before)
  })

  function guitarRowsIn(backup: ReturnType<typeof guitarBackup>, table: (typeof TABLES)[number]): number {
    return table === 'profile' ? 1 : backup[table].length
  }
})

describe('reset of one instrument', () => {
  it('removes the singing side and leaves every guitar row', async () => {
    await seedGuitar()
    const guitarOnly = await dump()
    await seedVoice()
    await resetTrainingData('voice')
    expect(await dump()).toEqual(guitarOnly)
  })

  it('removes the guitar side and leaves every singing row', async () => {
    await seedVoice()
    const voiceOnly = await dump()
    await seedGuitar()
    // Rows an older copy of the app may have left without a stamp are guitar rows too.
    await db.sessions.add(session('2026-03-12'))
    await resetTrainingData('guitar')
    expect(await dump()).toEqual(voiceOnly)
  })

  it('removes everything when no side is named', async () => {
    await seedGuitar()
    await seedVoice()
    await resetTrainingData()
    for (const rows of Object.values(await dump())) expect(rows).toEqual([])
  })
})

describe('the songs of one instrument', () => {
  function song(title: string, updatedAt: number, over: Partial<SongRecord> = {}): Omit<SongRecord, 'id'> {
    const chart = { title } as SongRecord['chart']
    return { title, artist: '', createdAt: 1, updatedAt, audioType: '', audioName: '', duration: 10, chart, source: 'builtin', bpm: 80, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0, ...over }
  }

  beforeEach(async () => {
    await db.songs.clear()
    await db.songs.bulkAdd([
      song('Riff', 1),
      song('Hot Cross Buns', 2, { instrument: 'voice', builtinId: 'sing-hot-cross-buns' }),
      song('Ode to Joy', 3),
      song('Twinkle', 4, { instrument: 'voice', builtinId: 'sing-twinkle' }),
    ] as SongRecord[])
  })

  it('lists the guitar songs, newest change first, unless singing is asked for', async () => {
    expect((await listSongs()).map((s) => s.title)).toEqual(['Ode to Joy', 'Riff'])
    expect((await listSongs('guitar')).map((s) => s.title)).toEqual(['Ode to Joy', 'Riff'])
    expect((await listSongs('voice')).map((s) => s.title)).toEqual(['Twinkle', 'Hot Cross Buns'])
  })
})

describe('harder cases for two instruments in one database', () => {
  const D1 = '2026-03-08'
  const D2 = '2026-03-09'

  it('a guitar backup with several sessions: each run follows its own session, whatever order the file lists them in', async () => {
    const voice = await seedVoice()
    // The ids in the file are the very numbers the new rows get here (the next free ones), shifted by one:
    // a link followed twice, or matched by its place in the file, lands on another day.
    const a = voice.sessionId + 1
    const b = voice.sessionId + 2
    const c = voice.sessionId + 3
    const backup = {
      version: 1,
      exportedAt: 1,
      profile: defaultProfile(1),
      skillStates: [],
      songItems: [],
      sessions: [
        { ...session(DAY_ONE), id: c },
        { ...session(D1), id: a },
        { ...session(D2), id: b },
      ],
      attempts: [
        attempt({ id: 31, at: 300, sessionId: c }),
        attempt({ id: 11, at: 100, sessionId: a }),
        attempt({ id: 21, at: 200, sessionId: b }),
        attempt({ id: 22, at: 210, sessionId: b }),
      ],
      tests: [],
    }
    await importTrainingData(JSON.stringify(backup))
    const dateOf = new Map((await db.sessions.toArray()).map((s) => [s.id, `${s.instrument}:${s.date}`]))
    const runs = await recentAttempts()
    expect(runs.map((r) => [r.at, dateOf.get(r.sessionId)])).toEqual([
      [300, `guitar:${DAY_ONE}`],
      [210, `guitar:${D2}`],
      [200, `guitar:${D2}`],
      [100, `guitar:${D1}`],
    ])
    // The sessions keep the order they were made in, so "the newest session" stays the newest.
    expect((await db.sessions.toArray()).filter((s) => s.instrument === 'guitar').map((s) => s.date)).toEqual([D1, D2, DAY_ONE])
    expect((await recentAttempts({ instrument: 'voice' })).map((r) => dateOf.get(r.sessionId))).toEqual([`voice:${DAY_ONE}`, `voice:${DAY_ONE}`])
  })

  it('a guitar backup put back twice leaves one copy of its rows and every singing row', async () => {
    const voice = await seedVoice()
    const voiceOnly = await dump()
    const backup = {
      version: 1,
      exportedAt: 1,
      profile: { ...defaultProfile(1), streak: 2 },
      skillStates: [skill('fret.chromatic', 50)],
      songItems: [songItem(3, 1)],
      sessions: [{ ...session(), id: voice.sessionId }],
      attempts: [attempt({ id: voice.attemptIds[0], at: 500, sessionId: voice.sessionId })],
      tests: [{ ...testRecord(7), id: voice.testId }],
      milestones: [{ ...milestone('streak:7', 8), id: voice.milestoneId }],
      lessons: [{ id: COURSE[0].id, status: 'available' }],
    }
    await importTrainingData(JSON.stringify(backup))
    await importTrainingData(JSON.stringify(backup))
    await expectKept(voiceOnly)
    const after = await dump()
    for (const t of TABLES) expect(after[t], t).toHaveLength(voiceOnly[t].length + 1)
    const guitar = (await getSession(DAY_ONE))!
    expect((await recentAttempts()).map((r) => r.sessionId)).toEqual([guitar.id])
  })

  it('a backup written by an older copy of the app after the update goes back in, with its two plans for one day', async () => {
    // That copy wrote version 1 with every row it found: the stamped guitar plan, a plan it saved itself
    // without a stamp, and the singing plan of the same day.
    const voice = await seedVoice()
    const voiceOnly = await dump()
    const backup = {
      version: 1,
      exportedAt: 1,
      profile: defaultProfile(1),
      skillStates: [],
      songItems: [],
      sessions: [
        { ...session(), id: 5, minutesDone: 2 },
        { ...session(), id: 4, minutesDone: 1, instrument: 'guitar' },
        { ...voiceSession(), id: voice.sessionId, instrument: 'voice', minutesDone: 77 },
      ],
      attempts: [attempt({ id: 1, at: 500, sessionId: 5 }), attempt({ id: 2, at: 600, sessionId: 4 })],
      tests: [],
    }
    await importTrainingData(JSON.stringify(backup))
    await expectKept(voiceOnly)
    const guitar = (await db.sessions.toArray()).filter((s) => s.id !== voice.sessionId)
    expect(guitar.map((s) => [s.minutesDone, s.instrument])).toEqual([
      [1, 'guitar'],
      [2, undefined],
    ])
    expect((await getSession(DAY_ONE))?.minutesDone).toBe(1)
    const minutesOf = new Map(guitar.map((s) => [s.id, s.minutesDone]))
    expect((await recentAttempts()).map((r) => [r.at, minutesOf.get(r.sessionId)])).toEqual([
      [600, 1],
      [500, 2],
    ])
  })

  it('a plan with singing blocks and no stamp is a singing plan: guitar never gets it, and a guitar reset leaves it', async () => {
    const loose = (await db.sessions.add(voiceSession())) as number
    expect(await getSession(DAY_ONE)).toBeUndefined()
    expect(await peekSession(DAY_ONE)).toBeUndefined()
    await resetTrainingData('guitar')
    expect(await db.sessions.get(loose)).toEqual({ ...voiceSession(), id: loose })
    expect(await getSession(DAY_ONE, 'voice')).toEqual({ ...voiceSession(), id: loose, instrument: 'voice' })
    await resetTrainingData('voice')
    expect(await db.sessions.count()).toBe(0)
  })

  it('finishing a block of the singing plan leaves the guitar plan of the same day alone, and the other way round', async () => {
    const guitar = await saveSession(session())
    const voice = await saveSession(voiceSession())
    const sung = await completeBlock(voice, `voice-${DAY_ONE}-0-warmup`, 3)
    expect(sung).toMatchObject({ id: voice, instrument: 'voice', minutesDone: 3 })
    expect(await db.sessions.get(guitar)).toEqual({ ...session(), id: guitar, instrument: 'guitar' })
    // A block id of the other side changes nothing.
    expect(await completeBlock(guitar, `voice-${DAY_ONE}-0-warmup`, 3)).toEqual({ ...session(), id: guitar, instrument: 'guitar' })
    await skipBlock(guitar, 'b1')
    await skipBlock(guitar, 'b2')
    expect((await getSession(DAY_ONE))?.finishedAt).toBeTypeOf('number')
    expect((await getSession(DAY_ONE, 'voice'))?.finishedAt).toBeUndefined()
  })

  it('a device that only sings exports a guitar profile too, and its backup replaces both sides elsewhere', async () => {
    await seedVoice()
    const data = JSON.parse(await exportTrainingData()) as { profile: Profile; profiles: Profile[] }
    expect(data.profile.id).toBe(1)
    expect(data.profiles.map((p) => p.id)).toEqual([1, 2])
    const sung = await dump()
    await resetTrainingData()
    await seedGuitar()
    await importTrainingData(JSON.stringify(data))
    expect(await dump()).toEqual(sung)
    expect(Object.keys((await loadLearnerModel()).skills)).toEqual([])
  })

  it('leaves out runs that did not count and runs of the other side before the limit, together', async () => {
    await recordAttempt(attempt({ at: 100, instrument: 'voice', skillId: VOICE_SKILL }))
    await recordAttempt(attempt({ at: 200 }))
    await recordAttempt(attempt({ at: 300, instrument: 'voice', skillId: VOICE_SKILL, bleed: true }))
    await recordAttempt(attempt({ at: 400, bleed: true }))
    await recordAttempt(attempt({ at: 500, instrument: 'voice', skillId: VOICE_SKILL }))
    expect((await recentAttempts({ instrument: 'voice', countedOnly: true, limit: 2 })).map((r) => r.at)).toEqual([500, 100])
    expect((await recentAttempts({ countedOnly: true, limit: 2 })).map((r) => r.at)).toEqual([200])
    // A stamp that says guitar is a guitar run like one without a stamp.
    await recordAttempt(attempt({ at: 600, instrument: 'guitar' }))
    expect((await recentAttempts({ limit: 1 })).map((r) => r.at)).toEqual([600])
  })

  it.each([1, 2])('refuses a version %i backup with a session that has no plan, says so, and leaves the data alone', async (version) => {
    await seedGuitar()
    await seedVoice()
    const before = await dump()
    const data = JSON.parse(await exportTrainingData()) as { sessions: unknown[] }
    for (const broken of [{ date: '2026-03-12', minutesDone: 0, completedBlockIds: [], startedAt: 1 }, { date: '2026-03-12', plan: {} }, null]) {
      const file = JSON.stringify({ ...data, version, sessions: [...data.sessions, broken] })
      await expect(importTrainingData(file)).rejects.toThrow(/^Invalid training data: .*session/)
    }
    expect(await dump()).toEqual(before)
  })

  it('an empty guitar backup empties the guitar side and nothing else', async () => {
    await seedVoice()
    const voiceOnly = await dump()
    await seedGuitar()
    const empty = { version: 1, exportedAt: 1, profile: defaultProfile(7), skillStates: [], songItems: [], attempts: [], sessions: [], tests: [] }
    expect(await importTrainingData(JSON.stringify(empty))).toEqual({ attempts: 0, skills: 0 })
    const after = await dump()
    expect(after.profile).toEqual([defaultProfile(7), ...voiceOnly.profile])
    expect({ ...after, profile: voiceOnly.profile }).toEqual(voiceOnly)
  })

  it('a backup that fails half way in leaves every row as it was, on both sides', async () => {
    await seedGuitar()
    await seedVoice()
    const before = await dump()
    const data = JSON.parse(await exportTrainingData()) as { sessions: SessionRecord[]; milestones: Milestone[] }
    // Two plans stamped for one instrument and day: the second cannot be stored, after the tables were emptied.
    const twoPlans = { ...data, sessions: [...data.sessions, { ...session(), id: 900, instrument: 'guitar' }] }
    await expect(importTrainingData(JSON.stringify(twoPlans))).rejects.toThrow()
    expect(await dump()).toEqual(before)
    // The same milestone twice in a guitar backup: it fails after the guitar rows were deleted.
    const twice = { ...data, version: 1, milestones: [milestone('streak:30', 5), { ...milestone('streak:30', 6), id: 901 }] }
    await expect(importTrainingData(JSON.stringify(twice))).rejects.toThrow()
    expect(await dump()).toEqual(before)
  })

  it('lists the milestones since a moment newest first, one side at a time', async () => {
    await db.milestones.bulkAdd([
      milestone('streak:3', 100),
      milestone('voice:streak:3', 200, { instrument: 'voice' }),
      milestone('streak:7', 300),
      milestone('voice:streak:7', 400, { instrument: 'voice' }),
      milestone('streak:14', 500, { instrument: 'guitar' }),
    ])
    expect((await milestonesSince(100)).map((m) => m.key)).toEqual(['streak:14', 'streak:7'])
    expect((await milestonesSince(100, 'voice')).map((m) => m.key)).toEqual(['voice:streak:7', 'voice:streak:3'])
    expect((await milestonesSince(200, 'voice')).map((m) => m.key)).toEqual(['voice:streak:7'])
    expect((await listMilestones(2)).map((m) => m.key)).toEqual(['streak:14', 'streak:7'])
  })
})
