import { describe, expect, it } from 'vitest'
import { getSkill } from '../skills'
import { DEFAULT_TUNING } from './builder'
import { chromaticGenerator } from './chromatic'

function notesPerBeat(skillId: string, tempo: number): number {
  const skill = getSkill(skillId)
  const { chart } = chromaticGenerator.generate(skill, { ...chromaticGenerator.defaults(skill, tempo), bars: 4 }, DEFAULT_TUNING)
  return chart.notes.length / 16
}

describe('chromatic', () => {
  it('drills each picking skill in the note value it is named after', () => {
    expect(chromaticGenerator.defaults(getSkill('pick.alternate-16'), 50).noteValue).toBe('sixteenth')
    expect(chromaticGenerator.defaults(getSkill('pick.alternate-8'), 60).noteValue).toBe('eighth')
    expect(notesPerBeat('pick.alternate-16', 50)).toBe(4)
    expect(notesPerBeat('pick.alternate-8', 60)).toBe(2)
  })

  it('gives the first finger exercise one note per beat', () => {
    expect(chromaticGenerator.defaults(getSkill('fret.chromatic'), 50).noteValue).toBe('quarter')
    expect(notesPerBeat('fret.chromatic', 50)).toBe(1)
  })

  it('rates the sixteenth-note drill for sixteenth notes', () => {
    const skill = getSkill('pick.alternate-16')
    const sixteenths = chromaticGenerator.generate(skill, chromaticGenerator.defaults(skill, 60), DEFAULT_TUNING)
    const eighths = chromaticGenerator.generate(skill, { ...chromaticGenerator.defaults(skill, 60), noteValue: 'eighth' }, DEFAULT_TUNING)
    // Tier base 60 at the reference tempo, plus 16 for sixteenth notes (8 for eighths).
    expect(sixteenths.difficulty).toBe(76)
    expect(eighths.difficulty).toBe(68)
  })

  it('says where the round really goes: a short one does not reach the thinnest string', () => {
    const skill = getSkill('fret.chromatic')
    const told = (bars: number) => {
      const ex = chromaticGenerator.generate(skill, { ...chromaticGenerator.defaults(skill, 50), bars }, DEFAULT_TUNING)
      const strings = new Set(ex.chart.notes.map((n) => n.string))
      return { text: ex.instructions ?? '', strings: strings.size, last: ex.chart.notes[ex.chart.notes.length - 1].string }
    }
    // Quarter notes: four bars are sixteen notes, which is four strings.
    expect(told(4)).toMatchObject({ strings: 4, text: expect.stringContaining('across the 4 thickest strings') })
    expect(told(4).text).not.toMatch(/thinnest|back down/)
    expect(told(1).text).toContain('on the thickest string')
    expect(told(6)).toMatchObject({ strings: 6, last: 5, text: expect.stringMatching(/to the thinnest\./) })
    expect(told(8).text).toMatch(/to the thinnest and starting back down/)
    expect(told(12)).toMatchObject({ last: 0, text: expect.stringMatching(/to the thinnest and back down/) })
  })
})
