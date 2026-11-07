import { describe, expect, it } from 'vitest'
import { McLeodDetector } from './pitch/mpm'
import { resampleLinear } from './resample'

describe('resampleLinear', () => {
  it('keeps a tone at the same frequency after downsampling 48k → 22.05k', () => {
    const from = 48000
    const to = 22050
    const freq = 220
    const input = new Float32Array(from)
    for (let i = 0; i < input.length; i++) input[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / from)
    const out = resampleLinear(input, from, to)
    expect(out.length).toBe(Math.floor(input.length / (from / to)))
    const detector = new McLeodDetector(2048, to)
    const r = detector.detect(out.subarray(4096, 4096 + 2048))
    expect(Math.abs(1200 * Math.log2(r.freq / freq))).toBeLessThan(5)
    expect(r.clarity).toBeGreaterThan(0.9)
  })

  it('returns a copy when rates match', () => {
    const input = Float32Array.from([1, 2, 3])
    const out = resampleLinear(input, 44100, 44100)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
  })
})
