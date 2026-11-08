import { describe, expect, it } from 'vitest'
import { detectPlateau, nextIntervention } from './plateau'
import type { Attempt, SkillState } from './types'

const DAY = 86_400_000

function attempt(day: number, ratingAfter?: number): Attempt {
  return {
    at: day * DAY, kind: 'practice', skillId: 's', perfects: 0, goods: 0, misses: 0, total: 0, timingMedianMs: null, timingStdevMs: null,
    coverage: 1, durationSec: 30, playedTempo: 80, targetTempo: 80, speed: 1, difficulty: 40, performance: 0.8, accuracy: 0.8,
    reliable: true, ratingAfter,
  }
}

const state = (plateauStep: number): SkillState => ({
  skillId: 's', rating: 40, confidence: 1, tempoCeiling: 0, ease: 2.3, intervalDays: 0, plateauStep, attempts: 0,
})

describe('detectPlateau', () => {
  it('flags a flat series', () => {
    const a = Array.from({ length: 10 }, (_, i) => attempt(i * 2, 50 + (i % 2) * 0.2))
    const r = detectPlateau(a, 20 * DAY)
    expect(r.plateau).toBe(true)
    expect(r.count).toBe(10)
    expect(r.days).toBe(18)
    expect(Math.abs(r.slopePerDay)).toBeLessThan(0.3)
  })
  it('does not flag a rising series', () => {
    const a = Array.from({ length: 10 }, (_, i) => attempt(i * 2, 30 + i * 2))
    const r = detectPlateau(a, 20 * DAY)
    expect(r.plateau).toBe(false)
    expect(r.slopePerDay).toBeCloseTo(1, 5)
  })
  it('needs enough attempts, span and a low rating, ignoring attempts without ratingAfter', () => {
    expect(detectPlateau(Array.from({ length: 5 }, (_, i) => attempt(i * 5, 50)), 0).plateau).toBe(false)
    expect(detectPlateau(Array.from({ length: 10 }, (_, i) => attempt(i, 50)), 0).plateau).toBe(false)
    expect(detectPlateau(Array.from({ length: 10 }, (_, i) => attempt(i * 2, 80)), 0).plateau).toBe(false)
    const mixed = Array.from({ length: 10 }, (_, i) => attempt(i * 2, i < 5 ? undefined : 50))
    expect(detectPlateau(mixed, 0).count).toBe(5)
    expect(detectPlateau([], 0).plateau).toBe(false)
  })
})

describe('nextIntervention', () => {
  it('walks 1 -> 2 -> 3 -> 4 -> null', () => {
    expect([0, 1, 2, 3].map((s) => nextIntervention(state(s))?.step)).toEqual([1, 2, 3, 4])
    expect(nextIntervention(state(4))).toBeNull()
  })
  it('describes each step', () => {
    expect(nextIntervention(state(0))).toMatchObject({ tempoFactor: 0.8, repsMultiplier: 2 })
    expect(nextIntervention(state(1))?.switchVariant).toBe(true)
    expect(nextIntervention(state(2))?.prerequisiteSessions).toBe(3)
  })
})
