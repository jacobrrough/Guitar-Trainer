import { describe, expect, it } from 'vitest'
import type { VocalStep } from '../songs/vocal/types'
import { NOTE_INDEX } from './chords'
import {
  DEFAULT_RANGES,
  KEY_FAMILIES,
  MAX_KEY_NUDGE,
  MIN_RANGE_SPAN,
  WRITTEN_HOME,
  chooseKey,
  defaultRange,
  easyRange,
  fittingForm,
  keyFamily,
  patternFits,
  patternSpan,
  placePattern,
  spanOfSteps,
} from './keys'
import { pitchClass } from './pitch'

/** A small seeded generator, so a failing random case can be run again. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const int = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

/** Thirty ranges a singer could have: 7 to 14 semitones wide, anywhere a voice can be, the easy note anywhere inside. */
function randomRanges(seed: number): Array<{ low: number; high: number; easy: number }> {
  const rand = lcg(seed)
  return Array.from({ length: 30 }, () => {
    const low = int(rand, 38, 70)
    const high = low + int(rand, MIN_RANGE_SPAN, 14)
    return { low, high, easy: int(rand, low, high) }
  })
}

const FIVE_NOTE_SCALE = [0, 2, 4, 5, 7]
const TRIAD = [0, 4, 7]
const TRIAD_TO_THE_TOP = [0, 4, 7, 12]

/**
 * A short tune the way a song is written: [semitones above home, beats, syllable], null for a rest. It opens like
 * Mary Had a Little Lamb, then rests and jumps to the fifth, so it spans seven semitones and its long notes sit high.
 */
const TUNE: VocalStep[] = [
  [4, 1, 'Ma-'],
  [2, 1, 'ry'],
  [0, 1, 'had'],
  [2, 1, 'a'],
  [4, 1, 'lit-'],
  [4, 1, 'tle'],
  [4, 2, 'lamb'],
  [null, 2],
  [7, 2, 'snow'],
]

describe('default ranges', () => {
  it('are the two starting ranges of the design, each the smallest span the app stores', () => {
    expect(DEFAULT_RANGES.lower).toEqual({ low: 48, high: 55, easy: 52 })
    expect(DEFAULT_RANGES.higher).toEqual({ low: 60, high: 67, easy: 64 })
    expect(MIN_RANGE_SPAN).toBe(7)
    for (const r of Object.values(DEFAULT_RANGES)) expect(r.high - r.low).toBe(MIN_RANGE_SPAN)
  })

  it('become stored ranges marked as a default, never as measured', () => {
    expect(defaultRange('lower', 1234)).toEqual({ low: 48, high: 55, easy: 52, source: 'default', at: 1234 })
    expect(defaultRange('higher', 5).source).toBe('default')
    // A stored range is its own object: changing it must not change the next singer's default.
    const stored = defaultRange('higher', 5)
    stored.high += 1
    expect(DEFAULT_RANGES.higher.high).toBe(67)
  })

  it('fall back to three under and four over the easy note', () => {
    expect(easyRange(57)).toEqual({ low: 54, high: 61, easy: 57 })
    expect(easyRange(57).high - easyRange(57).low).toBe(MIN_RANGE_SPAN)
  })

  it('hold a five-note scale and 1-3-5: both defaults and the fallback around any easy note', () => {
    const ranges = [DEFAULT_RANGES.lower, DEFAULT_RANGES.higher, ...[40, 47, 52, 59, 64, 71, 76].map(easyRange)]
    for (const range of ranges) {
      for (const pattern of [FIVE_NOTE_SCALE, TRIAD]) {
        expect(patternFits(pattern, range), `${pattern} in ${range.low}-${range.high}`).toBe(true)
        const homes = placePattern(pattern, range, 0)
        expect(homes.length).toBeGreaterThan(0)
        for (const home of homes) {
          for (const offset of pattern) {
            expect(home + offset).toBeGreaterThanOrEqual(range.low)
            expect(home + offset).toBeLessThanOrEqual(range.high)
          }
        }
        // Seven semitones in a range of seven: there is one place for it, bottom note on the lowest note.
        expect(new Set(homes)).toEqual(new Set([range.low]))
      }
    }
  })
})

describe('chooseKey', () => {
  const tune = spanOfSteps(TUNE)

  it('reads a tune as written with its home note on middle C, long notes weighing more', () => {
    expect(WRITTEN_HOME).toBe(60)
    expect(tune.low).toBe(60)
    expect(tune.high).toBe(67)
    // 4+2+0+2+4+4+8+14 = 38 semitone-beats over 10 sung beats; the rest counts for nothing.
    expect(tune.centre).toBeCloseTo(63.8, 9)
    expect(spanOfSteps([[0, 1], [12, 3]], 48)).toEqual({ low: 48, high: 60, centre: 57 })
  })

  it('reads a tune that starts under its home note, and one with nothing to weigh', () => {
    // A pickup on the fifth below home, as Happy Birthday and Amazing Grace begin: the compass opens under the home note.
    const pickup: VocalStep[] = [[-5, 0.5, 'Hap-'], [-5, 0.5, 'py'], [-3, 1, 'birth-'], [-5, 1, 'day'], [0, 1, 'to'], [-1, 2, 'you'], [null, 1]]
    expect(spanOfSteps(pickup)).toEqual({ low: 55, high: 60, centre: 57.5 })
    // Only rests, or nothing at all: the tune sits on its home note and nothing is not a number.
    expect(spanOfSteps([[null, 4]])).toEqual({ low: 60, high: 60, centre: 60 })
    expect(spanOfSteps([])).toEqual({ low: 60, high: 60, centre: 60 })
    // Notes without a length still have a compass; with no lengths to weigh, the centre is its middle.
    expect(spanOfSteps([[2, 0], [7, 0]])).toEqual({ low: 62, high: 67, centre: 64.5 })
  })

  it('counts the top note of the range as singable: the range is inclusive at both ends', () => {
    // Seven semitones of tune, seven of range: exactly one key, top note on the highest note.
    const key = chooseKey({ low: 60, high: 67, centre: 63 }, { low: 48, high: 55 })
    expect(key).toEqual({ shift: -12, fits: true })
    // One semitone wider and nothing fits.
    expect(chooseKey({ low: 60, high: 68, centre: 64 }, { low: 48, high: 55 }).fits).toBe(false)
  })

  it('puts the centre of the tune nearest the middle of the range', () => {
    // Middle of 45-57 is 51 and the tune's centre is 63: twelve down puts one on the other.
    expect(chooseKey({ low: 60, high: 67, centre: 63 }, { low: 45, high: 57 })).toEqual({ shift: -12, fits: true })
    // A tune that sits low in its own span is lifted, one that sits high is lowered, inside the same range.
    const range = { low: 48, high: 64 }
    const lowLying = chooseKey({ low: 60, high: 67, centre: 61 }, range)
    const highLying = chooseKey({ low: 60, high: 67, centre: 66 }, range)
    expect(lowLying.shift).toBeGreaterThan(highLying.shift)
    for (const [key, centre] of [[lowLying, 61], [highLying, 66]] as const) expect(Math.abs(centre + key.shift - 56)).toBeLessThanOrEqual(1)
  })

  it('gives the same tune an octave apart to two voices an octave apart', () => {
    const lower = chooseKey(tune, { low: 45, high: 57 })
    const higher = chooseKey(tune, { low: 57, high: 69 })
    expect(lower).toEqual({ shift: -12, fits: true })
    expect(higher).toEqual({ shift: 0, fits: true })
  })

  it('prefers a key with open chords when one is within a semitone of the nearest', () => {
    // Middle of 50-63 is 56.5 and the tune's centre is 63.8: seven down (home F) is nearest, eight down (home E) is open.
    const key = chooseKey(tune, { low: 50, high: 63 })
    expect(key).toEqual({ shift: -8, fits: true })
    expect(KEY_FAMILIES[pitchClass(WRITTEN_HOME + key.shift)]).toEqual({ family: 'E', capo: 0 })
    // With no open key within a semitone the nearest key stands, capo and all: F here, with G two semitones off.
    const capoed = chooseKey({ low: 60, high: 64, centre: 63.5 }, { low: 65, high: 72 })
    expect(capoed).toEqual({ shift: 5, fits: true })
    expect(KEY_FAMILIES[pitchClass(WRITTEN_HOME + capoed.shift)]).toEqual({ family: 'E', capo: 1 })
    // It never trades more than a semitone for it, and never leaves the range for it.
    for (const range of randomRanges(11)) {
      const chosen = chooseKey(tune, range)
      if (!chosen.fits) continue
      const middle = (range.low + range.high) / 2
      let nearest = Infinity
      for (let shift = range.low - tune.low; shift <= range.high - tune.high; shift++) nearest = Math.min(nearest, Math.abs(tune.centre + shift - middle))
      expect(Math.abs(tune.centre + chosen.shift - middle)).toBeLessThanOrEqual(nearest + 1 + 1e-9)
    }
  })

  it('takes the lower of two open keys that are equally near', () => {
    // Centre 64 in a range whose middle is 65: one up is C sharp; C (no move) and D (two up) are both a semitone off.
    expect(chooseKey({ low: 60, high: 68, centre: 64 }, { low: 57, high: 73 })).toEqual({ shift: 0, fits: true })
  })

  it('uses an open key whenever the range leaves a semitone of room either side of the nearest key', () => {
    const rand = lcg(5)
    for (let i = 0; i < 200; i++) {
      const range = { low: int(rand, 40, 60), high: 0 }
      range.high = range.low + int(rand, 10, 16)
      const span = { low: 60, high: 60 + int(rand, 3, 7), centre: 60 + rand() * 3 }
      const { shift, fits } = chooseKey(span, range)
      expect(fits).toBe(true)
      const roomBelow = shift - (range.low - span.low)
      const roomAbove = range.high - span.high - shift
      if (roomBelow >= 2 && roomAbove >= 2) expect(KEY_FAMILIES[pitchClass(WRITTEN_HOME + shift)].capo, `shift ${shift}`).toBe(0)
    }
  })

  it('says a tune wider than the range does not fit, and still answers with a whole number', () => {
    const tooWide = chooseKey({ low: 55, high: 67, centre: 61 }, DEFAULT_RANGES.lower)
    expect(tooWide.fits).toBe(false)
    expect(Number.isInteger(tooWide.shift)).toBe(true)
    // As near as it can be: the centre lands within a semitone of the middle of the range.
    expect(Math.abs(61 + tooWide.shift - 51.5)).toBeLessThanOrEqual(0.5)
    // A nudge cannot make it fit.
    expect(chooseKey({ low: 55, high: 67, centre: 61 }, DEFAULT_RANGES.lower, 2)).toEqual(tooWide)
  })

  it('moves by the nudge, at most three semitones, and never out of the range', () => {
    const span = { low: 60, high: 64, centre: 62 }
    const range = { low: 48, high: 62 }
    const base = chooseKey(span, range)
    expect(MAX_KEY_NUDGE).toBe(3)
    expect(chooseKey(span, range, 0)).toEqual(base)
    expect(chooseKey(span, range, 2).shift).toBe(base.shift + 2)
    expect(chooseKey(span, range, -1).shift).toBe(base.shift - 1)
    // More than three is three.
    expect(chooseKey(span, range, 9).shift).toBe(base.shift + 3)
    expect(chooseKey(span, range, -9).shift).toBe(base.shift - 3)
    // In a range with a semitone of room the nudge stops at the edge.
    const tight = { low: 48, high: 53 }
    expect(chooseKey(span, tight, 3)).toEqual({ shift: -11, fits: true })
    expect(chooseKey(span, tight, -3)).toEqual({ shift: -12, fits: true })
    // A tune that fills the range cannot move at all.
    expect(chooseKey({ low: 60, high: 67, centre: 63 }, DEFAULT_RANGES.higher, 3)).toEqual({ shift: 0, fits: true })
  })

  it('reads a nudge that is not a number as no nudge: a damaged profile never gives a key that is not a number', () => {
    const span = { low: 60, high: 64, centre: 62 }
    const range = { low: 48, high: 62 }
    const base = chooseKey(span, range)
    // The nudge comes out of a stored record, so it can be missing or damaged.
    for (const stored of [NaN, undefined, null] as unknown as number[]) expect(chooseKey(span, range, stored), String(stored)).toEqual(base)
  })

  it('never goes lower for "Higher": each nudge is one semitone, until the range or the three semitones end', () => {
    const rand = lcg(31)
    let moved = 0
    for (let i = 0; i < 200; i++) {
      const low = int(rand, 36, 72)
      const range = { low, high: low + int(rand, MIN_RANGE_SPAN, 14) }
      const spanLow = 60 - int(rand, 0, 7)
      const span = { low: spanLow, high: spanLow + int(rand, 2, 9), centre: spanLow + rand() * 2 }
      const base = chooseKey(span, range)
      if (!base.fits) continue
      const lowest = range.low - span.low
      const highest = range.high - span.high
      let before = -Infinity
      for (let nudge = -4; nudge <= 4; nudge++) {
        const { shift } = chooseKey(span, range, nudge)
        expect(shift).toBeGreaterThanOrEqual(before)
        expect(shift).toBe(Math.min(highest, Math.max(lowest, base.shift + Math.min(3, Math.max(-3, nudge)))))
        if (shift !== base.shift) moved++
        before = shift
      }
    }
    expect(moved).toBeGreaterThan(200)
  })

  it('moves with the voice: a range an octave higher gets the same key an octave higher, nudge and all', () => {
    const rand = lcg(404)
    for (let i = 0; i < 200; i++) {
      const low = int(rand, 36, 60)
      const range = { low, high: low + int(rand, 5, 14) }
      const spanLow = 60 - int(rand, 0, 7)
      const spanHigh = spanLow + int(rand, 2, 12)
      const span = { low: spanLow, high: spanHigh, centre: spanLow + rand() * (spanHigh - spanLow) }
      const nudge = int(rand, -3, 3)
      const here = chooseKey(span, range, nudge)
      const above = chooseKey(span, { low: range.low + 12, high: range.high + 12 }, nudge)
      expect(above).toEqual({ shift: here.shift + 12, fits: here.fits })
    }
  })

  it('keeps inside a range whose edges are not whole notes', () => {
    // A range can come straight from what was heard: 47.6 to 55.2 holds the notes 48 to 55 and no others.
    expect(chooseKey({ low: 60, high: 67, centre: 63 }, { low: 47.6, high: 55.2 })).toEqual({ shift: -12, fits: true })
    // 48.4 to 55.2 holds 49 to 55: seven notes, one too few for this tune.
    expect(chooseKey({ low: 60, high: 67, centre: 63 }, { low: 48.4, high: 55.2 }).fits).toBe(false)
    // A round too: wherever the easy note lies and whichever way the day moves the start, 48 and 49 are the only homes.
    for (const easy of [47.6, 51.3, 56.2]) {
      for (let seed = 0; seed < 5; seed++) {
        const homes = placePattern(TRIAD, { low: 47.6, high: 56.2, easy }, seed)
        expect(homes.length).toBeGreaterThan(0)
        for (const home of homes) {
          expect(Number.isInteger(home)).toBe(true)
          expect(home, `easy ${easy} seed ${seed}`).toBeGreaterThanOrEqual(47.6)
          expect(home + 7, `easy ${easy} seed ${seed}`).toBeLessThanOrEqual(56.2)
        }
      }
    }
  })

  it('keeps every note inside the range for any tune, range and nudge, and finds a key whenever one exists', () => {
    const rand = lcg(2024)
    for (let i = 0; i < 500; i++) {
      const low = int(rand, 36, 72)
      const range = { low, high: low + int(rand, MIN_RANGE_SPAN, 14) }
      const spanLow = 60 - int(rand, 0, 7)
      const spanHigh = spanLow + int(rand, 2, 16)
      const span = { low: spanLow, high: spanHigh, centre: spanLow + rand() * (spanHigh - spanLow) }
      const nudge = int(rand, -5, 5)
      const { shift, fits } = chooseKey(span, range, nudge)
      expect(Number.isInteger(shift)).toBe(true)
      expect(fits).toBe(spanHigh - spanLow <= range.high - range.low)
      if (!fits) continue
      expect(span.low + shift).toBeGreaterThanOrEqual(range.low)
      expect(span.high + shift).toBeLessThanOrEqual(range.high)
    }
  })
})

describe('KEY_FAMILIES', () => {
  it('names open shapes and a capo of 0 to 2 for all twelve home notes, as the design lists them', () => {
    const listed = ['C+0', 'C+1', 'D+0', 'D+1', 'E+0', 'E+1', 'E+2', 'G+0', 'G+1', 'A+0', 'A+1', 'A+2']
    expect(KEY_FAMILIES.map((k) => `${k.family}+${k.capo}`)).toEqual(listed)
  })

  it('sounds in the key it is asked for: the shape moved up by the capo is the home note', () => {
    for (let pc = 0; pc < 12; pc++) {
      const { family, capo } = KEY_FAMILIES[pc]
      expect((NOTE_INDEX[family] + capo) % 12, `pitch class ${pc}`).toBe(pc)
    }
  })

  it('is read by home note in any octave', () => {
    expect(keyFamily(60)).toEqual({ family: 'C', capo: 0 })
    expect(keyFamily(53)).toEqual({ family: 'E', capo: 1 })
    expect(keyFamily(47)).toEqual({ family: 'A', capo: 2 })
    expect(keyFamily(-3)).toEqual(keyFamily(69))
  })
})

describe('placePattern', () => {
  it('puts the middle of the pattern on the easy note', () => {
    // 0-2-4 has its middle two semitones above home: home 53 puts it on 55.
    expect(placePattern([0, 2, 4], { low: 48, high: 62, easy: 55 }, 0)[0]).toBe(53)
    // A middle between two semitones goes to the lower one: never higher than asked.
    expect(placePattern(FIVE_NOTE_SCALE, { low: 45, high: 59, easy: 52 }, 0)[0]).toBe(48)
    // An easy note at the edge of the range still gives a pattern inside it.
    expect(placePattern(FIVE_NOTE_SCALE, { low: 45, high: 59, easy: 45 }, 0)[0]).toBe(45)
    expect(placePattern(FIVE_NOTE_SCALE, { low: 45, high: 59, easy: 59 }, 0)[0]).toBe(52)
  })

  it('moves up a semitone each time until the top note is the highest note, then comes back', () => {
    const homes = placePattern([0, 2, 4], { low: 48, high: 62, easy: 55 }, 0)
    expect(homes).toEqual([53, 54, 55, 56, 57, 58, 57, 56, 55, 54, 53])
    // The top of the range is used: 58 + 4 is the highest note itself.
    expect(Math.max(...homes) + 4).toBe(62)
  })

  it('gives as many keys as the round has room for: up, then back', () => {
    const range = { low: 48, high: 62, easy: 55 }
    expect(placePattern([0, 2, 4], range, 0, 1)).toEqual([53])
    expect(placePattern([0, 2, 4], range, 0, 2)).toEqual([53, 54])
    expect(placePattern([0, 2, 4], range, 0, 3)).toEqual([53, 54, 53])
    expect(placePattern([0, 2, 4], range, 0, 4)).toEqual([53, 54, 55, 54])
    expect(placePattern([0, 2, 4], range, 0, 5)).toEqual([53, 54, 55, 54, 53])
    // With one semitone of room above, it goes up and down that one semitone.
    expect(placePattern(FIVE_NOTE_SCALE, { low: 48, high: 56, easy: 52 }, 0, 5)).toEqual([48, 49, 48, 49, 48])
    // With none it stays.
    expect(placePattern(FIVE_NOTE_SCALE, DEFAULT_RANGES.lower, 0, 4)).toEqual([48, 48, 48, 48])
  })

  it('never leaves the range, both ends included, for thirty random ranges', () => {
    const patterns = [FIVE_NOTE_SCALE, TRIAD, [0, 2, 4, 2, 0], [0, 4, 0], [0, -1, 0, 2], [0, 5], [7, 4, 0]]
    let reachedTop = 0
    let reachedBottom = 0
    for (const range of randomRanges(77)) {
      for (const pattern of patterns) {
        for (const seed of [0, 1, 2, 3, 4, 5, 17]) {
          for (const count of [undefined, 1, 2, 3, 4, 6]) {
            const homes = placePattern(pattern, range, seed, count)
            expect(homes.length).toBe(count ?? homes.length)
            expect(homes.length).toBeGreaterThan(0)
            for (const home of homes) {
              expect(Number.isInteger(home)).toBe(true)
              for (const offset of pattern) {
                const midi = home + offset
                expect(midi, `${pattern} in ${range.low}-${range.high} seed ${seed}`).toBeGreaterThanOrEqual(range.low)
                expect(midi, `${pattern} in ${range.low}-${range.high} seed ${seed}`).toBeLessThanOrEqual(range.high)
                if (midi === range.high) reachedTop++
                if (midi === range.low) reachedBottom++
              }
            }
            // One semitone at a time: a voice is never asked to jump keys.
            for (let i = 1; i < homes.length; i++) expect(Math.abs(homes[i] - homes[i - 1])).toBeLessThanOrEqual(1)
          }
        }
      }
    }
    // The highest and the lowest note are themselves asked for somewhere: the range is not treated as open at the top.
    expect(reachedTop).toBeGreaterThan(0)
    expect(reachedBottom).toBeGreaterThan(0)
  })

  it('is the same for the same day and starts near the easy note on every day', () => {
    const range = { low: 48, high: 62, easy: 55 }
    const starts = new Set<number>()
    for (let seed = 0; seed < 12; seed++) {
      const homes = placePattern([0, 2, 4], range, seed, 4)
      expect(placePattern([0, 2, 4], range, seed, 4)).toEqual(homes)
      expect(Math.abs(homes[0] - 53)).toBeLessThanOrEqual(2)
      starts.add(homes[0])
    }
    // Another day, another key: the seed is what changes it.
    expect(starts.size).toBeGreaterThan(1)
    // A seed is a day count or any number the planner hands over: fractions and negatives are still a day.
    expect(placePattern([0, 2, 4], range, -3.2, 4)).toEqual(placePattern([0, 2, 4], range, 3, 4))
  })

  it('starts in the middle of the range when the easy note is missing: a note that is not a number is never handed out', () => {
    const range = { low: 48, high: 62 }
    // Exercise parameters are read back from stored records, so the easy note can be absent or damaged.
    for (const easy of [NaN, undefined, null, Infinity] as unknown as number[]) {
      for (const count of [undefined, 3]) {
        const homes = placePattern([0, 2, 4], { ...range, easy }, 0, count)
        expect(homes[0], String(easy)).toBe(53)
        for (const home of homes) expect(Number.isInteger(home), String(easy)).toBe(true)
      }
    }
    // A seed that is not a number is day 0.
    expect(placePattern([0, 2, 4], { ...range, easy: 55 }, NaN, 3)).toEqual(placePattern([0, 2, 4], { ...range, easy: 55 }, 0, 3))
  })

  it('moves with the voice: a range an octave higher gets the same round an octave higher', () => {
    for (const range of randomRanges(9)) {
      for (const pattern of [FIVE_NOTE_SCALE, TRIAD, [0, -1, 0, 2]]) {
        for (const seed of [0, 3, 19_004]) {
          const here = placePattern(pattern, range, seed, 5)
          const above = placePattern(pattern, { low: range.low + 12, high: range.high + 12, easy: range.easy + 12 }, seed, 5)
          expect(above).toEqual(here.map((home) => home + 12))
        }
      }
    }
  })

  it('has no place for a pattern wider than the range, which sings its narrower form instead', () => {
    expect(patternSpan(TRIAD_TO_THE_TOP)).toBe(12)
    expect(patternSpan([0, -1, 0, 2])).toBe(3)
    const eleven = { low: 50, high: 61, easy: 55 }
    const twelve = { low: 50, high: 62, easy: 55 }
    expect(patternFits(TRIAD_TO_THE_TOP, eleven)).toBe(false)
    expect(placePattern(TRIAD_TO_THE_TOP, eleven, 0)).toEqual([])
    expect(placePattern(TRIAD_TO_THE_TOP, eleven, 0, 4)).toEqual([])
    // Twelve semitones hold the octave: 1-3-5-8 with home on the lowest note and 8 on the highest.
    expect(patternFits(TRIAD_TO_THE_TOP, twelve)).toBe(true)
    expect(placePattern(TRIAD_TO_THE_TOP, twelve, 0)).toEqual([50])
    expect(fittingForm([TRIAD_TO_THE_TOP, TRIAD], eleven)).toEqual(TRIAD)
    expect(fittingForm([TRIAD_TO_THE_TOP, TRIAD], twelve)).toEqual(TRIAD_TO_THE_TOP)
    // When not even the narrowest fits, it is still the narrowest that is handed back (and placePattern gives it no place).
    expect(fittingForm([TRIAD_TO_THE_TOP, TRIAD], { low: 50, high: 54 })).toEqual(TRIAD)
  })
})
