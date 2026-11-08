import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { createDemoSong } from '../features/library/demoSong'
import { completeExerciseBlock, completeSongBlock, exerciseForBlock, getOrCreateTodaySession, recordSongPlay, songSummaries } from './coach'
import { loadLearnerModel, loadProfile, resetTrainingData } from './store'
import type { AttemptResult, ExerciseBlock, SongBlock } from './types'

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

  it('plans practice blocks once placement is done, and completing a block updates everything', async () => {
    const profile = await loadProfile()
    await db.profile.put({ ...profile, placementDoneAt: Date.now() - 86_400_000 })
    const song = createDemoSong()
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
    expect(outcome.session.minutesDone).toBe(focus.minutes)

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

  it('records free song plays outside a session', async () => {
    const song = createDemoSong()
    const { audio, ...rest } = song
    const id = await db.songs.add({ ...rest, audioData: await audio.arrayBuffer(), createdAt: 1, updatedAt: 1, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0 })
    const stored = (await db.songs.get(id))!
    const { songItem, attempt } = await recordSongPlay(stored, 2, result({ perfects: 10, goods: 5, misses: 5 }), settings)
    expect(attempt.kind).toBe('song')
    expect(songItem.key).toBe(`${id}:2`)
    expect(songItem.bestAccuracy).toBeCloseTo((10 + 0.8 * 5) / 20, 6)
  })
})
