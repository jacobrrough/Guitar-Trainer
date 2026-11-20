import { beforeAll, describe, expect, it } from 'vitest'
import { midiToFreq } from '../../music/pitch'
import { GUITAR_PACK, bankNote, buildBank, type SampleBank } from './bank'
import { loadRealBank } from './realBank.testutil'
import { renderSampledNote } from './sampler'

let bank: SampleBank
beforeAll(async () => {
  bank = await loadRealBank()
})

/** Fundamental by normalised autocorrelation near the expected lag, refined with a parabola. */
function estimateFreq(x: Float32Array, sr: number, from: number, expected: number): number {
  const start = Math.round(from * sr)
  const len = Math.round(0.25 * sr)
  const lo = Math.floor(sr / (expected * 1.06))
  const hi = Math.ceil(sr / (expected / 1.06))
  const r = (lag: number) => {
    let s = 0
    for (let i = start; i < start + len; i++) s += x[i] * x[i + lag]
    return s
  }
  let best = -Infinity
  let bestLag = lo
  for (let lag = lo; lag <= hi; lag++) {
    const v = r(lag)
    if (v > best) {
      best = v
      bestLag = lag
    }
  }
  const a = r(bestLag - 1)
  const c = r(bestLag + 1)
  const d = a - 2 * best + c
  return sr / (bestLag + (d !== 0 ? (0.5 * (a - c)) / d : 0))
}

const cents = (f: number, midi: number) => 1200 * Math.log2(f / midiToFreq(midi))

function render(midi: number, seconds: number, sr = 44100, options: Parameters<typeof renderSampledNote>[7] = {}, lead = 0.1): Float32Array {
  const out = new Float32Array(Math.round((seconds + lead + 0.2) * sr))
  renderSampledNote(out, Math.round(lead * sr), bank, midi, seconds, 0.5, sr, options)
  return out
}

function firstAbove(x: Float32Array, fraction: number): number {
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= fraction * peak) return i
  return -1
}

describe('sample pack', () => {
  it('holds every semitone from D2 to D5, in tune and with a usable length', () => {
    expect(GUITAR_PACK.notes).toHaveLength(37)
    expect(GUITAR_PACK.notes[0].midi).toBe(38)
    expect(GUITAR_PACK.notes[36].midi).toBe(74)
    for (const n of GUITAR_PACK.notes) {
      expect(Math.abs(n.cents), `midi ${n.midi}`).toBeLessThan(8)
      expect(n.length, `midi ${n.midi}`).toBeGreaterThanOrEqual(1.2)
      expect(n.peak, `midi ${n.midi}`).toBeGreaterThan(0.3)
    }
  })

  it('decodes into a bank whose notes are where the manifest says', () => {
    expect(bank.sampleRate).toBe(44100)
    expect(bank.notes).toHaveLength(37)
    for (const n of bank.notes) {
      const expected = GUITAR_PACK.notes.find((p) => p.midi === n.midi)!
      expect(Math.abs((n.offset + n.pre) / bank.sampleRate - expected.start), `midi ${n.midi}`).toBeLessThan(0.01)
      expect(n.frames).toBeGreaterThan(bank.sampleRate)
    }
    expect(bankNote(bank, 20).midi).toBe(38)
    expect(bankNote(bank, 90).midi).toBe(74)
  })

  it('rejects audio that does not match the manifest', () => {
    expect(() => buildBank(GUITAR_PACK, new Float32Array(1000), 44100)).toThrow(/missing/)
    expect(() => buildBank(GUITAR_PACK, bank.pcm, 22050)).toThrow(/22050/)
  })
})

describe('renderSampledNote', () => {
  it('plays every guitar pitch in tune, including above the recorded range', () => {
    for (let midi = 38; midi <= 84; midi += 1) {
      const out = render(midi, 1.2)
      const got = cents(estimateFreq(out, 44100, 0.35, midiToFreq(midi)), midi)
      expect(Math.abs(got), `midi ${midi}`).toBeLessThan(12)
    }
  })

  it('lands the onset on the requested sample', () => {
    for (const midi of [40, 45, 52, 64, 74, 79]) {
      const out = render(midi, 1)
      const onset = firstAbove(out, GUITAR_PACK.onsetFraction)
      expect(Math.abs(onset - 4410) / 44.1, `midi ${midi}`).toBeLessThan(2)
    }
  })

  it('renders at the output rate asked for', () => {
    const out = render(45, 1, 48000)
    expect(Math.abs(cents(estimateFreq(out, 48000, 0.35, 110), 45))).toBeLessThan(10)
    expect(Math.abs(firstAbove(out, GUITAR_PACK.onsetFraction) - 4800) / 48).toBeLessThan(2)
  })

  it('uses a different take for each variant of a repeated note, at the same pitch', () => {
    const takes = [0, 1, 2].map((variant) => render(52, 1, 44100, { variant }))
    for (const t of takes) expect(Math.abs(cents(estimateFreq(t, 44100, 0.35, midiToFreq(52)), 52))).toBeLessThan(12)
    const differs = (a: Float32Array, b: Float32Array) => {
      let d = 0
      let e = 0
      for (let i = 4410; i < 4410 + 22050; i++) {
        d += (a[i] - b[i]) ** 2
        e += a[i] ** 2
      }
      return d / e
    }
    expect(differs(takes[0], takes[1])).toBeGreaterThan(0.05)
    expect(differs(takes[0], takes[2])).toBeGreaterThan(0.05)
    expect(differs(takes[1], takes[2])).toBeGreaterThan(0.05)
  })

  it('stops with a short fade when the note is cut, and is silent afterwards', () => {
    const out = render(40, 0.5, 44100, {}, 0.1)
    const end = Math.round(0.6 * 44100)
    let after = 0
    for (let i = end + 10; i < out.length; i++) after = Math.max(after, Math.abs(out[i]))
    expect(after).toBe(0)
    let before = 0
    for (let i = end - 4410; i < end - 2646; i++) before = Math.max(before, Math.abs(out[i]))
    expect(before).toBeGreaterThan(0.02)
  })

  it('is quieter and darker when struck softly', () => {
    const loud = render(52, 1, 44100, { velocity: 1 })
    const soft = render(52, 1, 44100, { velocity: 0.3 })
    const stats = (x: Float32Array) => {
      let e = 0
      let z = 0
      for (let i = 4410; i < 4410 + 8820; i++) {
        e += x[i] * x[i]
        if (x[i - 1] < 0 !== x[i] < 0) z++
      }
      return { rms: Math.sqrt(e / 8820), z }
    }
    expect(stats(soft).rms).toBeLessThan(stats(loud).rms * 0.8)
    expect(stats(soft).z).toBeLessThanOrEqual(stats(loud).z)
  })

  it('never writes outside the buffer', () => {
    const out = new Float32Array(1000)
    renderSampledNote(out, 0, bank, 45, 1, 0.5, 44100)
    renderSampledNote(out, 990, bank, 45, 1, 0.5, 44100)
    renderSampledNote(out, 5000, bank, 45, 1, 0.5, 44100)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
  })
})
