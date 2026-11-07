import { describe, expect, it } from 'vitest'
import { FFT } from './fft'
import { McLeodDetector } from './mpm'

const SR = 48000
const N = 2048

function tone(freq: number, harmonics: number[] = [1], phase = 0.3): Float32Array {
  const buf = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    let v = 0
    harmonics.forEach((amp, h) => {
      v += amp * Math.sin(2 * Math.PI * freq * (h + 1) * (i / SR) + phase * (h + 1))
    })
    buf[i] = v * 0.3
  }
  return buf
}

function cents(a: number, b: number): number {
  return 1200 * Math.log2(a / b)
}

describe('FFT', () => {
  it('round-trips a signal through forward and inverse transforms', () => {
    const fft = new FFT(64)
    const re = new Float32Array(64)
    const im = new Float32Array(64)
    for (let i = 0; i < 64; i++) re[i] = Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.1)
    const original = Float32Array.from(re)
    fft.transform(re, im, false)
    fft.transform(re, im, true)
    for (let i = 0; i < 64; i++) {
      expect(re[i]).toBeCloseTo(original[i], 4)
      expect(im[i]).toBeCloseTo(0, 4)
    }
  })

  it('places a pure tone in the right bin', () => {
    const fft = new FFT(256)
    const re = new Float32Array(256)
    const im = new Float32Array(256)
    for (let i = 0; i < 256; i++) re[i] = Math.cos((2 * Math.PI * 8 * i) / 256)
    fft.transform(re, im)
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]))
    const peak = mags.indexOf(Math.max(...mags.slice(0, 128)))
    expect(peak).toBe(8)
  })
})

describe('McLeodDetector', () => {
  const detector = new McLeodDetector(N, SR, { minFreq: 55, maxFreq: 1500 })

  it.each([82.41, 110, 146.83, 196, 246.94, 329.63, 440, 659.26, 1174.66])('detects a pure %f Hz tone within 2 cents', (freq) => {
    const r = detector.detect(tone(freq))
    expect(r.clarity).toBeGreaterThan(0.95)
    expect(Math.abs(cents(r.freq, freq))).toBeLessThan(2)
  })

  it('finds the fundamental of a bright guitar-like tone with strong harmonics', () => {
    for (const freq of [82.41, 110, 196, 329.63]) {
      const r = detector.detect(tone(freq, [1, 0.8, 0.5, 0.35, 0.2, 0.1]))
      expect(Math.abs(cents(r.freq, freq))).toBeLessThan(3)
      expect(r.clarity).toBeGreaterThan(0.9)
    }
  })

  it('does not octave-jump when the second harmonic is louder than the fundamental', () => {
    const r = detector.detect(tone(110, [0.6, 1, 0.4]))
    expect(Math.abs(cents(r.freq, 110))).toBeLessThan(3)
  })

  it('reports low clarity for white noise', () => {
    const buf = new Float32Array(N)
    let seed = 1
    for (let i = 0; i < N; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      buf[i] = (seed / 0x7fffffff) * 0.4 - 0.2
    }
    const r = detector.detect(buf)
    expect(r.clarity).toBeLessThan(0.6)
  })

  it('returns silence for an empty buffer', () => {
    const r = detector.detect(new Float32Array(N))
    expect(r.freq).toBe(0)
    expect(r.clarity).toBe(0)
    expect(r.rms).toBe(0)
  })
})
