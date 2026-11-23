/**
 * Finding a singer's easy notes: the rules one at a time on frames written by hand, then the whole
 * walk (a hum, two slides down, two slides up) sung by the virtual singer through the app's real
 * analyser, at both sample rates phones use, straight and through the phone microphone model.
 *
 * Every test names the rule it would fail without.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { DEFAULT_RANGES, MIN_RANGE_SPAN } from '../../music/keys'
import type { VoiceRange } from '../../training/types'
import { HIGHEST_RANGE_NOTE, LOWEST_RANGE_NOTE, loadVoiceProfile, saveVoiceRange } from '../../training/voiceProfile'
import { phoneMic } from '../play/simCases.testutil'
import { analyseMic } from '../play/simulate'
import { VOICE } from '../play/voice/judge'
import { sing, type SungNote } from '../play/voice/virtualSinger.testutil'
import type { EarFrame, Heard } from '../play/voice/voiceEar'
import {
  GUITAR_DETECTOR,
  LiveDot,
  RANGE,
  RANGE_COPY,
  RANGE_DETECTOR,
  STEPS,
  Take,
  VoiceListener,
  edgeLine,
  finderReducer,
  finderView,
  highestHeld,
  humOf,
  ladderLabel,
  ladderSpot,
  ladderView,
  lowestHeld,
  measure,
  newFinder,
  rangeFrom,
  rangeText,
  resultLine,
  sameNotes,
  shiftRange,
  stepLabel,
  tooStrong,
  unheardLine,
  voiceLine,
  type FinderState,
  type Hum,
  type Measurement,
} from './rangeFinder'

// The sung sessions render and analyse half a minute of audio each.
vi.setConfig({ testTimeout: 120_000 })

const AT = new Date(2026, 10, 23, 15).getTime()
/** Seconds between two detector frames at 44.1 kHz. */
const HOP = 512 / 44100
/** The level the hand-written hum is hummed at. */
const LEVEL = 0.05
const HUM: Hum = { easy: 52, level: LEVEL }

/** Frames of a voice doing one thing: `midi` is a pitch, or the pitch by seconds since `from`. */
function voice(midi: number | ((t: number) => number), seconds: number, from = 0, rms = LEVEL): Heard[] {
  const out: Heard[] = []
  const frames = Math.round(seconds / HOP)
  for (let i = 0; i < frames; i++) {
    const t = from + i * HOP
    out.push({ at: t, time: t, midi: typeof midi === 'number' ? midi : midi(i * HOP), rms, clarity: 0.95, seconds: HOP })
  }
  return out
}

const end = (heard: Heard[]) => heard[heard.length - 1].time + HOP
const measured = (over: Partial<Measurement> = {}): Measurement => ({ hum: HUM, lows: [], highs: [], ...over })

describe('the numbers of the design', () => {
  it('are the ones written in docs/SINGING.md, section 5', () => {
    // A hum of 4 s that needs 1.5 s of voice; a note held 0.3 s; half and twice the hum's level;
    // two semitones off the bottom and three off the top; no edge under C2 or over D6; at most 14 semitones.
    expect(RANGE).toMatchObject({ humSeconds: 4, humVoiced: 1.5, held: 0.3, croakLevel: 0.5, pushLevel: 2, lowMargin: 2, highMargin: 3, lowestNote: 36, highestNote: 86, widest: 14 })
  })

  it('leave the walk under a minute even for a singer who never stops', () => {
    expect(RANGE.humSeconds + 4 * RANGE.slideSeconds).toBeLessThanOrEqual(30)
    // ... and long enough to read what to do before starting.
    expect(RANGE.wait).toBeGreaterThanOrEqual(8)
  })
})

describe('the hum', () => {
  it('gives the easy note as the rounded middle of what was hummed, and keeps its level', () => {
    // Mostly a little above E3, with a wobble at the start, a dip and one stretch far off: the middle is what counts.
    const heard = [...voice(54.6, 0.3), ...voice(52.3, 2, 0.3), ...voice(47, 0.2, 2.3), ...voice(64, 0.2, 2.5, 0.2)]
    expect(humOf(heard)).toEqual({ easy: 52, level: LEVEL })
  })

  it('needs a second and a half of voice', () => {
    expect(humOf(voice(52, RANGE.humVoiced - 0.1))).toBeNull()
    expect(humOf(voice(52, RANGE.humVoiced + 0.1))).not.toBeNull()
    expect(humOf([])).toBeNull()
  })

  it('is not a hum when the smallest range around it would leave what a voice can do', () => {
    // Mains hum, a fan, a whistle: clear pitches no easy note can sit on.
    expect(humOf(voice(RANGE.lowestNote + 2, 2))).toBeNull()
    expect(humOf(voice(RANGE.highestNote - 3, 2))).toBeNull()
    expect(humOf(voice(RANGE.lowestNote + 3, 2))?.easy).toBe(RANGE.lowestNote + 3)
    expect(humOf(voice(RANGE.highestNote - 4, 2))?.easy).toBe(RANGE.highestNote - 4)
  })
})

describe('the lowest and the highest note held', () => {
  it('counts a note once the voice has stayed on it for 0.3 s, and not before', () => {
    const touched = [...voice(50, 1), ...voice(45, RANGE.held - 0.08, 1)]
    expect(lowestHeld(touched, LEVEL)).toBeCloseTo(50, 5)
    const stayed = [...voice(50, 1), ...voice(45, RANGE.held + 0.02, 1)]
    expect(lowestHeld(stayed, LEVEL)).toBeCloseTo(45, 5)
    const top = [...voice(55, 1), ...voice(62, RANGE.held - 0.08, 1)]
    expect(highestHeld(top, LEVEL)).toBeCloseTo(55, 5)
    expect(highestHeld([...voice(55, 1), ...voice(62, RANGE.held + 0.02, 1)], LEVEL)).toBeCloseTo(62, 5)
  })

  it('hears nothing held in less than 0.3 s of voice', () => {
    expect(lowestHeld(voice(45, RANGE.held - 0.05), LEVEL)).toBeNull()
    expect(highestHeld(voice(45, RANGE.held - 0.05), LEVEL)).toBeNull()
    expect(lowestHeld([], LEVEL)).toBeNull()
  })

  it('does not join two short sounds across a silence into one held note', () => {
    const first = voice(45, 0.2)
    const apart = [...first, ...voice(45, 0.2, end(first) + 0.2)]
    expect(lowestHeld(apart, LEVEL)).toBeNull()
    // A frame or two the detector lost is not a silence.
    const blip = [...first, ...voice(45, 0.2, end(first) + 2 * HOP)]
    expect(lowestHeld(blip, LEVEL)).toBeCloseTo(45, 5)
  })

  it('is not moved by a stray reading or two', () => {
    const low = voice(45, 0.6)
    low[20] = { ...low[20], midi: 33 }
    low[21] = { ...low[21], midi: 33 }
    expect(lowestHeld(low, LEVEL)).toBeCloseTo(45, 5)
    const high = voice(62, 0.6)
    high[20] = { ...high[20], midi: 74 }
    high[21] = { ...high[21], midi: 74 }
    expect(highestHeld(high, LEVEL)).toBeCloseTo(62, 5)
  })

  it('ignores a croak: a low note at under half the level of the hum', () => {
    const slide = voice(47, 1)
    const croak = (level: number) => [...slide, ...voice(42, 0.6, end(slide), level * LEVEL)]
    expect(lowestHeld(croak(RANGE.croakLevel - 0.1), LEVEL)).toBeCloseTo(47, 5)
    expect(lowestHeld(croak(RANGE.croakLevel + 0.1), LEVEL)).toBeCloseTo(42, 5)
    // Nothing but a croak is nothing held.
    expect(lowestHeld(voice(42, 0.6, 0, 0.3 * LEVEL), LEVEL)).toBeNull()
  })

  it('ignores a push: a high note at over twice the level of the hum', () => {
    const slide = voice(60, 1)
    const push = (level: number) => [...slide, ...voice(66, 0.6, end(slide), level * LEVEL)]
    expect(highestHeld(push(RANGE.pushLevel + 0.2), LEVEL)).toBeCloseTo(60, 5)
    expect(highestHeld(push(RANGE.pushLevel - 0.2), LEVEL)).toBeCloseTo(66, 5)
    expect(highestHeld(voice(66, 0.6, 0, 3 * LEVEL), LEVEL)).toBeNull()
  })

  it('asks no more of a top note than not to be forced, and no more of a low note than to sound', () => {
    // A light top note is how it should be sung; a full low note is no croak.
    expect(highestHeld(voice(66, 0.6, 0, 0.3 * LEVEL), LEVEL)).toBeCloseTo(66, 5)
    expect(lowestHeld(voice(42, 0.6, 0, 3 * LEVEL), LEVEL)).toBeCloseTo(42, 5)
  })

  it('reads a slide that never stops near its end, and never past it', () => {
    // A sigh from E3 down to G2 in three seconds, a siren from E3 up to E4.
    const low = lowestHeld(voice((t) => 52 - 3 * t, 3), LEVEL)!
    expect(low).toBeGreaterThanOrEqual(43)
    expect(low).toBeLessThan(44)
    const high = highestHeld(voice((t) => 52 + 4 * t, 3), LEVEL)!
    expect(high).toBeLessThanOrEqual(64)
    expect(high).toBeGreaterThan(62.8)
  })
})

describe('the range from what was heard', () => {
  it('takes two notes off the bottom and three off the top, of the lower slide down and the higher slide up', () => {
    const range = rangeFrom(measured({ lows: [44.2, 43.2], highs: [60.7, 61.9] }), AT)
    expect(range).toEqual({ low: 45, high: 59, easy: 52, measuredLow: 43, measuredHigh: 62, source: 'measured', at: AT })
  })

  it('falls back to three under and four over the easy note when the slides leave under eight notes', () => {
    // Heard 48 to 60: comfortable 50 to 57, eight notes, the fewest that will do.
    expect(rangeFrom(measured({ lows: [48], highs: [60] }), AT)).toMatchObject({ low: 50, high: 57, source: 'measured' })
    // Heard 49 to 60: comfortable 51 to 57, one note short.
    expect(rangeFrom(measured({ lows: [49], highs: [60] }), AT)).toEqual({ low: 49, high: 56, easy: 52, measuredLow: 49, measuredHigh: 60, source: 'default', at: AT })
  })

  it('falls back when an edge is not a note a voice has', () => {
    const low = (note: number) => rangeFrom(measured({ lows: [note], highs: [62] }), AT)!
    expect(low(RANGE.lowestNote).source).toBe('measured')
    expect(low(RANGE.lowestNote - 1)).toMatchObject({ low: 49, high: 56, source: 'default' })
    const high = (note: number) => rangeFrom(measured({ lows: [45], highs: [note] }), AT)!
    expect(high(RANGE.highestNote).source).toBe('measured')
    expect(high(RANGE.highestNote + 1)).toMatchObject({ low: 49, high: 56, source: 'default' })
    // What was not a voice is not kept as "heard" either.
    expect(low(RANGE.lowestNote - 1).measuredLow).toBeUndefined()
    expect(high(RANGE.highestNote + 1).measuredHigh).toBeUndefined()
  })

  it('gives the small range around the hum when both slides were skipped, and says it is a default', () => {
    expect(rangeFrom(measured(), AT)).toEqual({ low: 49, high: 56, easy: 52, source: 'default', at: AT })
  })

  it('uses the side that was sung when the other was skipped', () => {
    expect(rangeFrom(measured({ lows: [43] }), AT)).toEqual({ low: 45, high: 56, easy: 52, measuredLow: 43, source: 'measured', at: AT })
    expect(rangeFrom(measured({ highs: [64] }), AT)).toEqual({ low: 49, high: 61, easy: 52, measuredHigh: 64, source: 'measured', at: AT })
  })

  it('cuts a wide voice to fourteen semitones around the easy note', () => {
    // Heard 38 to 70: comfortable 40 to 67. Six under the easy note and eight over.
    expect(rangeFrom(measured({ lows: [38], highs: [70] }), AT)).toMatchObject({ low: 46, high: 60, easy: 52, measuredLow: 38, measuredHigh: 70, source: 'measured' })
    // An easy note near the bottom of the voice: the cut never reaches under the comfortable bottom ...
    expect(rangeFrom(measured({ hum: { easy: 43, level: LEVEL }, lows: [39], highs: [70] }), AT)).toMatchObject({ low: 41, high: 55, easy: 43 })
    // ... and near the top never over the comfortable top.
    expect(rangeFrom(measured({ hum: { easy: 65, level: LEVEL }, lows: [40], highs: [70] }), AT)).toMatchObject({ low: 53, high: 67, easy: 65 })
    // Fourteen itself is left alone.
    expect(rangeFrom(measured({ lows: [43], highs: [62] }), AT)).toMatchObject({ low: 45, high: 59 })
  })

  it('moves an easy note that lies outside the comfortable notes onto their edge', () => {
    // The hum was the lowest note of the voice: two above it is the comfortable bottom.
    expect(rangeFrom(measured({ lows: [51.8], highs: [66] }), AT)).toMatchObject({ low: 54, high: 63, easy: 54 })
    expect(rangeFrom(measured({ hum: { easy: 60, level: LEVEL }, lows: [45], highs: [61] }), AT)).toMatchObject({ low: 47, high: 58, easy: 58 })
  })

  it('has nothing to say without a hum', () => {
    expect(rangeFrom(measured({ hum: null, lows: [43], highs: [62] }), AT)).toBeNull()
  })

  it('only ever gives a range the app can store: whole notes, eight to fifteen of them, the easy note inside', () => {
    for (let easy = RANGE.lowestNote + 3; easy <= RANGE.highestNote - 4; easy += 3) {
      for (const low of [undefined, 30, 36, 41.4, easy - 9.5, easy - 2, easy + 3]) {
        for (const high of [undefined, 90, 86, 71.6, easy + 12.5, easy + 5, easy - 1]) {
          const range = rangeFrom(measured({ hum: { easy, level: LEVEL }, lows: low === undefined ? [] : [low], highs: high === undefined ? [] : [high] }), AT)!
          const what = `easy ${easy}, heard ${low} to ${high}`
          expect([range.low, range.high, range.easy].every(Number.isInteger), what).toBe(true)
          expect(range.high - range.low, what).toBeGreaterThanOrEqual(MIN_RANGE_SPAN)
          expect(range.high - range.low, what).toBeLessThanOrEqual(RANGE.widest)
          expect(range.easy, what).toBeGreaterThanOrEqual(range.low)
          expect(range.easy, what).toBeLessThanOrEqual(range.high)
          expect(range.low, what).toBeGreaterThanOrEqual(RANGE.lowestNote)
          expect(range.high, what).toBeLessThanOrEqual(RANGE.highestNote)
        }
      }
    }
  })
})

describe('a bit lower, a bit higher', () => {
  const range: VoiceRange = { low: 45, high: 59, easy: 52, measuredLow: 43, measuredHigh: 62, source: 'measured', at: 1 }

  it('moves every note one semitone and marks the range as moved by hand', () => {
    expect(shiftRange(range, -1, AT)).toEqual({ low: 44, high: 58, easy: 51, measuredLow: 43, measuredHigh: 62, source: 'manual', at: AT })
    expect(shiftRange(range, 1, AT)).toEqual({ low: 46, high: 60, easy: 53, measuredLow: 43, measuredHigh: 62, source: 'manual', at: AT })
  })

  it('never widens or narrows the range', () => {
    let moved = range
    for (let i = 0; i < 5; i++) moved = shiftRange(moved, 1, AT)!
    expect(moved.high - moved.low).toBe(range.high - range.low)
  })

  it('stops at the lowest and the highest note a voice has', () => {
    expect(shiftRange({ ...range, low: RANGE.lowestNote, high: RANGE.lowestNote + 7, easy: RANGE.lowestNote + 3 }, -1, AT)).toBeNull()
    expect(shiftRange({ ...range, low: RANGE.highestNote - 7, high: RANGE.highestNote, easy: RANGE.highestNote - 4 }, 1, AT)).toBeNull()
  })

  it('says so, kindly, when a button has nowhere left to go, and says nothing while both can move', () => {
    // A button that only goes grey leaves the learner guessing whether the app is stuck.
    const lowest: VoiceRange = { ...range, low: RANGE.lowestNote, high: RANGE.lowestNote + 7, easy: RANGE.lowestNote + 3 }
    const highest: VoiceRange = { ...range, low: RANGE.highestNote - 7, high: RANGE.highestNote, easy: RANGE.highestNote - 4 }
    expect(edgeLine(lowest)).toBe(RANGE_COPY.lowest)
    expect(edgeLine(highest)).toBe(RANGE_COPY.highest)
    expect(RANGE_COPY.lowest).not.toBe(RANGE_COPY.highest)
    expect(edgeLine(range)).toBeNull()
    // One note away from an edge both buttons still work.
    expect(edgeLine(shiftRange(lowest, 1, AT)!)).toBeNull()
    expect(edgeLine(shiftRange(highest, -1, AT)!)).toBeNull()
  })

  it('knows whether a new result changed the notes the singer had', () => {
    // Only then is there something to go back to. Where the notes came from and when does not count.
    const again: VoiceRange = { ...range, source: 'manual', at: AT }
    expect(sameNotes(range, again)).toBe(true)
    expect(sameNotes(range, { ...range, low: range.low + 1 })).toBe(false)
    expect(sameNotes(range, { ...range, high: range.high - 1 })).toBe(false)
    expect(sameNotes(range, { ...range, easy: range.easy + 1 })).toBe(false)
  })
})

describe('one listening step', () => {
  /** Gives a take what was heard, frame by frame as the microphone would, silence included: call it with the time to go on to. */
  function feeding(take: Take, heard: Heard[] = []): (until: number) => void {
    let i = 0
    let t = 0
    return (until) => {
      for (; t < until; t += HOP) {
        const now: Heard[] = []
        while (i < heard.length && heard[i].time <= t + 1e-9) now.push(heard[i++])
        take.add(now, t)
      }
    }
  }

  it('waits for a voice, and gives up kindly when none comes', () => {
    const take = new Take('hum')
    const feed = feeding(take)
    expect(take.status).toBe('waiting')
    feed(RANGE.wait - 0.5)
    expect(take.status).toBe('waiting')
    feed(RANGE.wait + 0.1)
    expect(take.status).toBe('done')
    expect(take.heard).toEqual([])
  })

  it('listens to a hum for four seconds from where the voice starts', () => {
    const take = new Take('hum')
    const feed = feeding(take, voice(52, 6, 3))
    feed(3 + RANGE.humSeconds - 0.2)
    expect(take.status).toBe('hearing')
    expect(take.progress).toBeGreaterThan(0.9)
    expect(take.progress).toBeLessThan(1)
    feed(3 + RANGE.humSeconds + 0.3)
    expect(take.status).toBe('done')
    expect(take.progress).toBe(1)
    expect(humOf(take.heard)?.easy).toBe(52)
  })

  it('does not make a singer who has finished wait out the clock', () => {
    const take = new Take('down')
    const feed = feeding(take, voice((t) => 52 - 3 * t, 2, 1))
    feed(3 + RANGE.quiet - 0.2)
    expect(take.status).toBe('hearing')
    feed(3 + RANGE.quiet + 0.2)
    expect(take.status).toBe('done')
    // The same for a hum that was long enough.
    const hum = new Take('hum')
    feeding(hum, voice(52, RANGE.humVoiced + 0.2, 1))(1 + RANGE.humVoiced + 0.2 + RANGE.quiet + 0.2)
    expect(hum.status).toBe('done')
  })

  it('does not take a cough for the slide', () => {
    // A short sound, a breath of a second and a half, then the slide: the take is still open when it comes,
    // and it runs its whole length from there.
    const take = new Take('down')
    const feed = feeding(take, [...voice(50, 0.2, 0.3), ...voice((t) => 52 - 1.5 * t, 5, 2)])
    feed(1.9)
    expect(take.status).toBe('waiting')
    feed(2.5)
    expect(take.status).toBe('hearing')
    feed(6.9)
    expect(take.status).toBe('hearing')
    feed(7 + RANGE.quiet + 0.2)
    expect(take.status).toBe('done')
    expect(lowestHeld(take.heard, LEVEL)).toBeLessThan(45.5)
  })

  it('does not take the end of the step before for the new step', () => {
    // The hum went on for most of a second after its step had ended; the sigh comes three seconds later.
    const tail = voice(52, 0.8, 0)
    const sigh = voice((t) => 52 - 3 * t, 2, 3)
    const take = new Take('down', true)
    const feed = feeding(take, [...tail, ...sigh])
    feed(0.5)
    expect(take.status).toBe('waiting')
    feed(2.5)
    // Still open: the tail was no slide, however long it was.
    expect(take.status).toBe('waiting')
    feed(5 + RANGE.quiet + 0.2)
    expect(take.status).toBe('done')
    expect(take.heard[0].time).toBeGreaterThanOrEqual(3)
    expect(lowestHeld(take.heard, LEVEL)).toBeLessThan(47.5)
    // A singer who had stopped and starts the next step quickly is heard from the first note on.
    const quick = new Take('down', true)
    feeding(quick, voice((t) => 52 - 3 * t, 2, 0.5))(1.5)
    expect(quick.status).toBe('hearing')
    expect(quick.heard[0].time).toBeCloseTo(0.5, 1)
    // A step that opens on a tap is heard from its first moment: nobody was singing before it.
    const fresh = new Take('hum')
    feeding(fresh, voice(52, 2, 0))(1)
    expect(fresh.status).toBe('hearing')
    expect(fresh.heard[0].time).toBe(0)
  })

  it('hears a hum that sinks straight into the sigh, without a breath between', () => {
    // The hum was still sounding when its step ended, and the singer, asked to start on that very note,
    // lets it fall from there. Once the voice has left the note it was on, it is the sigh.
    const take = new Take('down', true)
    const feed = feeding(take, [...voice(52, 1, 0), ...voice((t) => 52 - 3 * t, 2.7, 1)])
    feed(1.5)
    // Half a second into the fall, a tone and a half down: still the hum, for all anyone can tell.
    expect(take.status).toBe('waiting')
    expect(take.heard).toEqual([])
    feed(2.2)
    expect(take.status).toBe('hearing')
    feed(3.7 + RANGE.quiet + 0.2)
    expect(take.status).toBe('done')
    const low = lowestHeld(take.heard, LEVEL)!
    expect(low).toBeGreaterThanOrEqual(43.9)
    expect(low).toBeLessThan(45)
    // The hum itself is not in it.
    expect(Math.max(...take.heard.map((h) => h.midi))).toBeLessThanOrEqual(52 - RANGE.leave + 0.1)
    // A hum that wavers by a semitone and a half while it ends has not left its note.
    const wavering = new Take('down', true)
    feeding(wavering, voice((t) => 52 - 1.5 * Math.sin(20 * t), 2, 0))(2.2)
    expect(wavering.status).toBe('waiting')
    expect(wavering.heard).toEqual([])
    // Nor have stray readings far below it, however many, as long as each stands alone.
    const stray = voice(52, 2, 0)
    for (let i = 20; i < stray.length; i += 10) stray[i] = { ...stray[i], midi: 45 }
    const steady = new Take('down', true)
    feeding(steady, stray)(2.2)
    expect(steady.heard).toEqual([])
    // A voice that goes the other way is not this step: a hum that rises is no sigh ...
    const rising = new Take('down', true)
    feeding(rising, voice((t) => 52 + 3 * t, 2, 0))(2.2)
    expect(rising.heard).toEqual([])
    // ... and it is the siren, when the siren is what was asked for.
    const siren = new Take('up', true)
    feeding(siren, [...voice(52, 0.5, 0), ...voice((t) => 52 + 4 * t, 2, 0.5)])(2.4)
    expect(siren.status).toBe('hearing')
    expect(highestHeld(siren.heard, LEVEL)).toBeGreaterThan(58)
  })

  it('ends a slide that goes on and on', () => {
    const take = new Take('up')
    feeding(take, voice(55, RANGE.slideSeconds + 2, 0.5))(0.5 + RANGE.slideSeconds + 0.3)
    expect(take.status).toBe('done')
  })

  it('starts over when the microphone was away and has come back', () => {
    // Half a hum, then no frames at all for twenty seconds (another screen closed the microphone, a call),
    // then frames again. The waiting time was not used up while nobody could be heard, and the half hum
    // from before is not joined to what comes now.
    const take = new Take('hum')
    for (let t = 0; t < 1; t += HOP) take.add(voice(52, HOP, t), t)
    expect(take.status).toBe('hearing')
    const back = 21
    take.add([], back)
    expect(take.status).toBe('waiting')
    expect(take.heard).toEqual([])
    expect(take.progress).toBe(0)
    for (let t = back + HOP; t < back + RANGE.wait - 0.5; t += HOP) take.add([], t)
    expect(take.status).toBe('waiting')
    // The same for a step that was still waiting when the microphone went.
    const waiting = new Take('down', true)
    for (let t = 0; t < 2; t += HOP) waiting.add([], t)
    waiting.add([], 40)
    expect(waiting.status).toBe('waiting')
    // The hum of the step before was still sounding when the microphone went. What is sung when it is
    // back is the step itself, from its first note: nobody holds a note through a phone call.
    const carried = new Take('down', true)
    for (let t = 0; t < 0.5; t += HOP) carried.add(voice(52, HOP, t), t)
    expect(carried.heard).toEqual([])
    for (const h of voice(50, 0.5, 30)) carried.add([h], h.time)
    expect(carried.status).toBe('hearing')
    expect(carried.heard[0].time).toBe(30)
    // A frame or two that went missing is not the microphone going away.
    const steady = new Take('hum')
    for (let t = 0; t < 1; t += HOP) steady.add(voice(52, HOP, t), t)
    steady.add(voice(52, HOP, 1 + 3 * HOP), 1 + 3 * HOP)
    expect(steady.status).toBe('hearing')
    expect(steady.heard.length).toBeGreaterThan(80)
  })
})

describe('the steps of the range finder', () => {
  const hum = voice(52, 2)
  const down = voice((t) => 52 - 3 * t, 3)
  const up = voice((t) => 52 + 3 * t, 3)
  const heard = (state: FinderState, frames: Heard[]) => finderReducer(state, { type: 'heard', heard: frames, at: AT })
  const start = () => finderReducer(newFinder(), { type: 'start' })

  it('is a hum, two slides down and two slides up', () => {
    expect(STEPS).toEqual(['hum', 'down', 'down', 'up', 'up'])
    let state = start()
    expect(state).toMatchObject({ stage: 'listen', step: 0 })
    for (const [i, frames] of [hum, down, down, up, up].entries()) {
      expect(state).toMatchObject({ stage: 'listen', step: i })
      state = heard(state, frames)
    }
    expect(state.stage).toBe('result')
    expect(state.range).toMatchObject({ easy: 52, source: 'measured', at: AT })
    expect(state.range!.measuredLow).toBe(44)
    expect(state.range!.measuredHigh).toBe(60)
    expect(resultLine(state)).toBe(RANGE_COPY.result.measured)
  })

  it('asks again, kindly, when a step was not heard, and the step can be sung again or skipped', () => {
    const state = heard(start(), voice(52, 0.5))
    expect(state).toMatchObject({ stage: 'unheard', step: 0 })
    expect(finderReducer(state, { type: 'again' })).toMatchObject({ stage: 'listen', step: 0 })
    const slide = heard(heard(start(), hum), [])
    expect(slide).toMatchObject({ stage: 'unheard', step: 1 })
    expect(finderReducer(slide, { type: 'again' })).toMatchObject({ stage: 'listen', step: 1 })
    expect(finderReducer(slide, { type: 'skip', at: AT })).toMatchObject({ stage: 'listen', step: 2 })
  })

  it('tells a slide up that was sung with more voice than the hum from one that was not heard', () => {
    // Heard from start to end, and every note of it at three times the hum: nothing is kept of it, and
    // "move the phone closer" would make the next try stronger still.
    const forced = voice((t) => 52 + 3 * t, 3, 0, 3 * LEVEL)
    expect(tooStrong(forced, LEVEL)).toBe(true)
    expect(tooStrong(up, LEVEL)).toBe(false)
    expect(tooStrong([], LEVEL)).toBe(false)
    // Too short to hold anything is "not heard", however strong it was.
    expect(tooStrong(voice(60, RANGE.held - 0.1, 0, 3 * LEVEL), LEVEL)).toBe(false)
    // A slide that was gentle for a while and then forced gave a note: nothing to say.
    expect(tooStrong([...voice(55, 1), ...voice(62, 1, 1, 3 * LEVEL)], LEVEL)).toBe(false)
    let state = heard(heard(heard(start(), hum), down), down)
    expect(state).toMatchObject({ stage: 'listen', step: 3 })
    state = heard(state, forced)
    expect(state).toMatchObject({ stage: 'unheard', step: 3, strong: true })
    expect(unheardLine(state)).toBe(RANGE_COPY.strong)
    expect(RANGE_COPY.strong).not.toMatch(/closer/)
    // Sung again as softly as the hum, it counts, and the remark is gone.
    state = finderReducer(state, { type: 'again' })
    expect(state).toMatchObject({ stage: 'listen', step: 3, strong: false })
    state = heard(state, up)
    expect(state).toMatchObject({ stage: 'listen', step: 4, strong: false })
    expect(state.measured.highs).toHaveLength(1)
    // Nothing at all is "not heard", and so is a sigh that barely sounded: there, closer is right.
    const silent = heard(state, [])
    expect(silent).toMatchObject({ stage: 'unheard', strong: false })
    expect(unheardLine(silent)).toBe(RANGE_COPY.unheard)
    const faint = heard(heard(start(), hum), voice((t) => 52 - 3 * t, 3, 0, 0.3 * LEVEL))
    expect(faint).toMatchObject({ stage: 'unheard', step: 1, strong: false })
    // Skipping a step that was too strong leaves no remark behind for the next one.
    const skipped = finderReducer(heard(heard(heard(heard(start(), hum), down), down), forced), { type: 'skip', at: AT })
    expect(skipped).toMatchObject({ stage: 'listen', step: 4, strong: false })
  })

  it('lets every slide be skipped: the range is then the small one around the hum, said plainly', () => {
    let state = heard(start(), hum)
    for (let i = 0; i < 4; i++) state = finderReducer(state, { type: 'skip', at: AT })
    expect(state.stage).toBe('result')
    expect(state.range).toEqual({ low: 49, high: 56, easy: 52, source: 'default', at: AT })
    expect(resultLine(state)).toBe(RANGE_COPY.result.aroundEasy)
  })

  it('offers "Lower voice" and "Higher voice" when the hum is skipped or there is no microphone: 48 to 55 or 60 to 67', () => {
    for (const state of [finderReducer(start(), { type: 'skip', at: AT }), finderReducer(newFinder(), { type: 'skip', at: AT }), finderReducer(heard(start(), []), { type: 'skip', at: AT })]) {
      expect(state.stage).toBe('choose')
      expect(state.range).toBeNull()
      const lower = finderReducer(state, { type: 'choose', voice: 'lower', at: AT })
      expect(lower).toMatchObject({ stage: 'result', range: { low: 48, high: 55, easy: 52, source: 'default', at: AT } })
      const higher = finderReducer(state, { type: 'choose', voice: 'higher', at: AT })
      expect(higher).toMatchObject({ stage: 'result', range: { low: 60, high: 67, easy: 64, source: 'default', at: AT } })
      expect(resultLine(lower)).toBe(RANGE_COPY.result.chosen)
    }
    expect(DEFAULT_RANGES.lower).toEqual({ low: 48, high: 55, easy: 52 })
    expect(DEFAULT_RANGES.higher).toEqual({ low: 60, high: 67, easy: 64 })
  })

  it('counts the steps for the learner, from one', () => {
    expect(stepLabel(0)).toBe('Step 1 of 5')
    expect(stepLabel(4)).toBe('Step 5 of 5')
  })

  it('promises on the first screen as many steps as it then counts', () => {
    // "Three short steps" followed by "Step 4 of 5" reads as if something had gone astray.
    expect(STEPS).toHaveLength(5)
    expect(RANGE_COPY.intro).toMatch(/^Five short steps/)
    expect(RANGE_COPY.intro).toMatch(/down twice and up twice/)
  })

  it('starts again from nothing', () => {
    const done = finderReducer(newFinder(), { type: 'choose', voice: 'lower', at: AT })
    expect(finderReducer(done, { type: 'restart' })).toEqual(newFinder())
    expect(finderReducer(heard(start(), hum), { type: 'start' })).toMatchObject({ stage: 'listen', step: 0, measured: { hum: null, lows: [], highs: [] } })
  })

  it('does not count a slide twice or without a hum to compare it with', () => {
    const empty: Measurement = { hum: null, lows: [], highs: [] }
    expect(measure(empty, 'down', down)).toEqual(empty)
    const once = measure(measure(empty, 'hum', hum), 'down', down)
    expect(once.lows).toHaveLength(1)
    expect(once.highs).toHaveLength(0)
    // The slides were judged against the level of the hum before: a new hum starts over.
    expect(measure(measure(once, 'up', up), 'hum', hum)).toEqual({ hum: HUM, lows: [], highs: [] })
  })
})

describe('what the microphone hears', () => {
  const frame = (time: number, rms: number, freq = 130.81): EarFrame & { time: number } => ({ freq, clarity: 0.95, rms, time })

  it('takes the level of the room from the frames before the singing, as a sung run does', () => {
    const listener = new VoiceListener(44100)
    // A noisy room: twice its level is asked of a voice.
    for (let i = 0; i < 100; i++) listener.rest(frame(i * HOP, 0.006))
    const faint = listener.hear(frame(100 * HOP, 0.006 * VOICE.floorFactor - 0.001))
    const clear = [...listener.hear(frame(101 * HOP, 0.006 * VOICE.floorFactor + 0.001)), ...listener.hear(frame(102 * HOP, 0.02))]
    expect(faint).toEqual([])
    expect(clear).toHaveLength(2)
    expect(clear[0].midi).toBeCloseTo(48, 1)
  })

  it('hears a quiet voice in a quiet room', () => {
    const listener = new VoiceListener(44100)
    for (let i = 0; i < 100; i++) listener.rest(frame(i * HOP, 0.0005))
    expect(listener.hear(frame(100 * HOP, VOICE.minRms + 0.001))).toHaveLength(1)
  })

  it('sets the detector to the whole of what a voice can do, and knows what to give back to the guitar', () => {
    expect(RANGE_DETECTOR).toEqual({ minFreq: 60, maxFreq: 1200, threshold: 0.9 })
    // All three, as the audio engine opens a microphone when nothing is asked for: the tuner that takes
    // the microphone over only moves the lower edge, so whatever is left here is what it tunes with.
    expect(GUITAR_DETECTOR).toEqual({ minFreq: 55, maxFreq: 1500, threshold: 0.93 })
  })
})

describe('the dot on the ladder', () => {
  it('shows where the voice is now, steadied over a few frames', () => {
    const dot = new LiveDot()
    const heard = voice(52, 0.2)
    heard[heard.length - 1] = { ...heard[heard.length - 1], midi: 64 }
    dot.add(heard)
    expect(dot.at(end(heard))).toBeCloseTo(52, 5)
  })

  it('goes away soon after the voice stops', () => {
    const dot = new LiveDot()
    const heard = voice(52, 0.2)
    dot.add(heard)
    expect(dot.at(end(heard) + 0.1)).not.toBeNull()
    expect(dot.at(end(heard) + 1)).toBeNull()
    expect(new LiveDot().at(0)).toBeNull()
  })

  it('draws two notes more than the easy notes at each end, the highest at the top', () => {
    const view = ladderView({ low: 48, high: 55 })
    expect(view).toEqual({ bottom: 46, top: 57 })
    const top = ladderSpot(57, view)
    const bottom = ladderSpot(46, view)
    expect(top.y).toBeLessThan(bottom.y)
    expect(top.y).toBeGreaterThan(0)
    expect(bottom.y).toBeLessThan(1)
    // One row for each note, evenly.
    expect(ladderSpot(50, view).y - ladderSpot(51, view).y).toBeCloseTo(1 / 12, 9)
    expect(ladderSpot(51.5, view).beyond).toBeNull()
  })

  it('keeps a voice outside the picture at its edge and says which way it went', () => {
    const view = ladderView({ low: 48, high: 55 })
    expect(ladderSpot(70, view)).toEqual({ y: 0, beyond: 'above' })
    expect(ladderSpot(30, view)).toEqual({ y: 1, beyond: 'below' })
  })

  it('shows a wide stretch of notes while the range is not known, then the notes around the hum', () => {
    // Before the hum: room for a low and for a high speaking voice.
    const open = finderView(null)
    expect(open.bottom).toBeLessThanOrEqual(43)
    expect(open.top).toBeGreaterThanOrEqual(72)
    // After it: as far as a slide may go either way before the range is cut, and a little more.
    const around = finderView(HUM)
    expect(around.bottom).toBeLessThanOrEqual(HUM.easy - 12)
    expect(around.top).toBeGreaterThanOrEqual(HUM.easy + 12)
    expect(ladderSpot(HUM.easy, around).y).toBeCloseTo(0.5, 9)
  })

  it('says in words what the picture shows, for someone who cannot see it', () => {
    expect(ladderLabel({ range: { low: 48, high: 55 }, dot: null })).toBe('A ladder of notes, higher towards the top. Your easy notes, C3 to G3, are shaded.')
    expect(ladderLabel({ range: { low: 48, high: 55 }, target: 52, dot: 51.6 })).toBe('A ladder of notes, higher towards the top. Your easy notes, C3 to G3, are shaded. The note to sing is E3. Your voice is on E3.')
    expect(ladderLabel({ dot: 44.2 })).toBe('A ladder of notes, higher towards the top. Your voice is on G#2.')
  })

  it('tells the singer where their note is against their easy notes', () => {
    const range = { low: 48, high: 55 }
    expect(voiceLine(null, range)).toBe(RANGE_COPY.page.watch)
    expect(voiceLine(50.2, range)).toBe(RANGE_COPY.page.inside)
    expect(voiceLine(55.4, range)).toBe(RANGE_COPY.page.inside)
    expect(voiceLine(55.6, range)).toBe(RANGE_COPY.page.above)
    expect(voiceLine(47.4, range)).toBe(RANGE_COPY.page.below)
  })
})

describe('the words', () => {
  const flat = (value: unknown): string[] => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(flat) : [])
  const words = flat(RANGE_COPY)

  it('says the lines of the design as they are written', () => {
    expect(RANGE_COPY.steps.hum.title).toBe('Hum any note that feels easy')
    expect(RANGE_COPY.steps.down.title).toBe('Slide down gently, like a sigh, and stop when it starts to croak')
    expect(RANGE_COPY.steps.up.title).toBe('Slide up quietly, like a small siren')
    expect(RANGE_COPY.care).toBe('Stop while it is easy. This is not a test of how high you can go.')
    expect(RANGE_COPY.hurt).toBe('Singing should never hurt. If your throat feels sore, scratchy or tired, stop for today.')
    expect(RANGE_COPY.choose.lower).toBe('Lower voice')
    expect(RANGE_COPY.choose.higher).toBe('Higher voice')
    expect(RANGE_COPY.result.title).toBe('Your easy notes')
    expect(RANGE_COPY.lower).toBe('A bit lower')
    expect(RANGE_COPY.higher).toBe('A bit higher')
    expect(RANGE_COPY.findAgain).toBe('Find my range again')
  })

  it('asks for the slides the way the hum was made, so that their levels can be compared', () => {
    // A hum with closed lips is far quieter than an open "ah" sung just as gently. The slides are judged
    // against the level of the hum (half of it is a croak, twice is forced), so all three are hummed.
    for (const step of [RANGE_COPY.steps.hum, RANGE_COPY.steps.down, RANGE_COPY.steps.up]) expect(step.hint).toMatch(/lips closed/i)
    expect(RANGE_COPY.strong).toMatch(/hum/)
  })

  it('never blames, never asks for more voice, and shows no number a beginner cannot use', () => {
    expect(words.length).toBeGreaterThan(20)
    for (const line of words) {
      expect(line, line).not.toMatch(/\b(wrong|fail(ed|ure)?|tone.deaf|louder|push|belt|bad|mistake|error)\b/i)
      expect(line, line).not.toMatch(/\b(cents?|hz|hertz|midi|semitones?|bpm|rating|accuracy|frequency|octave)\b/i)
      expect(line, line).not.toMatch(/\d/)
      expect(line, line).not.toMatch(/\b(man|men|woman|women|male|female|boy|girl)\b/i)
    }
  })

  it('names the easy notes by their note names', () => {
    expect(rangeText({ low: 55, high: 62 })).toBe('G3 to D4')
    expect(rangeText({ low: 48, high: 55 })).toBe('C3 to G3')
  })
})

describe('saving what was found', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('never offers a move the store would refuse: both stop at the same lowest and highest note', async () => {
    expect(RANGE.lowestNote).toBe(LOWEST_RANGE_NOTE)
    expect(RANGE.highestNote).toBe(HIGHEST_RANGE_NOTE)
    const bottom: VoiceRange = { low: LOWEST_RANGE_NOTE + 1, high: LOWEST_RANGE_NOTE + 8, easy: LOWEST_RANGE_NOTE + 4, source: 'manual', at: AT }
    const lowest = shiftRange(bottom, -1, AT)!
    expect((await saveVoiceRange(lowest, AT)).range).toEqual(lowest)
    expect(shiftRange(lowest, -1, AT)).toBeNull()
    await expect(saveVoiceRange({ ...lowest, low: lowest.low - 1, high: lowest.high - 1, easy: lowest.easy - 1 }, AT)).rejects.toThrow()
  })

  it('stores every kind of result as it was shown', async () => {
    const found = rangeFrom(measured({ lows: [43.2], highs: [61.9] }), AT)!
    const moved = shiftRange(found, 1, AT + 1)!
    const results = [found, moved, rangeFrom(measured(), AT)!, rangeFrom(measured({ lows: [51.8], highs: [66] }), AT)!, finderReducer(newFinder(), { type: 'choose', voice: 'higher', at: AT }).range!]
    for (const range of results) {
      const stored = await saveVoiceRange(range, AT)
      expect(stored.range).toEqual(range)
      expect((await loadVoiceProfile()).range).toEqual(range)
    }
  })
})

describe('the pitch a voice is measured against', () => {
  it('is always A = 440: nothing in the voice tools reads the reference pitch of the guitar side', () => {
    // The starting notes, the guide voice and every sung run are at 440 (docs/SINGING.md, 13.11). A range
    // found against another pitch would name and store notes a third of a semitone off for a guitarist
    // who tunes to 432.
    for (const file of ['rangeFinder.ts', 'noteMatch.ts', 'RangeFinder.tsx', 'NoteMatch.tsx', 'PitchLadder.tsx', 'RangePage.tsx']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/\ba4\b/)
    }
    // A voice on 440 Hz is the A above middle C, whatever the settings say.
    const listener = new VoiceListener(44100)
    listener.hear({ freq: 440, clarity: 0.95, rms: 0.05, time: 0 })
    expect(listener.hear({ freq: 440, clarity: 0.95, rms: 0.05, time: HOP })[0].midi).toBeCloseTo(69, 9)
  })
})

/**
 * The whole walk, sung. One take holds the session, so the levels of its parts compare as they would
 * for one person: a hum, two sighs down from the hum, two sirens up from it, with the room before.
 *
 * The singer's vowel is "ah". The level of this model swings with the pitch as harmonics pass its
 * formants (0.75 to 1.55 times the hum along these slides, 2.7 times where a harmonic sits on the
 * first formant, around F#4), so the notes here are chosen away from that peak: a top note there
 * would be taken for a forced one, which is the rule doing its work on a singer who is in fact loud.
 */
describe('a singer finds their easy notes', () => {
  interface Singer {
    easy: number
    bottom: number
    top: number
    /** After the second sigh the voice goes on down, barely sounding. */
    croak?: number
    /** After the second siren a top note is forced out. */
    push?: number
    /** The level of the croak and of the push: 0.3 and 3 unless told (1 = sung like everything else). */
    croakGain?: number
    pushGain?: number
    /** The level of the hum against the slides (1 = the same). */
    humGain?: number
    /** Every slide turns round at its far end and comes back to the easy note, as a siren does. */
    back?: boolean
  }

  /** Seconds of room before the hum. */
  const ROOM = 1.5

  function session(s: Singer): SungNote[] {
    const notes: SungNote[] = [{ time: ROOM + 0.5, duration: 4.3, midi: s.easy, gain: s.humGain }]
    /** One slide of three seconds: straight to `to`, or there and back. */
    const slide = (t: number, to: number): SungNote[] =>
      s.back
        ? [
            { time: t, duration: 1.5, midi: s.easy, slideTo: to },
            { time: t + 1.5, duration: 1.5, midi: to, slideTo: s.easy },
          ]
        : [{ time: t, duration: 3, midi: s.easy, slideTo: to }]
    let t = ROOM + 6.5
    for (let i = 0; i < 2; i++) {
      notes.push(...slide(t, s.bottom))
      if (i === 1 && s.croak !== undefined) notes.push({ time: t + 3, duration: 0.9, midi: s.bottom - 1, slideTo: s.croak, gain: s.croakGain ?? 0.3 })
      t += 5.5
    }
    for (let i = 0; i < 2; i++) {
      notes.push(...slide(t, s.top))
      if (i === 1 && s.push !== undefined) notes.push({ time: t + 3.3, duration: 0.9, midi: s.push, gain: s.pushGain ?? 3 })
      t += 5.5
    }
    return notes
  }

  /** The recording through the real analyser, set as the range finder sets the detector. */
  function frames(mic: Float32Array, sampleRate: number): Array<EarFrame & { time: number }> {
    return analyseMic(mic, { sampleRate, spectrum: false, preRoll: 0, detector: { pitch: true, ...RANGE_DETECTOR } }).map(({ wall, frame }) => ({ freq: frame.freq, clarity: frame.clarity, rms: frame.rms, time: wall }))
  }

  /** Walks the steps as the screen does: the room first, then one take after the other until the result. `seconds` is how long that took. */
  function find(s: Singer, sampleRate: number, phone: boolean): FinderState & { seconds: number } {
    const notes = session(s)
    const last = notes[notes.length - 1]
    // There and back is one breath: the voice does not stop where it turns round.
    const take = sing(notes, { sampleRate, seconds: last.time + last.duration + 3, legato: s.back })
    const listener = new VoiceListener(sampleRate)
    let state = finderReducer(newFinder(), { type: 'start' })
    let step = new Take(STEPS[state.step])
    let seconds = 0
    for (const frame of frames(phone ? phoneMic(take, sampleRate) : take, sampleRate)) {
      if (frame.time < ROOM) {
        listener.rest(frame)
        continue
      }
      if (state.stage !== 'listen') break
      seconds = frame.time - ROOM
      step.add(listener.hear(frame), frame.time)
      if (step.status !== 'done') continue
      state = finderReducer(state, { type: 'heard', heard: step.heard, at: AT })
      // As on the screen: a step that follows another may open while the singer has not quite stopped.
      if (state.stage === 'listen') step = new Take(STEPS[state.step], true)
    }
    return { ...state, seconds }
  }

  const WAYS = [44100, 48000].flatMap((sampleRate) => [false, true].map((phone) => ({ sampleRate, phone, name: `${sampleRate} Hz${phone ? ', phone microphone' : ''}` })))

  for (const way of WAYS) {
    it(`hears the hum and both edges within a semitone (${way.name})`, () => {
      const singer = { easy: 52, bottom: 44, top: 62 }
      const state = find(singer, way.sampleRate, way.phone)
      expect(state.stage).toBe('result')
      const range = state.range!
      expect(range.easy).toBe(52)
      expect(Math.abs(range.measuredLow! - singer.bottom)).toBeLessThanOrEqual(1)
      expect(Math.abs(range.measuredHigh! - singer.top)).toBeLessThanOrEqual(1)
      // Never past what was sung.
      expect(range.measuredLow!).toBeGreaterThanOrEqual(singer.bottom)
      expect(range.measuredHigh!).toBeLessThanOrEqual(singer.top)
      expect(range).toMatchObject({ low: range.measuredLow! + 2, high: range.measuredHigh! - 3, source: 'measured' })
      // Nobody tapped anything: each step ended by itself, and the walk took well under a minute.
      expect(state.seconds).toBeLessThan(35)
    })

    it(`ignores a croak under the bottom and a forced note over the top (${way.name})`, () => {
      const singer = { easy: 52, bottom: 44, top: 62, croak: 39, push: 68 }
      const range = find(singer, way.sampleRate, way.phone).range!
      expect(Math.abs(range.measuredLow! - singer.bottom)).toBeLessThanOrEqual(1)
      expect(Math.abs(range.measuredHigh! - singer.top)).toBeLessThanOrEqual(1)
      expect(range.measuredLow!).toBeGreaterThanOrEqual(singer.bottom)
      expect(range.measuredHigh!).toBeLessThanOrEqual(singer.top)
    })
  }

  it('would have heard those two notes, had they been sung like the rest', () => {
    // The same session with the low tail and the top note at the singer's own level: now they are the edges.
    const range = find({ easy: 52, bottom: 44, top: 62, croak: 39, push: 68, croakGain: 1, pushGain: 1 }, 44100, true).range!
    expect(range.measuredLow!).toBeLessThanOrEqual(41)
    expect(range.measuredHigh!).toBe(68)
  })

  it('cuts a wide voice to fourteen semitones around its easy note', () => {
    const range = find({ easy: 55, bottom: 40, top: 64 }, 48000, true).range!
    // More was comfortable than is kept ...
    expect(range.measuredHigh! - 3 - (range.measuredLow! + 2)).toBeGreaterThan(RANGE.widest)
    // ... and what is kept lies inside it, around the hum.
    expect(range).toMatchObject({ easy: 55, source: 'measured' })
    expect(range.high - range.low).toBe(RANGE.widest)
    expect(range.low).toBeGreaterThanOrEqual(range.measuredLow! + 2)
    expect(range.high).toBeLessThanOrEqual(range.measuredHigh! - 3)
    expect(range.low).toBeLessThan(55)
    expect(range.high).toBeGreaterThan(55)
  })

  it('gives a singer who slides only a little the small range around their hum', () => {
    const state = find({ easy: 57, bottom: 54, top: 61 }, 44100, true)
    expect(state.stage).toBe('result')
    expect(state.range).toMatchObject({ low: 54, high: 61, easy: 57, source: 'default' })
    expect(resultLine(state)).toBe(RANGE_COPY.result.aroundEasy)
  })

  it('hears the same edges through a microphone that gives a third of the frames (16 kHz, a wireless headset)', () => {
    // Nothing here may count frames: at 16 kHz a frame is 32 ms long, not 12.
    const singer = { easy: 52, bottom: 44, top: 62 }
    const state = find(singer, 16000, true)
    expect(state.stage).toBe('result')
    const range = state.range!
    expect(range).toMatchObject({ easy: 52, source: 'measured' })
    expect(range.measuredLow!).toBeGreaterThanOrEqual(singer.bottom)
    expect(range.measuredLow!).toBeLessThanOrEqual(singer.bottom + 1)
    expect(range.measuredHigh!).toBeLessThanOrEqual(singer.top)
    expect(range.measuredHigh!).toBeGreaterThanOrEqual(singer.top - 1)
  })

  it('reads the turning point of a slide that comes back, as a siren does', () => {
    // Down to the bottom and up again, up to the top and down again, each in one breath: the note the
    // voice turned round on is the edge, and coming back does not undo it.
    const singer = { easy: 52, bottom: 44, top: 62, back: true }
    const state = find(singer, 48000, true)
    expect(state.stage).toBe('result')
    const range = state.range!
    expect(range.measuredLow!).toBeGreaterThanOrEqual(singer.bottom)
    expect(range.measuredLow!).toBeLessThanOrEqual(singer.bottom + 1)
    expect(range.measuredHigh!).toBeLessThanOrEqual(singer.top)
    expect(range.measuredHigh!).toBeGreaterThanOrEqual(singer.top - 1)
  })

  it('keeps in step with a singer who lets the hum sink into the first sigh in one breath', () => {
    // A hum of five seconds (its step ends after four) that falls straight into the sigh; then a second
    // sigh and two sirens, each after a pause. Every step hears the sound that was meant for it, and
    // nobody waits for a step that was already sung.
    const sampleRate = 44100
    const notes: SungNote[] = [
      { time: ROOM + 0.5, duration: 5, midi: 52 },
      { time: ROOM + 5.5, duration: 3, midi: 52, slideTo: 44 },
      { time: ROOM + 11, duration: 3, midi: 52, slideTo: 44 },
      { time: ROOM + 16.5, duration: 3, midi: 52, slideTo: 62 },
      { time: ROOM + 22, duration: 3, midi: 52, slideTo: 62 },
    ]
    const mic = phoneMic(sing(notes, { sampleRate, seconds: ROOM + 28, legato: true }), sampleRate)
    const listener = new VoiceListener(sampleRate)
    let state = finderReducer(newFinder(), { type: 'start' })
    let step = new Take(STEPS[state.step])
    const endedAt: number[] = []
    for (const frame of frames(mic, sampleRate)) {
      if (frame.time < ROOM) {
        listener.rest(frame)
        continue
      }
      if (state.stage !== 'listen') break
      step.add(listener.hear(frame), frame.time)
      if (step.status !== 'done') continue
      endedAt.push(frame.time - ROOM)
      state = finderReducer(state, { type: 'heard', heard: step.heard, at: AT })
      if (state.stage === 'listen') step = new Take(STEPS[state.step], true)
    }
    expect(state.stage).toBe('result')
    expect(state.measured.lows).toHaveLength(2)
    expect(state.measured.highs).toHaveLength(2)
    // The first sigh ended its own step, a second after it stopped (8.5 s in), not the step after it.
    expect(endedAt[1]).toBeGreaterThan(8.5 + RANGE.quiet - 0.1)
    expect(endedAt[1]).toBeLessThan(8.5 + RANGE.quiet + 0.3)
    for (const low of state.measured.lows) expect(Math.abs(low - 44.5)).toBeLessThanOrEqual(0.6)
    for (const high of state.measured.highs) expect(Math.abs(high - 61.5)).toBeLessThanOrEqual(0.6)
    expect(state.range).toMatchObject({ easy: 52, source: 'measured' })
  })

  it('says so when a slide up was sung with far more voice than the hum, and does not ask the singer to come closer', () => {
    // The hum barely sounded and the slides were sung out, at two and a half times its level. A sigh
    // has no upper limit, so both lows are kept; the siren is over the limit from its first note to its last.
    const state = find({ easy: 52, bottom: 44, top: 62, humGain: 0.4 }, 44100, true)
    expect(state).toMatchObject({ stage: 'unheard', step: 3, strong: true })
    expect(state.measured.lows).toHaveLength(2)
    expect(unheardLine(state)).toBe(RANGE_COPY.strong)
    // Skipped twice, the top comes from the hum and the bottom from what was sung.
    const skipped = finderReducer(finderReducer(state, { type: 'skip', at: AT }), { type: 'skip', at: AT })
    expect(skipped.range).toMatchObject({ low: skipped.range!.measuredLow! + 2, high: 56, easy: 52, source: 'measured' })
    expect(skipped.range!.measuredHigh).toBeUndefined()
  })

  it('hears no hum in an empty room, and offers the two starting ranges instead', () => {
    const sampleRate = 44100
    const listener = new VoiceListener(sampleRate)
    let state = finderReducer(newFinder(), { type: 'start' })
    const step = new Take('hum')
    for (const frame of frames(phoneMic(new Float32Array(sampleRate * (ROOM + RANGE.wait + 1)), sampleRate), sampleRate)) {
      if (frame.time < ROOM) listener.rest(frame)
      else step.add(listener.hear(frame), frame.time)
    }
    expect(step.status).toBe('done')
    expect(step.heard).toEqual([])
    state = finderReducer(state, { type: 'heard', heard: step.heard, at: AT })
    expect(state.stage).toBe('unheard')
    expect(finderReducer(state, { type: 'skip', at: AT }).stage).toBe('choose')
  })
})
