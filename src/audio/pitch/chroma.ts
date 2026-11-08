import {
  CHORD_CHROMA_MATCH,
  CHORD_MIN_PRESENT,
  CHROMA_MAX_FREQ,
  CHROMA_MIN_FREQ,
  CHROMA_PRESENT_RATIO,
} from '../../training/constants'
import { FFT } from './fft'

export const PITCH_CLASSES = 12

export interface ChromaOptions {
  minFreq?: number
  maxFreq?: number
}

/** Harmonic orders (of a lower note) that fall on a different pitch class, with the fraction of that note's magnitude removed. */
const SUPPRESSED_HARMONICS: ReadonlyArray<readonly [number, number]> = [
  [3, 0.6],
  [5, 0.4],
  [7, 0.3],
]
/** Harmonics used to pick between neighbouring semitones for low, poorly resolved peaks. */
const SNAP_HARMONICS = 6
/** Peaks below this frequency are snapped to the semitone whose upper harmonics are best supported. */
const SNAP_BELOW_HZ = 320
/** Minimum harmonic support for a low peak to be kept. */
const SNAP_MIN_SUPPORT = 0.1
/** Relative frequency tolerance when matching a harmonic to a peak (about 50 cents). */
const HARMONIC_TOLERANCE = 0.03
/** Peaks below this fraction of the strongest peak are ignored (window sidelobes, noise). */
const PEAK_FLOOR = 0.1
/** Spectral tilt: above TILT_HZ magnitudes fall off as (TILT_HZ/f)^TILT_POW; upper partials are weaker pitch evidence. */
const TILT_HZ = 300
const TILT_POW = 1.5
/** Partials above this are ignored (covers fundamentals up to the 12th fret of the high E string, 659 Hz): higher peaks are dominated by high harmonics of the low strings, i.e. wrong pitch classes. */
const UPPER_PARTIAL_HZ = 800
/** Frames whose mean spectral magnitude is below this are treated as silence. */
const SILENCE_EPS = 1e-4

/**
 * Folds a Hann-windowed magnitude spectrum into 12 pitch classes (C = 0).
 * `analyze` returns a max-normalised vector (strongest bin = 1), all zeros on silence.
 *
 * Method, on a sparse spectrum of refined peaks (parabolic interpolation on log magnitude):
 * 1. Low peaks (< 320 Hz) are poorly placed by a 2048-sample window (neighbouring main
 *    lobes pull them by up to a semitone), so each is snapped to whichever neighbouring
 *    semitone has its 2nd..6th harmonics best supported by higher, accurately placed peaks.
 * 2. Harmonic suppression: a peak is reduced by a fraction of the amplitude of peaks at
 *    1/3, 1/5 and 1/7 of its frequency (overtones that fall on other pitch classes), so a
 *    single note does not light up its fifth or major third as strongly as itself.
 * 3. Amplitudes get a steep 1/f tilt (upper partials are weak pitch evidence), are
 *    square-root compressed and max-pooled per pitch class.
 * Allocation-free after construction.
 */
export class ChromaAnalyzer {
  readonly windowSize: number
  readonly sampleRate: number
  readonly minFreq: number
  readonly maxFreq: number
  private readonly fft: FFT
  private readonly window: Float32Array
  private readonly re: Float32Array
  private readonly im: Float32Array
  private readonly mag: Float32Array
  private readonly peakFreq: Float32Array
  private readonly peakAmp: Float32Array
  private readonly peakOut: Float32Array
  private readonly binLo: number
  private readonly binHi: number

  constructor(windowSize: number, sampleRate: number, opts: ChromaOptions = {}) {
    this.windowSize = windowSize
    this.sampleRate = sampleRate
    this.minFreq = opts.minFreq ?? CHROMA_MIN_FREQ
    this.maxFreq = opts.maxFreq ?? CHROMA_MAX_FREQ
    this.fft = new FFT(windowSize)
    this.window = new Float32Array(windowSize)
    for (let i = 0; i < windowSize; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowSize - 1))
    this.re = new Float32Array(windowSize)
    this.im = new Float32Array(windowSize)
    const half = windowSize >> 1
    this.mag = new Float32Array(half + 1)
    this.peakFreq = new Float32Array(half)
    this.peakAmp = new Float32Array(half)
    this.peakOut = new Float32Array(half)
    const binHz = sampleRate / windowSize
    this.binLo = Math.max(2, Math.floor(this.minFreq / binHz))
    this.binHi = Math.min(half - 2, Math.ceil(this.maxFreq / binHz))
  }

  /** Summed amplitude (weighted 1/h) of peaks near the 2nd..4th harmonics of `f`. */
  private harmonicSupport(f: number, np: number): number {
    const { peakFreq, peakAmp } = this
    let sum = 0
    for (let h = 2; h <= SNAP_HARMONICS; h++) {
      const target = f * h
      let best = 0
      for (let j = 0; j < np; j++) {
        const pf = peakFreq[j]
        if (pf > target * (1 + HARMONIC_TOLERANCE)) break
        if (pf >= target * (1 - HARMONIC_TOLERANCE) && peakAmp[j] > best) best = peakAmp[j]
      }
      sum += best / h
    }
    return sum
  }

  analyze(frame: Float32Array, out: Float32Array = new Float32Array(PITCH_CLASSES)): Float32Array {
    out.fill(0)
    const n = this.windowSize
    const { re, im, mag, window, peakFreq, peakAmp, peakOut } = this
    for (let i = 0; i < n; i++) {
      re[i] = (frame[i] ?? 0) * window[i]
      im[i] = 0
    }
    this.fft.transform(re, im)
    const half = n >> 1
    let total = 0
    let peak = 0
    for (let k = 0; k <= half; k++) {
      const m = Math.hypot(re[k], im[k])
      mag[k] = m
      total += m
      if (k >= this.binLo && k <= this.binHi && m > peak) peak = m
    }
    if (total / n < SILENCE_EPS || peak <= 0) return out
    const floor = PEAK_FLOOR * peak
    const binHz = this.sampleRate / n

    // Sparse spectrum, ascending in frequency (up to Nyquist so harmonics of high notes are visible).
    let np = 0
    for (let k = this.binLo; k < half - 1; k++) {
      const b = mag[k]
      const a = mag[k - 1]
      const c = mag[k + 1]
      if (b < floor || b <= a || b < c) continue
      const la = Math.log(a + 1e-12)
      const lb = Math.log(b)
      const lc = Math.log(c + 1e-12)
      const denom = la - 2 * lb + lc
      const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (la - lc)) / denom)) : 0
      peakFreq[np] = (k + delta) * binHz
      peakAmp[np] = b / peak
      np++
    }
    if (np === 0) return out

    // 1. Snap low peaks to the best-supported semitone (frequencies then sit exactly on the grid).
    for (let i = 0; i < np; i++) {
      const f = peakFreq[i]
      if (f >= SNAP_BELOW_HZ) break
      const pos = 12 * Math.log2(f / 440) + 69
      const nearest = Math.round(pos)
      const maxDev = f < 200 ? 1.3 : 0.7
      let bestMidi = nearest
      let bestScore = this.harmonicSupport(440 * Math.pow(2, (nearest - 69) / 12), np)
      for (let d = -1; d <= 1; d += 2) {
        const midi = nearest + d
        const score = this.harmonicSupport(440 * Math.pow(2, (midi - 69) / 12), np)
        // A neighbour must beat the nearest semitone clearly, and be within maxDev semitones of the measurement (peaks are less biased as frequency rises).
        if (score > bestScore * 1.1 + 1e-6 && Math.abs(pos - midi) < maxDev) {
          bestScore = score
          bestMidi = midi
        }
      }
      // A low peak with no harmonic support is an unresolved merge of several notes: drop it.
      peakOut[i] = bestScore >= SNAP_MIN_SUPPORT ? 440 * Math.pow(2, (bestMidi - 69) / 12) : 0
    }
    for (let i = 0; i < np; i++) if (peakFreq[i] < SNAP_BELOW_HZ) peakFreq[i] = peakOut[i]

    // 2 + 3. Suppress overtones of lower peaks, tilt, compress, pool.
    for (let i = 0; i < np; i++) {
      const f = peakFreq[i]
      if (f < this.minFreq) continue
      if (f > this.maxFreq || f > UPPER_PARTIAL_HZ) break
      let amp = peakAmp[i]
      for (let h = 0; h < SUPPRESSED_HARMONICS.length; h++) {
        const target = f / SUPPRESSED_HARMONICS[h][0]
        if (target < this.minFreq * (1 - HARMONIC_TOLERANCE)) break
        const tol = Math.max(HARMONIC_TOLERANCE * target, 0.6 * binHz)
        let m = 0
        for (let j = 0; j < i; j++) {
          const pf = peakFreq[j]
          if (pf > target + tol) break
          if (pf >= target - tol && peakAmp[j] > m) m = peakAmp[j]
        }
        amp -= SUPPRESSED_HARMONICS[h][1] * m
      }
      if (amp <= 0) continue
      amp *= Math.pow(TILT_HZ / Math.max(f, TILT_HZ), TILT_POW)
      const pc = (((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12)
      const v = Math.sqrt(amp)
      if (v > out[pc]) out[pc] = v
    }
    let max = 0
    for (let i = 0; i < PITCH_CLASSES; i++) if (out[i] > max) max = out[i]
    if (max <= 0) return out
    for (let i = 0; i < PITCH_CLASSES; i++) out[i] /= max
    return out
  }
}

/** 12-bin template with 1 for every pitch class in the chord. */
export function chordTemplate(midis: number[]): Float32Array {
  const t = new Float32Array(PITCH_CLASSES)
  for (const m of midis) t[((Math.round(m) % 12) + 12) % 12] = 1
  return t
}

/** Cosine similarity in 0..1; 0 when either vector is silent. */
export function chromaSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < PITCH_CLASSES; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na <= 0 || nb <= 0) return 0
  return Math.max(0, Math.min(1, dot / Math.sqrt(na * nb)))
}

/** Bins at or above `ratio` × the strongest bin. */
export function presentPitchClasses(chroma: Float32Array, ratio = CHROMA_PRESENT_RATIO): boolean[] {
  let max = 0
  for (let i = 0; i < PITCH_CLASSES; i++) max = Math.max(max, chroma[i])
  const out: boolean[] = []
  for (let i = 0; i < PITCH_CLASSES; i++) out.push(max > 0 && chroma[i] >= ratio * max)
  return out
}

export interface ChordMatch {
  similarity: number
  /** Fraction of the chord's distinct pitch classes that are present. */
  presentFraction: number
  ok: boolean
}

export interface ChordMatchOptions {
  match?: number
  minPresent?: number
  presentRatio?: number
}

/** Judges an accumulated chroma vector against a chord's pitch classes. */
export function chordMatch(chroma: Float32Array, midis: number[], opts: ChordMatchOptions = {}): ChordMatch {
  const template = chordTemplate(midis)
  const present = presentPitchClasses(chroma, opts.presentRatio ?? CHROMA_PRESENT_RATIO)
  let needed = 0
  let found = 0
  for (let i = 0; i < PITCH_CLASSES; i++) {
    if (template[i] > 0) {
      needed++
      if (present[i]) found++
    }
  }
  const similarity = chromaSimilarity(chroma, template)
  const presentFraction = needed ? found / needed : 0
  return {
    similarity,
    presentFraction,
    ok: similarity >= (opts.match ?? CHORD_CHROMA_MATCH) && presentFraction >= (opts.minPresent ?? CHORD_MIN_PRESENT),
  }
}
