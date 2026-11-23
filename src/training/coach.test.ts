import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/db'
import { createDemoSong } from '../features/library/demoSong'
import { COURSE, nextAvailableLesson } from '../lessons/course'
import { finishLesson } from '../lessons/finish'
import { courseProgress, initialiseCourse } from '../lessons/store'
import { installBuiltInSongs } from '../songs'
import {
  attemptForTask,
  completeExerciseBlock,
  completeFirstSteps,
  completeSongBlock,
  exerciseForBlock,
  finishExerciseBlock,
  finishTest,
  finishedLessons,
  getOrCreateTodaySession,
  minutesPlayed,
  recordExerciseRep,
  recordLessonDrill,
  recordSongPlay,
  songSummaries,
  startFirstSteps,
  type FirstStepsSetup,
} from './coach'
import { exerciseParams } from './exercises'
import { SKILLS } from './skills'
import { exportTrainingData, getSession, importTrainingData, listTests, loadLearnerModel, loadProfile, resetTrainingData, saveSession } from './store'
import type { AttemptResult, Block, ExerciseBlock, SessionRecord, SongBlock, TestTask } from './types'

// The cases below date their rounds in November 2026, and the store asks the clock which rounds are
// from the last 30 days. Without a fixed clock they would start failing a month after they were written.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 8, 9, 0, 0))
})
afterAll(() => {
  vi.useRealTimers()
})

// The wizard also installs the bundled songs, which renders audio; these tests are about the course rows.
vi.mock('../songs', async (importOriginal) => ({ ...(await importOriginal<typeof import('../songs')>()), installBuiltInSongs: vi.fn(async () => {}) }))

const settings = { calibratedAt: Date.now() }

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

describe('coach orchestration', () => {
  beforeEach(async () => {
    await resetTrainingData()
    await db.songs.clear()
  })

  it('plans a first session for a new player with an empty library', async () => {
    const now = new Date(2026, 10, 8, 9, 0, 0)
    const session = await getOrCreateTodaySession({ settings, now })
    expect(session.id).toBeDefined()
    expect(session.date).toBe('2026-11-08')
    // Placement is due on first use, so the plan is the placement test block.
    expect(session.plan.blocks.map((b) => b.kind)).toEqual(['test'])
    const again = await getOrCreateTodaySession({ settings, now })
    expect(again.id).toBe(session.id)
  })

  it('stores one session for the day when the screen asks twice at once', async () => {
    const now = new Date(2026, 10, 8, 9, 0, 0)
    const [a, b] = await Promise.all([getOrCreateTodaySession({ settings, now }), getOrCreateTodaySession({ settings, now })])
    expect(a.id).toBeDefined()
    expect(b.id).toBe(a.id)
    expect(await db.sessions.count()).toBe(1)
    // A re-plan that arrives while the first plan is still being made replaces it; still one session.
    await db.sessions.clear()
    const [first, replanned] = await Promise.all([
      getOrCreateTodaySession({ settings, now }),
      getOrCreateTodaySession({ settings, now, quick: true, forceNew: true }),
    ])
    expect(replanned.id).toBe(first.id)
    expect(await db.sessions.count()).toBe(1)
  })

  it('plans practice blocks once placement is done, and completing a block updates everything', async () => {
    const profile = await loadProfile()
    await db.profile.put({ ...profile, placementDoneAt: Date.now() - 86_400_000 })
    const song = await createDemoSong()
    const { audio, ...rest } = song
    await db.songs.add({ ...rest, audioData: await audio.arrayBuffer(), createdAt: 1, updatedAt: 1, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0 })
    expect((await songSummaries())[0].levelNoteCounts).toHaveLength(6)

    const now = new Date(2026, 10, 8, 9, 0, 0)
    const session = await getOrCreateTodaySession({ settings, now })
    const kinds = session.plan.blocks.map((b) => b.kind)
    expect(kinds).toContain('focus')
    expect(kinds).toContain('song')
    expect(session.plan.minutes).toBe(20)

    const focus = session.plan.blocks.find((b): b is ExerciseBlock => b.kind === 'focus')!
    const exercise = exerciseForBlock(focus)
    expect(exercise.chart.notes.length).toBeGreaterThan(0)
    expect(exercise.backing).not.toBeNull()

    const outcome = await completeExerciseBlock(session, focus, exercise, result({ playedTempo: focus.tempo, targetTempo: focus.tempo }), settings, now.getTime())
    expect(outcome.state?.rating).toBeGreaterThan(0)
    expect(outcome.attempt.id).toBeDefined()
    expect(outcome.attempt.ratingAfter).toBe(outcome.state?.rating)
    expect(outcome.session.completedBlockIds).toEqual([focus.id])
    expect(outcome.session.plan.blocks.find((b) => b.id === focus.id)?.status).toBe('done')
    // Time done is the time really played (one 40-second round), not the planned length of the block.
    expect(focus.minutes).toBeGreaterThan(1)
    expect(outcome.session.minutesDone).toBe(1)
    expect(minutesPlayed([{ durationSec: 29 }, { durationSec: 31 }, { durationSec: 28 }, { durationSec: 500, bleed: true }])).toBe(1)
    expect(minutesPlayed([{ durationSec: 200 }, { durationSec: 220 }])).toBe(7)
    expect(minutesPlayed([])).toBe(0)

    const model = await loadLearnerModel()
    expect(model.skills[focus.skillId].attempts).toBe(1)
    expect(model.profile.streak).toBe(1)
    expect(model.profile.lastSessionDate).toBe('2026-11-08')
    expect(await db.attempts.count()).toBe(1)

    const songBlock = outcome.session.plan.blocks.find((b): b is SongBlock => b.kind === 'song')!
    const stored = (await db.songs.toArray())[0]
    const songOutcome = await completeSongBlock(outcome.session, songBlock, stored, result({ perBar: [1, 1, 0.5, 1] }), settings, now.getTime())
    expect(songOutcome.songItem?.bestAccuracy).toBeCloseTo(0.98, 2)
    expect(songOutcome.songItem?.weakBars).toEqual([2])
    expect(songOutcome.session.completedBlockIds).toHaveLength(2)
    expect((await loadLearnerModel()).profile.streak).toBe(1)
  })

  it('counts the time of every round of a block as minutes done, and reads what the course really taught', async () => {
    const profile = await loadProfile()
    await db.profile.put({ ...profile, placementDoneAt: Date.now() - 86_400_000 })
    const now = new Date(2026, 10, 8, 9, 0, 0)
    const session = await getOrCreateTodaySession({ settings, now })
    const focus = session.plan.blocks.find((b): b is ExerciseBlock => b.kind === 'focus')!
    const exercise = exerciseForBlock(focus)
    const round = result({ playedTempo: focus.tempo, targetTempo: focus.tempo, durationSec: 70 })
    await recordExerciseRep(session, focus, exercise, round, settings, now.getTime())
    await recordExerciseRep(session, focus, exercise, round, settings, now.getTime() + 80_000)
    const outcome = await completeExerciseBlock(session, focus, exercise, round, settings, now.getTime() + 160_000)
    // Three rounds of 70 seconds: three and a half minutes, shown as 4, whatever the block was planned at.
    expect(outcome.session.minutesDone).toBe(4)

    expect(await finishedLessons()).toEqual({ lessonsDone: 0, lessonSkillIds: [] })
    await db.lessons.bulkPut([
      { id: COURSE[0].id, status: 'done' },
      { id: COURSE[2].id, status: 'done' },
      { id: COURSE[3].id, status: 'available' },
    ])
    expect(await finishedLessons()).toEqual({ lessonsDone: 2, lessonSkillIds: [COURSE[0].drill!.skillId, COURSE[2].drill!.skillId] })
  })

  it('does not announce a skill of the finished lessons as unlocked: the plan has had it open since the course', async () => {
    const now = new Date(2026, 10, 8, 9, 0, 0).getTime()
    // A graduate with low ratings. The lessons drilled chord changes, so the planner keeps them open.
    await db.lessons.bulkPut(COURSE.map((l) => ({ id: l.id, status: 'done' as const })))
    expect((await finishedLessons()).lessonSkillIds).toContain('chord.changes-open')
    const low = (skillId: string, rating: number) => ({ skillId, rating, confidence: 6, tempoCeiling: 50, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 6, lastPracticedAt: now - 86_400_000 })
    await db.skillStates.bulkPut([low('fret.single-string', 24.5), low('chord.changes-open', 20)])
    // One clean round lifts single notes over 25, the mark from which a practised tier 2 skill is within reach.
    const block: ExerciseBlock = { id: 'b', kind: 'focus', status: 'pending', minutes: 5, skillId: 'fret.single-string', generatorId: 'firstFrets', params: { tempo: 60, bars: 4, startTempo: 60 }, tempo: 60, reps: 1, reason: '' }
    const out = await recordLessonDrill('fret.single-string', exerciseForBlock(block), result({ perfects: 20, goods: 0 }), settings, now)
    expect(out.ratingBefore).toBeLessThan(25)
    expect(out.state.rating).toBeGreaterThanOrEqual(25)
    const keys = (await db.milestones.toArray()).map((m) => m.key)
    expect(keys).not.toContain('unlock:chord.changes-open')
  })

  it('records free song plays outside a session', async () => {
    const song = await createDemoSong()
    const { audio, ...rest } = song
    const id = await db.songs.add({ ...rest, audioData: await audio.arrayBuffer(), createdAt: 1, updatedAt: 1, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0 })
    const stored = (await db.songs.get(id))!
    const { songItem, attempt } = await recordSongPlay(stored, 2, result({ perfects: 10, goods: 5, misses: 5 }), settings)
    expect(attempt.kind).toBe('song')
    expect(songItem.key).toBe(`${id}:2`)
    expect(songItem.bestAccuracy).toBeCloseTo((10 + 0.8 * 5) / 20, 6)
  })
})

const NOW = new Date(2026, 10, 8, 9, 0, 0).getTime()
const SKILL = SKILLS[0]
const OTHER_SKILL = SKILLS[1]

function exerciseBlock(kind: ExerciseBlock['kind'] = 'focus', tempo = 80): ExerciseBlock {
  const generatorId = SKILL.generators[0]
  return { id: `b-${kind}`, kind, status: 'pending', minutes: 5, skillId: SKILL.id, generatorId, params: exerciseParams(SKILL, generatorId, tempo), tempo, reps: 3, reason: 'test' }
}

async function storedSession(blocks: Block[]): Promise<SessionRecord> {
  const date = '2026-11-08'
  const record: SessionRecord = { date, plan: { date, minutes: 20, dayFactor: 1, blocks, explanation: [] }, minutesDone: 0, completedBlockIds: [], startedAt: 1 }
  const id = await saveSession(record)
  return { ...record, id }
}

async function storedDemoSong() {
  const { audio, ...rest } = await createDemoSong()
  const id = await db.songs.add({ ...rest, audioData: await audio.arrayBuffer(), createdAt: 1, updatedAt: 1, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0 })
  return (await db.songs.get(id))!
}

/** A full-marks run the microphone picked up from the speaker: the app scored its own guitar part. */
function bleed(partial: Partial<AttemptResult> = {}): AttemptResult {
  return result({ perfects: 20, goods: 0, misses: 0, bleed: true, ...partial })
}

describe('the target tempo is where the Coach stops', () => {
  beforeEach(async () => {
    await resetTrainingData()
    await db.songs.clear()
  })

  it('after a clean round at the target the next round is at the target, not above it', async () => {
    const block = exerciseBlock('focus', SKILL.targetTempo)
    const session = await storedSession([block])
    const clean = result({ perfects: 20, goods: 0, misses: 0, playedTempo: SKILL.targetTempo, targetTempo: SKILL.targetTempo })
    const out = await recordExerciseRep(session, block, exerciseForBlock(block), clean, settings, NOW)
    expect(out.counted).toBe(true)
    expect(out.nextTempo).toBe(SKILL.targetTempo)
    // One step under it, the step up stops there too.
    const near = exerciseBlock('focus', SKILL.targetTempo - 1)
    const nearOut = await recordExerciseRep(session, near, exerciseForBlock(near), { ...clean, playedTempo: SKILL.targetTempo - 1, targetTempo: SKILL.targetTempo - 1 }, settings, NOW)
    expect(nearOut.nextTempo).toBe(SKILL.targetTempo)
  })

  it('two rounds in a row that are neither clean nor rough at one tempo: the next one eases off', async () => {
    const block = exerciseBlock('focus', 80)
    const session = await storedSession([block])
    const soso = result({ perfects: 16, goods: 0, misses: 4, playedTempo: 80, targetTempo: 80 })
    const first = await recordExerciseRep(session, block, exerciseForBlock(block), soso, settings, NOW)
    expect(first.performance.acc).toBeCloseTo(0.8, 6)
    expect(first.nextTempo).toBe(80)
    const second = await recordExerciseRep(session, block, exerciseForBlock(block), soso, settings, NOW + 60_000)
    expect(second.nextTempo).toBe(76)
    // At the eased tempo the count starts again: one in-between round there keeps the tempo.
    const eased = exerciseBlock('focus', 76)
    const third = await recordExerciseRep(session, eased, exerciseForBlock(eased), { ...soso, playedTempo: 76, targetTempo: 76 }, settings, NOW + 120_000)
    expect(third.nextTempo).toBe(76)
    // Yesterday's rounds do not count for today's: another sitting starts fresh.
    const other = { ...session, id: (session.id ?? 0) + 1000 }
    // Also when it begins at the very tempo the last sitting ended on, with a round like its last one.
    const sameTempo = await recordExerciseRep(other, eased, exerciseForBlock(eased), { ...soso, playedTempo: 76, targetTempo: 76 }, settings, NOW + 86_400_000 - 60_000)
    expect(sameTempo.nextTempo).toBe(76)
    const fresh = await recordExerciseRep(other, block, exerciseForBlock(block), soso, settings, NOW + 86_400_000)
    expect(fresh.nextTempo).toBe(80)
  })

  it('a plan stored by an earlier version above the target is brought down to it when the day is opened', async () => {
    const now = new Date(2026, 10, 8, 9, 0, 0)
    const fast = exerciseBlock('focus', SKILL.targetTempo + 32)
    const done: ExerciseBlock = { ...exerciseBlock('warmup', SKILL.targetTempo + 20), status: 'done' }
    const stored = await storedSession([done, fast])
    const opened = await getOrCreateTodaySession({ settings, now })
    expect(opened.id).toBe(stored.id)
    const [first, second] = opened.plan.blocks as ExerciseBlock[]
    // What was played stays as it was played.
    expect(first.tempo).toBe(SKILL.targetTempo + 20)
    expect(second.tempo).toBe(SKILL.targetTempo)
    expect(second.params).toMatchObject({ tempo: SKILL.targetTempo, startTempo: SKILL.targetTempo, maxTempo: SKILL.targetTempo })
    expect((await getSession(stored.date))!.plan.blocks[1]).toMatchObject({ tempo: SKILL.targetTempo })
    // A plan that is already within its targets is handed back untouched.
    expect(await getOrCreateTodaySession({ settings, now })).toEqual(opened)
  })
})

describe('a run where the app heard its own guitar part (speaker bleed)', () => {
  beforeEach(async () => {
    await resetTrainingData()
    await db.songs.clear()
  })

  it('keeps a rep in the history and changes nothing else', async () => {
    const block = exerciseBlock('focus')
    const session = await storedSession([block])
    const out = await recordExerciseRep(session, block, exerciseForBlock(block), bleed({ playedTempo: 80, targetTempo: 80 }), settings, NOW)
    expect(out.state).toMatchObject({ rating: 0, tempoCeiling: 0, attempts: 0 })
    expect(out.nextTempo).toBe(80)
    expect(out.ratingBefore).toBe(0)
    expect(out.counted).toBe(false)
    const history = await db.attempts.toArray()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ bleed: true, reliable: false, skillId: SKILL.id, sessionId: session.id })
    expect(history[0].ratingAfter).toBeUndefined()
    expect(out.attempt.id).toBe(history[0].id)
    expect(await db.skillStates.count()).toBe(0)
    expect(await db.milestones.count()).toBe(0)
  })

  it('treats a partial run (begun in the middle, or with the microphone gone for part of it) the same way', async () => {
    const block = exerciseBlock('focus')
    const session = await storedSession([block])
    const partial = result({ perfects: 20, goods: 0, misses: 0, partial: true, playedTempo: 80, targetTempo: 80 })
    const out = await completeExerciseBlock(session, block, exerciseForBlock(block), partial, settings, NOW)
    expect(out.counted).toBe(false)
    expect(out.session).toEqual(session)
    expect(await db.attempts.count()).toBe(1)
    expect(await db.skillStates.count()).toBe(0)
    expect((await loadProfile()).streak).toBe(0)
  })

  it('does not finish an exercise block, adapt the day or start a streak', async () => {
    const warmup = exerciseBlock('warmup')
    const session = await storedSession([warmup, exerciseBlock('focus')])
    // A poor warm-up would slow the rest of the day down, a clean one would keep it: neither may happen here.
    for (const run of [bleed({ perfects: 2, goods: 0, misses: 18 }), bleed()]) {
      const out = await completeExerciseBlock(session, warmup, exerciseForBlock(warmup), run, settings, NOW)
      expect(out.session).toEqual(session)
      expect(out.state?.rating ?? 0).toBe(0)
      expect(out.counted).toBe(false)
    }
    expect(await getSession(session.date)).toEqual(session)
    expect(await db.attempts.count()).toBe(2)
    expect(await db.skillStates.count()).toBe(0)
    expect(await db.milestones.count()).toBe(0)
    const profile = await loadProfile()
    expect(profile.streak).toBe(0)
    expect(profile.lastSessionDate).toBeUndefined()
  })

  it('does not let a finished-early block close on a rep that did not count', async () => {
    const block = exerciseBlock('focus')
    const session = await storedSession([block])
    const rep = await recordExerciseRep(session, block, exerciseForBlock(block), bleed(), settings, NOW)
    const out = await finishExerciseBlock(session, block, rep, NOW)
    expect(out.counted).toBe(false)
    expect(out.session).toEqual(session)
    expect(await getSession(session.date)).toEqual(session)
    expect(await db.skillStates.count()).toBe(0)
  })

  it('leaves the skill exactly as it was when there is earlier progress', async () => {
    const block = exerciseBlock('review')
    const session = await storedSession([block])
    const exercise = exerciseForBlock(block)
    const first = await recordExerciseRep(session, block, exercise, result({ playedTempo: 80, targetTempo: 80 }), settings, NOW)
    expect(first.counted).toBe(true)
    // Due for review and one clean run away from a later date: a bleed run must not move the date.
    const before = { ...first.state, rating: 80, nextReviewAt: NOW - 1, intervalDays: 3 }
    await db.skillStates.put(before)
    const out = await completeExerciseBlock(session, block, exercise, bleed({ playedTempo: 200, targetTempo: 200 }), settings, NOW + 60_000)
    expect(out.counted).toBe(false)
    expect(out.ratingBefore).toBe(80)
    expect(out.state).toEqual(before)
    expect(await db.skillStates.get(SKILL.id)).toEqual(before)
  })

  it('does not raise the tempo ceiling later, from the history', async () => {
    const block = exerciseBlock('focus')
    const session = await storedSession([block])
    const exercise = exerciseForBlock(block)
    await recordExerciseRep(session, block, exercise, bleed({ playedTempo: 200, targetTempo: 200 }), settings, NOW)
    const out = await recordExerciseRep(session, block, exercise, result({ playedTempo: 80, targetTempo: 80 }), settings, NOW + 60_000)
    expect(out.counted).toBe(true)
    expect(out.state.tempoCeiling).toBe(80)
    expect(out.state.attempts).toBe(1)
  })

  it('does not count a lesson drill', async () => {
    const block = exerciseBlock('focus')
    const out = await recordLessonDrill(SKILL.id, exerciseForBlock(block), bleed({ playedTempo: 80, targetTempo: 80 }), settings, NOW)
    expect(out.counted).toBe(false)
    expect(await db.attempts.count()).toBe(1)
    expect(await db.skillStates.count()).toBe(0)
    expect(await db.milestones.count()).toBe(0)
  })

  it('does not count a song play or finish a song block', async () => {
    const song = await storedDemoSong()
    const free = await recordSongPlay(song, 0, bleed(), settings, NOW)
    expect(free.songItem.bestAccuracy).toBeNull()
    expect(free.songItem.nextReviewAt).toBeUndefined()
    expect(free.counted).toBe(false)

    const block: SongBlock = { id: 'b-song', kind: 'song', status: 'pending', minutes: 5, songId: song.id, level: 0, speed: 1, reason: 'test' }
    const session = await storedSession([block])
    const out = await completeSongBlock(session, block, song, bleed(), settings, NOW)
    expect(out.counted).toBe(false)
    expect(out.session).toEqual(session)
    expect(await getSession(session.date)).toEqual(session)

    const history = await db.attempts.toArray()
    expect(history.map((a) => a.bleed)).toEqual([true, true])
    expect(await db.songItems.count()).toBe(0)
    expect(await db.milestones.count()).toBe(0)
    expect((await loadProfile()).streak).toBe(0)
  })

  it('keeps a song item as it was when there is earlier progress', async () => {
    const song = await storedDemoSong()
    const first = await recordSongPlay(song, 0, result({ perfects: 10, goods: 0, misses: 10 }), settings, NOW)
    expect(first.counted).toBe(true)
    const out = await recordSongPlay(song, 0, bleed({ perBar: [0, 0] }), settings, NOW + 60_000)
    expect(out.counted).toBe(false)
    expect(out.songItem).toEqual(first.songItem)
    expect(await db.songItems.toArray()).toEqual([first.songItem])
  })

  it('leaves a skill check alone: bleed tasks are stored as attempts but judge nothing', async () => {
    const task = (id: string, skill = SKILL): TestTask => ({
      id,
      title: id,
      instructions: '',
      skillIds: [skill.id],
      generatorId: skill.generators[0],
      params: exerciseParams(skill, skill.generators[0], 80),
      difficulty: 20,
      passCriteria: { minAccuracy: 0.8, maxMedianMs: 60, maxStdevMs: 60 },
    })
    const tasks = [task('t1'), task('t2', OTHER_SKILL)]
    const heardItself = { taskId: 't1', attempt: attemptForTask(tasks[0], bleed(), settings, NOW), passed: true }
    const played = { taskId: 't2', attempt: attemptForTask(tasks[1], result(), settings, NOW), passed: true }

    const record = await finishTest('checkpoint', tasks, [heardItself, played], NOW)
    expect(record.results.map((r) => r.taskId)).toEqual(['t2'])
    const model = await loadLearnerModel()
    expect(model.skills[SKILL.id]).toBeUndefined()
    expect(model.skills[OTHER_SKILL.id].rating).toBeGreaterThan(0)
    expect((await db.attempts.toArray()).map((a) => !!a.bleed).sort()).toEqual([false, true])

    // Nothing but bleed: there is no check to save.
    await resetTrainingData()
    await expect(finishTest('checkpoint', tasks, [heardItself], NOW)).rejects.toThrow()
    expect(await listTests()).toHaveLength(0)
    expect(await db.skillStates.count()).toBe(0)
    expect(await db.milestones.count()).toBe(0)
    expect((await loadProfile()).lastCheckpointAt).toBeUndefined()
    expect(await db.attempts.count()).toBe(1)
  })

  it('still counts a run that was only hard to hear', async () => {
    const block = exerciseBlock('focus')
    const session = await storedSession([block])
    const out = await completeExerciseBlock(session, block, exerciseForBlock(block), result({ coverage: 0.3, playedTempo: 80, targetTempo: 80 }), settings, NOW)
    expect(out.counted).toBe(true)
    expect(out.performance.reliable).toBe(false)
    expect(out.state?.rating).toBeGreaterThan(0)
    expect(out.session.completedBlockIds).toEqual([block.id])
  })
})

describe('First steps course: there is always a lesson to start', () => {
  const ids = COURSE.map((l) => l.id)
  const setup: FirstStepsSetup = { experience: 'new', handedness: 'right', guitarType: 'acoustic', dailyMinutes: 10 }
  /** What Today shows: the course screen while the course is running. */
  const courseRunning = async () => {
    const p = await loadProfile()
    return !!p.firstStepsStartedAt && !p.firstStepsDoneAt
  }
  const finishWholeCourse = async () => {
    for (const id of ids) await finishLesson(id)
  }

  beforeEach(async () => {
    await resetTrainingData()
    await db.lessons.clear()
  })

  it('starts the course again after a graduate resets and says they never played', async () => {
    await startFirstSteps(setup)
    await finishWholeCourse()
    expect(await courseRunning()).toBe(false)

    await resetTrainingData()
    await startFirstSteps(setup)
    expect(await courseRunning()).toBe(true)
    expect(nextAvailableLesson(await courseProgress())?.id).toBe(ids[0])
  })

  it('starts at lesson 1 when every lesson is still marked done from before a reset', async () => {
    // What an earlier reset left behind: no profile, ten finished lessons.
    await db.lessons.bulkPut(ids.map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    await startFirstSteps(setup)
    expect(await courseRunning()).toBe(true)
    const rows = await courseProgress()
    expect(nextAvailableLesson(rows)?.id).toBe(ids[0])
    expect(rows.filter((r) => r.status === 'done')).toHaveLength(0)
  })

  it('keeps lesson progress made before the wizard was answered', async () => {
    await initialiseCourse(ids)
    await finishLesson(ids[0])
    await startFirstSteps(setup)
    const rows = await courseProgress()
    expect(rows.find((r) => r.id === ids[0])?.status).toBe('done')
    expect(nextAvailableLesson(rows)?.id).toBe(ids[1])
  })

  it('leaves a graduate who runs the wizard again on the daily plan', async () => {
    await startFirstSteps(setup)
    await finishWholeCourse()
    await startFirstSteps(setup)
    expect(await courseRunning()).toBe(false)
    expect((await courseProgress()).every((r) => r.status === 'done')).toBe(true)
  })

  it('has a lesson ready even if setup stops while the songs are being installed', async () => {
    vi.mocked(installBuiltInSongs).mockRejectedValueOnce(new Error('app closed'))
    await expect(startFirstSteps(setup)).rejects.toThrow('app closed')
    expect(await courseRunning()).toBe(true)
    expect(nextAvailableLesson(await courseProgress())?.id).toBe(ids[0])
  })

  it('skipping the course ends it', async () => {
    await startFirstSteps(setup)
    await completeFirstSteps()
    expect(await courseRunning()).toBe(false)
  })

  it('never leaves the course running with nothing to start, whatever order things happen in', async () => {
    const lessonReady = async () => !(await courseRunning()) || !!nextAvailableLesson(await courseProgress())
    const answers = ['new', 'some', 'played'] as const
    for (const first of answers) {
      for (const second of answers) {
        for (const lessonsDone of [0, 3, ids.length]) {
          for (const skip of [false, true]) {
            const story = `${first}, ${lessonsDone} lessons${skip ? ', skip' : ''}, then ${second}`
            await resetTrainingData()
            await startFirstSteps({ ...setup, experience: first })
            expect(await lessonReady(), story).toBe(true)
            // Someone who has played before can still open the lessons from the menu.
            await initialiseCourse(ids)
            for (const id of ids.slice(0, lessonsDone)) await finishLesson(id)
            expect(await lessonReady(), story).toBe(true)
            if (skip) await completeFirstSteps()
            await startFirstSteps({ ...setup, experience: second })
            expect(await lessonReady(), story).toBe(true)

            const backup = await exportTrainingData()
            await resetTrainingData()
            await importTrainingData(backup)
            expect(await lessonReady(), `${story}, backup restored`).toBe(true)
            const { lessons: _lessons, ...older } = JSON.parse(backup) as Record<string, unknown>
            await importTrainingData(JSON.stringify(older))
            expect(await lessonReady(), `${story}, older backup restored`).toBe(true)
          }
        }
      }
    }
  })
})
