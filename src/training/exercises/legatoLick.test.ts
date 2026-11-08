import { describe, expect, it } from 'vitest'
import type { ExerciseParams, SkillDef } from '../types'
import { SKILLS } from '../skills'
import { DEFAULT_TUNING, NOTE_VALUE_BEATS } from './builder'
import { legatoLickGenerator as gen } from './legatoLick'

const skill = SKILLS.find((s) => s.id === 'lead.hammer-pull') as SkillDef
const DROP_D = [38, 45, 50, 55, 59, 64]

function make(over: Partial<ExerciseParams> = {}, tuning = DEFAULT_TUNING) {
  const params = { ...gen.defaults(skill, 70), ...over }
  return { params, ex: gen.generate(skill, params, tuning) }
}

describe('legatoLick generator', () => {
  it('has a stable identity and deterministic ids', () => {
    const a = make().ex
    const b = make().ex
    expect(a.id).toBe(b.id)
    expect(a.id.startsWith('legatoLick:')).toBe(true)
    expect(a.chart).toEqual(b.chart)
    expect(make({ tempo: 90 }).ex.id).not.toBe(a.id)
    expect(a.backing).toBeNull()
  })

  it('fills every bar at the note value', () => {
    for (const noteValue of ['quarter', 'eighth', 'triplet', 'sixteenth'] as const) {
      const { params, ex } = make({ noteValue })
      expect(ex.chart.notes.length).toBe(Math.round((params.bars * 4) / NOTE_VALUE_BEATS[noteValue]))
    }
  })

  it.each(['hp', 'hhp', 'trill'])('pattern %s: picked first notes, legato rest, frets and midi valid', (pattern) => {
    const { params, ex } = make({ pattern, strings: 3 })
    const pos = params.position as number
    let prev = -1
    let sinceCell = 0
    for (const n of ex.chart.notes) {
      const legato = !!(n.tech?.hammerOn || n.tech?.pullOff)
      if (!legato) sinceCell = 0
      else sinceCell++
      if (sinceCell === 0) expect(n.velocity).toBe(0.9)
      else expect(n.velocity).toBe(0.7)
      expect(n.fret).toBeGreaterThanOrEqual(pos)
      expect(n.fret).toBeLessThanOrEqual(pos + 5)
      expect(n.time).toBeGreaterThanOrEqual(prev)
      prev = n.time
    }
    // first note is picked, and every picked note is followed by legato notes (except possibly a truncated tail)
    expect(ex.chart.notes[0].tech?.hammerOn).toBeFalsy()
    expect(ex.chart.notes[1].tech?.hammerOn).toBe(true)
    if (pattern !== 'trill') expect(ex.chart.notes.some((n) => n.tech?.pullOff)).toBe(true)
  })

  it('uses the tuning for midi', () => {
    const { ex } = make({ pattern: 'hhp', strings: 3 }, DROP_D)
    expect(ex.chart.tuning).toEqual(DROP_D)
    for (const n of ex.chart.notes) expect(n.midi).toBe(DROP_D[n.string] + n.fret)
  })

  it('stays on the top strings', () => {
    const { ex } = make({ strings: 2 })
    for (const n of ex.chart.notes) expect([4, 5]).toContain(n.string)
  })

  it('difficulty rises with tempo and hhp', () => {
    expect(make({ tempo: 100 }).ex.difficulty).toBeGreaterThan(make({ tempo: 70 }).ex.difficulty)
    expect(make({ pattern: 'hhp' }).ex.difficulty).toBeGreaterThan(make({ pattern: 'hp' }).ex.difficulty)
  })

  it('generates a valid chart for the lead.hammer-pull skill', () => {
    const { ex } = make()
    expect(ex.skillId).toBe('lead.hammer-pull')
    expect(ex.chart.duration).toBeGreaterThan(0)
    expect(ex.chart.beats.length).toBeGreaterThan(0)
    expect(ex.chart.notes.length).toBeGreaterThan(0)
    expect(ex.instructions).toContain('pick only the first note of each group'.replace('pick', 'Pick'))
  })

  it.each([{ noteValue: 'triplet' }, { pattern: 'trill' }, { pattern: 'trill', noteValue: 'triplet' }])('variant %o is valid', (over) => {
    const { ex } = make(over as Partial<ExerciseParams>)
    expect(ex.chart.notes.length).toBeGreaterThan(0)
    expect(ex.chart.duration).toBeGreaterThan(0)
    for (const n of ex.chart.notes) expect(n.duration).toBeGreaterThan(0)
  })
})
