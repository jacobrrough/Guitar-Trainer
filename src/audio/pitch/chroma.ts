import {
  CHORD_CHROMA_MATCH,
  CHORD_MIN_PRESENT,
  CHROMA_MAX_FREQ,
  CHROMA_MIN_FREQ,
  CHROMA_PRESENT_RATIO,
} from '../../training/constants'

export const PITCH_CLASSES = 12

export interface ChromaOptions {
  minFreq?: number
  maxFreq?: number
}

/**
 * Folds a Hann-windowed magnitude spectrum into 12 pitch classes (C = 0).
 * `analyze` returns a max-normalised vector (strongest bin = 1), all zeros on silence.
 */
export class ChromaAnalyzer {
  readonly windowSize: number
  readonly sampleRate: number
  readonly minFreq: number
  readonly maxFreq: number

  constructor(windowSize: number, sampleRate: number, opts: ChromaOptions = {}) {
    this.windowSize = windowSize
    this.sampleRate = sampleRate
    this.minFreq = opts.minFreq ?? CHROMA_MIN_FREQ
    this.maxFreq = opts.maxFreq ?? CHROMA_MAX_FREQ
  }

  analyze(_frame: Float32Array, out: Float32Array = new Float32Array(PITCH_CLASSES)): Float32Array {
    // Implemented by the chroma DSP package; the contract is the signature above.
    out.fill(0)
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
