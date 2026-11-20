import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { attemptForBlock } from '../features/today/todayUtils'
import { attemptForTask, completeExerciseBlock, exerciseForBlock, getOrCreateTodaySession, minutesPlayed, nextPendingBlockId } from './coach'
import { CHECKPOINT_MINUTES, MONTHLY_MINUTES } from './constants'
import { exerciseParams } from './exercises'
import { SKILLS } from './skills'
import { getSession, listTests, loadProfile, resetTrainingData, saveProfile, saveSession } from './store'
import { blockRuns, completeTestBlock, saveFinishedTest } from './testBlocks'
import type { AttemptResult, Block, ExerciseBlock, SessionRecord, TestBlock, TestTask, TestTaskResult } from './types'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 20, 18, 0, 0)
const TODAY = '2026-11-20'
const settings = { calibratedAt: NOW.getTime() - DAY }
const SKILL = SKILLS[0]

function result(partial: Partial<AttemptResult> = {}): AttemptResult {
  return {
    perfects: 18,
    goods: 2,
    misses: 0,
    total: 20,
    timingMedianMs: 5,
    timingStdevMs: 20,
    coverage: 0.9,
    durationSec: 40,
    playedTempo: 60,
    targetTempo: 60,
    speed: 1,
    ...partial,
  }
}

function task(id: string): TestTask {
  return {
    id,
    title: id,
    instructions: '',
    skillIds: [SKILL.id],
    generatorId: SKILL.generators[0],
    params: exerciseParams(SKILL, SKILL.generators[0], 80),
    difficulty: 20,
    passCriteria: { minAccuracy: 0.8, maxMedianMs: 60, maxStdevMs: 60 },
  }
}

function played(tasks: TestTask[], partial: Partial<AttemptResult> = {}): TestTaskResult[] {
  return tasks.map((t) => ({ taskId: t.id, attempt: attemptForTask(t, result(partial), settings, NOW.getTime()), passed: true }))
}

function warmup(id: string): ExerciseBlock {
  return {
    id,
    kind: 'warmup',
    status: 'pending',
    minutes: 3,
    skillId: SKILL.id,
    generatorId: SKILL.generators[0],
    params: exerciseParams(SKILL, SKILL.generators[0], 60),
    tempo: 60,
    reps: 1,
    reason: '',
  }
}

function testBlock(id: string, test: TestBlock['test'], minutes: number): TestBlock {
  return { id, kind: 'test', status: 'pending', minutes, test, reason: '' }
}

async function storeSession(blocks: Block[], date = TODAY): Promise<SessionRecord> {
  const record: SessionRecord = {
    date,
    plan: { date, minutes: blocks.reduce((s, b) => s + b.minutes, 0), dayFactor: 1, blocks, explanation: [] },
    minutesDone: 0,
    completedBlockIds: [],
    startedAt: NOW.getTime(),
  }
  return { ...record, id: await saveSession(record) }
}

const statusOf = async (blockId: string, date = TODAY) => (await getSession(date))?.plan.blocks.find((b) => b.id === blockId)?.status

describe('a finished skill check closes its block in the day plan', () => {
  beforeEach(async () => {
    await resetTrainingData()
    await db.songs.clear()
    await saveProfile({ ...(await loadProfile()), placementDoneAt: NOW.getTime() - 10 * DAY })
  })

  it('marks the block done, counts the time it took and ends the session when it was the last block', async () => {
    const session = await storeSession([testBlock('b-test', 'checkpoint', CHECKPOINT_MINUTES)])
    const tasks = [task('t1'), task('t2'), task('t3')]

    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())

    const after = (await getSession(TODAY))!
    expect(after.id).toBe(session.id)
    expect(after.plan.blocks[0].status).toBe('done')
    // Time done is time played, as for every other block: three tasks of 40 seconds.
    expect(after.minutesDone).toBe(2)
    expect(after.completedBlockIds).toEqual(['b-test'])
    expect(after.finishedAt).toBeDefined()
    expect(await listTests()).toHaveLength(1)
  })

  it('leaves the other blocks open and no longer offers the check as the next block', async () => {
    await storeSession([warmup('b-warm'), testBlock('b-test', 'monthly', MONTHLY_MINUTES), warmup('b-later')])
    const tasks = [task('t1')]

    await saveFinishedTest('monthly', tasks, played(tasks), NOW.getTime())

    const after = (await getSession(TODAY))!
    expect(after.plan.blocks.map((b) => b.status)).toEqual(['pending', 'done', 'pending'])
    expect(after.finishedAt).toBeUndefined()
    // "Next block" after the later exercise wraps round to the first open block: never the check again.
    expect(nextPendingBlockId(after, 'b-later')).toBe('b-warm')
    expect(nextPendingBlockId(after, 'b-warm')).toBe('b-later')
  })

  it('counts the day for the streak, like any other first block of the day', async () => {
    await saveProfile({ ...(await loadProfile()), streak: 2, longestStreak: 2, lastSessionDate: '2026-11-19' })
    await storeSession([testBlock('b-test', 'checkpoint', CHECKPOINT_MINUTES), warmup('b-warm')])
    const tasks = [task('t1')]

    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())

    const profile = await loadProfile()
    expect(profile.streak).toBe(3)
    expect(profile.longestStreak).toBe(3)
    expect(profile.lastSessionDate).toBe(TODAY)
    expect((await db.milestones.toArray()).some((m) => m.key === 'streak:3')).toBe(true)
    // The check has just been taken: its own day is not a "session since the last check".
    expect(profile.sessionsSinceTest).toBe(0)
    expect(profile.lastCheckpointAt).toBe(NOW.getTime())
  })

  it('does not count the day twice when an exercise was finished first', async () => {
    await saveProfile({ ...(await loadProfile()), streak: 2, longestStreak: 2, lastSessionDate: '2026-11-19' })
    const warm = warmup('b-warm')
    const session = await storeSession([warm, testBlock('b-test', 'checkpoint', CHECKPOINT_MINUTES)])
    const warmed = await completeExerciseBlock(session, warm, exerciseForBlock(warm), result(), settings, NOW.getTime())
    expect((await loadProfile()).streak).toBe(3)
    const tasks = [task('t1'), task('t2'), task('t3')]

    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())

    const after = (await getSession(TODAY))!
    expect(after.plan.blocks.map((b) => b.status)).toEqual(['done', 'done'])
    // The warm-up's time stays, and the two minutes of the check come on top.
    expect(warmed.session.minutesDone).toBeGreaterThan(0)
    expect(after.minutesDone).toBe(warmed.session.minutesDone + 2)
    expect(after.finishedAt).toBeDefined()
    expect((await loadProfile()).streak).toBe(3)
  })

  it('keeps the time of the check when an exercise is finished after it', async () => {
    // The usual order of a plan: the check comes before the exercises.
    const later = warmup('b-later')
    await storeSession([testBlock('b-test', 'checkpoint', CHECKPOINT_MINUTES), later])
    const tasks = [task('t1'), task('t2'), task('t3')]
    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())
    const afterCheck = (await getSession(TODAY))!
    expect(afterCheck.minutesDone).toBe(2)

    const outcome = await completeExerciseBlock(afterCheck, later, exerciseForBlock(later), result({ durationSec: 60 }), settings, NOW.getTime() + 60_000)

    const after = (await getSession(TODAY))!
    expect(after.plan.blocks.map((b) => b.status)).toEqual(['done', 'done'])
    // Three tasks of 40 seconds and one minute of exercise: three minutes, not the exercise alone.
    expect(outcome.session.minutesDone).toBe(3)
    expect(after.minutesDone).toBe(3)
    expect(after.minutesDone).toBe(minutesPlayed(await db.attempts.toArray()))
  })

  it('never shows a task of the check as the result of an exercise on the same skill', async () => {
    const warm = warmup('b-warm')
    const session = await storeSession([warm, testBlock('b-test', 'checkpoint', CHECKPOINT_MINUTES)])
    await completeExerciseBlock(session, warm, exerciseForBlock(warm), result({ perfects: 20, goods: 0 }), settings, NOW.getTime())
    const tasks = [task('t1')]
    // The check is played later, on the same skill, and goes badly.
    const later = NOW.getTime() + 600_000
    const results: TestTaskResult[] = tasks.map((t) => ({ taskId: t.id, attempt: attemptForTask(t, result({ perfects: 2, goods: 0, misses: 18 }), settings, later), passed: false }))
    await saveFinishedTest('checkpoint', tasks, results, later)

    const attempts = await db.attempts.toArray()
    // The check's runs belong to the session (their time counts) ...
    expect(attempts.filter((a) => a.kind === 'test').every((a) => a.sessionId === session.id)).toBe(true)
    // ... but the warm-up row on Today still shows the warm-up.
    const shown = attemptForBlock(blockRuns(attempts), session.id, warm)
    expect(shown?.kind).toBe('warmup')
    expect(shown?.perfects).toBe(20)
    expect(blockRuns(attempts).some((a) => a.kind === 'test')).toBe(false)
  })

  it('leaves the runs of a check that is not in the plan out of the session', async () => {
    const session = await storeSession([warmup('b-warm')])
    const tasks = [task('t1')]
    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())
    expect((await db.attempts.toArray()).some((a) => a.sessionId === session.id)).toBe(false)
    expect((await getSession(TODAY))!.minutesDone).toBe(0)
  })

  it('changes nothing when the same check is run a second time that day', async () => {
    await storeSession([testBlock('b-test', 'checkpoint', CHECKPOINT_MINUTES), warmup('b-warm')])
    const tasks = [task('t1')]
    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())
    const first = (await getSession(TODAY))!

    expect(await completeTestBlock('checkpoint', NOW.getTime() + 60_000)).toBeNull()
    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime() + 120_000)

    const second = (await getSession(TODAY))!
    expect(second.minutesDone).toBe(first.minutesDone)
    expect(second.completedBlockIds).toEqual(first.completedBlockIds)
    expect(second.plan.blocks.map((b) => b.status)).toEqual(['done', 'pending'])
  })

  it('only closes a block of the same kind of check, and only in the plan of the day it was finished on', async () => {
    await storeSession([testBlock('b-month', 'monthly', MONTHLY_MINUTES)])
    await storeSession([testBlock('b-old', 'checkpoint', CHECKPOINT_MINUTES)], '2026-11-19')
    const tasks = [task('t1')]

    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())

    expect(await statusOf('b-month')).toBe('pending')
    expect(await statusOf('b-old', '2026-11-19')).toBe('pending')
    expect((await getSession(TODAY))!.minutesDone).toBe(0)
  })

  it('does nothing when there is no plan for the day, and still saves the check', async () => {
    const tasks = [task('t1')]
    const record = await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())
    expect(record.id).toBeDefined()
    expect(await getSession(TODAY)).toBeUndefined()
    expect((await loadProfile()).lastSessionDate).toBeUndefined()
  })

  it('leaves the block open when the check could not be saved', async () => {
    await storeSession([testBlock('b-test', 'checkpoint', CHECKPOINT_MINUTES)])
    const tasks = [task('t1')]
    // Every task heard only the app's own guitar part: there is nothing to save.
    await expect(saveFinishedTest('checkpoint', tasks, played(tasks, { bleed: true }), NOW.getTime())).rejects.toThrow()
    expect(await statusOf('b-test')).toBe('pending')
    expect((await getSession(TODAY))!.minutesDone).toBe(0)
  })

  it('works on the plan the coach makes: a due weekly check is planned once, closed by the check, and not planned again that day', async () => {
    await saveProfile({ ...(await loadProfile()), sessionsSinceTest: 5 })
    const planned = await getOrCreateTodaySession({ settings, now: NOW })
    const block = planned.plan.blocks.find((b): b is TestBlock => b.kind === 'test')
    expect(block?.test).toBe('checkpoint')
    const tasks = [task('t1')]

    await saveFinishedTest('checkpoint', tasks, played(tasks), NOW.getTime())

    const same = await getOrCreateTodaySession({ settings, now: new Date(NOW.getTime() + 3_600_000) })
    expect(same.id).toBe(planned.id)
    expect(same.plan.blocks.find((b) => b.id === block!.id)?.status).toBe('done')
    // One task of 40 seconds: a minute played, not the minutes the plan set aside.
    expect(same.minutesDone).toBe(1)
    // A fresh plan for the same day has no check in it either.
    const fresh = await getOrCreateTodaySession({ settings, now: new Date(NOW.getTime() + 3_600_000), forceNew: true })
    expect(fresh.plan.blocks.some((b) => b.kind === 'test')).toBe(false)
  })
})
