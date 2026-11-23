/**
 * Sung scoring end to end, without a singer: a virtual singer (a different model from the app's own
 * guide voice, see virtualSinger.testutil.ts) sings tunes and exercises the way people do, into the
 * model of a phone microphone in a living room, at both sample rates phones use; the result goes
 * through the same framing, detector and tracker as the microphone does in the app.
 *
 * Two lists, from docs/SINGING.md section 9. What must score is judged the way the Coach judges a
 * round: by `attemptPerformance(result).acc`, where a good counts 0.8 and a clean round needs 0.85.
 * What must not score is everything that is not the learner singing the notes: silence, the room, the
 * app's own click and cues, chords, another pitch, one hummed note.
 *
 * Everything on every piece at both rates takes about five minutes in one process, so a plain test run
 * sings a stand-in for each case (under a minute): every way of singing and every way of not singing is
 * still there, once, on one of the pieces and at one of the two rates, which take turns. The whole gate
 * runs with FULL_SIM=1: run it before and after any change to the tracker or its constants.
 * VOICE_FILE=<file> appends one line per scored take, so that two such runs can be compared.
 */
import { appendFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { SampleBank } from '../../../audio/instrument/bank'
import { loadRealBank } from '../../../audio/instrument/realBank.testutil'
import { renderDrums, renderStrings } from '../../../audio/synth'
import { renderVoiceNotes } from '../../../audio/voice'
import { constantBeatGrid } from '../../../chart/timing'
import { emptyChart, type Chart, type ChartNote, type VoiceCue, type VoiceJudge } from '../../../chart/types'
import { attemptPerformance } from '../../../training/performance'
import { runVerdict } from '../runVerdict'
import { delayed, mix, phoneMic } from '../simCases.testutil'
import type { SimulationOptions } from '../simulate'
import { simulateVoice, type VoiceSimulationResult } from './simulateVoice'
import { sing, type SingOptions, type SungNote } from './virtualSinger.testutil'

const RATES = [44100, 48000]
const whole = !!process.env.FULL_SIM
/** The rates a case is sung at: both, or in a plain run the one whose turn it is. */
const rates = (turn = 0): number[] => (whole ? RATES : [RATES[turn % 2]])
/** A case only the whole gate plays: a variation on one that a plain run plays too. */
const fullOnly = it.skipIf(!whole)
/** Seconds of count-in at the head of every recording: the tracker hears the room in it. */
const LEAD = 2
/** A clean round, as the Coach counts it. */
const CLEAN = 0.85

// Every test renders and analyses whole performances at two sample rates: seconds each on a slow machine.
vi.setConfig({ testTimeout: 120_000 })

let bank: SampleBank
beforeAll(async () => {
  bank = await loadRealBank()
})

/** One note or rest: semitones above the home note (null = a rest) and beats. */
type Step = [semitones: number | null, beats: number]

interface Piece {
  name: string
  chart: Chart
  notes: ChartNote[]
}

interface Written {
  beat: number
  beats: number
  midi: number
}

/** A sung chart from notes and cues written in beats, on a 4/4 grid. */
function piece(name: string, bpm: number, judge: VoiceJudge, home: number, sung: Written[], cued: Written[], lineStarts: number[], breath = new Set<Written>()): Piece {
  const beat = 60 / bpm
  // A line's last note gives up 0.4 s (or half of itself) for the breath, as the arranger does it.
  const notes: ChartNote[] = sung.map((n, id) => ({ id, time: n.beat * beat, duration: n.beats * beat - (breath.has(n) ? Math.min(0.4, 0.5 * n.beats * beat) : 0), midi: n.midi, string: 0, fret: 0, velocity: 0.8, chordId: id, lyric: 'la' }))
  const cues: VoiceCue[] = cued.map((c) => ({ time: c.beat * beat, duration: c.beats * beat, midi: c.midi }))
  const lastBeat = Math.max(...sung.map((n) => n.beat + n.beats))
  const duration = (Math.ceil(lastBeat / 4) * 4 + 2) * beat
  const midis = [...sung, ...cued].map((n) => n.midi)
  const chart = emptyChart({
    title: name,
    source: 'builtin',
    duration,
    notes,
    beats: constantBeatGrid(bpm, 0, duration),
    tempos: [{ time: 0, bpm }],
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
    voice: { judge, cues, low: Math.min(...midis), high: Math.max(...midis), tonic: home, shift: home - 60, lineStarts: lineStarts.map((b) => b * beat) },
  })
  return { name, chart, notes }
}

/** A tune as the arranger lays it out: a bar with the starting note as a cue for two beats and two silent beats, then the lines. */
function tune(name: string, lines: Step[][], bpm: number, judge: VoiceJudge, home = 57): Piece {
  const sung: Written[] = []
  const breath = new Set<Written>()
  const lineStarts: number[] = []
  let at = 4
  for (const line of lines) {
    lineStarts.push(at)
    let last: Written | null = null
    for (const [semis, beats] of line) {
      if (semis !== null) {
        last = { beat: at, beats, midi: home + semis }
        sung.push(last)
      } else {
        last = null
      }
      at += beats
    }
    // A line that ends on a note (not on a written rest) is where the breath has to come from.
    if (last) breath.add(last)
  }
  return piece(name, bpm, judge, home, sung, [{ beat: 0, beats: 2, midi: sung[0].midi }], lineStarts, breath)
}

/** An echo exercise: the guide sings a figure (cues), two beats of rest, the learner answers over clicks, two beats of rest. */
function echo(name: string, figures: number[][], rhythm: number[], bpm: number, judge: VoiceJudge, home = 57, call: number[] = rhythm): Piece {
  const sung: Written[] = []
  const cued: Written[] = []
  const lineStarts: number[] = []
  const span = (r: number[]) => r.reduce((a, b) => a + b, 0)
  let at = 0
  for (const figure of figures) {
    let b = at
    call.forEach((beats, i) => {
      cued.push({ beat: b, beats, midi: home + figure[i] })
      b += beats
    })
    at += span(call) + 2
    lineStarts.push(at)
    b = at
    rhythm.forEach((beats, i) => {
      sung.push({ beat: b, beats, midi: home + figure[i] })
      b += beats
    })
    at += span(rhythm) + 2
  }
  return piece(name, bpm, judge, home, sung, cued, lineStarts)
}

const ODE: Step[][] = [
  [[4, 1], [4, 1], [5, 1], [7, 1], [7, 1], [5, 1], [4, 1], [2, 1], [0, 1], [0, 1], [2, 1], [4, 1], [4, 1.5], [2, 0.5], [2, 2]],
  [[4, 1], [4, 1], [5, 1], [7, 1], [7, 1], [5, 1], [4, 1], [2, 1], [0, 1], [0, 1], [2, 1], [4, 1], [2, 1.5], [0, 0.5], [0, 2]],
]
const BUNS: Step[][] = [
  [[4, 1], [2, 1], [0, 2]],
  [[4, 1], [2, 1], [0, 2]],
  [[0, 0.5], [0, 0.5], [0, 0.5], [0, 0.5], [2, 0.5], [2, 0.5], [2, 0.5], [2, 0.5], [4, 1], [2, 1], [0, 2]],
]
const MARY: Step[][] = [
  [[4, 1], [2, 1], [0, 1], [2, 1], [4, 1], [4, 1], [4, 2]],
  [[2, 1], [2, 1], [2, 2]],
  [[4, 1], [7, 1], [7, 2]],
  [[4, 1], [2, 1], [0, 1], [2, 1], [4, 1], [4, 1], [4, 1], [4, 1], [2, 1], [2, 1], [4, 1], [2, 1], [0, 4]],
]
/** Five notes up and back in eighths, ending on a long note, then the same a semitone higher. */
const SCALE: Step[][] = [0, 1].map((key) => [...[0, 2, 4, 5, 7, 5, 4, 2].map((s): Step => [key + s, 0.5]), [key, 2], [null, 2]])

const IN_TUNE: VoiceJudge = { band: 50, minShare: 0.5 }
const PERFORMANCE: VoiceJudge = { band: 35, minShare: 0.6, sustain: true }

/**
 * The pieces the two lists are sung on: a tune in quarters, quick notes, long held notes, an echo. They
 * sit in different places (home notes A3, G3, C4 and E3), each where a voice can also take it an octave
 * down or up.
 */
const pieces = (judge: VoiceJudge = IN_TUNE) => ({
  ode: tune('Ode to Joy, a line at 100', ODE.slice(0, 1), 100, judge, 57),
  quick: tune('five notes up and back, eighths at 100', SCALE, 100, judge, 55),
  held: echo('held notes of four beats at 60', [[0], [7]], [4], 60, { ...judge, sustain: true }, 60, [2]),
  echo: echo('echo of three notes at 72', [[0, 2, 4], [4, 2, 0], [0, 4, 2]], [0.5, 0.5, 1], 72, judge, 52),
})
/** The same five notes where a low voice has them (from A2, 110 Hz): the click's kick drum lies in the detector's range there. */
const lowPiece = () => tune('five notes for a low voice', SCALE.slice(0, 1), 100, IN_TUNE, 45)

/** Samples of every track of a piece: the click runs a second past the chart, and everything else lies under it. */
const lengthOf = (p: Piece, sampleRate: number) => renderDrums(p.chart, { sampleRate }).length

/** The track that plays while the microphone scores on a speaker: the click and the cues. */
function scoredTrack(p: Piece, sampleRate: number): Float32Array {
  const click = renderDrums(p.chart, { sampleRate })
  return mix(click, renderVoiceNotes(p.chart.voice!.cues, { sampleRate, length: click.length }))
}

/** The guide track: the scored track with the notes themselves sung by the guide voice. */
function guideTrack(p: Piece, sampleRate: number): Float32Array {
  const track = scoredTrack(p, sampleRate)
  return mix(track, renderVoiceNotes(p.notes, { sampleRate, length: track.length }))
}

/** The singer singing `notes` (the piece's own unless told), as long as the piece's tracks. */
function take(p: Piece, sampleRate: number, options: Partial<SingOptions> = {}, notes: SungNote[] = p.notes): Float32Array {
  return sing(notes, { sampleRate, seconds: lengthOf(p, sampleRate) / sampleRate, ...options })
}

/**
 * What the phone's microphone makes of a sound: the count-in's worth of room first, then the sound in
 * the room. `hum` is something that sounds in the room all along (from before the count-in to the end).
 */
function throughPhone(sound: Float32Array, sampleRate: number, hum?: (seconds: number) => Float32Array): Float32Array {
  const lead = Math.round(LEAD * sampleRate)
  const withLead = new Float32Array(lead + sound.length)
  withLead.set(sound, lead)
  return phoneMic(hum ? mix(withLead, hum(withLead.length / sampleRate)) : withLead, sampleRate)
}

function score(p: Piece, sound: Float32Array, sampleRate: number, extra: Partial<SimulationOptions> = {}, hum?: (seconds: number) => Float32Array): VoiceSimulationResult {
  const r = simulateVoice(p.chart, p.notes, throughPhone(sound, sampleRate, hum), { sampleRate, micLead: LEAD, ...extra })
  log(`${expect.getState().currentTestName} | ${p.name} | ${told(r, sampleRate)} | coach ${coach(r).toFixed(3)} | cents ${r.result.voice?.medianCents?.toFixed(1) ?? '-'}${r.ownSound ? ' | own sound' : ''}`)
  return r
}

/** One line per scored take, for comparing two runs (see the head of this file). */
function log(line: string): void {
  if (process.env.VOICE_FILE) appendFileSync(process.env.VOICE_FILE, line + '\n')
}

/** A steady tone in the room (a fridge, a fan, the mains through a cheap charger): four harmonics, at a fifth of a voice's level. */
function roomHum(midi: number, sampleRate: number): (seconds: number) => Float32Array {
  return (seconds) => {
    const out = new Float32Array(Math.round(seconds * sampleRate))
    const freq = 440 * 2 ** ((midi - 69) / 12)
    for (let i = 0; i < out.length; i++) {
      let v = 0
      for (let h = 1; h <= 4; h++) v += Math.sin((2 * Math.PI * h * freq * i) / sampleRate) / h
      out[i] = 0.02 * v
    }
    return out
  }
}

const coach = (r: VoiceSimulationResult) => attemptPerformance(r.result).acc
const hits = (r: VoiceSimulationResult) => r.summary.perfects + r.summary.goods
const verdict = (r: VoiceSimulationResult) => runVerdict(r.summary, r.result)
/** One mark a note: P perfect, g good, and for a miss the first letter of its reason. */
const marks = (r: VoiceSimulationResult) => r.notes.map((n) => (n.status === 'hit' ? (n.judgement === 'perfect' ? 'P' : 'g') : n.status === 'miss' ? (n.reason ?? '?')[0] : '-')).join('')
const told = (r: VoiceSimulationResult, sampleRate: number) => `${sampleRate}: ${marks(r)} coverage ${r.result.coverage.toFixed(2)}`

interface Way {
  name: string
  options?: Partial<SingOptions>
  /** What reaches the microphone, given the take (default: the take alone). */
  room?: (voice: Float32Array, p: Piece, sampleRate: number) => Float32Array
  sim?: Partial<SimulationOptions>
}

const WAYS: Way[] = [
  { name: 'in tune' },
  { name: 'an octave down', options: { octave: -1 } },
  { name: 'an octave up', options: { octave: 1 } },
  { name: 'with a scoop of 200 cents over 150 ms into every note', options: { scoopCents: 200, scoopSec: 0.15 } },
  { name: 'with a vibrato of 50 cents at 6 a second', options: { vibratoCents: 50, vibratoHz: 6 } },
  { name: 'with a vibrato of 80 cents at 6 a second', options: { vibratoCents: 80, vibratoHz: 6 } },
  { name: '150 ms late', options: { lateSec: 0.15 } },
  { name: '80 ms early', options: { lateSec: -0.08 } },
  { name: 'with a consonant of 100 ms before every note', options: { gapSec: 0.1 } },
  { name: 'legato', options: { legato: true } },
  { name: 'quietly', options: { level: 0.03 } },
  { name: 'quietly and breathily', options: { level: 0.02, breath: 0.4 } },
  { name: 'over the app\'s click and cues at the level of the voice', room: (voice, p, sampleRate) => mix(voice, scoredTrack(p, sampleRate)) },
  { name: 'with the sound 60 ms late and the latency setting matched', room: (voice, _p, sampleRate) => delayed(voice, 0.06, sampleRate), sim: { latencySec: 0.06 } },
  { name: 'with the sound 250 ms late and the latency setting matched', room: (voice, p, sampleRate) => delayed(mix(voice, scoredTrack(p, sampleRate)), 0.25, sampleRate), sim: { latencySec: 0.25 } },
]

function sungRun(p: Piece, way: Way, sampleRate: number): VoiceSimulationResult {
  const voice = take(p, sampleRate, way.options)
  return score(p, way.room ? way.room(voice, p, sampleRate) : voice, sampleRate, way.sim)
}

describe('singing that must score', () => {
  const all = pieces()
  const sungOn = [all.ode, all.quick, all.held, all.echo]
  /** The ways a piece is sung in this run: all of them, or in a plain run every fourth, so that each way is sung on one piece. */
  const waysOn = (k: number) => WAYS.map((w, i) => [w.name, w, i] as const).filter(([, , i]) => whole || i % sungOn.length === k)

  it('sings every way of the list: on every piece, or in a plain run on one of them', () => {
    const sung = sungOn.flatMap((_, k) => waysOn(k).map(([name]) => name))
    expect(new Set(sung)).toEqual(new Set(WAYS.map((w) => w.name)))
    expect(sung.length).toBe(whole ? WAYS.length * sungOn.length : WAYS.length)
  })

  for (const [k, p] of sungOn.entries()) {
    describe(p.name, () => {
      it.each(waysOn(k))('%s: a clean round', (_name, way, i) => {
        // In a plain run the rate changes with every fourth way, so each piece is heard at both.
        for (const sampleRate of rates(i >> 2)) {
          const r = sungRun(p, way, sampleRate)
          expect(r.summary.total, told(r, sampleRate)).toBe(p.notes.length)
          expect(coach(r), told(r, sampleRate)).toBeGreaterThanOrEqual(CLEAN)
          expect(verdict(r), told(r, sampleRate)).toBe('counted')
          expect(r.result.coverage, told(r, sampleRate)).toBeGreaterThanOrEqual(0.9)
        }
      })
    })
  }

  describe('at the strictest judging too (35 cents, 0.6 of every note, long notes held)', () => {
    const strict = pieces(PERFORMANCE)
    const ways = WAYS.filter((w) => /^(in tune|an octave|150 ms|80 ms|with a consonant|legato)/.test(w.name))
    it('covers what does not depend on how exactly a note is hit', () => {
      expect(ways.length).toBe(7)
    })
    // A plain run: every other way (an octave down, 150 ms late, with a consonant), the two pieces taking turns.
    it.each(ways.map((w, i) => [w.name, w, i] as const).filter(([, , i]) => whole || i % 2 === 1))('%s: a clean round', (_name, way, i) => {
      const both = [strict.ode, strict.held]
      for (const p of whole ? both : [both[(i >> 1) % 2]]) {
        for (const sampleRate of rates(i >> 1)) {
          const r = sungRun(p, way, sampleRate)
          expect(coach(r), `${p.name}, ${told(r, sampleRate)}`).toBeGreaterThanOrEqual(CLEAN)
        }
      }
    })
  })

  fullOnly('a slower, a faster and a wider vibrato are still on the note: 80 cents at 5 and 7 a second, 100 cents at 4.5', () => {
    const all = pieces()
    for (const p of [all.held, all.ode]) {
      for (const [vibratoCents, vibratoHz] of [[80, 5], [80, 7], [100, 4.5]]) {
        for (const sampleRate of RATES) {
          const r = score(p, take(p, sampleRate, { vibratoCents, vibratoHz }), sampleRate)
          expect(coach(r), `${p.name}, ${vibratoCents} cents at ${vibratoHz}, ${told(r, sampleRate)}`).toBeGreaterThanOrEqual(CLEAN)
        }
      }
    }
  })

  it('quick notes, 4.4 a second: clean when on time, and 150 ms late (two thirds of a note) every note still counts', () => {
    // Eighths at 132 bpm last 0.23 s. Sung 150 ms late, a third of each note is left inside its own time,
    // too little to tell a note by: it is the late credit that makes it count. It is capped, so the round
    // is counted and not clean, which is fair for a singer most of a note behind.
    const p = tune('five notes up and back, eighths at 132', SCALE.slice(0, 1), 132, IN_TUNE, 55)
    for (const sampleRate of rates(1)) {
      const onTime = score(p, take(p, sampleRate), sampleRate)
      expect(coach(onTime), told(onTime, sampleRate)).toBeGreaterThanOrEqual(CLEAN)
      const late = score(p, take(p, sampleRate, { lateSec: 0.15 }), sampleRate)
      expect(hits(late), told(late, sampleRate)).toBe(p.notes.length)
      expect(coach(late), told(late, sampleRate)).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('a low voice over the click: the kick drum under it takes nothing away', () => {
    const p = lowPiece()
    for (const sampleRate of rates(0)) {
      const r = score(p, mix(take(p, sampleRate), scoredTrack(p, sampleRate)), sampleRate)
      expect(coach(r), told(r, sampleRate)).toBeGreaterThanOrEqual(CLEAN)
    }
  })

  it.each([80, 65] as const)('30 cents flat at a band of %i is comfortably inside it: every note perfect', (band) => {
    for (const [k, p] of [tune('Ode to Joy', ODE, 100, { band, minShare: 0.5 }), tune('five notes', SCALE, 100, { band, minShare: 0.5 })].entries()) {
      // A plain run: on the quick notes only, one band at each rate.
      if (!whole && k === 0) continue
      for (const sampleRate of rates(band === 80 ? 0 : 1)) {
        const r = score(p, take(p, sampleRate, { cents: -30 }), sampleRate)
        expect(r.summary.perfects, `${p.name} ${told(r, sampleRate)}`).toBe(p.notes.length)
        expect(coach(r)).toBe(1)
        expect(r.result.voice!.medianCents!).toBeGreaterThan(-40)
        expect(r.result.voice!.medianCents!).toBeLessThan(-20)
      }
    }
  })

  it('60 cents flat at a band of 80 is near its edge: every note counts and none is perfect, a round that is counted and not clean', () => {
    const p = tune('Ode to Joy', ODE, 100, { band: 80, minShare: 0.5 })
    for (const sampleRate of rates(1)) {
      const r = score(p, take(p, sampleRate, { cents: -60 }), sampleRate)
      expect(hits(r), told(r, sampleRate)).toBe(p.notes.length)
      expect(r.summary.perfects, told(r, sampleRate)).toBe(0)
      expect(coach(r)).toBeCloseTo(0.8)
      expect(coach(r)).toBeLessThan(CLEAN)
      expect(verdict(r)).toBe('counted')
    }
  })

  it('two passes of a looped section both count in full', () => {
    const p = tune('Ode to Joy', ODE, 100, IN_TUNE)
    const beat = 0.6
    // Bars 3 and 4 of the chart: eight quarter notes.
    const from = 8 * beat
    const to = 16 * beat
    const inLoop = p.notes.filter((n) => n.time >= from - 1e-6 && n.time < to - 1e-6)
    expect(inLoop.length).toBe(8)
    for (const sampleRate of rates(0)) {
      // A plain run: with the long sound delay only, where the end of each pass arrives after the wrap.
      for (const latency of whole ? [0, 0.25] : [0.25]) {
        const twice: SungNote[] = [0, 1].flatMap((pass) => inLoop.map((n) => ({ time: n.time - from + pass * (to - from), duration: n.duration, midi: n.midi })))
        const voice = sing(twice, { sampleRate, seconds: 2 * (to - from) + 1 })
        const r = score(p, delayed(voice, latency, sampleRate), sampleRate, { latencySec: latency, loop: { from, to, passes: 2 } })
        expect(r.summary.total, `${told(r, sampleRate)} latency ${latency}`).toBe(16)
        // Every note in full, the last of the first pass too, although half of its sound arrives after the
        // wrap. The run ends with the last pass: with a long sound delay its very last note is still on its way.
        expect(r.summary.perfects, `${told(r, sampleRate)} latency ${latency}`).toBeGreaterThanOrEqual(latency > 0 ? 15 : 16)
        expect(coach(r), `${told(r, sampleRate)} latency ${latency}`).toBeGreaterThanOrEqual(CLEAN)
      }
    }
  })

  fullOnly('three passes of a looped section with the sound slow to start again after each wrap', () => {
    // The media element takes a moment to seek back: the clock runs on from the loop's start and then
    // steps back, and the learner, who sings to what is heard, starts every later pass that much later.
    const p = tune('Ode to Joy', ODE, 100, IN_TUNE)
    const beat = 0.6
    const from = 8 * beat
    const to = 16 * beat
    const inLoop = p.notes.filter((n) => n.time >= from - 1e-6 && n.time < to - 1e-6)
    for (const sampleRate of RATES) {
      for (const [latency, stall] of [[0.1, 0.06], [0.25, 0.12]]) {
        const thrice: SungNote[] = [0, 1, 2].flatMap((pass) => inLoop.map((n) => ({ time: n.time - from + pass * (to - from + stall), duration: n.duration, midi: n.midi })))
        const voice = sing(thrice, { sampleRate, seconds: 3 * (to - from + stall) + 1 })
        const r = score(p, delayed(voice, latency, sampleRate), sampleRate, { latencySec: latency, loop: { from, to, passes: 3, wrapStall: stall } })
        const label = `${told(r, sampleRate)} latency ${latency} stall ${stall}`
        expect(r.summary.total, label).toBe(24)
        // During the stall the end of one pass is heard where the next has begun: it costs the first note
        // of a pass nothing, and the last a perfect at the very most.
        expect(hits(r), label).toBe(24)
        expect(r.summary.perfects, label).toBeGreaterThanOrEqual(22)
        expect(coach(r), label).toBeGreaterThanOrEqual(CLEAN)
      }
    }
  })

  fullOnly('a latency setting 150 ms too large makes every note look early: still a clean round on quarters and on eighths', () => {
    // A phone calibrated with wireless headphones and then used without them.
    const all = pieces()
    for (const p of [all.ode, all.quick]) {
      for (const sampleRate of RATES) {
        const r = score(p, take(p, sampleRate, { lateSec: -0.15 }), sampleRate)
        expect(hits(r), `${p.name} ${told(r, sampleRate)}`).toBe(p.notes.length)
        expect(coach(r), `${p.name} ${told(r, sampleRate)}`).toBeGreaterThanOrEqual(CLEAN)
      }
    }
    // On 4.4 notes a second that is two thirds of a note: what is left inside each note is too little to
    // tell it by, and it is the early credit that makes every note count (as the late credit does for a
    // singer as far behind): counted, and not clean.
    const fast = tune('five notes up and back, eighths at 132', SCALE.slice(0, 1), 132, IN_TUNE, 55)
    for (const sampleRate of RATES) {
      const r = score(fast, take(fast, sampleRate, { lateSec: -0.15 }), sampleRate)
      expect(hits(r), told(r, sampleRate)).toBe(fast.notes.length)
      expect(coach(r), told(r, sampleRate)).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('with the guitar\'s reference pitch set anywhere from 430 to 450 Hz, a singer on the app\'s notes is judged exactly as with it at 440', () => {
    // What the app plays for singing is at 440 whatever that setting says. At the strictest judging,
    // read against the setting, this singer had no perfect note at 432 and no note at all at 430 or 450.
    const p = pieces(PERFORMANCE).ode
    for (const sampleRate of rates(1)) {
      const voice = take(p, sampleRate)
      const at440 = score(p, voice, sampleRate)
      expect(coach(at440), told(at440, sampleRate)).toBeGreaterThanOrEqual(CLEAN)
      // The ends of the setting's range and two tunings in between; a plain run takes the one people do use.
      for (const a4 of whole ? [430, 432, 446, 450] : [432]) {
        const r = score(p, voice, sampleRate, { a4 })
        expect(marks(r), `${a4}: ${told(r, sampleRate)}`).toBe(marks(at440))
        expect(r.result.voice!.medianCents, `${a4}`).toBe(at440.result.voice!.medianCents)
      }
    }
  })

  it('reports how late the notes began as it measured it, and never as a spread', () => {
    const p = pieces().ode
    const onTime = score(p, take(p, 44100), 44100)
    const late = score(p, take(p, 44100, { lateSec: 0.15 }), 44100)
    expect(onTime.result.timingMedianMs!).toBeGreaterThan(0)
    expect(onTime.result.timingMedianMs!).toBeLessThan(120)
    expect(late.result.timingMedianMs! - onTime.result.timingMedianMs!).toBeGreaterThan(120)
    expect(late.result.timingMedianMs! - onTime.result.timingMedianMs!).toBeLessThan(180)
    expect(late.result.timingStdevMs).toBeNull()
  })

  it('knows the octave it was sung in, and that a scoop is a slide up', () => {
    const p = pieces().ode
    expect(score(p, take(p, 44100, { octave: -1 }), 44100).feedback.octave).toBe(-1)
    // The whole gate: the octave above as well, and sung as written there is nothing to tell.
    if (whole) {
      expect(score(p, take(p, 44100, { octave: 1 }), 44100).feedback.octave).toBe(1)
      expect(score(p, take(p, 44100), 44100).feedback).toMatchObject({ octave: 0, reasons: { silent: 0, low: 0, high: 0, unsteady: 0, slid: 0 } })
    }
    const scooped = score(p, take(p, 44100, { scoopCents: 250, scoopSec: 0.2 }), 44100)
    expect(scooped.feedback.reasons.slid, marks(scooped)).toBeGreaterThanOrEqual(0.7 * p.notes.length)
  })

  it('a clean round sung a little late is not a round of slides: up a scale, every note begins on the note before', () => {
    // Without the rule, 7 or 8 of these 18 notes carried "slid" at 100 and at 150 ms late, with every note
    // perfect: enough for the result card to say "You slid up to the notes" to a singer who did not, or
    // whose phone is that much out of sync.
    const p = pieces().quick
    for (const sampleRate of rates(0)) {
      for (const lateSec of whole ? [0.1, 0.15] : [0.15]) {
        const r = score(p, take(p, sampleRate, { lateSec }), sampleRate)
        expect(coach(r), `${lateSec} ${told(r, sampleRate)}`).toBeGreaterThanOrEqual(CLEAN)
        expect(r.feedback.reasons.slid, `${lateSec} ${told(r, sampleRate)}`).toBe(0)
      }
      // A real scoop into every note is still heard as one on most of them (the whole gate; a plain run has the scoop of the test above).
      if (!whole) continue
      const scooped = score(p, take(p, sampleRate, { scoopCents: 250, scoopSec: 0.2 }), sampleRate)
      expect(scooped.feedback.reasons.slid, told(scooped, sampleRate)).toBeGreaterThanOrEqual(0.5 * p.notes.length)
    }
  })
})

/** Nothing counted, and the run is "nothing was scored" rather than a round of misses. */
function nothing(r: VoiceSimulationResult, label: string): void {
  expect(hits(r), label).toBe(0)
  expect(verdict(r), label).toBe('unscored')
}

describe('what must not score', () => {
  const all = pieces()
  const each = [all.ode, all.quick, all.held, all.echo, lowPiece()]
  /**
   * Where a take with nobody singing is hardest to tell: quick notes under a low voice's lanes (the
   * click's kick drum lies in the detector's range there) and the echo, half of which is the app's own
   * voice. A plain run plays some of those takes on these two only.
   */
  const hardest = whole ? each : [each[4], each[3]]

  it('silence', () => {
    for (const p of each) {
      for (const sampleRate of RATES) {
        const r = simulateVoice(p.chart, p.notes, new Float32Array(lengthOf(p, sampleRate)), { sampleRate })
        nothing(r, `${p.name} ${told(r, sampleRate)}`)
      }
    }
  })

  it('the noise of the room', () => {
    for (const [k, p] of hardest.slice(0, whole ? hardest.length : 1).entries()) {
      for (const sampleRate of rates(k)) {
        const r = score(p, new Float32Array(lengthOf(p, sampleRate)), sampleRate)
        nothing(r, `${p.name} ${told(r, sampleRate)}`)
      }
    }
  })

  it('a steady hum in the room, even on a note of the tune: it was there before anyone sang, so it is the room', () => {
    const p = all.ode
    // On the note the line has most of (five of its fifteen).
    const midi = 57 + 4
    for (const sampleRate of rates(1)) {
      const r = score(p, new Float32Array(lengthOf(p, sampleRate)), sampleRate, {}, roomHum(midi, sampleRate))
      nothing(r, told(r, sampleRate))
      // And it does not keep a singer from being heard over it.
      const sung = score(p, take(p, sampleRate), sampleRate, {}, roomHum(midi, sampleRate))
      expect(coach(sung), told(sung, sampleRate)).toBeGreaterThanOrEqual(CLEAN)
    }
  })

  it('the click alone, soft or loud', () => {
    for (const [k, p] of hardest.entries()) {
      for (const sampleRate of rates(k)) {
        const click = renderDrums(p.chart, { sampleRate })
        // A plain run: soft under the low lanes, loud under the echo.
        for (const gain of whole ? [1, 2.5] : [[1, 2.5][k % 2]]) {
          const r = score(p, click.map((v) => Math.max(-1, Math.min(1, v * gain))), sampleRate)
          nothing(r, `${p.name} x${gain} ${told(r, sampleRate)}`)
        }
      }
    }
  })

  it('the app\'s scored track alone (click and cues): the cues are the app, not the learner', () => {
    // A plain run: the hardest two and the quick notes.
    for (const [k, p] of (whole ? each : [...hardest, each[1]]).entries()) {
      for (const sampleRate of rates(k + 1)) {
        const r = score(p, scoredTrack(p, sampleRate), sampleRate)
        nothing(r, `${p.name} ${told(r, sampleRate)}`)
      }
    }
  })

  it('the scored track alone with the latency setting wrong by 250 ms, either way', () => {
    for (const [k, p] of hardest.entries()) {
      for (const sampleRate of rates(k + 1)) {
        const track = scoredTrack(p, sampleRate)
        // The sound arrives a quarter of a second later than the setting says ...
        if (whole || k === 0) {
          const lateSound = score(p, delayed(track, 0.25, sampleRate), sampleRate)
          nothing(lateSound, `${p.name} sound late ${told(lateSound, sampleRate)}`)
        }
        // ... or the setting takes a quarter of a second off that is not there. (A plain run: one way on each piece.)
        if (whole || k === 1) {
          const lateSetting = score(p, track, sampleRate, { latencySec: 0.25 })
          nothing(lateSetting, `${p.name} setting late ${told(lateSetting, sampleRate)}`)
        }
      }
    }
  })

  it('strummed chords alone do not pass for singing: a note here and there at most', () => {
    // Not "nothing", as the design hoped. A strummed chord does give the detector a clear pitch now and
    // then, for a fifth of a second after the stroke, and when that pitch is the note that is due, the
    // note counts: 0 to 2 notes in 30 on the recorded guitar, whatever the band (measured with the tune in
    // three places, at both rates). It is one more reason the chords are on the guide track only.
    const p = tune('Ode to Joy', ODE, 100, IN_TUNE)
    for (const sampleRate of rates(0)) {
      const r = score(p, strums(p, sampleRate), sampleRate)
      expect(hits(r), told(r, sampleRate)).toBeLessThanOrEqual(2)
      expect(coach(r), told(r, sampleRate)).toBeLessThan(0.1)
    }
  })

  it('the guide track alone: the guide voice would score every note, which is why it only plays for headphones, and it is noticed', () => {
    // A plain run: the echo (a call before every answer) and the tune (one starting note).
    for (const [k, p] of (whole ? [all.ode, all.quick, all.held, all.echo] : [all.echo, all.ode]).entries()) {
      for (const sampleRate of rates(k)) {
        const r = score(p, guideTrack(p, sampleRate), sampleRate)
        // Kept as the written reason for the speaker policy: unmuted, the app's own voice passes for a singer.
        expect(hits(r), `${p.name} ${told(r, sampleRate)}`).toBe(p.notes.length)
        // With the guide on, this is how the player knows: the cues came back on time and on pitch.
        expect(r.ownSound, `${p.name} at ${sampleRate}`).toBe(true)
      }
    }
  })

  it('a singer who never sings during a cue is not taken for the speaker', () => {
    // A plain run: the echo, which has a cue before every answer.
    for (const p of whole ? [all.ode, all.quick, all.held, all.echo] : [all.echo]) {
      const r = score(p, take(p, 44100), 44100)
      expect(r.ownSound, p.name).toBe(false)
    }
  })

  it('60 cents flat at a band of 50', () => {
    for (const [k, p] of [all.ode, all.quick, all.held].slice(0, whole ? 3 : 2).entries()) {
      for (const sampleRate of rates(k)) {
        const r = score(p, take(p, sampleRate, { cents: -60 }), sampleRate)
        expect(hits(r), `${p.name} ${told(r, sampleRate)}`).toBe(0)
        // It was heard, and heard low: a run that counts, with nothing in it.
        expect(verdict(r)).toBe('counted')
        expect(r.feedback.reasons.low, `${p.name} ${told(r, sampleRate)}`).toBe(p.notes.length)
      }
    }
  })

  it('120 cents flat at a band of 80, on eighth notes at 100: in tune with the neighbouring notes, and not credited through them', () => {
    const p = tune('five notes up and back, eighths at 100', SCALE, 100, { band: 80, minShare: 0.5 })
    for (const sampleRate of rates(1)) {
      for (const cents of whole ? [-120, 120] : [-120]) {
        const r = score(p, take(p, sampleRate, { cents }), sampleRate)
        expect(hits(r), `${cents} ${told(r, sampleRate)}`).toBe(0)
      }
    }
  })

  it('a third too high', () => {
    for (const [k, p] of [tune('Ode to Joy', ODE, 100, { band: 80, minShare: 0.5 }), tune('five notes', SCALE, 100, { band: 80, minShare: 0.5 })].entries()) {
      // A plain run: a major third, on the quick notes.
      if (!whole && k === 0) continue
      for (const sampleRate of rates(k)) {
        for (const cents of whole ? [300, 400] : [400]) {
          const r = score(p, take(p, sampleRate, { cents }), sampleRate)
          expect(hits(r), `${p.name} +${cents} ${told(r, sampleRate)}`).toBe(0)
        }
      }
    }
  })

  const wide: VoiceJudge = { band: 80, minShare: 0.5 }
  const tunes = [tune('Ode to Joy', ODE, 100, wide), tune('Hot Cross Buns', BUNS, 90, wide), tune('Mary Had a Little Lamb', MARY, 100, wide)]
  /** A plain run hums and speaks through the shortest of the three. */
  const hummed = whole ? tunes : [tunes[1]]
  it.each(hummed.map((p) => [p.name, p] as const))('one hummed note through the whole of %s, whichever note it is: under half, at the widest band', (_name, p) => {
    // Each note of the tune, and half way between two that lie a semitone apart: from there both are in reach of one hum.
    const written = [...new Set(p.notes.map((n) => n.midi))].sort((x, y) => x - y)
    const between = written.filter((m) => written.includes(m + 1)).map((m) => m + 0.5)
    let best = 0
    for (const midi of [...written, ...between]) {
      const r = score(p, take(p, 44100, { monotoneMidi: midi }), 44100)
      best = Math.max(best, coach(r))
      expect(coach(r), `${p.name} hummed on ${midi}: ${marks(r)}`).toBeLessThan(0.5)
    }
    // The hum was heard and did land on its own notes.
    expect(best, p.name).toBeGreaterThan(0.2)
    if (!whole) return
    const other = score(p, take(p, 48000, { monotoneMidi: written[0] }), 48000)
    expect(coach(other), `${p.name} at 48000: ${marks(other)}`).toBeLessThan(0.5)
  })

  it('a hum that wobbles, half way between two notes a whole tone apart: under half with an ordinary vibrato, never a clean round with a wide one', () => {
    // The widest band is 80 cents so that one held pitch cannot be two notes a whole tone apart: it lies
    // 100 from each. A hum that swings reaches into both bands at the ends of its swing, and a note asks
    // for half of its judged part only. Measured between the second and the third note of the scale (the
    // two these tunes are mostly made of): 0.00 with a straight hum, at most 0.05 with a swing of 30
    // cents, 0.35 to 0.47 with 50 (each of those notes good, none perfect), and with a swing of 80 cents
    // 0.62 on Mary Had a Little Lamb. That last one is the limit of the rule, kept here in sight.
    const between = 57 + 3
    for (const p of hummed) {
      const r = score(p, take(p, 44100, { monotoneMidi: between, vibratoCents: 50 }), 44100)
      expect(coach(r), `${p.name}: ${marks(r)}`).toBeLessThan(0.5)
      expect(r.summary.perfects, `${p.name}: ${marks(r)}`).toBe(0)
    }
    if (!whole) return
    const mary = tunes[2]
    const wideSwing = score(mary, take(mary, 44100, { monotoneMidi: between, vibratoCents: 80 }), 44100)
    expect(coach(wideSwing), marks(wideSwing)).toBeLessThan(0.75)
    expect(wideSwing.summary.perfects, marks(wideSwing)).toBe(0)
  })

  fullOnly('saying the words in rhythm instead of singing them: heard, and next to nothing counts', () => {
    // A speaking voice: every syllable short, somewhere within a tone and a half of where the speaker
    // talks, and falling by one to three semitones as it is said. Tried where it helps the speaker most:
    // talking on the lowest, the middle and the highest note of the tune.
    for (const p of tunes) {
      const written = [...new Set(p.notes.map((n) => n.midi))].sort((x, y) => x - y)
      for (const [k, base] of [written[0], written[written.length >> 1], written[written.length - 1]].entries()) {
        let seed = 7919 * (k + 1)
        const random = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          return seed / 4294967296
        }
        const spoken: SungNote[] = p.notes.map((n) => {
          const midi = base + 3 * (random() - 0.5)
          return { time: n.time, duration: Math.min(0.22, 0.7 * n.duration), midi, slideTo: midi - 1 - 2 * random() }
        })
        const sampleRate = RATES[k % 2]
        const r = score(p, take(p, sampleRate, { breath: 0.3, gapSec: 0.04 }, spoken), sampleRate)
        const label = `${p.name} spoken around ${base}: ${told(r, sampleRate)}`
        expect(coach(r), label).toBeLessThan(0.25)
        // It is not silence: the run counts, with nothing in it, and the card can say what was the matter.
        expect(verdict(r), label).toBe('counted')
        expect(r.result.coverage, label).toBeGreaterThan(0.6)
      }
    }
  })

  fullOnly('the right tune a whole note behind: only where a note is repeated does the last one pass for the next', () => {
    const p = tunes[0]
    // Sung one beat late, each pitch sounds while the next note is due. Where the tune repeats a note
    // that is the note; everywhere else the late credit is capped under a hit.
    const repeats = p.notes.filter((n, i) => i > 0 && p.notes[i - 1].midi === n.midi && Math.abs(p.notes[i - 1].time + 0.6 - n.time) < 0.31).length
    expect(repeats).toBeGreaterThan(5)
    for (const sampleRate of RATES) {
      const r = score(p, take(p, sampleRate, { lateSec: 0.6 }), sampleRate)
      expect(hits(r), told(r, sampleRate)).toBeLessThanOrEqual(repeats + 1)
      expect(coach(r), told(r, sampleRate)).toBeLessThan(0.5)
    }
  })

  it('holding the first note of an echo call into the answer', () => {
    const p = all.echo
    const beat = 60 / 72
    // From the start of each call to the end of its answer (six beats on), on the call's first note.
    const held: SungNote[] = p.chart.voice!.cues.filter((_, i) => i % 3 === 0).map((c) => ({ time: c.time, duration: 6.5 * beat, midi: c.midi }))
    expect(held.length).toBe(3)
    for (const sampleRate of rates(1)) {
      const r = score(p, take(p, sampleRate, {}, held), sampleRate)
      // The answers begin on the note that is held, and that is all the hold is worth.
      expect(hits(r), told(r, sampleRate)).toBeLessThanOrEqual(3)
      expect(coach(r), told(r, sampleRate)).toBeLessThan(0.5)
    }
  })
})

/**
 * A wireless headset's microphone can put the whole audio context at 16 or 24 kHz. A frame is 512
 * samples at any rate: 32 or 21 ms there, not 12, with a window of 128 or 85 ms. Every rule of the
 * tracker is in seconds, so nothing may change with the rate but how finely the singing is seen.
 */
const HEADSET_RATES = [16000, 24000]

describe('through a wireless headset\'s microphone, where a frame is two or three times as long', () => {
  it('in tune, a little late and an octave down still count, and the scored track alone does not', () => {
    const all = pieces()
    // A plain run: the quick notes at 16 kHz, where a note is nine frames long.
    for (const p of whole ? [all.ode, all.quick] : [all.quick]) {
      for (const sampleRate of whole ? HEADSET_RATES : [HEADSET_RATES[0]]) {
        for (const options of [{}, { lateSec: 0.15 }, { octave: -1 }]) {
          const r = score(p, take(p, sampleRate, options), sampleRate)
          expect(coach(r), `${p.name} ${JSON.stringify(options)} ${told(r, sampleRate)}`).toBeGreaterThanOrEqual(CLEAN)
        }
        const alone = score(p, scoredTrack(p, sampleRate), sampleRate)
        expect(hits(alone), `${p.name} ${told(alone, sampleRate)}`).toBe(0)
        expect(verdict(alone), `${p.name} ${told(alone, sampleRate)}`).toBe('unscored')
      }
    }
  })

  it('a vibrato of 80 cents at 6 a second is still on the note: the short notes of the echo and a line of quarter notes', () => {
    // From one frame to the next such a swing moves up to 91 cents at 16 kHz. Held to the 60 cents a
    // frame that tell a voice from the kick drum at 44.1 kHz, the echo lost a note at both rates.
    const all = pieces()
    for (const p of [all.echo, all.ode]) {
      for (const sampleRate of HEADSET_RATES) {
        const r = score(p, take(p, sampleRate, { vibratoCents: 80, vibratoHz: 6 }), sampleRate)
        expect(r.summary.total, `${p.name} ${told(r, sampleRate)}`).toBe(p.notes.length)
        expect(coach(r), `${p.name} ${told(r, sampleRate)}`).toBeGreaterThanOrEqual(CLEAN)
        expect(verdict(r), `${p.name} ${told(r, sampleRate)}`).toBe('counted')
      }
    }
  })

  it('a singer steadily off the notes stays far from a pass, though at 16 kHz the long window lets a note through here and there', () => {
    // The limit of the long window, kept here in sight. 128 ms of it smear the step from one note to the
    // next into a glide, slower than a vibrato swings, and on its way a singer 60 cents off passes
    // through the band of the note. On eighth notes that is enough for 4 notes in 18, all good, none
    // perfect (1 or 2 in 18 while the rule was 60 cents a frame, which threw part of such a glide away
    // along with the vibrato). From 24 kHz up it is none, as through a phone's own microphone.
    const p = pieces().quick
    for (const cents of whole ? [-60, 60] : [-60]) {
      const r = score(p, take(p, 16000, { cents }), 16000)
      expect(hits(r), `${cents} ${told(r, 16000)}`).toBeLessThanOrEqual(4)
      expect(r.summary.perfects, `${cents} ${told(r, 16000)}`).toBe(0)
      expect(coach(r), `${cents} ${told(r, 16000)}`).toBeLessThan(0.25)
      // Heard, and heard off the note: a run that counts, as a weak one.
      expect(verdict(r), `${cents} ${told(r, 16000)}`).toBe('counted')
      expect(r.feedback.reasons[cents < 0 ? 'low' : 'high'], `${cents} ${told(r, 16000)}`).toBe(p.notes.length - hits(r))
      if (!whole) continue
      const finer = score(p, take(p, 24000, { cents }), 24000)
      expect(hits(finer), `${cents} ${told(finer, 24000)}`).toBe(0)
    }
  })

  it('the click alone, soft or loud, is nobody singing: its kick drum is not taken for a voice, under a low voice\'s lanes either', () => {
    const all = pieces()
    // A plain run: the low voice's lanes, where the kick drum lies in the detector's range.
    for (const p of whole ? [lowPiece(), all.echo, all.quick, all.ode, all.held] : [lowPiece()]) {
      for (const sampleRate of HEADSET_RATES) {
        const click = renderDrums(p.chart, { sampleRate })
        for (const gain of [1, 2.5]) {
          const r = score(p, click.map((v) => Math.max(-1, Math.min(1, v * gain))), sampleRate)
          nothing(r, `${p.name} x${gain} ${told(r, sampleRate)}`)
        }
        const track = score(p, scoredTrack(p, sampleRate), sampleRate)
        nothing(track, `${p.name} scored track ${told(track, sampleRate)}`)
      }
    }
  })
})

/** Strummed open chords under the tune in A (A, D, E), on beats one and three, on the recorded guitar. */
function strums(p: Piece, sampleRate: number): Float32Array {
  const tuning = [40, 45, 50, 55, 59, 64]
  const shapes: Record<string, Array<[string: number, fret: number]>> = {
    A: [[1, 0], [2, 2], [3, 2], [4, 2], [5, 0]],
    D: [[2, 0], [3, 2], [4, 3], [5, 2]],
    E: [[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]],
  }
  const beat = 60 / (p.chart.tempos[0]?.bpm ?? 100)
  const notes: ChartNote[] = []
  const bars = Math.floor(p.chart.duration / (4 * beat))
  for (let bar = 0; bar < bars; bar++) {
    const name = ['A', 'A', 'D', 'A', 'E', 'A'][bar % 6]
    for (const at of [0, 2]) {
      const chordId = notes.length
      for (const [string, fret] of shapes[name]) {
        notes.push({ id: notes.length, time: (bar * 4 + at) * beat, duration: 2 * beat, midi: tuning[string] + fret, string, fret, velocity: 0.8, chordId, chordName: name })
      }
    }
  }
  const out = renderStrings({ ...p.chart, notes, voice: undefined }, { bank, sampleRate })
  const length = lengthOf(p, sampleRate)
  return out.length === length ? out : Float32Array.from({ length }, (_, i) => out[i] ?? 0)
}
