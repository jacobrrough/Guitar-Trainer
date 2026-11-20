import { describe, expect, it } from 'vitest'
import { repairImportedChart } from './repair'
import type { Chart, ChartNote } from './types'

function note(id: number, time: number, string: number, fret: number, extra: Partial<ChartNote> = {}): ChartNote {
  return { id, time, duration: 0.5, midi: 40 + string * 5 + fret, string, fret, velocity: 0.8, chordId: id, ...extra }
}

function chart(source: Chart['source'], notes: ChartNote[]): Chart {
  return { version: 1, title: 't', artist: 'a', source, tuning: [40, 45, 50, 55, 59, 64], capo: 0, duration: 10, notes, beats: [], tempos: [{ time: 0, bpm: 120 }], timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] }
}

describe('repairImportedChart', () => {
  it('drops the copies an old import made of a ringing note, and keeps real repeats', () => {
    const c = chart('guitarpro', [note(0, 1, 2, 3), note(1, 1, 2, 3), note(2, 1, 2, 3), note(3, 1, 3, 0), note(4, 1.5, 2, 3)])
    const fixed = repairImportedChart(c)
    expect(fixed.notes.map((n) => n.id)).toEqual([0, 3, 4])
  })

  it('drops muted notes, which have no pitch to play', () => {
    const fixed = repairImportedChart(chart('guitarpro', [note(0, 1, 0, 0, { tech: { dead: true } }), note(1, 2, 0, 3)]))
    expect(fixed.notes.map((n) => n.id)).toEqual([1])
  })

  it('returns the same chart when nothing is wrong, and never touches charts from other sources', () => {
    const clean = chart('guitarpro', [note(0, 1, 0, 0), note(1, 2, 0, 3)])
    expect(repairImportedChart(clean)).toBe(clean)
    const midi = chart('midi', [note(0, 1, 2, 3), note(1, 1, 2, 3)])
    expect(repairImportedChart(midi)).toBe(midi)
  })
})
