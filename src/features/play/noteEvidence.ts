/**
 * Evidence that a particular note is sounding, read from a frame's spectral peaks. A plucked string
 * shows up as peaks at whole multiples of its fundamental; checking for that pattern works whatever
 * else is ringing, which a single-pitch detector cannot do.
 */

/** Harmonics examined per note. */
export const HARMONICS = 5
/** A peak counts for a harmonic when it is within this many cents of it. */
export const HARMONIC_TOLERANCE_CENTS = 45
/** Quieter than this, a harmonic is treated as absent (amplitude of a sine, full scale = 1). */
const PRESENT_ABS = 8e-4
/** ...or more than 30 dB below the frame's strongest peak. */
const PRESENT_REL = 0.03

export interface NoteEvidence {
  /** Amplitude of the peak at each of the first harmonics (index 0 = fundamental); 0 where there is none. */
  harmonics: number[]
  /** Combined amplitude of those harmonics. */
  salience: number
  /** Amplitudes at 0.5x, 1.5x and 2.5x the fundamental: energy only the octave below would supply. */
  below: number[]
}

/** Amplitude of the strongest peak within `cents` of `freq`; 0 when there is none. `peaks` holds [freq, amp] pairs in ascending frequency. */
export function peakNear(peaks: Float32Array, freq: number, cents = HARMONIC_TOLERANCE_CENTS): number {
  const ratio = 2 ** (cents / 1200)
  const lo = freq / ratio
  const hi = freq * ratio
  let best = 0
  for (let i = 0; i < peaks.length; i += 2) {
    const f = peaks[i]
    if (f > hi) break
    if (f >= lo && peaks[i + 1] > best) best = peaks[i + 1]
  }
  return best
}

export function strongestPeak(peaks: Float32Array): number {
  let m = 0
  for (let i = 1; i < peaks.length; i += 2) if (peaks[i] > m) m = peaks[i]
  return m
}

const BELOW = [0.5, 1.5, 2.5]

/**
 * Reads the evidence for a note with fundamental `freq` from one frame's peaks. Harmonics under the
 * presence floor read 0. `cents` is how far a peak may be from a harmonic and still count.
 */
export function noteEvidence(peaks: Float32Array, freq: number, strongest = strongestPeak(peaks), cents = HARMONIC_TOLERANCE_CENTS): NoteEvidence {
  const floor = Math.max(PRESENT_ABS, PRESENT_REL * strongest)
  const harmonics: number[] = []
  let energy = 0
  for (let h = 1; h <= HARMONICS; h++) {
    const a = peakNear(peaks, freq * h, cents)
    const v = a >= floor ? a : 0
    harmonics.push(v)
    energy += v * v
  }
  const below = BELOW.map((m) => {
    const a = peakNear(peaks, freq * m, cents)
    return a >= floor ? a : 0
  })
  return { harmonics, salience: Math.sqrt(energy), below }
}

const EMPTY: NoteEvidence = { harmonics: [0, 0, 0, 0, 0], salience: 0, below: [0, 0, 0] }

/** A harmonic has risen when it is at least `factor` times (and a small absolute step above) where it was before the attack. */
function risen(now: number, before: number, factor: number): boolean {
  return now > 0 && now >= factor * before + 4e-4
}

/** The default rise: 15 %. */
export const RISE = 1.15

export interface FreshNote {
  /** How much each harmonic rose with the attack (0 where it did not rise). */
  rises: number[]
  /** Harmonics that rose with the attack. */
  risen: number
  fundamentalRisen: boolean
  /** Combined rise of all harmonics. */
  strength: number
  /** Combined rise of the fundamental, third and fifth harmonics: the octave above only raises the even ones. */
  oddStrength: number
  /** Combined rise at 0.5x, 1.5x and 2.5x the fundamental: what a pluck of the octave below adds. */
  belowRise: number
}

/**
 * What an attack added at a note's harmonics: compares the evidence now with the evidence before the
 * attack (null at the very start). Energy that was already ringing does not count, so a string that
 * is still sounding cannot pass for a new note, nor lend its harmonics to a different one.
 */
export function freshNote(now: NoteEvidence, before: NoteEvidence | null, factor = RISE): FreshNote {
  const b = before ?? EMPTY
  let count = 0
  let energy = 0
  let odd = 0
  const rises = now.harmonics.map((a, i) => {
    if (!risen(a, b.harmonics[i], factor)) return 0
    count++
    const d = a - b.harmonics[i]
    energy += d * d
    if (i % 2 === 0) odd += d * d
    return d
  })
  let below = 0
  now.below.forEach((a, i) => {
    const d = Math.max(0, a - b.below[i])
    below += d * d
  })
  return { rises, risen: count, fundamentalRisen: risen(now.harmonics[0], b.harmonics[0], factor), strength: Math.sqrt(energy), oddStrength: Math.sqrt(odd), belowRise: Math.sqrt(below) }
}
