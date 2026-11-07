import { describe, expect, it } from 'vitest'
import { LEVELS, generateLevel, generateLevels, reduceChord, scoreGroups } from './difficulty'
import { constantBeatGrid } from './timing'
import type { Chart, ChartNote } from './types'

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
  it('picks root, then root+fifth, then the lowest three', () => {
    expect(reduceChord(cMajor, 'root').map((n) => n.midi)).toEqual([48])
    expect(reduceChord(cMajor, 'power').map((n) => n.midi)).toEqual([48, 55])
    expect(reduceChord(cMajor, 'triad').map((n) => n.midi)).toEqual([48, 52, 55])
    expect(reduceChord(cMajor, 'full').length).toBe(5)
  })
})
