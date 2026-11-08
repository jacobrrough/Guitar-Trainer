import { describe, expect, it } from 'vitest'
import { SKILLS } from '../skills'
import { DEFAULT_TUNING } from './builder'
import { GENERATORS, GENERATOR_ALIASES, exerciseParams, generateExercise, getGenerator, resolveGeneratorId } from './index'

describe('exercise registry', () => {
  it('resolves every generator id used by the skill taxonomy', () => {
    for (const skill of SKILLS) {
      for (const id of skill.generators) {
        const resolved = resolveGeneratorId(id)
        expect(GENERATORS[resolved], `${skill.id} → ${id}`).toBeDefined()
        expect(getGenerator(id).id).toBe(resolved)
      }
    }
  })

  it('aliases point at implemented generators', () => {
    for (const target of Object.values(GENERATOR_ALIASES)) expect(GENERATORS[target]).toBeDefined()
  })

  it('can generate a valid exercise for every skill with its default generator', () => {
    for (const skill of SKILLS) {
      const generatorId = skill.generators[0]
      const params = exerciseParams(skill, generatorId, skill.startTempo)
      const ex = generateExercise(skill, generatorId, params, DEFAULT_TUNING)
      expect(ex.chart.notes.length, skill.id).toBeGreaterThan(0)
      expect(ex.difficulty).toBeGreaterThanOrEqual(0)
      expect(ex.params.tempo).toBe(skill.startTempo)
      for (const n of ex.chart.notes) expect(ex.chart.tuning[n.string] + n.fret).toBe(n.midi)
    }
  })

  it('overrides win over defaults except tempo, which is always the requested one', () => {
    const skill = SKILLS.find((s) => s.id === 'chord.changes-open')!
    const params = exerciseParams(skill, 'chordChanges', 72, { bars: 2, tempo: 999 })
    expect(params.bars).toBe(2)
    expect(params.tempo).toBe(72)
  })
})
