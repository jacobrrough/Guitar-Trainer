import { FFT } from './fft'

export interface PitchEstimate {
  /** Fundamental frequency in Hz, 0 when nothing periodic was found. */
  freq: number
  /** 0..1, how clearly periodic the frame is (NSDF peak height). */
  clarity: number
  /** Root-mean-square level of the frame. */
  rms: number
}

export interface McLeodOptions {
  minFreq?: number
  maxFreq?: number
  /** Peak-picking threshold relative to the highest NSDF peak (0.8–0.95). */
  threshold?: number
}

/**
 * McLeod Pitch Method ("A Smarter Way to Find Pitch", McLeod & Wyvill 2005).
 * Autocorrelation is computed with an FFT so a 2048-sample window costs
 * well under a millisecond per frame, cheap enough to run inside an
 * AudioWorklet at ~100 frames per second.
 */
export class McLeodDetector {
  readonly windowSize: number
  readonly sampleRate: number
  private readonly fft: FFT
  private readonly re: Float32Array
  private readonly im: Float32Array
  private readonly nsdf: Float32Array
  private readonly cum: Float64Array
  private readonly minLag: number
  private readonly maxLag: number
  private readonly threshold: number

  constructor(windowSize: number, sampleRate: number, opts: McLeodOptions = {}) {
    this.windowSize = windowSize
    this.sampleRate = sampleRate
    this.fft = new FFT(windowSize * 2)
    this.re = new Float32Array(windowSize * 2)
    this.im = new Float32Array(windowSize * 2)
    this.nsdf = new Float32Array(windowSize)
    this.cum = new Float64Array(windowSize + 1)
    const minFreq = opts.minFreq ?? 50
    const maxFreq = opts.maxFreq ?? 1500
    this.minLag = Math.max(2, Math.floor(sampleRate / maxFreq))
    this.maxLag = Math.min(Math.floor(windowSize * 0.8), Math.ceil(sampleRate / minFreq))
    this.threshold = opts.threshold ?? 0.93
  }

  detect(buf: Float32Array): PitchEstimate {
    const n = this.windowSize
    const { re, im, nsdf, cum } = this
    let sumSq = 0
    cum[0] = 0
    for (let i = 0; i < n; i++) {
      const v = buf[i]
      re[i] = v
      im[i] = 0
      sumSq += v * v
      cum[i + 1] = sumSq
    }
    for (let i = n; i < 2 * n; i++) {
      re[i] = 0
      im[i] = 0
    }
    const rms = Math.sqrt(sumSq / n)
    if (rms < 1e-5) return { freq: 0, clarity: 0, rms }

    // Autocorrelation via FFT: r(tau) = IFFT(|FFT(x)|^2)
    this.fft.transform(re, im, false)
    for (let i = 0; i < 2 * n; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i]
      im[i] = 0
    }
    this.fft.transform(re, im, true)

    // Normalised square difference function.
    for (let tau = 0; tau < n; tau++) {
      const m = cum[n - tau] + (sumSq - cum[tau])
      nsdf[tau] = m > 0 ? (2 * re[tau]) / m : 0
    }

    // Key maxima between positive zero crossings, after the initial lobe.
    const maxLag = this.maxLag
    let pos = 1
    while (pos < maxLag && nsdf[pos] > 0) pos++
    const peaks: number[] = []
    let bestVal = 0
    while (pos < maxLag) {
      while (pos < maxLag && nsdf[pos] <= 0) pos++
      if (pos >= maxLag) break
      let maxIdx = pos
      let maxV = nsdf[pos]
      while (pos < maxLag && nsdf[pos] > 0) {
        if (nsdf[pos] > maxV) {
          maxV = nsdf[pos]
          maxIdx = pos
        }
        pos++
      }
      if (maxIdx >= this.minLag) {
        peaks.push(maxIdx)
        if (maxV > bestVal) bestVal = maxV
      }
    }
    if (peaks.length === 0 || bestVal < 0.05) return { freq: 0, clarity: 0, rms }

    const cutoff = this.threshold * bestVal
    let chosen = peaks[0]
    for (const p of peaks) {
      if (nsdf[p] >= cutoff) {
        chosen = p
        break
      }
    }
    if (chosen <= 0 || chosen >= n - 1) return { freq: 0, clarity: 0, rms }

    // Parabolic interpolation around the chosen peak.
    const y0 = nsdf[chosen - 1]
    const y1 = nsdf[chosen]
    const y2 = nsdf[chosen + 1]
    const denom = y0 - 2 * y1 + y2
    const delta = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0
    const tau = chosen + delta
    const peak = y1 - 0.25 * (y0 - y2) * delta
    return { freq: this.sampleRate / tau, clarity: Math.min(1, Math.max(0, peak)), rms }
  }
}
