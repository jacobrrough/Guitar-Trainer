/**
 * Ordinary guitar patterns on the recorded guitar, scored the way the microphone is scored in the app:
 * bass walks and arpeggios with the strings left ringing, the open strings up and down, an octave
 * figure, power-chord changes, a bass note with a chord right after it, hammer-ons and pull-offs.
 * Each is played exactly as written, in a quiet room and through a phone's microphone, and has to
 * score; and each comes with the ways of not playing it that must not score (nobody plays, every note
 * a fret or two off, every other note left out while the rest ring on, one stroke for two notes).
 *
 * PATTERN_ONLY=<regexp> runs a part of it, PATTERN_LOG=1 prints one line per run.
 */
import { appendFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SampleBank } from '../../audio/instrument/bank'
import { loadRealBank } from '../../audio/instrument/realBank.testutil'
import { renderStrings } from '../../audio/synth'
import { groupNotes } from '../../chart/events'
import { constantBeatGrid } from '../../chart/timing'
import type { Chart, ChartNote, NoteTechniques } from '../../chart/types'
import { DEFAULT_WINDOW } from './scoring'
import { phoneMic, transposed } from './simCases.testutil'
import { simulateRun, type SimulationResult } from './simulate'

const TUNING = [40, 45, 50, 55, 59, 64]

/** One stroke of the picking hand: when (in steps of the pattern's note value) and which strings at which frets. Strings count from the thickest, 6, to the thinnest, 1. */
interface Stroke {
  at: number
  notes: [guitarString: number, fret: number][]
  tech?: NoteTechniques
}

type Family = 'bass walk' | 'arpeggio' | 'open strings' | 'octave' | 'power chords' | 'bass then chord' | 'hammer-ons' | 'pull-offs'

interface Pattern {
  name: string
  family: Family
  bpm: number
  /** Notes per beat: 1 quarters, 2 eighths, 4 sixteenths. */
  perBeat: number
  strokes: Stroke[]
  /** Share of the notes that must score when played exactly, in a quiet room and through the phone microphone. */
  hit: number
  hitPhone: number
  /** Share of the hits that must be within 45 ms of the beat. */
  onTime: number
}

/** `cycle` played `times` times, one stroke per step. */
function repeat(cycle: Stroke['notes'][], times: number, tech?: (i: number) => NoteTechniques | undefined): Stroke[] {
  const out: Stroke[] = []
  for (let r = 0; r < times; r++) cycle.forEach((notes, i) => out.push({ at: out.length, notes, tech: tech?.(i) }))
  return out
}

function chartOf(p: Pick<Pattern, 'bpm' | 'perBeat' | 'strokes'>): Chart {
  const step = 60 / p.bpm / p.perBeat
  const start = 2 * (60 / p.bpm)
  const notes: ChartNote[] = []
  p.strokes.forEach((s, chordId) => {
    for (const [guitarString, fret] of s.notes) {
      const string = 6 - guitarString
      notes.push({ id: notes.length, time: start + s.at * step, duration: step, midi: TUNING[string] + fret, string, fret, velocity: 0.8, chordId, tech: s.tech })
    }
  })
  const duration = start + (Math.max(...p.strokes.map((s) => s.at)) + 1) * step + 1.5
  return { version: 1, title: 'pattern', artist: '', source: 'builtin', tuning: TUNING, capo: 0, duration, notes, beats: constantBeatGrid(p.bpm, 0, duration), tempos: [{ time: 0, bpm: p.bpm }], timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] }
}

const VALUE: Record<number, string> = { 1: 'quarters', 2: 'eighths', 4: 'sixteenths' }

function patterns(): Pattern[] {
  const out: Pattern[] = []
  const add = (family: Family, what: string, bpm: number, perBeat: number, strokes: Stroke[], hit: number, hitPhone: number, onTime: number) =>
    out.push({ name: `${family}: ${what}, ${VALUE[perBeat]} at ${bpm}`, family, bpm, perBeat, strokes, hit, hitPhone, onTime })

  // Bass walks, the string before left ringing: a whole tone apart, on neighbouring strings.
  const walks: [string, Stroke['notes'][]][] = [
    ['6th string fret 3, open 5th and back', [[[6, 3]], [[5, 0]]]],
    ['5th string fret 3, open 4th and back', [[[5, 3]], [[4, 0]]]],
  ]
  for (const [what, cycle] of walks) {
    for (const perBeat of [1, 2]) for (const bpm of [60, 80, 100, 120]) add('bass walk', what, bpm, perBeat, repeat(cycle, perBeat === 1 ? 4 : 6), 1, 0.97, 1)
  }

  // Arpeggios, every string left ringing under the next.
  const arps: [string, Stroke['notes'][]][] = [
    ['Em', [[[6, 0]], [[4, 2]], [[3, 0]], [[2, 0]], [[1, 0]], [[2, 0]], [[3, 0]], [[4, 2]]]],
    ['G', [[[6, 3]], [[3, 0]], [[2, 0]], [[1, 3]], [[2, 0]], [[3, 0]]]],
    ['C', [[[5, 3]], [[3, 0]], [[2, 1]], [[1, 0]], [[2, 1]], [[3, 0]]]],
    ['Am', [[[5, 0]], [[3, 2]], [[2, 1]], [[1, 0]], [[2, 1]], [[3, 2]]]],
    ['D', [[[4, 0]], [[3, 2]], [[2, 3]], [[1, 2]], [[2, 3]], [[3, 2]]]],
  ]
  for (const [what, cycle] of arps) for (const bpm of [80, 100, 120]) add('arpeggio', what, bpm, 2, repeat(cycle, 4), 1, 0.97, 1)

  // The six open strings.
  const up: Stroke['notes'][] = [[[6, 0]], [[5, 0]], [[4, 0]], [[3, 0]], [[2, 0]], [[1, 0]]]
  for (const bpm of [100, 120, 140]) {
    const fast = bpm > 120
    add('open strings', 'thickest to thinnest', bpm, 2, repeat(up, 4), fast ? 0.9 : 1, fast ? 0.9 : 0.97, fast ? 0.9 : 1)
    add('open strings', 'thinnest to thickest', bpm, 2, repeat([...up].reverse(), 4), fast ? 0.9 : 1, fast ? 0.9 : 0.97, fast ? 0.9 : 1)
  }

  // The low E and the E an octave above it, in turn.
  for (const perBeat of [2, 4]) add('octave', 'open 6th string and 4th string fret 2', 100, perBeat, repeat([[[6, 0]], [[4, 2]]], 12), 0.9, 0.9, 0.9)

  // Power chords, two strokes each: E5, G5, A5.
  const power: Stroke['notes'][] = [
    [[6, 0], [5, 2], [4, 2]],
    [[6, 0], [5, 2], [4, 2]],
    [[6, 3], [5, 5], [4, 5]],
    [[6, 3], [5, 5], [4, 5]],
    [[5, 0], [4, 2], [3, 2]],
    [[5, 0], [4, 2], [3, 2]],
  ]
  for (const bpm of [120, 140, 160]) add('power chords', 'E5 G5 A5', bpm, 2, repeat(power, 4), 0.95, 0.9, 0.9)
  for (const bpm of [100, 120, 130]) add('power chords', 'E5 G5 A5', bpm, 4, repeat(power, 4), 0.9, 0.9, 0.9)

  // A bass note and, a sixteenth later, the chord above it (Em twice, Am twice).
  const boomChick = (times: number): Stroke[] => {
    const strokes: Stroke[] = []
    for (let beat = 0; beat < times * 4; beat++) {
      const em = beat % 4 < 2
      strokes.push({ at: beat * 4, notes: em ? [[6, 0]] : [[5, 0]] })
      strokes.push({ at: beat * 4 + 1, notes: em ? [[4, 2], [3, 0], [2, 0], [1, 0]] : [[4, 2], [3, 2], [2, 1], [1, 0]] })
    }
    return strokes
  }
  for (const bpm of [100, 120]) add('bass then chord', 'Em and Am', bpm, 4, boomChick(3), 0.9, 0.9, 0.9)

  // Hammer-ons and pull-offs on the 3rd string: open to fret 2 and fret 2 to open.
  for (const bpm of [100, 115, 130]) {
    add('hammer-ons', '3rd string open to fret 2', bpm, 4, repeat([[[3, 0]], [[3, 2]]], 12, (i) => (i === 1 ? { hammerOn: true } : undefined)), 0.9, 0.9, 0.9)
    add('pull-offs', '3rd string fret 2 to open', bpm, 4, repeat([[[3, 2]], [[3, 0]]], 12, (i) => (i === 1 ? { pullOff: true } : undefined)), 0.9, 0.9, 0.9)
  }
  return out
}

const only = process.env.PATTERN_ONLY ? new RegExp(process.env.PATTERN_ONLY) : null
const PATTERNS = patterns().filter((p) => !only || only.test(p.name))
const log = (line: string) => {
  if (process.env.PATTERN_LOG) console.log(line)
  if (process.env.PATTERN_FILE) appendFileSync(process.env.PATTERN_FILE, line + '\n')
}

/**
 * What the tracker does not manage yet, as measured: each test named here still fails its target and
 * is run as an expected failure, so the day one of them is fixed it shows up and comes off the list.
 * Nothing may be added here to make a change pass.
 */
const KNOWN_GAPS = new Set<string>([
  'arpeggio: Am, eighths at 120',
  'arpeggio: Am, eighths at 120, through a phone microphone at 48 kHz',
  'arpeggio: C, eighths at 100, through a phone microphone at 48 kHz',
  'arpeggio: C, eighths at 120, through a phone microphone at 48 kHz',
  'arpeggio: D, eighths at 100, through a phone microphone at 48 kHz',
  'arpeggio: D, eighths at 120',
  'arpeggio: D, eighths at 120, through a phone microphone at 48 kHz',
  'arpeggio: Em, eighths at 100',
  'arpeggio: Em, eighths at 100, through a phone microphone at 48 kHz',
  'arpeggio: Em, eighths at 120',
  'arpeggio: Em, eighths at 120, through a phone microphone at 48 kHz',
  'arpeggio: Em, eighths at 120: every other note left out while the rest ring on',
  'arpeggio: Em, eighths at 80, through a phone microphone at 48 kHz',
  'arpeggio: G, eighths at 100',
  'arpeggio: G, eighths at 100, through a phone microphone at 48 kHz',
  'arpeggio: G, eighths at 120',
  'arpeggio: G, eighths at 120, through a phone microphone at 48 kHz',
  'bass then chord: Em and Am, sixteenths at 100',
  'bass then chord: Em and Am, sixteenths at 100, through a phone microphone at 48 kHz',
  'bass then chord: Em and Am, sixteenths at 100: every other note left out while the rest ring on',
  'bass then chord: Em and Am, sixteenths at 120',
  'bass then chord: Em and Am, sixteenths at 120, through a phone microphone at 48 kHz',
  'bass then chord: Em and Am, sixteenths at 120: every other note left out while the rest ring on',
  'bass walk: 6th string fret 3, open 5th and back, eighths at 120: every note a fret or two off',
  'hammer-ons: 3rd string open to fret 2, sixteenths at 115: every note a fret or two off',
  'octave: open 6th string and 4th string fret 2, sixteenths at 100',
  'octave: open 6th string and 4th string fret 2, sixteenths at 100, through a phone microphone at 48 kHz',
  'octave: open 6th string and 4th string fret 2, sixteenths at 100: every note a fret or two off',
  'open strings: thickest to thinnest, eighths at 100: every note a fret or two off',
  'open strings: thickest to thinnest, eighths at 120',
  'open strings: thickest to thinnest, eighths at 120, through a phone microphone at 48 kHz',
  'open strings: thickest to thinnest, eighths at 140, through a phone microphone at 48 kHz',
  'open strings: thickest to thinnest, eighths at 140: every note a fret or two off',
  'open strings: thinnest to thickest, eighths at 100',
  'open strings: thinnest to thickest, eighths at 100: every other note left out while the rest ring on',
  'open strings: thinnest to thickest, eighths at 120',
  'open strings: thinnest to thickest, eighths at 120, through a phone microphone at 48 kHz',
  'open strings: thinnest to thickest, eighths at 120: every other note left out while the rest ring on',
  'power chords: E5 G5 A5, eighths at 140, through a phone microphone at 48 kHz',
  'power chords: E5 G5 A5, eighths at 140: every note a fret or two off',
  'power chords: E5 G5 A5, eighths at 140: one stroke does not score two notes of the same pitch',
  'power chords: E5 G5 A5, eighths at 160, through a phone microphone at 48 kHz',
  'power chords: E5 G5 A5, eighths at 160: every note a fret or two off',
  'power chords: E5 G5 A5, sixteenths at 100',
  'power chords: E5 G5 A5, sixteenths at 100, through a phone microphone at 48 kHz',
  'power chords: E5 G5 A5, sixteenths at 100: every note a fret or two off',
  'power chords: E5 G5 A5, sixteenths at 100: every other note left out while the rest ring on',
  'power chords: E5 G5 A5, sixteenths at 120',
  'power chords: E5 G5 A5, sixteenths at 120, through a phone microphone at 48 kHz',
  'power chords: E5 G5 A5, sixteenths at 120: every note a fret or two off',
  'power chords: E5 G5 A5, sixteenths at 130',
  'power chords: E5 G5 A5, sixteenths at 130, through a phone microphone at 48 kHz',
  'power chords: E5 G5 A5, sixteenths at 130: every note a fret or two off',
  'pull-offs: 3rd string fret 2 to open, sixteenths at 115: every note a fret or two off',
  'pull-offs: 3rd string fret 2 to open, sixteenths at 130: one stroke does not score two notes of the same pitch',
])

/**
 * The octave above taken for the note itself while other strings ring (partials of the ringing strings
 * rise where the note's third or fifth harmonic would be). Measured note for note the same on the
 * tracker as it was before the ringing-string fixes, so none of these came with a change.
 */
for (const title of [
  'arpeggio: Am, eighths at 100: the octave above does not score',
  'arpeggio: Am, eighths at 80: the octave above does not score',
  'arpeggio: C, eighths at 100: the octave above does not score',
  'arpeggio: C, eighths at 120: the octave above does not score',
  'arpeggio: C, eighths at 80: the octave above does not score',
  'arpeggio: D, eighths at 100: the octave above does not score',
  'arpeggio: D, eighths at 120: the octave above does not score',
  'arpeggio: D, eighths at 80: the octave above does not score',
  'arpeggio: Em, eighths at 100: the octave above does not score',
  'arpeggio: Em, eighths at 120: the octave above does not score',
  'arpeggio: Em, eighths at 80: the octave above does not score',
  'arpeggio: G, eighths at 100: the octave above does not score',
  'arpeggio: G, eighths at 80: the octave above does not score',
  'hammer-ons: 3rd string open to fret 2, sixteenths at 100: the octave above does not score',
  'hammer-ons: 3rd string open to fret 2, sixteenths at 115: the octave above does not score',
  'hammer-ons: 3rd string open to fret 2, sixteenths at 130: the octave above does not score',
  'open strings: thinnest to thickest, eighths at 100: the octave above does not score',
  'open strings: thinnest to thickest, eighths at 120: the octave above does not score',
  'open strings: thinnest to thickest, eighths at 140: the octave above does not score',
  'pull-offs: 3rd string fret 2 to open, sixteenths at 100: the octave above does not score',
  'pull-offs: 3rd string fret 2 to open, sixteenths at 115: the octave above does not score',
  'pull-offs: 3rd string fret 2 to open, sixteenths at 130: the octave above does not score',
]) KNOWN_GAPS.add(title)

const check = (title: string) => (KNOWN_GAPS.has(title) ? it.fails : it)

let bank: SampleBank
beforeAll(async () => {
  bank = await loadRealBank()
})

const hits = (r: SimulationResult) => r.summary.perfects + r.summary.goods
const marks = (r: SimulationResult) => r.statuses.map((s) => (s === 'hit' ? 'H' : '.')).join('')
const late = (r: SimulationResult) => r.deltasMs.filter((d) => Math.abs(d) > 45).map((d) => d.toFixed(0))

/** The pattern's notes (or `played` instead) performed on the recorded guitar. */
function perform(chart: Chart, sampleRate: number, played: ChartNote[] = chart.notes): Float32Array {
  return renderStrings({ ...chart, notes: played }, { bank, sampleRate })
}

/**
 * Hits that nothing in the performance can account for: no stroke of exactly the group's pitches fell
 * inside the group's window. (A wrong note that happens to be the next note's pitch, played inside
 * that note's window, is a real, early hit and does not count here.)
 */
function falseHits(chart: Chart, played: ChartNote[], r: SimulationResult): number {
  const strokes = groupNotes(played)
  let n = 0
  groupNotes(chart.notes).forEach((g, i) => {
    if (r.statuses[i] !== 'hit') return
    const want = g.notes.map((x) => x.midi).sort((a, b) => a - b).join(',')
    const real = strokes.some((s) => s.time >= g.time - DEFAULT_WINDOW.early && s.time <= g.time + DEFAULT_WINDOW.late && s.notes.map((x) => x.midi).sort((a, b) => a - b).join(',') === want)
    if (!real) n++
  })
  return n
}

describe('patterns played exactly as written', () => {
  it('covers every family', () => {
    if (only) return
    expect(new Set(PATTERNS.map((p) => p.family)).size).toBe(8)
  })

  for (const p of PATTERNS) check(p.name)(p.name, () => {
    const chart = chartOf(p)
    const r = simulateRun(chart.notes, chart.beats, perform(chart, 44100), { sampleRate: 44100 })
    log(`${p.name} | ${hits(r)}/${r.summary.total} (${r.summary.perfects}/${r.summary.goods}/${r.summary.misses}) ${marks(r)} | >45ms: ${late(r).join(',')}`)
    expect(hits(r) / r.summary.total, `${marks(r)}`).toBeGreaterThanOrEqual(p.hit)
    expect(r.deltasMs.filter((d) => Math.abs(d) <= 45).length / Math.max(1, r.deltasMs.length), `late or early (ms): ${late(r).join(', ')}`).toBeGreaterThanOrEqual(p.onTime)
  })

  for (const p of PATTERNS) check(`${p.name}, through a phone microphone at 48 kHz`)(`${p.name}, through a phone microphone at 48 kHz`, () => {
    const chart = chartOf(p)
    const r = simulateRun(chart.notes, chart.beats, phoneMic(perform(chart, 48000), 48000), { sampleRate: 48000 })
    log(`${p.name} [phone] | ${hits(r)}/${r.summary.total} (${r.summary.perfects}/${r.summary.goods}/${r.summary.misses}) ${marks(r)} | >45ms: ${late(r).join(',')}`)
    expect(hits(r) / r.summary.total, `${marks(r)}`).toBeGreaterThanOrEqual(p.hitPhone)
    expect(r.deltasMs.filter((d) => Math.abs(d) <= 45).length / Math.max(1, r.deltasMs.length), `late or early (ms): ${late(r).join(', ')}`).toBeGreaterThanOrEqual(Math.min(p.onTime, 0.9))
  })
})

describe('patterns: what must not score', () => {
  for (const p of PATTERNS) check(`${p.name}: nobody plays`)(`${p.name}: nobody plays`, () => {
    const chart = chartOf(p)
    const r = simulateRun(chart.notes, chart.beats, new Float32Array(Math.ceil(chart.duration * 44100)), { sampleRate: 44100 })
    expect(hits(r)).toBe(0)
  })

  for (const p of PATTERNS) check(`${p.name}: every note a fret or two off`)(`${p.name}: every note a fret or two off`, () => {
    const chart = chartOf(p)
    for (const semitones of [1, -1, 2, -2]) {
      const played = transposed(chart.notes, semitones)
      const r = simulateRun(chart.notes, chart.beats, perform(chart, 44100, played), { sampleRate: 44100 })
      const wrong = falseHits(chart, played, r)
      log(`${p.name} [${semitones > 0 ? '+' : ''}${semitones}] | ${hits(r)}/${r.summary.total} false ${wrong} ${marks(r)}`)
      expect(wrong / r.summary.total, `${semitones} semitones: ${marks(r)}`).toBeLessThanOrEqual(0.03)
    }
  })

  // The octave above in place of every other note, while the notes in between are played and ring on:
  // a ringing string next to the wanted note's fundamental must not make the octave above pass for it.
  for (const p of PATTERNS.filter((x) => x.strokes.every((s) => s.notes.length === 1) && x.family !== 'octave')) check(`${p.name}: the octave above does not score`)(`${p.name}: the octave above does not score`, () => {
    const chart = chartOf(p)
    for (const parity of [0, 1]) {
      const played = chart.notes.map((n) => (n.chordId % 2 === parity ? { ...n, midi: n.midi + 12 } : n))
      const r = simulateRun(chart.notes, chart.beats, perform(chart, 44100, played), { sampleRate: 44100 })
      const shifted = groupNotes(chart.notes).filter((g) => g.chordId % 2 === parity).length
      const wrong = falseHits(chart, played, r)
      log(`${p.name} [octave above, ${parity}] | false ${wrong}/${shifted} ${marks(r)}`)
      expect(wrong / shifted, marks(r)).toBeLessThanOrEqual(0.03)
    }
  })

  // A bass walk under ringing thin strings: their partials sit on the bass notes' third and fifth
  // harmonics, which is all that tells a bass note from its octave above when a string next to it rings.
  for (const bpm of [80, 100, 120]) check(`bass walk under ringing thin strings, eighths at ${bpm}: the octave above does not score`)(`bass walk under ringing thin strings, eighths at ${bpm}: the octave above does not score`, () => {
    if (only && !only.test('bass walk')) return
    const chart = chartOf({ bpm, perBeat: 2, strokes: repeat([[[6, 3]], [[5, 0]], [[1, 0]], [[2, 0]]], 6) })
    for (const which of [0, 1]) {
      const played = chart.notes.map((n) => (n.chordId % 4 === which ? { ...n, midi: n.midi + 12 } : n))
      const r = simulateRun(chart.notes, chart.beats, perform(chart, 44100, played), { sampleRate: 44100 })
      const wrong = falseHits(chart, played, r)
      log(`bass walk under ringing thin strings, eighths at ${bpm} [octave above, ${which}] | false ${wrong}/6 ${marks(r)}`)
      expect(wrong, marks(r)).toBe(0)
    }
  })

  for (const p of PATTERNS) check(`${p.name}: every other note left out while the rest ring on`)(`${p.name}: every other note left out while the rest ring on`, () => {
    const chart = chartOf(p)
    for (const parity of [0, 1]) {
      const played = chart.notes.filter((n) => n.chordId % 2 === parity)
      const r = simulateRun(chart.notes, chart.beats, perform(chart, 44100, played), { sampleRate: 44100 })
      const groups = groupNotes(chart.notes)
      const left = groups.filter((g) => g.chordId % 2 !== parity).length
      const wrong = falseHits(chart, played, r)
      const kept = groups.filter((g, i) => g.chordId % 2 === parity && r.statuses[i] === 'hit').length
      log(`${p.name} [every other, ${parity}] | played ${kept}/${groups.length - left} false ${wrong}/${left} ${marks(r)}`)
      expect(wrong / left, marks(r)).toBeLessThanOrEqual(0.03)
    }
  })

  for (const p of PATTERNS) check(`${p.name}: one stroke does not score two notes of the same pitch`)(`${p.name}: one stroke does not score two notes of the same pitch`, () => {
    const chart = chartOf(p)
    // The chart asks for every note twice, 90 ms apart; each is played once.
    const twice: ChartNote[] = []
    for (const n of chart.notes) twice.push({ ...n, id: twice.length }, { ...n, id: twice.length + 1, time: n.time + 0.09, chordId: n.chordId + 100000 })
    const r = simulateRun(twice, chart.beats, perform(chart, 44100), { sampleRate: 44100 })
    const strokes = groupNotes(chart.notes).length
    log(`${p.name} [written twice] | ${hits(r)} hits for ${strokes} strokes ${marks(r)}`)
    expect(hits(r)).toBeLessThanOrEqual(strokes)
  })
})
