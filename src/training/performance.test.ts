import { describe, expect, it } from 'vitest'
import { attemptPerformance } from './performance'
import type { AttemptResult } from './types'

function result(over: Partial<AttemptResult> = {}): AttemptResult {
  return {
    perfects: 10,
    goods: 0,
    misses: 0,
    total: 10,
    timingMedianMs: 0,
    timingStdevMs: 0,
    coverage: 1,
    durationSec: 10,
    playedTempo: 110,
    targetTempo: 100,
    speed: 1,
    ...over,
  }
}

describe('attemptPerformance', () => {
  it('gives p = 1 for a perfect clean run at the target tempo', () => {
    const p = attemptPerformance(result())
    expect(p.acc).toBe(1)
    expect(p.tim).toBe(1)
    expect(p.tmp).toBeCloseTo(1, 10)
    expect(p.p).toBeCloseTo(1, 10)
    expect(p.reliable).toBe(true)
    expect(p.reasons).toEqual([])
  })

  it('weights goods at 0.8 and handles total = 0', () => {
    expect(attemptPerformance(result({ perfects: 5, goods: 5 })).acc).toBeCloseTo(0.9, 10)
    expect(attemptPerformance(result({ perfects: 0, goods: 0, misses: 0, total: 0 })).acc).toBe(0)
  })

  it('computes timing from stdev and falls back to acc', () => {
    expect(attemptPerformance(result({ timingStdevMs: 40 })).tim).toBeCloseTo(0.5, 10)
    expect(attemptPerformance(result({ timingStdevMs: 200 })).tim).toBe(0)
    expect(attemptPerformance(result({ timingStdevMs: null, perfects: 8, misses: 2 })).tim).toBeCloseTo(0.8, 10)
    expect(attemptPerformance(result({ perfects: 6, goods: 1, misses: 3, total: 10, timingStdevMs: 10 })).tim).toBeCloseTo(0.68, 10)
  })

  it('clamps the tempo factor', () => {
    expect(attemptPerformance(result({ playedTempo: 100 })).tmp).toBeCloseTo(1, 10)
    expect(attemptPerformance(result({ playedTempo: 10 })).tmp).toBeCloseTo(0.5, 10)
    expect(attemptPerformance(result({ playedTempo: 300 })).tmp).toBeCloseTo(1, 10)
    expect(attemptPerformance(result({ targetTempo: 0 })).tmp).toBe(1)
  })

  it('combines with the 0.6 / 0.25 / 0.15 weights', () => {
    const p = attemptPerformance(result({ perfects: 8, misses: 2, timingStdevMs: 40, playedTempo: 100 }))
    expect(p.p).toBeCloseTo(0.6 * 0.8 + 0.25 * 0.5 + 0.15 * 1, 10)
  })

  it('flags unreliable evidence', () => {
    expect(attemptPerformance(result({ coverage: 0.5 })).reasons).toEqual(['low coverage'])
    expect(attemptPerformance(result(), { isTest: true, calibrationAgeDays: null }).reasons).toEqual(['calibration stale'])
    expect(attemptPerformance(result(), { isTest: true, calibrationAgeDays: 31 }).reliable).toBe(false)
    expect(attemptPerformance(result(), { isTest: true, calibrationAgeDays: 30 }).reliable).toBe(true)
    expect(attemptPerformance(result(), { calibrationAgeDays: null }).reliable).toBe(true)
    expect(attemptPerformance(result(), { sessionTimingBiasMs: -45 }).reasons).toEqual(['timing bias'])
    expect(attemptPerformance(result(), { sessionTimingBiasMs: 40 }).reliable).toBe(true)
    expect(attemptPerformance(result({ bleed: true })).reasons).toEqual(['speaker bleed'])
    expect(attemptPerformance(result({ bleed: true })).reliable).toBe(false)
    const all = attemptPerformance(result({ coverage: 0.1 }), { isTest: true, sessionTimingBiasMs: 60 })
    expect(all.reasons).toEqual(['low coverage', 'calibration stale', 'timing bias'])
  })
})
