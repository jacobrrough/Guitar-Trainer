import { describe, expect, it } from 'vitest'
import { CHORD_SHAPES } from '../music/chords'
import { LEVELS, distinctLevels, generateLevel, generateLevels, reduceChord, scoreGroups, type ChordMode } from './difficulty'
import { constantBeatGrid } from './timing'
import type { Chart, ChartNote } from './types'

const TUNING = [40, 45, 50, 55, 59, 64]

/** A 4/4 chart at 120 bpm from [beat, lengthInBeats, [string, fret][]] entries: one entry is one note or one strum. */
function chartOf(bars: number, entries: [beat: number, beats: number, shape: number[][]][]): Chart {
  const bpm = 120
  const beat = 60 / bpm
  const notes: ChartNote[] = []
  entries.forEach(([at, len, shape], chordId) => {
    for (const [string, fret] of shape) notes.push({ id: notes.length, time: at * beat, duration: len * beat * 0.9, midi: TUNING[string] + fret, string, fret, velocity: 0.8, chordId })
  })
  const duration = bars * 4 * beat
  return {
    version: 1,
    title: 't',
    artist: 'a',
    source: 'midi',
    tuning: TUNING,
    capo: 0,
    duration,
    notes,
    beats: constantBeatGrid(bpm, 0, duration, 4),
    tempos: [{ time: 0, bpm }],
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  }
}

const noteIds = (c: Chart) => c.notes.map((n) => n.id)

/** Every level holds all the notes of the one below, and more of them while the chart has more to give. */
function expectLadder(chart: Chart, levels: Chart[]) {
  for (let i = 1; i < levels.length; i++) {
    const below = new Set(noteIds(levels[i - 1]))
    const here = new Set(noteIds(levels[i]))
    for (const id of below) expect(here.has(id), `level ${i + 1} drops note ${id}`).toBe(true)
    if (below.size < chart.notes.length) expect(here.size, `level ${i + 1} against level ${i}`).toBeGreaterThan(below.size)
    else expect(levels[i]).toBe(chart)
  }
}

function makeChart(): Chart {
  // 8 bars at 120 bpm, 16th-note runs in bars 1-4, open chords on every beat in bars 5-8.
  const bpm = 120
  const beat = 60 / bpm
  const notes: ChartNote[] = []
  let chordId = 0
  for (let bar = 0; bar < 4; bar++) {
    for (let step = 0; step < 16; step++) {
      const time = bar * 4 * beat + step * (beat / 4)
      notes.push({ id: notes.length, time, duration: beat / 4, midi: 52 + (step % 8), string: 2, fret: 2 + (step % 8), velocity: 0.7, chordId: chordId++ })
    }
  }
  const em: [number, number][] = [[0, 0], [1, 2], [2, 2], [3, 0], [4, 0], [5, 0]]
  const tuning = [40, 45, 50, 55, 59, 64]
  for (let bar = 4; bar < 8; bar++) {
    for (let b = 0; b < 4; b++) {
      const time = bar * 4 * beat + b * beat
      const id = chordId++
      for (const [s, f] of em) {
        notes.push({ id: notes.length, time, duration: beat * 0.9, midi: tuning[s] + f, string: s, fret: f, velocity: 0.8, chordId: id, chordName: 'Em' })
      }
    }
  }
  const duration = 8 * 4 * beat
  return {
    version: 1,
    title: 't',
    artist: 'a',
    source: 'midi',
    tuning,
    capo: 0,
    duration,
    notes,
    beats: constantBeatGrid(bpm, 0, duration, 4),
    tempos: [{ time: 0, bpm }],
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  }
}

describe('scoreGroups', () => {
  it('rates downbeats above off-beats', () => {
    const chart = makeChart()
    const groups = scoreGroups(chart)
    const downbeat = groups.find((g) => Math.abs(g.time - 0) < 1e-6)!
    const sixteenth = groups.find((g) => Math.abs(g.time - 0.125) < 1e-6)!
    const onBeat = groups.find((g) => Math.abs(g.time - 0.5) < 1e-6)!
    expect(downbeat.salience).toBeGreaterThan(onBeat.salience)
    expect(onBeat.salience).toBeGreaterThan(sixteenth.salience)
  })

  it('rates a note by the beat it is on, also when rounding puts it a hair before that beat', () => {
    // At 88 bpm the beat grid (added up bar by bar) and the note times (beat number times beat length)
    // round differently: some notes come out a fraction of a microsecond before their own beat.
    const bpm = 88
    const beat = 60 / bpm
    const duration = 16 * 4 * beat
    const beats = constantBeatGrid(bpm, 0, duration, 4)
    const notes: ChartNote[] = Array.from({ length: 64 }, (_, i) => ({ id: i, time: i * beat, duration: beat * 0.95, midi: 55, string: 3, fret: 0, velocity: 0.8, chordId: i }))
    expect(notes.some((n, i) => n.time < beats[i].time)).toBe(true)
    const chart: Chart = { version: 1, title: 't', artist: 'a', source: 'midi', tuning: TUNING, capo: 0, duration, notes, beats, tempos: [{ time: 0, bpm }], timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] }
    const groups = scoreGroups(chart)
    groups.forEach((g, i) => {
      expect(g.bar, `beat ${i}`).toBe(Math.floor(i / 4))
      // Every bar after the first is rated like the second: beat 1 highest, then beat 3, then 2 and 4.
      if (i >= 4) expect(g.salience, `beat ${i}`).toBe(groups[4 + (i % 4)].salience)
    })
    expect(groups[4].salience).toBeGreaterThan(groups[6].salience)
    expect(groups[6].salience).toBeGreaterThan(groups[5].salience)
    expect(groups[5].salience).toBe(groups[7].salience)
  })
})

describe('generateLevels', () => {
  const chart = makeChart()
  const levels = generateLevels(chart)

  it('produces a monotonic progression of note counts ending at the full chart', () => {
    const counts = levels.map((l) => l.notes.length)
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    expect(levels[levels.length - 1].notes.length).toBe(chart.notes.length)
    expect(counts[0]).toBeLessThan(counts[counts.length - 1] * 0.4)
  })

  it('keeps at least one note in every bar at level 1', () => {
    const level1 = levels[0]
    const beat = 0.5
    for (let bar = 0; bar < 8; bar++) {
      const inBar = level1.notes.filter((n) => n.time >= bar * 4 * beat - 1e-6 && n.time < (bar + 1) * 4 * beat - 1e-6)
      expect(inBar.length).toBeGreaterThan(0)
    }
  })

  it('reduces chords to single notes at level 1 and power chords at level 3', () => {
    const chordTime = 4 * 4 * 0.5
    const l1 = levels[0].notes.filter((n) => Math.abs(n.time - chordTime) < 1e-6)
    expect(l1.length).toBe(1)
    expect(l1[0].midi).toBe(40)
    const l3 = levels[2].notes.filter((n) => Math.abs(n.time - chordTime) < 1e-6)
    expect(l3.map((n) => n.midi).sort((a, b) => a - b)).toEqual([40, 47])
    const full = levels[5].notes.filter((n) => Math.abs(n.time - chordTime) < 1e-6)
    expect(full.length).toBe(6)
  })

  it('respects the minimum spacing at low levels', () => {
    const l1 = levels[0]
    const times = [...new Set(l1.notes.map((n) => n.time))].sort((a, b) => a - b)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(0.25 - 1e-6)
  })

  it('is deterministic', () => {
    const again = generateLevels(chart)
    levels.forEach((l, i) => expect(again[i].notes.map((n) => n.id)).toEqual(l.notes.map((n) => n.id)))
  })

  it('returns the original chart object for the full level', () => {
    expect(generateLevel(chart, LEVELS[5])).toBe(chart)
  })

  it('makes every level contain the one below and add to it', () => {
    expectLadder(chart, levels)
    expect(distinctLevels(levels)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('gives one level the same notes whether it is built alone or with the others', () => {
    LEVELS.forEach((def, i) => expect(noteIds(generateLevel(chart, def))).toEqual(noteIds(levels[i])))
  })
})

describe('levels of a short tune', () => {
  const open = (string: number) => [[string, 0]]

  it('still differ when one note per bar is already more than the lower levels ask for', () => {
    // 8 bars with a note on beats 1 and 3, as in a first open-string tune: the bar anchors alone are
    // half the tune, more than the 15% and 30% the two lowest levels keep.
    const tune = chartOf(8, Array.from({ length: 16 }, (_, i) => [i * 2, 2, open(3 + (i % 3))]))
    const levels = generateLevels(tune)
    expect(levels).toHaveLength(LEVELS.length)
    expect(levels[0].notes).toHaveLength(8)
    expectLadder(tune, levels)
    expect(distinctLevels(levels)).toEqual([0, 1, 2, 3, 4, 5])
    expect(levels[5]).toBe(tune)
  })

  it('repeats the full chart once the notes run out, and distinctLevels says from where', () => {
    // 11 notes in 8 bars: three more than the anchors, so three more levels and then nothing left.
    const tune = chartOf(8, [...Array.from({ length: 8 }, (_, i): [number, number, number[][]] => [i * 4, 2, open(4)]), [2, 2, open(3)], [14, 2, open(3)], [26, 2, open(3)]])
    const levels = generateLevels(tune)
    expect(levels).toHaveLength(LEVELS.length)
    expect(levels.map((l) => l.notes.length)).toEqual([8, 9, 10, 11, 11, 11])
    expectLadder(tune, levels)
    expect(distinctLevels(levels)).toEqual([0, 1, 2, 3])
    // One note per bar and nothing else: there is only one chart to offer.
    const bare = chartOf(4, Array.from({ length: 4 }, (_, i) => [i * 4, 4, open(5)]))
    const same = generateLevels(bare)
    expect(same).toHaveLength(LEVELS.length)
    for (const l of same) expect(l).toBe(bare)
    expect(distinctLevels(same)).toEqual([0])
  })

  it('shows more of each chord when there is no other note to add', () => {
    // One G strum per bar: every level keeps all four strums, so only the chord can grow.
    const strums = chartOf(4, Array.from({ length: 4 }, (_, i) => [i * 4, 4, CHORD_SHAPES.G.shape]))
    const levels = generateLevels(strums)
    expect(levels.map((l) => l.notes.length)).toEqual([4, 8, 12, 24, 24, 24])
    expectLadder(strums, levels)
    expect(distinctLevels(levels)).toEqual([0, 1, 2, 3])
  })

  it('adds a note that is closer than the spacing rather than repeat a level', () => {
    // Each bar has a note on beat 1 and a quick one a quarter of a beat later: too close for the two
    // lowest levels, but the only notes left to add.
    const flams = chartOf(4, Array.from({ length: 8 }, (_, i) => [Math.floor(i / 2) * 4 + (i % 2) * 0.25, 0.25, open(4)]))
    const levels = generateLevels(flams)
    expect(levels[0].notes).toHaveLength(4)
    expect(levels[1].notes).toHaveLength(5)
    expectLadder(flams, levels)
  })
})

describe('distinctLevels', () => {
  it('lists the first level and every level that is not a copy of the one below', () => {
    const tune = chartOf(2, [[0, 1, [[3, 0]]], [1, 1, [[4, 0]]], [4, 1, [[5, 0]]]])
    const first = { ...tune, notes: tune.notes.slice(0, 1) }
    const other = { ...tune, notes: tune.notes.slice(1, 2) }
    expect(distinctLevels([])).toEqual([])
    expect(distinctLevels([tune])).toEqual([0])
    expect(distinctLevels([first, { ...first }, tune, tune])).toEqual([0, 2])
    // The same number of notes is not enough to be a copy.
    expect(distinctLevels([first, other, other])).toEqual([0, 1])
  })
})

describe('reduceChord', () => {
  const tuning = [40, 45, 50, 55, 59, 64]
  const cMajor: ChartNote[] = [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]].map(([s, f], i) => ({
    id: i,
    time: 0,
    duration: 1,
    midi: tuning[s] + f,
    string: s,
    fret: f,
    velocity: 1,
    chordId: 0,
  }))
  it('picks the root, then the root and the string next to it, then the lowest three', () => {
    expect(reduceChord(cMajor, 'root').map((n) => n.midi)).toEqual([48])
    // C on the A string and E on the D string: the G a fifth up is on the G string, with the D string between.
    expect(reduceChord(cMajor, 'power').map((n) => n.midi)).toEqual([48, 52])
    expect(reduceChord(cMajor, 'power').map((n) => n.string)).toEqual([1, 2])
    expect(reduceChord(cMajor, 'triad').map((n) => n.midi)).toEqual([48, 52, 55])
    expect(reduceChord(cMajor, 'full').length).toBe(5)
  })

  const strum = (shape: number[][]): ChartNote[] => shape.map(([s, f], i) => ({ id: i, time: 0, duration: 1, midi: tuning[s] + f, string: s, fret: f, velocity: 1, chordId: 0 }))

  it('reduces every chord shape to two strings next to each other, lowest note included', () => {
    for (const { name, shape } of Object.values(CHORD_SHAPES)) {
      const two = reduceChord(strum(shape), 'power')
      expect(two.map((n) => n.string), name).toEqual([shape[0][0], shape[0][0] + 1])
    }
    expect(reduceChord(strum(CHORD_SHAPES.G.shape), 'power').map((n) => [n.string, n.fret])).toEqual([[0, 3], [1, 2]])
  })

  it('keeps the root alone when the shape has no note on a neighbouring string', () => {
    const spread = strum([[0, 3], [2, 0], [4, 0]])
    expect(reduceChord(spread, 'power').map((n) => n.string)).toEqual([0])
    expect(reduceChord(spread, 'triad').map((n) => n.string)).toEqual([0, 2, 4])
    // A two-note shape is already as small as the chart wrote it.
    const octave = strum([[0, 3], [2, 5]])
    expect(reduceChord(octave, 'power')).toHaveLength(2)
  })

  it('never takes a note away when the mode gets fuller', () => {
    const modes: ChordMode[] = ['root', 'power', 'triad', 'full']
    // The last shape has its fifth far from the root, where "lowest three" alone would drop it.
    const shapes = [...Object.values(CHORD_SHAPES).map((c) => c.shape), [[0, 3], [2, 0], [4, 0]], [[1, 3], [3, 0], [4, 1], [2, 2]]]
    for (const shape of shapes) {
      const notes = strum(shape)
      for (let i = 1; i < modes.length; i++) {
        const fuller = reduceChord(notes, modes[i])
        for (const n of reduceChord(notes, modes[i - 1])) expect(fuller).toContain(n)
        expect(fuller.length).toBeLessThanOrEqual(Math.min(notes.length, [1, 2, 3, 6][i]))
      }
    }
  })
})
