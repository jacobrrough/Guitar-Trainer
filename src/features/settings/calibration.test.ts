import { describe, expect, it } from 'vitest'
import { ClickMatcher, calibrationAdvice, createOnsetDetector, noiseFloor, summarise, type LevelFrame } from './calibration'

const HOP = 512 / 48000

interface Burst {
  at: number
  rms: number
  /** Seconds the sound lasts (decaying). */
  length?: number
}

/** Frames at the worklet hop: a steady background level plus decaying bursts. */
function frames(opts: { seconds: number; floor: number; bursts: Burst[] }): LevelFrame[] {
  const out: LevelFrame[] = []
  for (let t = 0; t < opts.seconds; t += HOP) {
    let rms = opts.floor
    for (const b of opts.bursts) {
      const len = b.length ?? 0.05
      if (t >= b.at && t < b.at + len) rms = Math.max(rms, b.rms * Math.exp((-(t - b.at) / len) * 2))
    }
    out.push({ rms, time: t })
  }
  return out
}

function onsets(fs: LevelFrame[], floor: number): number[] {
  const detect = createOnsetDetector({ floor })
  const out: number[] = []
  for (const f of fs) {
    const o = detect(f)
    if (o !== null) out.push(o)
  }
  return out
}

describe('noiseFloor', () => {
  it('is the median of the quiet frames, never below the minimum', () => {
    expect(noiseFloor([])).toBeCloseTo(0.0015)
    expect(noiseFloor(new Array(100).fill(0.0002))).toBeCloseTo(0.0015)
    expect(noiseFloor(new Array(100).fill(0.02))).toBeCloseTo(0.02)
  })

  it('ignores a pluck or two while the player waits for the clicks', () => {
    const waiting = [...new Array(70).fill(0.001), ...new Array(30).fill(0.1)]
    expect(noiseFloor(waiting)).toBeCloseTo(0.0015)
  })
})

describe('createOnsetDetector', () => {
  it('hears a quiet muted strum on a phone mic without gain', () => {
    const fs = frames({ seconds: 1, floor: 0.0008, bursts: [{ at: 0.5, rms: 0.006 }] })
    const got = onsets(fs, 0.001)
    expect(got).toHaveLength(1)
    expect(got[0]).toBeGreaterThan(0.48)
    expect(got[0]).toBeLessThan(0.52)
  })

  it('ignores a level that only wobbles around the floor', () => {
    const fs = frames({ seconds: 1, floor: 0.002, bursts: [] }).map((f, i) => ({ ...f, rms: f.rms * (1 + 0.3 * Math.sin(i)) }))
    expect(onsets(fs, 0.002)).toHaveLength(0)
  })

  it('scales with a noisy room instead of firing on the noise', () => {
    const fs = frames({ seconds: 1, floor: 0.02, bursts: [{ at: 0.5, rms: 0.03 }] }).map((f, i) => ({ ...f, rms: f.rms * (1 + 0.2 * Math.sin(i * 1.7)) }))
    expect(onsets(fs, 0.02)).toHaveLength(0)
    const loud = frames({ seconds: 1, floor: 0.02, bursts: [{ at: 0.5, rms: 0.2 }] })
    expect(onsets(loud, 0.02)).toHaveLength(1)
  })

  it('reports a ringing note once', () => {
    const fs = frames({ seconds: 1, floor: 0.001, bursts: [{ at: 0.3, rms: 0.05, length: 0.4 }] })
    expect(onsets(fs, 0.001)).toHaveLength(1)
  })

  it('hears the next strum after the first has decayed', () => {
    const fs = frames({ seconds: 2, floor: 0.001, bursts: [{ at: 0.3, rms: 0.05 }, { at: 0.9, rms: 0.05 }] })
    const got = onsets(fs, 0.001)
    expect(got).toHaveLength(2)
    expect(got[1] - got[0]).toBeCloseTo(0.6, 1)
  })
})

describe('ClickMatcher', () => {
  const clicks = [1, 1.6, 2.2, 2.8]

  it('keeps the earliest sound in each window, so speaker echo stands in for the strum', () => {
    const m = new ClickMatcher(clicks)
    for (const [i, c] of clicks.entries()) {
      expect(m.onset(c + 0.035)).toBe(i)
      expect(m.onset(c + 0.2)).toBe(-1)
    }
    expect(m.heard).toBe(4)
    for (const o of m.offsets) expect(o).toBeCloseTo(0.035, 6)
  })

  it('matches a strum through headphones whether it is early or late', () => {
    const m = new ClickMatcher(clicks)
    expect(m.onset(clicks[0] - 0.04)).toBe(0)
    expect(m.onset(clicks[1] + 0.3)).toBe(1)
    expect(m.onset(clicks[3] + 0.55)).toBe(-1)
    expect(m.offsets[3]).toBeNull()
    expect(m.heard).toBe(2)
  })

  it('ignores sounds between the windows', () => {
    const m = new ClickMatcher(clicks)
    expect(m.onset(0.2)).toBe(-1)
    expect(m.onset(clicks[0] - 0.3)).toBe(-1)
    expect(m.heard).toBe(0)
  })
})

describe('summarise', () => {
  it('needs at least three hits', () => {
    expect(summarise([0.05, null, 0.06, null, null, null, null, null])).toBeNull()
  })

  it('reports the median, the count and that the timing was steady', () => {
    const s = summarise([0.05, 0.06, 0.055, null, 0.052, 0.3, 0.058, 0.054])
    expect(s).not.toBeNull()
    expect(s?.ms).toBeGreaterThanOrEqual(52)
    expect(s?.ms).toBeLessThanOrEqual(58)
    expect(s?.samples).toBe(7)
    expect(s?.steady).toBe(true)
  })

  it('flags scattered strums as unsteady', () => {
    const s = summarise([0.02, 0.25, 0.4, 0.1, 0.33, -0.05, 0.2, 0.45])
    expect(s?.steady).toBe(false)
    expect(s?.spreadMs).toBeGreaterThan(40)
  })
})

describe('calibrationAdvice', () => {
  it('blames the room when the floor is high', () => {
    expect(calibrationAdvice(1, 8, 0.05)).toMatch(/noisy/i)
  })

  it('asks for louder strums otherwise', () => {
    expect(calibrationAdvice(1, 8, 0.002)).toMatch(/1 of 8/)
  })
})
