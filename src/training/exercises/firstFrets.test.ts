import { describe, expect, it } from 'vitest'
import { SKILLS_BY_ID } from '../skills'
import type { NoteValue } from '../types'
import { NOTE_VALUE_BEATS } from './builder'
import { firstFretsGenerator as gen } from './firstFrets'

const DROP_D = [38, 45, 50, 55, 59, 64]
const tier0 = SKILLS_BY_ID['basics.first-frets']
const tier1 = SKILLS_BY_ID['fret.single-string']

describe('firstFrets', () => {
  it('has stable ids', () => {
    const p = gen.defaults(tier0, 60)
    expect(gen.generate(tier0, { ...p }, DROP_D).id).toBe(gen.generate(tier0, p, DROP_D).id)
    expect(gen.generate(tier0, { ...p, tempo: 70 }, DROP_D).id).not.toBe(gen.generate(tier0, p, DROP_D).id)
  })

  it.each<NoteValue>(['whole', 'half', 'quarter'])('fills the bars with %s notes', (noteValue) => {
    const ex = gen.generate(tier0, { ...gen.defaults(tier0, 80), noteValue }, DROP_D)
    const len = NOTE_VALUE_BEATS[noteValue]
    expect(ex.chart.notes).toHaveLength((8 * 4) / len)
    // The builder sets each note to 95% of its slot so consecutive notes do not touch.
    for (const n of ex.chart.notes) expect(Math.abs(n.duration - (len * 60 * 0.95) / 80)).toBeLessThan(0.001)
  })

  it('keeps every note on the chosen string with the right pitch', () => {
    for (const string of [5, 2, 0]) {
      const ex = gen.generate(tier0, { ...gen.defaults(tier0, 60), string }, DROP_D)
      for (const n of ex.chart.notes) {
        expect(n.string).toBe(string)
        expect(n.midi).toBe(DROP_D[string] + n.fret)
      }
    }
  })

  it('starts on the open string and respects maxFret', () => {
    for (const maxFret of [2, 3, 4]) {
      const ex = gen.generate(tier1, { ...gen.defaults(tier1, 60), noteValue: 'quarter', maxFret }, DROP_D)
      expect(ex.chart.notes[0].fret).toBe(0)
      for (const n of ex.chart.notes) {
        expect(n.fret).toBeGreaterThanOrEqual(0)
        expect(n.fret).toBeLessThanOrEqual(maxFret)
      }
    }
  })

  it('tier 0 default stops at fret 3, tier 1 default reaches fret 4', () => {
    const frets = (s: typeof tier0) => gen.generate(s, gen.defaults(s, 60), DROP_D).chart.notes.map((n) => n.fret)
    expect(Math.max(...frets(tier0))).toBe(3)
    expect(Math.max(...frets(tier1))).toBe(4)
  })

  it('difficulty rises with tempo and is lower for half than quarter', () => {
    const d = (tempo: number, noteValue: NoteValue) => gen.generate(tier0, { ...gen.defaults(tier0, tempo), noteValue }, DROP_D).difficulty
    expect(d(50, 'half')).toBeLessThan(d(80, 'half'))
    expect(d(60, 'half')).toBeLessThan(d(60, 'quarter'))
  })

  it.each(['basics.open-strings', 'basics.first-frets', 'fret.single-string'])('generates with defaults for %s', (id) => {
    const s = SKILLS_BY_ID[id]
    const ex = gen.generate(s, gen.defaults(s, 60), DROP_D)
    expect(ex.chart.duration).toBeGreaterThan(0)
    expect(ex.chart.beats.length).toBeGreaterThan(0)
  })
})
