import { describe, expect, it } from 'vitest'
import { earAttemptResult, earSummary, feedbackText, judgeCents, judgePrompt, stablePitch } from './earTrainer'

describe('judgeCents', () => {
  it('folds to the nearest octave', () => {
    const r = judgeCents(64.2, 52)
    expect(r.octaves).toBe(1)
    expect(r.cents).toBeCloseTo(20, 5)
    const low = judgeCents(40.1, 52)
    expect(low.octaves).toBe(-1)
    expect(low.cents).toBeCloseTo(10, 5)
    expect(judgeCents(52, 52)).toEqual({ cents: 0, octaves: 0 })
  })
})

describe('judgePrompt', () => {
  it('categorises', () => {
    expect(judgePrompt(null, 52)).toBe('miss')
    expect(judgePrompt(52.2, 52)).toBe('perfect')
    expect(judgePrompt(51.6, 52)).toBe('good')
    expect(judgePrompt(52.8, 52)).toBe('miss')
    expect(judgePrompt(64.1, 52)).toBe('good')
    expect(judgePrompt(64.4, 52)).toBe('miss')
    expect(judgePrompt(39.9, 52)).toBe('good')
  })
})

describe('stablePitch', () => {
  it('needs four agreeing values', () => {
    expect(stablePitch([52, 52, 52])).toBeNull()
    expect(stablePitch([50, 52, 52.1, 51.9, 52])).toBeCloseTo(52, 1)
    expect(stablePitch([52, 52.5, 52, 52])).toBeNull()
    expect(stablePitch([60, 52, 52.1, 52.05, 51.95])).not.toBeNull()
  })
})

describe('earAttemptResult / earSummary', () => {
  const js = ['perfect', 'good', 'miss', 'perfect'] as const
  it('counts and coverage', () => {
    const r = earAttemptResult([...js], { durationSec: 30, tempo: 60, heard: 3 })
    expect([r.perfects, r.goods, r.misses, r.total]).toEqual([2, 1, 1, 4])
    expect(r.coverage).toBeCloseTo(0.75)
    expect(r.timingMedianMs).toBeNull()
    expect(r.playedTempo).toBe(60)
    expect(r.speed).toBe(1)
    expect(earAttemptResult([], { durationSec: 0, tempo: 60, heard: 0 }).coverage).toBe(1)
  })
  it('summary accuracy and streak', () => {
    const r = earAttemptResult([...js], { durationSec: 30, tempo: 60, heard: 3 })
    const s = earSummary(r, [...js])
    expect(s.score).toBe(250)
    expect(s.accuracy).toBeCloseTo((2 + 0.8) / 4)
    expect(s.maxStreak).toBe(2)
    expect(earSummary(earAttemptResult([], { durationSec: 0, tempo: 60, heard: 0 })).accuracy).toBe(0)
  })
})

describe('feedbackText', () => {
  it('describes', () => {
    expect(feedbackText(30, 0)).toBe('30 cents sharp')
    expect(feedbackText(-15, 0)).toBe('15 cents flat')
    expect(feedbackText(3, 0)).toBe('spot on')
    expect(feedbackText(10, 1)).toBe('right note, an octave high')
    expect(feedbackText(-5, -1)).toBe('right note, an octave low')
  })
})
