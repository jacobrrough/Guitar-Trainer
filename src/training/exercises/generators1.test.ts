import { describe, expect, it } from 'vitest'
import type { ExerciseGenerator, SkillDef } from '../types'
import { DEFAULT_TUNING } from './builder'
import { chromaticGenerator } from './chromatic'
import { melodyGenerator } from './melody'
import { scaleRunGenerator } from './scaleRun'
import { stringSkippingGenerator } from './stringSkipping'

const skill: SkillDef = {
  id: 'fake-skill',
  name: 'Fake',
  category: 'fretting',
  tier: 2,
  prerequisites: [],
  refTempo: 90,
  startTempo: 60,
  targetTempo: 120,
  description: 'x',
  tips: [],
  generators: [],
}

const generators: ExerciseGenerator[] = [chromaticGenerator, melodyGenerator, scaleRunGenerator, stringSkippingGenerator]

describe.each(generators)('$id generator', (gen) => {
  it('defaults return tempo and positive bars', () => {
    const d = gen.defaults(skill, 92)
    expect(d.tempo).toBe(92)
    expect(d.bars).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const params = gen.defaults(skill, 92)
    const a = gen.generate(skill, params, DEFAULT_TUNING)
    const b = gen.generate(skill, { ...params }, DEFAULT_TUNING)
    expect(a.chart).toEqual(b.chart)
    expect(a.id).toBe(b.id)
    expect(a.id.startsWith(`${gen.id}:`)).toBe(true)
    expect(a.backing).toBeNull()
  })

  it.each([70, 100, 130])('produces a valid chart at %i bpm', (tempo) => {
    const params = gen.defaults(skill, tempo)
    const ex = gen.generate(skill, params, DEFAULT_TUNING)
    const { chart } = ex
    expect(chart.notes.length).toBeGreaterThan(0)
    let prev = -1
    for (const n of chart.notes) {
      expect(n.string).toBeGreaterThanOrEqual(0)
      expect(n.string).toBeLessThanOrEqual(5)
      expect(n.fret).toBeGreaterThanOrEqual(0)
      expect(n.fret).toBeLessThanOrEqual(24)
      expect(chart.tuning[n.string] + n.fret).toBe(n.midi)
      expect(n.duration).toBeGreaterThan(0)
      expect(n.time).toBeGreaterThan(prev)
      prev = n.time
    }
    const last = chart.notes[chart.notes.length - 1]
    expect(last.time + last.duration).toBeLessThan(chart.duration)
    expect(chart.beats.filter((b) => b.isDownbeat).length).toBeGreaterThanOrEqual(params.bars)
    expect(ex.instructions.length).toBeGreaterThan(0)
  })

  it('difficulty rises with tempo and note density', () => {
    const base = gen.defaults(skill, 70)
    const d = (tempo: number, noteValue: 'quarter' | 'eighth') =>
      gen.generate(skill, { ...base, tempo, noteValue }, DEFAULT_TUNING).difficulty
    expect(d(70, 'quarter')).toBeLessThan(d(100, 'quarter'))
    expect(d(100, 'quarter')).toBeLessThan(d(130, 'quarter'))
    expect(d(100, 'eighth')).toBeGreaterThan(d(100, 'quarter'))
  })
})

describe('melody', () => {
  it('ends on the root', () => {
    const ex = melodyGenerator.generate(skill, melodyGenerator.defaults(skill, 80), DEFAULT_TUNING)
    const last = ex.chart.notes[ex.chart.notes.length - 1]
    expect(last.midi % 12).toBe(9)
  })
})

describe('stringSkipping', () => {
  it('skip-two uses strings three apart', () => {
    const params = { ...stringSkippingGenerator.defaults(skill, 80), pattern: 'skip-two' }
    const ex = stringSkippingGenerator.generate(skill, params, DEFAULT_TUNING)
    expect(Math.abs(ex.chart.notes[1].string - ex.chart.notes[0].string)).toBe(3)
  })
})
