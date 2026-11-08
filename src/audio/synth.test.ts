import { describe, expect, it } from 'vitest'
import { constantBeatGrid } from '../chart/timing'
import type { Chart } from '../chart/types'
import { midiToFreq } from '../music/pitch'
import { applyGainLimited, guitarBody, loudnessGain, pluck, renderChartBacking } from './synth'

const SR = 44100

function render(freq: number, seconds: number, options?: Parameters<typeof pluck>[7]): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  pluck(out, 0, freq, seconds, 0.5, 42, SR, options)
  return out
}

/** Fundamental period by autocorrelation around the expected lag, refined with a parabola. */
function estimateFreq(samples: Float32Array, from: number, expected: number): number {
  const start = Math.round(from * SR)
  const len = Math.round(0.6 * SR)
  const lag0 = SR / expected
  let bestLag = 0
  let best = -Infinity
  const r = (lag: number) => {
    let s = 0
    for (let i = start; i < start + len; i++) s += samples[i] * samples[i + lag]
    return s
  }
  const lo = Math.floor(lag0 * 0.95)
  const hi = Math.ceil(lag0 * 1.05)
  const values = new Map<number, number>()
  for (let lag = lo; lag <= hi; lag++) {
    const v = r(lag)
    values.set(lag, v)
    if (v > best) {
      best = v
      bestLag = lag
    }
  }
  const a = values.get(bestLag - 1) ?? r(bestLag - 1)
  const c = values.get(bestLag + 1) ?? r(bestLag + 1)
  const denom = a - 2 * best + c
  const refined = denom !== 0 ? bestLag + (0.5 * (a - c)) / denom : bestLag
  return SR / refined
}

function rms(samples: Float32Array, from: number, seconds: number): number {
  const start = Math.round(from * SR)
  const n = Math.round(seconds * SR)
  let e = 0
  for (let i = start; i < start + n; i++) e += samples[i] * samples[i]
  return Math.sqrt(e / n)
}

function zeroCrossings(samples: Float32Array, from: number, seconds: number): number {
  const start = Math.round(from * SR)
  const n = Math.round(seconds * SR)
  let z = 0
  for (let i = start + 1; i < start + n; i++) if (samples[i - 1] < 0 !== samples[i] < 0) z++
  return z
}

describe('pluck', () => {
  it('is in tune across the fretboard (fractional delay, not whole samples)', () => {
    for (const midi of [40, 45, 52, 59, 64, 76, 88]) {
      const f = midiToFreq(midi)
      const got = estimateFreq(render(f, 1.4), 0.3, f)
      const cents = 1200 * Math.log2(got / f)
      expect(Math.abs(cents), `midi ${midi}`).toBeLessThan(4)
    }
  })

  it('decays like a string: low notes ring longer than high ones', () => {
    const low = render(midiToFreq(40), 3)
    const high = render(midiToFreq(76), 3)
    const lowRatio = rms(low, 2, 0.2) / rms(low, 0.1, 0.2)
    const highRatio = rms(high, 2, 0.2) / rms(high, 0.1, 0.2)
    expect(lowRatio).toBeLessThan(1)
    expect(highRatio).toBeLessThan(lowRatio)
    expect(lowRatio).toBeGreaterThan(0.08)
  })

  it('is brighter and louder when struck harder', () => {
    const soft = render(midiToFreq(52), 1, { velocity: 0.25 })
    const hard = render(midiToFreq(52), 1, { velocity: 1 })
    expect(zeroCrossings(hard, 0.02, 0.1)).toBeGreaterThan(zeroCrossings(soft, 0.02, 0.1))
    expect(rms(hard, 0.02, 0.1)).toBeGreaterThan(rms(soft, 0.02, 0.1))
  })

  it('is deterministic for the same seed and bounded', () => {
    const a = render(220, 1)
    const b = render(220, 1)
    expect(a).toEqual(b)
    let peak = 0
    for (const v of a) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(0.5)
    expect(peak).toBeGreaterThan(0.1)
  })

  it('fades out at the end instead of cutting', () => {
    const out = render(220, 0.5)
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.01)
  })
})

describe('guitarBody', () => {
  const tone = (freq: number) => {
    const out = new Float32Array(SR)
    for (let i = 0; i < out.length; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / SR)
    return out
  }

  it('lifts the top resonance, thins the lowest fundamentals and rolls off the top', () => {
    const steady = (s: Float32Array) => rms(s, 0.5, 0.4)
    const gain = (f: number) => steady(guitarBody(tone(f), SR)) / 0.3 / Math.SQRT1_2
    expect(gain(210)).toBeGreaterThan(1.1)
    expect(gain(82)).toBeLessThan(0.7)
    expect(gain(82)).toBeGreaterThan(0.2)
    expect(gain(1000)).toBeGreaterThan(0.8)
    expect(gain(1000)).toBeLessThan(1.2)
    expect(gain(9000)).toBeLessThan(0.5)
  })

  it('keeps the length and stays finite', () => {
    const out = guitarBody(render(110, 1), SR)
    expect(out.length).toBe(SR)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
  })
})

describe('loudness', () => {
  it('brings quiet material up and loud material down, within limits', () => {
    const quiet = new Float32Array(SR).map((_, i) => 0.02 * Math.sin(i / 10))
    const loud = new Float32Array(SR).map((_, i) => 0.8 * Math.sin(i / 10))
    expect(loudnessGain(quiet, SR)).toBeGreaterThan(1)
    expect(loudnessGain(loud, SR)).toBeLessThan(1)
    expect(loudnessGain(new Float32Array(SR), SR)).toBe(1)
  })

  it('never lets the peak pass the ceiling', () => {
    const s = applyGainLimited(new Float32Array([0.5, -0.5, 0.1]), 4, 0.95)
    expect(Math.max(...Array.from(s).map(Math.abs))).toBeCloseTo(0.95, 5)
    const t = applyGainLimited(new Float32Array([0.1, -0.1]), 2, 0.95)
    expect(t[0]).toBeCloseTo(0.2, 5)
  })
})

describe('renderChartBacking', () => {
  const beats = constantBeatGrid(120, 0, 4)
  const chart: Chart = {
    title: 'test',
    artist: '',
    tuning: [40, 45, 50, 55, 59, 64],
    capo: 0,
    duration: 4,
    bpm: 120,
    beats,
    notes: [
      { time: 0, duration: 0.5, string: 0, fret: 0, midi: 40, velocity: 0.8, chordId: 0 },
      { time: 0.5, duration: 0.5, string: 0, fret: 3, midi: 43, velocity: 0.8, chordId: 1 },
      { time: 1, duration: 1, string: 1, fret: 0, midi: 45, velocity: 0.8, chordId: 2 },
      { time: 2, duration: 1, string: 2, fret: 2, midi: 52, velocity: 0.9, chordId: 3 },
      { time: 2, duration: 1, string: 3, fret: 2, midi: 57, velocity: 0.9, chordId: 3 },
      { time: 2, duration: 1, string: 4, fret: 0, midi: 59, velocity: 0.9, chordId: 3 },
    ],
    sections: [],
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  } as unknown as Chart

  it('renders strings and click at a consistent level, deterministically', () => {
    const full = renderChartBacking(chart, { seed: 7 })
    const again = renderChartBacking(chart, { seed: 7 })
    const clickOnly = renderChartBacking(chart, { seed: 7, plucks: false })
    expect(again).toEqual(full)
    expect(clickOnly.length).toBe(full.length)
    const peak = (s: Float32Array) => Math.max(...Array.from(s.subarray(0, SR)).map(Math.abs))
    expect(peak(full)).toBeLessThanOrEqual(0.95)
    expect(peak(full)).toBeGreaterThan(0.2)
    // The click track is soft under the strings, and the same when played alone.
    expect(peak(clickOnly)).toBeLessThan(peak(full))
    expect(rms(clickOnly, 0.3, 0.1)).toBeLessThan(rms(full, 0.3, 0.1))
  })

  it('cuts a note when the next one lands on the same string', () => {
    const out = renderChartBacking({ ...chart, notes: chart.notes.slice(0, 2) } as Chart, { seed: 7, click: false })
    // Just before the second note the first (E2, long t60) would still be ringing; after it, only G2 sounds.
    const f = estimateFreq(out, 0.7, midiToFreq(43))
    expect(Math.abs(1200 * Math.log2(f / midiToFreq(43)))).toBeLessThan(10)
  })
})
