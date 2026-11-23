/**
 * Where a tune or an exercise sits for one singer. A tune is written once, in semitones from a home
 * note on middle C; here it is moved to the key that suits a range, and a short pattern is given the
 * keys of one round. Pure arithmetic on MIDI numbers.
 *
 * A range is inclusive at both ends: every note asked for satisfies `low <= midi <= high`. The
 * headroom is taken off when the range is found (two semitones above the lowest note heard, three
 * below the highest), never again here.
 */
import type { VoiceRange } from '../training/types'
import { clamp, pitchClass } from './pitch'

/** The edges of a range, which is all a key needs. */
export type RangeEdges = Pick<VoiceRange, 'low' | 'high'>
/** A range with its easiest note, which is where an exercise starts. */
export type RangeAroundEasy = Pick<VoiceRange, 'low' | 'high' | 'easy'>

/**
 * The smallest span (highest minus lowest note, in semitones) the app ever stores: eight notes, which
 * hold a five-note scale and 1-3-5 exactly. Everything a first lesson asks for is built to fit it.
 */
export const MIN_RANGE_SPAN = 7

/** The starting ranges offered when the range was not measured: "Lower voice" and "Higher voice". */
export const DEFAULT_RANGES = {
  lower: { low: 48, high: 55, easy: 52 },
  higher: { low: 60, high: 67, easy: 64 },
} as const satisfies Record<string, RangeAroundEasy>

/** A starting range as it is stored: marked as a default, so nobody takes it for a measurement. */
export function defaultRange(voice: keyof typeof DEFAULT_RANGES, at: number): VoiceRange {
  return { ...DEFAULT_RANGES[voice], source: 'default', at }
}

/** The smallest range around an easy note: three semitones under it, four over (a voice has more room above its easy note than below). */
export function easyRange(easy: number): RangeAroundEasy {
  return { low: easy - 3, high: easy + 4, easy }
}

/** MIDI number of the home note every tune is written from. */
export const WRITTEN_HOME = 60

/** The compass of a tune as written: its lowest and highest note, and where its notes sit on average when long notes count for more. */
export interface TuneSpan {
  low: number
  high: number
  centre: number
}

/** One note or rest of a tune: semitones above home (null = a rest) and its length in beats. A `VocalStep` is one. */
export type WrittenStep = readonly [semitonesAboveHome: number | null, beats: number, ...rest: unknown[]]

/** The compass of written steps, with the home note on `home`. Rests count for nothing; a tune without notes sits on its home note. */
export function spanOfSteps(steps: readonly WrittenStep[], home = WRITTEN_HOME): TuneSpan {
  let low = Infinity
  let high = -Infinity
  let weighted = 0
  let beats = 0
  for (const [offset, length] of steps) {
    if (offset === null) continue
    low = Math.min(low, offset)
    high = Math.max(high, offset)
    weighted += offset * length
    beats += length
  }
  if (low > high) return { low: home, high: home, centre: home }
  // Notes without a length have nothing to weigh: the centre is then the middle of the compass, never 0 / 0.
  return { low: home + low, high: home + high, centre: home + (beats > 0 ? weighted / beats : (low + high) / 2) }
}

export type ShapeFamily = 'C' | 'D' | 'E' | 'G' | 'A'

export interface KeyFamily {
  /** The key whose open chord shapes are strummed. */
  family: ShapeFamily
  /** Fret of the capo that lifts those shapes to the key asked for. */
  capo: 0 | 1 | 2
}

/**
 * How the accompaniment is played in each key, by pitch class of the home note (0 = C): open shapes
 * and a capo no higher than the second fret. A capo of 0 marks the five keys that need none.
 */
export const KEY_FAMILIES: readonly KeyFamily[] = [
  { family: 'C', capo: 0 },
  { family: 'C', capo: 1 },
  { family: 'D', capo: 0 },
  { family: 'D', capo: 1 },
  { family: 'E', capo: 0 },
  { family: 'E', capo: 1 },
  { family: 'E', capo: 2 },
  { family: 'G', capo: 0 },
  { family: 'G', capo: 1 },
  { family: 'A', capo: 0 },
  { family: 'A', capo: 1 },
  { family: 'A', capo: 2 },
]

/** Shapes and capo for a key, by the MIDI number of its home note in any octave. */
export function keyFamily(tonic: number): KeyFamily {
  return KEY_FAMILIES[pitchClass(Math.round(tonic))]
}

/** The furthest "Lower" or "Higher" can move a song from its chosen key, in semitones. */
export const MAX_KEY_NUDGE = 3

/**
 * Nearest whole number, a half going down: when two keys are equally near, the lower one is kinder to a voice.
 * The `+ 0` turns the -0 that `Math.ceil` gives for anything between -1 and 0 into a plain 0: a shift of -0
 * is not equal to 0 for `Object.is`, which is what a test or a memo compares with.
 */
function roundDown(v: number): number {
  return Math.ceil(v - 0.5) + 0
}

/**
 * The key for a tune in a range, as semitones to move it from where it is written.
 *
 * Every shift that keeps the whole tune inside `low … high` is a candidate. The one whose centre lies
 * nearest the middle of the range is taken, unless it or a neighbour a semitone away has a home note
 * of C, D, E, G or A (open chords, no capo): then the nearest of those, and of two equally near the
 * lower. `nudge` (the singer's "Lower" / "Higher", at most three semitones) moves the result, but
 * never out of the range. So a stored nudge can ask for more than it gets: what it really moved is
 * this shift minus the shift without a nudge, and "Lower" has nothing left to give when a nudge one
 * smaller returns the same shift. A nudge that is missing or not a number is no nudge.
 *
 * `fits` is false when the tune is wider than the range. The shift is then only where the tune would
 * sit most evenly, for a screen that lists it; no nudge applies and it must not be sung.
 */
export function chooseKey(span: TuneSpan, range: RangeEdges, nudge = 0): { shift: number; fits: boolean } {
  const lowest = Math.ceil(range.low - span.low)
  const highest = Math.floor(range.high - span.high)
  const middle = (range.low + range.high) / 2
  const ideal = roundDown(middle - span.centre)
  if (lowest > highest) return { shift: ideal, fits: false }
  const off = (shift: number) => Math.abs(span.centre + shift - middle)
  const nearest = clamp(ideal, lowest, highest)
  let chosen = nearest
  let best = Infinity
  // Lowest first, and only a strictly nearer one replaces it: of two equally near, the lower stays.
  for (let shift = nearest - 1; shift <= nearest + 1; shift++) {
    if (shift < lowest || shift > highest || keyFamily(WRITTEN_HOME + shift).capo !== 0) continue
    if (off(shift) < best - 1e-9) {
      best = off(shift)
      chosen = shift
    }
  }
  // The nudge is read from a stored profile: one that is missing or damaged is no nudge, never a key that is not a number.
  const asked = Number.isFinite(nudge) ? clamp(Math.round(nudge), -MAX_KEY_NUDGE, MAX_KEY_NUDGE) : 0
  return { shift: clamp(chosen + asked, lowest, highest) + 0, fits: true }
}

/** Semitones between the lowest and the highest note of a pattern. */
export function patternSpan(offsets: readonly number[]): number {
  return offsets.length === 0 ? 0 : Math.max(...offsets) - Math.min(...offsets)
}

/** True when the range can hold the pattern somewhere. */
export function patternFits(offsets: readonly number[], range: RangeEdges): boolean {
  return patternSpan(offsets) <= range.high - range.low
}

/**
 * The first of `forms` the range can hold. List the widest first (1-3-5-8 before 1-3-5): a pattern
 * wider than the range is sung in its narrower form. When none fits the last is returned, and
 * `placePattern` has no place for it.
 */
export function fittingForm<T extends readonly number[]>(forms: readonly T[], range: RangeEdges): T {
  return forms.find((form) => patternFits(form, range)) ?? forms[forms.length - 1]
}

/** Where a round may start, in semitones from the easy placement, by day: consecutive days walk through the list and start again. */
const START_MOVES = [0, 1, -1, 2, -2]

/**
 * Home notes for the keys of one round of a pattern given in semitones from its home note.
 *
 * The first key puts the middle of the pattern on the easy note (pushed inside the range when that
 * would leave it). Each repetition is then a semitone higher while the top note stays at or under
 * `high`, and after that the keys come back down the way they went. Without `count` that is the
 * whole walk, up to the top of the range and back to the start. With `count` it is exactly that many
 * keys: up for the first half, back for the second, turning sooner when the range ends sooner (in a
 * range the pattern fills, every key is the same one).
 *
 * `seed` is the day's variation (the planner counts practice days): it moves the first key by up to
 * two semitones, so the same exercise is not in the same key every day, and is the same all day.
 *
 * A pattern wider than the range has no place: the result is empty. Ask `fittingForm` for the
 * narrower form first; an empty result must never be turned into notes.
 */
export function placePattern(offsets: readonly number[], range: RangeAroundEasy, seed: number, count?: number): number[] {
  if (offsets.length === 0) return []
  const bottom = Math.min(...offsets)
  const top = Math.max(...offsets)
  const lowestHome = Math.ceil(range.low - bottom)
  const highestHome = Math.floor(range.high - top)
  if (lowestHome > highestHome) return []
  const day = Number.isFinite(seed) ? Math.abs(Math.round(seed)) : 0
  // Exercise parameters are read back from stored records: without an easy note the round starts in the middle of the range.
  const easy = Number.isFinite(range.easy) ? range.easy : (range.low + range.high) / 2
  const onEasy = clamp(roundDown(easy - (bottom + top) / 2), lowestHome, highestHome)
  const start = clamp(onEasy + START_MOVES[day % START_MOVES.length], lowestHome, highestHome)
  const room = highestHome - start
  const length = count === undefined ? 2 * room + 1 : Math.max(0, Math.floor(count))
  const climb = count === undefined ? room : Math.min(room, Math.floor(length / 2))
  const homes: number[] = []
  for (let i = 0; i < length; i++) {
    // A triangle: up `climb` semitones, back down, and up again if the round is longer than that.
    const step = climb === 0 ? 0 : i % (2 * climb)
    homes.push(start + (step <= climb ? step : 2 * climb - step))
  }
  return homes
}
