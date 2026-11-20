import { McLeodDetector, type McLeodOptions } from './mpm'
import { SpectrumAnalyzer } from './spectrum'

export interface FrameAnalyzerOptions extends McLeodOptions {
  /** Samples the single-pitch detector looks at (short, for the tuner and the on-screen pitch). */
  windowSize?: number
  /** Samples the spectrum analyser looks at: partials of two strings a fourth apart below 200 Hz only separate with ~90 ms of signal. */
  spectrumWindow?: number
  /** Samples between analyses. */
  hop?: number
  /** Spectral peaks and attack strength for the scorer. */
  spectrum?: boolean
  /** Run the single-pitch detector (default true). Off, frames report freq 0. */
  pitch?: boolean
}

export interface AnalyzedFrame {
  freq: number
  clarity: number
  rms: number
  /** Spectral peaks of the long window as [freq, amp, ...] pairs, when spectrum analysis is on and enough signal has arrived. */
  peaks?: Float32Array
  /**
   * Attack strength of the last hop: RMS of the second difference of the samples, which all but ignores
   * the low partials of ringing strings and jumps at the broadband snap of a new stroke. Present when
   * spectrum analysis is on.
   */
  flux?: number
  /**
   * The same idea in the 600 Hz - 4 kHz band (RMS of the difference of the band-passed samples): less
   * sharp, but it still shows a stroke through room noise, which swamps the wide-band measure.
   */
  fluxBand?: number
}

/**
 * The detector's framing, independent of where the audio comes from: keeps the most recent samples
 * in a ring and, every `hop` samples, runs the McLeod pitch detector on the last `windowSize` of them
 * and, for the scorer, the spectrum analyser on the last `spectrumWindow`. The audio worklet feeds it
 * the microphone; the scoring simulation feeds it rendered audio, so both score through exactly the
 * same code.
 */
export class FrameAnalyzer {
  readonly sampleRate: number
  readonly windowSize: number
  readonly spectrumWindow: number
  hop: number
  spectrumOn: boolean
  pitchOn: boolean
  private readonly ring: Float32Array
  private readonly frame: Float32Array
  private readonly longFrame: Float32Array
  private writeIdx = 0
  private filled = 0
  private sinceLast = 0
  private detector: McLeodDetector
  private detectorOptions: McLeodOptions
  private readonly spectrum: SpectrumAnalyzer
  private prevSample = 0
  private prevSample2 = 0
  private diffEnergy = 0
  private diffCount = 0
  private readonly hpK: number
  private readonly lpA: number
  private hp = 0
  private lp1 = 0
  private lp2 = 0
  private bandEnergy = 0

  constructor(sampleRate: number, options: FrameAnalyzerOptions = {}) {
    this.sampleRate = sampleRate
    this.windowSize = options.windowSize ?? 2048
    this.spectrumWindow = Math.max(this.windowSize, options.spectrumWindow ?? 4096)
    this.hop = options.hop ?? 512
    this.spectrumOn = options.spectrum ?? false
    this.pitchOn = options.pitch ?? true
    this.ring = new Float32Array(this.spectrumWindow)
    this.frame = new Float32Array(this.windowSize)
    this.longFrame = new Float32Array(this.spectrumWindow)
    this.detectorOptions = { minFreq: options.minFreq, maxFreq: options.maxFreq, threshold: options.threshold }
    this.detector = new McLeodDetector(this.windowSize, sampleRate, this.detectorOptions)
    this.spectrum = new SpectrumAnalyzer(this.spectrumWindow, sampleRate)
    this.hpK = Math.exp((-2 * Math.PI * 600) / sampleRate)
    this.lpA = 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate)
  }

  configure(options: FrameAnalyzerOptions): void {
    if (options.minFreq !== undefined || options.maxFreq !== undefined || options.threshold !== undefined) {
      this.detectorOptions = {
        minFreq: options.minFreq ?? this.detectorOptions.minFreq,
        maxFreq: options.maxFreq ?? this.detectorOptions.maxFreq,
        threshold: options.threshold ?? this.detectorOptions.threshold,
      }
      this.detector = new McLeodDetector(this.windowSize, this.sampleRate, this.detectorOptions)
    }
    if (options.spectrum !== undefined) this.spectrumOn = options.spectrum
    if (options.pitch !== undefined) this.pitchOn = options.pitch
    if (options.hop) this.hop = options.hop
  }

  /** Copies the most recent `out.length` samples of the ring into `out`, oldest first. */
  private latest(out: Float32Array): void {
    const size = this.ring.length
    const start = (this.writeIdx - out.length + size) % size
    const firstPart = Math.min(out.length, size - start)
    out.set(this.ring.subarray(start, start + firstPart), 0)
    if (firstPart < out.length) out.set(this.ring.subarray(0, out.length - firstPart), firstPart)
  }

  private frameRms(): number {
    let e = 0
    for (let i = 0; i < this.frame.length; i++) e += this.frame[i] * this.frame[i]
    return Math.sqrt(e / this.frame.length)
  }

  /** Feeds a block of samples (a render quantum). Returns a frame when a hop has completed, else null. */
  push(block: Float32Array): AnalyzedFrame | null {
    const size = this.ring.length
    const n = block.length
    let prev = this.prevSample
    let prev2 = this.prevSample2
    let diff = 0
    let { hp, lp1, lp2 } = this
    let band = 0
    const { hpK, lpA } = this
    for (let i = 0; i < n; i++) {
      const v = block[i]
      this.ring[this.writeIdx] = v
      this.writeIdx = this.writeIdx + 1 === size ? 0 : this.writeIdx + 1
      const d = v - 2 * prev + prev2
      diff += d * d
      // Band-pass (one-pole high-pass at 600 Hz, two one-pole low-passes at 4 kHz), then its difference.
      hp = hpK * (hp + v - prev)
      lp1 += lpA * (hp - lp1)
      const was = lp2
      lp2 += lpA * (lp1 - lp2)
      band += (lp2 - was) * (lp2 - was)
      prev2 = prev
      prev = v
    }
    this.prevSample = prev
    this.prevSample2 = prev2
    this.hp = hp
    this.lp1 = lp1
    this.lp2 = lp2
    this.diffEnergy += diff
    this.bandEnergy += band
    this.diffCount += n
    this.filled = Math.min(size, this.filled + n)
    this.sinceLast += n
    if (this.sinceLast < this.hop || this.filled < this.windowSize) return null
    this.sinceLast = 0
    const flux = Math.sqrt(this.diffEnergy / Math.max(1, this.diffCount))
    const fluxBand = Math.sqrt(this.bandEnergy / Math.max(1, this.diffCount))
    this.diffEnergy = 0
    this.bandEnergy = 0
    this.diffCount = 0
    this.latest(this.frame)
    let out: AnalyzedFrame
    if (this.pitchOn) {
      const r = this.detector.detect(this.frame)
      out = { freq: r.freq, clarity: r.clarity, rms: r.rms }
    } else {
      out = { freq: 0, clarity: 0, rms: this.frameRms() }
    }
    if (this.spectrumOn) {
      out.flux = flux
      out.fluxBand = fluxBand
      if (this.filled >= this.spectrumWindow) {
        this.latest(this.longFrame)
        out.peaks = this.spectrum.analyze(this.longFrame)
      }
    }
    return out
  }
}
