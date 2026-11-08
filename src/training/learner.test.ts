import { describe, expect, it } from 'vitest'
import {
  applyAttempt,
  applyToModel,
  effectiveRating,
  expectedScore,
  masteryBand,
  newSkillState,
  ratingDelta,
  updateTempoCeiling,
} from './learner'
import type { Attempt, LearnerModel, SkillDef } from './types'

const DAY = 86400000
const NOW = 1_700_000_000_000

const skill: SkillDef = {
  id: 'alt-picking', name: 'Alt', category: 'picking', tier: 1, prerequisites: [], refTempo: 80, startTempo: 60, targetTempo: 120,
  description: '', tips: [], generators: ['x'],
}

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    perfects: 10, goods: 0, misses: 0, total: 10, timingMedianMs: 0, timingStdevMs: 0, coverage: 1, durationSec: 10,
    playedTempo: 100, targetTempo: 100, speed: 1, at: NOW, kind: 'practice', difficulty: 50, performance: 1, accuracy: 1, reliable: true,
    ...over,
  }
}

const confident = { ...newSkillState('alt-picking', 50), confidence: 10 }

describe('basics', () => {
  it('creates a fresh state', () => {
    expect(newSkillState('s', 12, NOW)).toEqual({
      skillId: 's', rating: 12, confidence: 0, tempoCeiling: 0, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 0,
    })
  })

  it('maps ratings to bands', () => {
    expect([0, 19.9, 20, 49, 50, 74, 75, 89, 90, 100].map(masteryBand)).toEqual([
      'new', 'new', 'learning', 'learning', 'developing', 'developing', 'solid', 'solid', 'mastered', 'mastered',
    ])
  })

  it('computes expected score', () => {
    expect(expectedScore(50, 50)).toBe(0.5)
    expect(expectedScore(75, 50)).toBeCloseTo(10 / 11, 10)
    expect(expectedScore(50, 75)).toBeCloseTo(1 / 11, 10)
  })
})

describe('effectiveRating (rust)', () => {
  const s = { ...confident, lastPracticedAt: NOW }
  it('is the rating when never practised or within grace', () => {
    expect(effectiveRating(confident, NOW)).toBe(50)
    expect(effectiveRating(s, NOW + 14 * DAY)).toBe(50)
  })
  it('loses 2 points per week after 14 days', () => {
    expect(effectiveRating(s, NOW + 21 * DAY)).toBeCloseTo(48, 10)
    expect(effectiveRating(s, NOW + 28 * DAY)).toBeCloseTo(46, 10)
  })
  it('never loses more than 20 points and never goes below 0', () => {
    expect(effectiveRating(s, NOW + 1000 * DAY)).toBe(30)
    expect(effectiveRating({ ...s, rating: 5 }, NOW + 1000 * DAY)).toBe(0)
  })
})

describe('ratingDelta', () => {
  it('is K·(p − E)·gain', () => {
    expect(ratingDelta(confident, attempt())).toBeCloseTo(6, 10)
    expect(ratingDelta(confident, attempt({ performance: 0 }))).toBeCloseTo(-6, 10)
  })
  it('doubles for tests', () => {
    expect(ratingDelta(confident, attempt({ kind: 'test' }))).toBeCloseTo(2 * ratingDelta(confident, attempt()), 10)
  })
  it('is x1.5 while confidence is low and /3 when unreliable', () => {
    expect(ratingDelta(newSkillState('s', 50), attempt())).toBeCloseTo(9, 10)
    expect(ratingDelta(confident, attempt({ reliable: false }))).toBeCloseTo(2, 10)
  })
})

describe('applyAttempt', () => {
  it('raises about 30 points over 10 perfect attempts at d = 50', () => {
    let s = confident
    for (let i = 0; i < 10; i++) s = applyAttempt(s, attempt({ at: NOW + i * 1000 }), skill)
    expect(s.rating - 50).toBeGreaterThan(25)
    expect(s.rating - 50).toBeLessThan(35)
    expect(s.attempts).toBe(10)
  })

  it('does not mutate and updates timestamps', () => {
    const out = applyAttempt(confident, attempt({ kind: 'test' }), skill)
    expect(confident.attempts).toBe(0)
    expect(out.lastPracticedAt).toBe(NOW)
    expect(out.lastTestedAt).toBe(NOW)
    expect(applyAttempt(confident, attempt(), skill).lastTestedAt).toBeUndefined()
  })

  it('clamps to 0..100', () => {
    expect(applyAttempt({ ...confident, rating: 99.5 }, attempt({ difficulty: 99.5 }), skill).rating).toBe(100)
    expect(applyAttempt({ ...confident, rating: 0.5 }, attempt({ performance: 0, difficulty: 0.5 }), skill).rating).toBe(0)
  })

  it('caps provisional skills at 75', () => {
    const out = applyAttempt({ ...confident, rating: 74.9 }, attempt({ difficulty: 74.9 }), { ...skill, provisional: true })
    expect(out.rating).toBe(75)
  })

  it('does not cap provisional skills after a chroma-scored attempt', () => {
    const start = { ...confident, rating: 74.9 }
    const pitch = applyAttempt(start, attempt({ difficulty: 74.9, chordScoring: 'pitch' }), { ...skill, provisional: true })
    const chroma = applyAttempt(start, attempt({ difficulty: 74.9, chordScoring: 'chroma' }), { ...skill, provisional: true })
    expect(pitch.rating).toBe(75)
    expect(chroma.rating).toBeGreaterThan(75)
  })

  it('updates confidence incrementally with recency decay', () => {
    const first = applyAttempt(newSkillState('s', 0), attempt(), skill)
    expect(first.confidence).toBe(1)
    const later = applyAttempt(first, attempt({ at: NOW + 30 * DAY }), skill)
    expect(later.confidence).toBeCloseTo(Math.exp(-1) + 1, 10)
  })

  it('sets the tempo ceiling from recent attempts', () => {
    const out = applyAttempt(confident, attempt({ playedTempo: 120 }), skill, [attempt({ playedTempo: 90, at: NOW - DAY })])
    expect(out.tempoCeiling).toBe(120)
  })
})

describe('updateTempoCeiling', () => {
  it('picks the highest tempo with >= 85% accuracy', () => {
    const list = [
      attempt({ playedTempo: 80, accuracy: 0.9 }),
      attempt({ playedTempo: 100, accuracy: 0.85 }),
      attempt({ playedTempo: 120, accuracy: 0.84 }),
    ]
    expect(updateTempoCeiling(list, NOW)).toBe(100)
  })
  it('falls back to 0.8 x the minimum tempo, and 0 when empty', () => {
    const list = [attempt({ playedTempo: 100, accuracy: 0.5 }), attempt({ playedTempo: 70, accuracy: 0.6 })]
    expect(updateTempoCeiling(list, NOW)).toBeCloseTo(56, 10)
    expect(updateTempoCeiling([], NOW)).toBe(0)
  })
  it('ignores attempts older than 30 days and keeps only the 10 most recent', () => {
    expect(updateTempoCeiling([attempt({ playedTempo: 200, at: NOW - 31 * DAY })], NOW)).toBe(0)
    const old = attempt({ playedTempo: 200, accuracy: 0.95, at: NOW - 20 * DAY })
    const recent = Array.from({ length: 10 }, (_, i) => attempt({ playedTempo: 80, accuracy: 0.9, at: NOW - i * 1000 }))
    expect(updateTempoCeiling([old, ...recent], NOW)).toBe(80)
  })
})

describe('applyToModel', () => {
  it('creates missing state without mutating the input', () => {
    const model: LearnerModel = {
      skills: {},
      songItems: {},
      profile: { id: 1, goals: [], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 },
    }
    const out = applyToModel(model, attempt(), skill)
    expect(model.skills).toEqual({})
    expect(out.skills['alt-picking'].attempts).toBe(1)
    expect(out.skills['alt-picking'].rating).toBeGreaterThan(0)
    expect(out.songItems).toBe(model.songItems)
  })
})
