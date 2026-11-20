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
      for (const n of ex.chart.notes) {
        // Bend notes carry the reached pitch (fret pitch + 1 or 2 semitones); everything else is the fret pitch.
        const fretPitch = ex.chart.tuning[n.string] + n.fret
        if (n.tech?.bend) expect([1, 2], `${skill.id} bend`).toContain(n.midi - fretPitch)
        else expect(fretPitch, `${skill.id} ${n.id}`).toBe(n.midi)
      }
    }
  })

  it('overrides win over defaults except tempo, which is always the requested one', () => {
    const skill = SKILLS.find((s) => s.id === 'chord.changes-open')!
    const params = exerciseParams(skill, 'chordChanges', 72, { bars: 2, tempo: 999 })
    expect(params.bars).toBe(2)
    expect(params.tempo).toBe(72)
  })

  it('fills in what a caller left out from the skill\'s own defaults, so a bare tempo still gives the skill\'s drill', () => {
    const vibrato = SKILLS.find((s) => s.id === 'lead.vibrato')!
    const bare = generateExercise(vibrato, 'bendTargets', { tempo: 60, bars: 4 }, DEFAULT_TUNING)
    const full = generateExercise(vibrato, 'bendTargets', exerciseParams(vibrato, 'bendTargets', 60, { bars: 4 }), DEFAULT_TUNING)
    expect(bare.chart).toEqual(full.chart)
    expect(bare.chart.notes.every((n) => n.tech?.vibrato && n.fret >= 5)).toBe(true)
    // What the caller did say still wins.
    const eight = generateExercise(vibrato, 'bendTargets', { tempo: 60, bars: 8 }, DEFAULT_TUNING)
    expect(eight.chart.notes).toHaveLength(16)
    expect(eight.params.bars).toBe(8)
  })
})
