import { describe, expect, it } from 'vitest'
import { SKILLS_BY_ID } from '../skills'
import type { NoteValue } from '../types'
import { NOTE_VALUE_BEATS } from './builder'
import { openStringsGenerator as gen } from './openStrings'

const DROP_D = [38, 45, 50, 55, 59, 64]
const skill = SKILLS_BY_ID['basics.open-strings']

describe('openStrings', () => {
  it('has stable ids', () => {
    const p = gen.defaults(skill, 60)
    expect(gen.generate(skill, { ...p }, DROP_D).id).toBe(gen.generate(skill, p, DROP_D).id)
    expect(gen.generate(skill, { ...p, tempo: 70 }, DROP_D).id).not.toBe(gen.generate(skill, p, DROP_D).id)
  })

  it.each<NoteValue>(['whole', 'half', 'quarter'])('fills the bars with %s notes', (noteValue) => {
    const ex = gen.generate(skill, { ...gen.defaults(skill, 80), noteValue }, DROP_D)
    const len = NOTE_VALUE_BEATS[noteValue]
    expect(ex.chart.notes).toHaveLength((8 * 4) / len)
    // The builder sets each note to 95% of its slot so consecutive notes do not touch.
    for (const n of ex.chart.notes) expect(Math.abs(n.duration - (len * 60 * 0.95) / 80)).toBeLessThan(0.001)
  })

  it('plays open strings under drop D', () => {
    const ex = gen.generate(skill, { ...gen.defaults(skill, 60), strings: 6 }, DROP_D)
    for (const n of ex.chart.notes) {
      expect(n.fret).toBe(0)
      expect(n.midi).toBe(DROP_D[n.string] + n.fret)
    }
  })

  it('alternates two strings', () => {
    const ex = gen.generate(skill, gen.defaults(skill, 60), DROP_D)
    expect(ex.chart.notes.slice(0, 6).map((n) => n.string)).toEqual([0, 1, 0, 1, 0, 1])
  })

  it('repeats a single string and respects the selected set', () => {
    const one = gen.generate(skill, { ...gen.defaults(skill, 60), strings: 1 }, DROP_D)
    expect(new Set(one.chart.notes.map((n) => n.string))).toEqual(new Set([0]))
    const three = gen.generate(skill, { ...gen.defaults(skill, 60), strings: 3, order: 'down' }, DROP_D)
    for (const n of three.chart.notes) expect(n.string).toBeLessThan(3)
  })

  it('walks down and back', () => {
    const ex = gen.generate(skill, { ...gen.defaults(skill, 60), strings: 3, order: 'down' }, DROP_D)
    expect(ex.chart.notes.slice(0, 5).map((n) => n.string)).toEqual([0, 1, 2, 1, 0])
  })

  it('difficulty rises with tempo and is lower for half than quarter', () => {
    const d = (tempo: number, noteValue: NoteValue) => gen.generate(skill, { ...gen.defaults(skill, tempo), noteValue }, DROP_D).difficulty
    expect(d(50, 'half')).toBeLessThan(d(80, 'half'))
    expect(d(60, 'half')).toBeLessThan(d(60, 'quarter'))
  })

  it.each(['basics.open-strings', 'basics.first-frets', 'fret.single-string'])('generates with defaults for %s', (id) => {
    const s = SKILLS_BY_ID[id]
    const ex = gen.generate(s, gen.defaults(s, s.startTempo ?? 60), DROP_D)
    expect(ex.chart.duration).toBeGreaterThan(0)
    expect(ex.chart.beats.length).toBeGreaterThan(0)
  })
})
