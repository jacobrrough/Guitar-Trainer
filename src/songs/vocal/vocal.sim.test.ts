import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setGuitarBankForTests } from '../../audio/guitar'
import { loadRealBank } from '../../audio/instrument/realBank.testutil'
import { runVerdict } from '../../features/play/runVerdict'
import { delayed, mix, phoneMic } from '../../features/play/simCases.testutil'
import type { HeardFrame } from '../../features/play/simulate'
import { hearVoice, scoreVoiceHeard, simulateVoice } from '../../features/play/voice/simulateVoice'
import { sing, type SingOptions } from '../../features/play/voice/virtualSinger.testutil'
import { attemptPerformance } from '../../training/performance'
import { arrange, songKey } from './arrange'
import { VOCAL_SONGS } from './index'
import { renderGuideTrack, renderScoredTrack } from './render'
import type { VocalSong } from './types'

/**
 * Every song sung from start to end without a person or a phone: the virtual singer (a voice model that
 * shares nothing with the app's guide voice) sings what the chart asks for, the app's own scored track
 * comes out of the speaker beside them, both go through the phone microphone model, the real analyser
 * and the real voice tracker, driven by the player's clock. What is asserted is what the Coach would
 * read from the result (`attemptPerformance(...).acc`), not the tracker's own percentage.
 *
 * Two voices, each with the song in its own key, in ranges wide enough for every song. A microphone
 * runs at 44.1 or at 48 kHz: each song is sung at both, one voice at each, and from song to song the
 * voices swap, so neither rate is only ever heard with one kind of voice.
 */
const VOICES = [
  { name: 'a low voice', range: { low: 43, high: 57 } },
  { name: 'a high voice', range: { low: 57, high: 72 } },
]
const RATES = [44100, 48000]

/** Seconds of count-in at the head of every recording: the tracker takes the level of the room from it. */
const LEAD = 2

/** What the phone's microphone makes of a sound: the count-in's worth of room first, then the sound in the room. */
function throughPhone(sound: Float32Array, sampleRate: number): Float32Array {
  const withLead = new Float32Array(Math.round(LEAD * sampleRate) + sound.length)
  withLead.set(sound, Math.round(LEAD * sampleRate))
  return phoneMic(withLead, sampleRate)
}

/** The Coach calls a round clean from here, and rough under the second number. */
const CLEAN = 0.85
const ROUGH = 0.75
/**
 * A take that must not score is only proof when the singer in it was heard: this share of the notes
 * had a voice on them, in tune or not. Without it, silence passes every "must not score".
 */
const HEARD = 0.8

type Singing = Omit<SingOptions, 'sampleRate' | 'seconds'>

interface Outcome {
  /** Accuracy as the Coach reads it: a perfect counts 1, a good 0.8. */
  acc: number
  hits: number
  total: number
  /** Share of the notes during which a voice was heard at all. */
  coverage: number
  /** What the player would do with the run: 'counted', or 'unscored' when the app heard nobody sing. */
  verdict: string
}

const CASES = VOCAL_SONGS.flatMap((song, s) => VOICES.map((voice, v) => [song.id, voice.name, RATES[(s + v) % 2], song, voice] as const))

/**
 * Every song in both voices takes about five minutes in one process, so a plain test run sings three
 * that stand for the rest (under a minute): the first song of the course in the low voice (the shortest
 * one, and the one that is also sung two lines at a time), When the Saints in the high voice (it starts
 * three beats before its first bar line, so it has two bars of introduction) and Happy Birthday in the
 * low voice at the other rate (three beats to the bar, and the widest reach of all). Each of the three
 * is sung at an echo level, at "Whole tune" and at "Performance": in tune, flat, on one held note and not
 * at all, and its guide is played on a bare speaker. The whole sweep runs with FULL_SIM=1: run it after
 * any change to the voice tracker, to a tune or to the arranger.
 */
const whole = !!process.env.FULL_SIM
const QUICK: Array<[id: string, voice: string]> = [
  ['sing-hot-cross-buns', 'a low voice'],
  ['sing-saints', 'a high voice'],
  ['sing-happy-birthday', 'a low voice'],
]
const PLAYED = whole ? CASES : CASES.filter(([id, name]) => QUICK.some(([song, voice]) => song === id && voice === name))

describe('what is sung', () => {
  it('is every song in both voices, each song at both rates', () => {
    expect(CASES.length).toBe(VOCAL_SONGS.length * VOICES.length)
    for (const song of VOCAL_SONGS) expect(new Set(CASES.filter(([id]) => id === song.id).map(([, , rate]) => rate)), song.id).toEqual(new Set(RATES))
    if (whole) expect(PLAYED).toEqual(CASES)
  })

  it('in a plain run is three songs that stand for the rest: both voices, both rates, and the song the course echoes two lines at a time', () => {
    const quick = CASES.filter(([id, name]) => QUICK.some(([song, voice]) => song === id && voice === name))
    expect(quick.length).toBe(QUICK.length)
    expect(new Set(quick.map(([, name]) => name))).toEqual(new Set(VOICES.map((v) => v.name)))
    expect(new Set(quick.map(([, , rate]) => rate))).toEqual(new Set(RATES))
    expect(quick.some(([id]) => id === 'sing-hot-cross-buns')).toBe(true)
    if (!whole) expect(PLAYED).toEqual(quick)
  })
})

describe.each(PLAYED)('%s sung by %s at %i Hz', (_id, _name, rate, song: VocalSong, voice) => {
  const { shift, fits } = songKey(song, voice.range)

  // The levels from "Whole tune" on are the same notes at the same times after the same starting note; only
  // the judging differs. So one take is sung and analysed for them, and scored once per level.
  const formOf = (level: number) => (level <= 1 ? level : 2)
  const tracks = new Map<number, Float32Array>()
  const takes = new Map<string, HeardFrame[]>()
  afterAll(() => {
    tracks.clear()
    takes.clear()
  })

  /** The scored track of a level: what the speaker plays while the microphone listens. */
  function scoredTrack(level: number): Float32Array {
    const form = formOf(level)
    let track = tracks.get(form)
    if (!track) {
      track = renderScoredTrack(arrange(song, { shift, level: form }), rate)
      tracks.set(form, track)
    }
    return track
  }

  /** What the app makes of a take at a level: `singing` is how the notes are sung, or null when nobody sings. */
  function outcome(level: number, singing: Singing | null): Outcome {
    const chart = arrange(song, { shift, level })
    const speaker = scoredTrack(level)
    const seconds = speaker.length / rate
    const key = `${formOf(level)}:${JSON.stringify(singing)}`
    let heard = takes.get(key)
    if (!heard) {
      const room = singing ? mix(speaker, sing(chart.notes, { ...singing, sampleRate: rate, seconds })) : speaker
      heard = hearVoice(chart, throughPhone(room, rate), { sampleRate: rate, micLead: LEAD })
      takes.set(key, heard)
    }
    const { summary, result } = scoreVoiceHeard(chart, chart.notes, heard, LEAD + seconds, { sampleRate: rate, micLead: LEAD })
    return { acc: attemptPerformance(result).acc, hits: summary.perfects + summary.goods, total: summary.total, coverage: result.coverage, verdict: runVerdict(summary, result) }
  }

  it('has the song in a key that fits the range', () => {
    expect(fits).toBe(true)
    for (const n of arrange(song, { shift, level: 2 }).notes) {
      expect(n.midi).toBeGreaterThanOrEqual(voice.range.low)
      expect(n.midi).toBeLessThanOrEqual(voice.range.high)
    }
  })

  it.each([0, 2, 5])('sung in tune at level %i it is a clean round', (level) => {
    const sung = outcome(level, {})
    expect(sung.total).toBe(arrange(song, { shift, level }).notes.length)
    expect(sung.verdict).toBe('counted')
    expect(sung.acc, `${sung.hits} of ${sung.total} notes`).toBeGreaterThanOrEqual(CLEAN)
  }, 120_000)

  if (song.id === 'sing-hot-cross-buns') {
    it('sung in tune two lines at a time (level 1), the form the course meets first after line by line, it is a clean round', () => {
      const sung = outcome(1, {})
      expect(sung.verdict).toBe('counted')
      expect(sung.acc, `${sung.hits} of ${sung.total} notes`).toBeGreaterThanOrEqual(CLEAN)
    }, 120_000)
  }

  it('sung 60 cents flat at "Whole tune" it still counts, every note a good one, and is not a clean round', () => {
    const flat = outcome(2, { cents: -60 })
    expect(flat.verdict).toBe('counted')
    expect(flat.acc, `${flat.hits} of ${flat.total} notes`).toBeGreaterThanOrEqual(ROUGH)
    expect(flat.acc, `${flat.hits} of ${flat.total} notes`).toBeLessThan(CLEAN)
  }, 120_000)

  it.each([3, 5])('sung 60 cents flat at level %i most of the notes are lost: from "In tune" on that is outside the band', (level) => {
    const flat = outcome(level, { cents: -60 })
    // The singer was heard on the notes: they are lost for being flat, not for not being there.
    expect(flat.coverage).toBeGreaterThanOrEqual(HEARD)
    expect(flat.acc, `${flat.hits} of ${flat.total} notes`).toBeLessThan(0.5)
    expect(flat.hits, `${flat.hits} of ${flat.total} notes`).toBeLessThan(flat.total / 2)
  }, 120_000)

  it.each([0, 2, 5])('one note held all the way through level %i is never a clean round, and less than half the song unless the song sits on that note', (level) => {
    // The starting note is the one the app has just played: the note a singer who cannot move yet stays on.
    const held = outcome(level, { monotoneMidi: arrange(song, { shift, level }).notes[0].midi })
    // The hum is heard all the way through; a hum the app did not hear would pass everything below.
    expect(held.coverage).toBeGreaterThanOrEqual(HEARD)
    expect(held.acc, `${held.hits} of ${held.total} notes`).toBeLessThan(ROUGH)
    // 26 of the 51 notes of Jingle Bells are its starting note: there, and only there, half is out of reach.
    if (song.id !== 'sing-jingle-bells') expect(held.acc, `${held.hits} of ${held.total} notes`).toBeLessThan(0.5)
  }, 120_000)

  it.each([0, 2])('the scored track alone, with nobody singing, scores nothing at level %i, and the run is not counted', (level) => {
    const nobody = outcome(level, null)
    expect(nobody.hits).toBe(0)
    expect(nobody.acc).toBe(0)
    // Nothing of the app's own sound was taken for a voice, so the singer is told "nothing was scored"
    // instead of being handed a run full of misses.
    expect(nobody.coverage).toBeLessThan(0.05)
    expect(nobody.verdict).toBe('unscored')
  }, 120_000)

  if (song.id === 'sing-jingle-bells') {
    it.each([0, 2])('the hum that fits most of it, between its main note and the note above, is still not a clean round at level %i', (level) => {
      // Forty cents above mi is inside the wide bands of every mi and every fa: 37 of the 51 notes.
      const between = outcome(level, { monotoneMidi: arrange(song, { shift, level }).notes[0].midi, cents: 40 })
      expect(between.acc, `${between.hits} of ${between.total} notes`).toBeLessThan(ROUGH)
      // It does hear the hum: this is the tracker giving credit where the pitch is in tune, and no further.
      expect(between.hits).toBeGreaterThan(between.total / 2)
    }, 120_000)
  }
})

/**
 * The guide track on a bare speaker. It holds the notes themselves, sung by the guide voice, so a phone
 * on a table with the guide on would mark its own singing. The player has two ways to know. One is its
 * count-in, which is not a matter of the song. The other is the song's: the tracker listens for the
 * starting note coming back on time and on pitch (`ownSound`), and that only works while nothing else
 * of the guide track sounds over that note. So this is played with the chords as the app plays them, on
 * the recorded guitar, and with no count-in to tell.
 */
describe('the guide of a song on a bare speaker, with nobody singing', () => {
  beforeAll(async () => {
    setGuitarBankForTests(await loadRealBank())
  })
  afterAll(() => {
    setGuitarBankForTests(null)
  })

  /** Seconds from the speaker to the detector on a phone, taken out again by the latency setting. */
  const DEVICE = 0.04
  /** Seconds of the song that are enough to know: the starting note, and the first of the tune. */
  const HEAD = 6

  /** What the tracker makes of the guide alone, the microphone picking up `gain` of the speaker, over the first `seconds` of the song. */
  function alone(chart: ReturnType<typeof arrange>, guide: Float32Array, rate: number, gain: number, seconds: number) {
    const speaker = mix(new Float32Array(Math.min(guide.length, Math.round(seconds * rate))), guide, gain)
    return simulateVoice(chart, chart.notes, throughPhone(delayed(speaker, DEVICE, rate), rate), { sampleRate: rate, micLead: LEAD, latencySec: DEVICE })
  }

  it.each(PLAYED)('%s in the key of %s at %i Hz: the app knows its own starting note, so the run cannot count', async (_id, _name, rate, song: VocalSong, voice) => {
    const { shift } = songKey(song, voice.range)
    // "Whole tune" has the starting note as its only cue: the one chance to tell. Its guide doubles the singer.
    const chart = arrange(song, { shift, level: 2 })
    const guide = await renderGuideTrack(song, { shift, level: 2 }, rate)
    for (const gain of [1, 0.5, 0.2]) expect(alone(chart, guide, rate, gain, HEAD).ownSound, `the microphone hears ${gain} of the speaker`).toBe(true)
  }, 120_000)

  it('left to itself the guide would be handed a clean round: that is why it has to be known', async () => {
    const song = VOCAL_SONGS.find((s) => s.id === 'sing-amazing-grace')
    if (!song) throw new Error('Amazing Grace is one of the songs')
    const [low] = VOICES
    const { shift } = songKey(song, low.range)
    const chart = arrange(song, { shift, level: 2 })
    const guide = await renderGuideTrack(song, { shift, level: 2 }, 44100)
    const run = alone(chart, guide, 44100, 0.5, guide.length / 44100)
    expect(attemptPerformance(run.result).acc).toBeGreaterThanOrEqual(CLEAN)
    expect(runVerdict(run.summary, run.result)).toBe('counted')
    expect(run.ownSound).toBe(true)
  }, 120_000)
})
