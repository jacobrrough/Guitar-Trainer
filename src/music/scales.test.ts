import { describe, expect, it } from 'vitest'
import { pentatonicBox, pitchClassOf, scalePositions } from './scales'

const TUNING = [40, 45, 50, 55, 59, 64]

function frets(notes: Array<{ string: number; fret: number }>, string: number): number[] {
  return notes.filter((n) => n.string === string).map((n) => n.fret)
}

describe('scales', () => {
  it('parses pitch classes', () => {
    expect(pitchClassOf('A')).toBe(9)
    expect(pitchClassOf('F#')).toBe(6)
    expect(pitchClassOf('Bb')).toBe(10)
  })

  it('A minor pentatonic position 5 contains the box-1 shape', () => {
    const notes = scalePositions('A', 'minor-pentatonic', 5, TUNING)
    expect(frets(notes, 0)).toEqual(expect.arrayContaining([5, 8]))
    for (const s of [1, 2, 3]) expect(frets(notes, s)).toEqual(expect.arrayContaining([5, 7]))
    expect(frets(notes, 5)).toEqual(expect.arrayContaining([5, 8]))
    for (let i = 1; i < notes.length; i++) expect(notes[i].midi).toBeGreaterThanOrEqual(notes[i - 1].midi)
    for (const n of notes) expect(TUNING[n.string] + n.fret).toBe(n.midi)
  })

  it('pentatonic box 1 for A has the root on string 0 fret 5', () => {
    const box = pentatonicBox('A', 1, TUNING)
    expect(box.position).toBe(5)
    expect(box.notes[0]).toMatchObject({ string: 0, fret: 5 })
    expect(frets(box.notes, 0)).toEqual([5, 8])
    expect(box.notes).toHaveLength(12)
  })

  it('all five boxes cover the same notes with two per string', () => {
    for (const b of [1, 2, 3, 4, 5] as const) {
      const box = pentatonicBox('A', b, TUNING)
      for (let s = 0; s < 6; s++) expect(frets(box.notes, s)).toHaveLength(2)
    }
  })
})
