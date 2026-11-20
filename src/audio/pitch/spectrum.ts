import { FFT } from './fft'

export interface SpectrumOptions {
  minFreq?: number
  maxFreq?: number
  /** Strongest peaks kept per frame. */
  maxPeaks?: number
}

/** Peaks quieter than this (amplitude of a sine, full scale = 1) are noise: about -66 dBFS. */
const ABS_FLOOR = 5e-4
/** Peaks more than 34 dB below the frame's strongest are window sidelobes or noise. */
const REL_FLOOR = 0.02

/**
 * Sparse spectrum of a frame: the frequencies and amplitudes of its spectral peaks. A Hann window,
 * an FFT, then every local maximum above the floors, refined by parabolic interpolation on the log
 * magnitude (accurate to a few cents for an isolated partial). Amplitudes are those of the underlying
 * sinusoids (a full-scale sine reads 1). This is what the scorer checks expected notes against: a
 * plucked string shows up as peaks at its harmonics whatever else is ringing.
 */
export class SpectrumAnalyzer {
  readonly windowSize: number
  readonly sampleRate: number
  readonly maxPeaks: number
  private readonly fft: FFT
  private readonly window: Float32Array
  private readonly re: Float32Array
  private readonly im: Float32Array
  private readonly mag: Float32Array
  private readonly candF: Float32Array
  private readonly candA: Float32Array
  private readonly order: Int32Array
  private readonly binLo: number
  private readonly binHi: number
  private readonly scale: number

  constructor(windowSize: number, sampleRate: number, options: SpectrumOptions = {}) {
    this.windowSize = windowSize
    this.sampleRate = sampleRate
    this.maxPeaks = options.maxPeaks ?? 48
    this.fft = new FFT(windowSize)
    this.window = new Float32Array(windowSize)
    let sum = 0
    for (let i = 0; i < windowSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowSize - 1))
      sum += this.window[i]
    }
    this.scale = 2 / sum
    this.re = new Float32Array(windowSize)
    this.im = new Float32Array(windowSize)
    const half = windowSize >> 1
    this.mag = new Float32Array(half + 1)
    this.candF = new Float32Array(half)
    this.candA = new Float32Array(half)
    this.order = new Int32Array(half)
    const binHz = sampleRate / windowSize
    this.binLo = Math.max(2, Math.floor((options.minFreq ?? 60) / binHz))
    this.binHi = Math.min(half - 2, Math.ceil((options.maxFreq ?? 5000) / binHz))
  }

  /**
   * Returns the peaks of `frame` as pairs [freq0, amp0, freq1, amp1, ...] in ascending frequency
   * (a fresh array each call, at most `maxPeaks` pairs; empty for silence).
   */
  analyze(frame: Float32Array): Float32Array {
    const n = this.windowSize
    const { re, im, mag, window, candF, candA, order } = this
    for (let i = 0; i < n; i++) {
      re[i] = (frame[i] ?? 0) * window[i]
      im[i] = 0
    }
    this.fft.transform(re, im)
    let strongest = 0
    for (let k = this.binLo - 1; k <= this.binHi + 1; k++) {
      const m = Math.hypot(re[k], im[k]) * this.scale
      mag[k] = m
      if (m > strongest) strongest = m
    }
    const floor = Math.max(ABS_FLOOR, REL_FLOOR * strongest)
    if (strongest < ABS_FLOOR) return new Float32Array(0)
    const binHz = this.sampleRate / n
    let count = 0
    for (let k = this.binLo; k <= this.binHi; k++) {
      const b = mag[k]
      const a = mag[k - 1]
      const c = mag[k + 1]
      if (b < floor || b <= a || b < c) continue
      const la = Math.log(a + 1e-12)
      const lb = Math.log(b)
      const lc = Math.log(c + 1e-12)
      const denom = la - 2 * lb + lc
      const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (la - lc)) / denom)) : 0
      candF[count] = (k + delta) * binHz
      // Height of the fitted parabola: the true amplitude of a partial that falls between bins.
      candA[count] = Math.exp(lb - 0.25 * (la - lc) * delta)
      count++
    }
    if (count > this.maxPeaks) {
      for (let i = 0; i < count; i++) order[i] = i
      const idx = Array.from(order.subarray(0, count)).sort((x, y) => candA[y] - candA[x]).slice(0, this.maxPeaks).sort((x, y) => x - y)
      const out = new Float32Array(idx.length * 2)
      idx.forEach((j, i) => {
        out[2 * i] = candF[j]
        out[2 * i + 1] = candA[j]
      })
      return out
    }
    const out = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      out[2 * i] = candF[i]
      out[2 * i + 1] = candA[i]
    }
    return out
  }
}
