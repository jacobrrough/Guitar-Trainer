import { describe, expect, it } from 'vitest'
import { estimateTempo } from './tempo-estimate'

describe('estimateTempo', () => {
  it('recovers tempo and downbeat phase from accented onsets with jitter', () => {
    const bpm = 128
    const period = 60 / bpm
    const offset = 0.37
    const onsets: { time: number; weight: number }[] = []
    let seed = 7
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 64; i++) {
      const jitter = (rand() - 0.5) * 0.02
      onsets.push({ time: offset + i * period + jitter, weight: i % 4 === 0 ? 1.5 : 0.8 })
      if (i % 2 === 1) onsets.push({ time: offset + (i + 0.5) * period + jitter, weight: 0.3 })
    }
    const duration = offset + 64 * period + 1
    const est = estimateTempo(onsets, duration)
    expect(Math.abs(est.bpm - bpm)).toBeLessThan(2)
    const phaseError = ((est.downbeat - offset) % (period * 4)) / period
    const nearest = Math.min(Math.abs(phaseError), Math.abs(4 - Math.abs(phaseError)))
    expect(nearest).toBeLessThan(0.12)
    expect(est.beatsPerBar).toBe(4)
  })

  it('falls back gracefully with too few onsets', () => {
    const est = estimateTempo([{ time: 1, weight: 1 }], 10)
    expect(est.bpm).toBe(120)
    expect(est.confidence).toBe(0)
  })
})
