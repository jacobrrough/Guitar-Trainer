import { describe, expect, it } from 'vitest'
import { SpectrumAnalyzer } from './spectrum'

const SR = 44100
const N = 4096

function tone(parts: [number, number][], sr = SR, n = N): Float32Array {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) for (const [f, a] of parts) x[i] += a * Math.sin((2 * Math.PI * f * i) / sr + f)
  return x
}

const pairs = (p: Float32Array) => Array.from({ length: p.length / 2 }, (_, i) => ({ f: p[2 * i], a: p[2 * i + 1] }))

describe('SpectrumAnalyzer', () => {
  it('finds partials with accurate frequency and amplitude', () => {
    const peaks = pairs(new SpectrumAnalyzer(N, SR).analyze(tone([[82.41, 0.2], [164.8, 0.3], [247.2, 0.1], [1234.5, 0.05]])))
    expect(peaks).toHaveLength(4)
    const expected = [[82.41, 0.2], [164.8, 0.3], [247.2, 0.1], [1234.5, 0.05]]
    peaks.forEach((p, i) => {
      expect(Math.abs(1200 * Math.log2(p.f / expected[i][0])), `freq ${expected[i][0]}`).toBeLessThan(12)
      expect(p.a / expected[i][1], `amp ${expected[i][0]}`).toBeGreaterThan(0.85)
      expect(p.a / expected[i][1], `amp ${expected[i][0]}`).toBeLessThan(1.15)
    })
  })

  it('works at 48 kHz', () => {
    const peaks = pairs(new SpectrumAnalyzer(N, 48000).analyze(tone([[110, 0.3], [220, 0.2]], 48000)))
    expect(peaks).toHaveLength(2)
    expect(Math.abs(peaks[0].f - 110)).toBeLessThan(1)
    expect(Math.abs(peaks[1].f - 220)).toBeLessThan(1)
  })

  it('returns nothing for silence and for very quiet input', () => {
    const an = new SpectrumAnalyzer(N, SR)
    expect(an.analyze(new Float32Array(N))).toHaveLength(0)
    expect(an.analyze(tone([[440, 1e-4]]))).toHaveLength(0)
  })

  it('drops peaks far below the strongest and keeps the list bounded', () => {
    const an = new SpectrumAnalyzer(N, SR, { maxPeaks: 5 })
    const many: [number, number][] = Array.from({ length: 20 }, (_, i) => [200 + i * 150, 0.02 + 0.01 * i])
    const peaks = pairs(an.analyze(tone(many)))
    expect(peaks).toHaveLength(5)
    for (let i = 1; i < peaks.length; i++) expect(peaks[i].f).toBeGreaterThan(peaks[i - 1].f)
    expect(peaks[0].f).toBeGreaterThan(2000)
    const weak = pairs(new SpectrumAnalyzer(N, SR).analyze(tone([[440, 0.5], [1000, 0.004]])))
    expect(weak).toHaveLength(1)
  })
})
