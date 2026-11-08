import { describe, expect, it } from 'vitest'
import { applySongAttempt, dueReviews, newSongItem, nextReview, songItemKey, startReview } from './review'
import { newSkillState } from './learner'
import type { Attempt, LearnerModel } from './types'

const DAY = 86400000
const NOW = 1_700_000_000_000

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    perfects: 9, goods: 0, misses: 1, total: 10, timingMedianMs: 0, timingStdevMs: 10, coverage: 1, durationSec: 60,
    playedTempo: 100, targetTempo: 100, speed: 1, at: NOW, kind: 'song', difficulty: 50, performance: 0.9, accuracy: 0.9, reliable: true,
    ...over,
  }
}

describe('review scheduling', () => {
  it('starts with a 2 day interval', () => {
    expect(startReview(NOW)).toEqual({ ease: 2.3, intervalDays: 2, nextReviewAt: NOW + 2 * DAY })
  })

  it('grows intervals 2 -> 5 -> 12 on passes', () => {
    const a = nextReview({ ease: 2.3, intervalDays: 2 }, 0.9, NOW)
    expect(a.intervalDays).toBe(5)
    expect(a.ease).toBeCloseTo(2.35, 10)
    const b = nextReview(a, 0.9, NOW)
    expect(b.intervalDays).toBe(12)
    expect(b.nextReviewAt).toBe(NOW + 12 * DAY)
  })

  it('caps ease at 2.8', () => {
    expect(nextReview({ ease: 2.8, intervalDays: 10 }, 1, NOW).ease).toBe(2.8)
  })

  it('holds with x1.2 on 0.7 <= p < 0.85', () => {
    const r = nextReview({ ease: 2.3, intervalDays: 10 }, 0.7, NOW)
    expect(r.intervalDays).toBe(12)
    expect(r.ease).toBe(2.3)
  })

  it('resets on p < 0.7 and lowers ease to a floor of 1.3', () => {
    const r = nextReview({ ease: 2.3, intervalDays: 12 }, 0.69, NOW)
    expect(r.intervalDays).toBe(1)
    expect(r.ease).toBeCloseTo(2.1, 10)
    expect(nextReview({ ease: 1.35, intervalDays: 3 }, 0, NOW).ease).toBe(1.3)
  })
})

describe('song items', () => {
  it('builds keys and fresh items', () => {
    expect(songItemKey(7, 3)).toBe('7:3')
    expect(newSongItem(7, 3)).toMatchObject({ key: '7:3', songId: 7, level: 3, bestAccuracy: null, lastAt: null, weakBars: [] })
  })

  it('tracks best accuracy, last time and weak bars without mutating', () => {
    const item = newSongItem(1, 1)
    const out = applySongAttempt(item, attempt({ accuracy: 0.6, perBar: [0.9, 0.5, 0.7, 0.69] }))
    expect(out.bestAccuracy).toBe(0.6)
    expect(out.weakBars).toEqual([1, 3])
    expect(out.nextReviewAt).toBeUndefined()
    expect(item.bestAccuracy).toBeNull()
    const again = applySongAttempt(out, attempt({ accuracy: 0.5 }))
    expect(again.bestAccuracy).toBe(0.6)
    expect(again.weakBars).toEqual([])
  })

  it('starts a review at accuracy >= 0.9 and speed >= 1, then advances it', () => {
    const slow = applySongAttempt(newSongItem(1, 1), attempt({ speed: 0.9 }))
    expect(slow.nextReviewAt).toBeUndefined()
    const started = applySongAttempt(newSongItem(1, 1), attempt())
    expect(started.intervalDays).toBe(2)
    expect(started.nextReviewAt).toBe(NOW + 2 * DAY)
    const next = applySongAttempt(started, attempt({ at: NOW + 2 * DAY, performance: 0.9 }))
    expect(next.intervalDays).toBe(5)
    const failed = applySongAttempt(next, attempt({ at: NOW + 7 * DAY, performance: 0.5, accuracy: 0.5 }))
    expect(failed.intervalDays).toBe(1)
  })
})

describe('dueReviews', () => {
  it('returns due items, most overdue first', () => {
    const model: LearnerModel = {
      skills: {
        a: { ...newSkillState('a'), nextReviewAt: NOW - DAY },
        b: { ...newSkillState('b'), nextReviewAt: NOW - 3 * DAY },
        c: { ...newSkillState('c'), nextReviewAt: NOW + DAY },
        d: newSkillState('d'),
        e: { ...newSkillState('e'), nextReviewAt: NOW },
      },
      songItems: {
        '1:1': { ...newSongItem(1, 1), nextReviewAt: NOW - 2 * DAY },
        '2:1': { ...newSongItem(2, 1), nextReviewAt: NOW - 5 * DAY },
        '3:1': { ...newSongItem(3, 1), nextReviewAt: NOW + 1 },
      },
      profile: { id: 1, goals: [], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 },
    }
    expect(dueReviews(model, NOW)).toEqual({ skillIds: ['b', 'a', 'e'], songItemKeys: ['2:1', '1:1'] })
  })
})
