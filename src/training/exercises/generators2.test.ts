import { describe, expect, it } from 'vitest'
import type { Chart } from '../../chart/types'
import type { ExerciseGenerator, SkillDef } from '../types'
import { DEFAULT_TUNING } from './builder'
import { chordChangesGenerator } from './chordChanges'
import { metronomeSteadyGenerator } from './metronomeSteady'
import { powerChordRiffGenerator } from './powerChordRiff'
import { strumPatternGenerator } from './strumPattern'
import { subdivisionSwitchGenerator } from './subdivisionSwitch'

function fakeSkill(id: string): SkillDef {
  return {
    id,
    name: id,
    category: 'chords',
    tier: 2,
    prerequisites: [],
    refTempo: 80,
    startTempo: 60,
    targetTempo: 100,
    description: '',
    tips: [],
    generators: [],
  }
}

const skill = fakeSkill('chord.open')
const generators: ExerciseGenerator[] = [
  chordChangesGenerator,
  strumPatternGenerator,
  powerChordRiffGenerator,
  subdivisionSwitchGenerator,
  metronomeSteadyGenerator,
]

function checkInvariants(chart: Chart): void {
  expect(chart.notes.length).toBeGreaterThan(0)
  let prev = -1
  const chordIds = new Map<number, number>()
  for (const n of chart.notes) {
    expect(chart.tuning[n.string] + n.fret).toBe(n.midi)
    expect(n.fret).toBeGreaterThanOrEqual(0)
    expect(n.fret).toBeLessThanOrEqual(24)
    expect(n.string).toBeGreaterThanOrEqual(0)
    expect(n.string).toBeLessThanOrEqual(5)
    expect(n.time).toBeGreaterThanOrEqual(prev)
    prev = n.time
    expect(n.duration).toBeGreaterThan(0)
    expect(n.time + n.duration).toBeLessThan(chart.duration)
    const t = chordIds.get(n.chordId)
    if (t !== undefined) expect(n.time).toBe(t)
    chordIds.set(n.chordId, n.time)
  }
}

function groups(chart: Chart): Chart['notes'][] {
  const map = new Map<number, Chart['notes']>()
  for (const n of chart.notes) map.set(n.chordId, [...(map.get(n.chordId) ?? []), n])
  return [...map.values()]
}

describe('generators2', () => {
  for (const g of generators) {
    describe(g.id, () => {
      it('is deterministic', () => {
        const params = g.defaults(skill, 90)
        const a = g.generate(skill, params, DEFAULT_TUNING)
        const b = g.generate(skill, { ...params }, DEFAULT_TUNING)
        expect(b.chart).toEqual(a.chart)
        expect(b.id).toBe(a.id)
        expect(a.id.startsWith(`${g.id}:`)).toBe(true)
        expect(a.generatorId).toBe(g.id)
        expect(a.backing).toBeNull()
      })
      it.each([60, 90, 120])('keeps chart invariants at %i bpm', (tempo) => {
        const ex = g.generate(skill, g.defaults(skill, tempo), DEFAULT_TUNING)
        checkInvariants(ex.chart)
        expect(ex.instructions.length).toBeGreaterThan(0)
      })
    })
  }

  it('chordChanges produces 16 strums with the right string counts', () => {
    const ex = chordChangesGenerator.generate(skill, { tempo: 80, bars: 8, chords: ['Em', 'Am', 'D'], beatsPerChord: 2 }, DEFAULT_TUNING)
    const gs = groups(ex.chart)
    expect(gs).toHaveLength(16)
    const expected: Record<string, number> = { Em: 6, Am: 5, D: 4 }
    const order = ['Em', 'Am', 'D']
    gs.forEach((g, i) => {
      const name = order[i % 3]
      expect(g[0].chordName).toBe(name)
      expect(g).toHaveLength(expected[name])
    })
  })

  it('chordChanges defaults depend on skill and barre is harder', () => {
    expect(chordChangesGenerator.defaults(fakeSkill('chord.barre'), 70).chords).toEqual(['F', 'C'])
    expect(chordChangesGenerator.defaults(fakeSkill('chord.sevenths'), 70).chords).toEqual(['E7', 'A7', 'D7'])
    const barre = chordChangesGenerator.generate(skill, { tempo: 80, bars: 8, chords: ['F', 'C'] }, DEFAULT_TUNING)
    const open = chordChangesGenerator.generate(skill, { tempo: 80, bars: 8, chords: ['Em', 'Am'] }, DEFAULT_TUNING)
    expect(barre.difficulty).toBeGreaterThan(open.difficulty)
  })

  it('chordChanges rejects unknown chords', () => {
    expect(() => chordChangesGenerator.generate(skill, { tempo: 80, bars: 4, chords: ['Xyz'] }, DEFAULT_TUNING)).toThrow(/Unknown chord/)
  })

  it('strumPattern D-DU-UDU yields one strum per D/U slot each bar', () => {
    const ex = strumPatternGenerator.generate(skill, { tempo: 80, bars: 4, pattern: 'D-DU-UDU', chord: 'G' }, DEFAULT_TUNING)
    const gs = groups(ex.chart)
    // The pattern string contains six D/U symbols (the task text said 5; the pattern really has 6).
    expect(gs).toHaveLength(6 * 4)
    const barDur = (4 * 60) / 80
    expect(gs.filter((g) => g[0].time < barDur - 1e-9)).toHaveLength(6)
    const ups = gs.filter((g) => g[0].velocity === 0.6)
    expect(ups.length).toBe(3 * 4)
    for (const u of ups) expect(u).toHaveLength(4)
  })

  it('powerChordRiff marks palm mutes and has two notes per strum', () => {
    const ex = powerChordRiffGenerator.generate(skill, powerChordRiffGenerator.defaults(skill, 90), DEFAULT_TUNING)
    const gs = groups(ex.chart)
    expect(gs).toHaveLength(4 * 4 * 2)
    for (const g of gs) expect(g).toHaveLength(2)
    gs.forEach((g, i) => {
      const muted = i % 4 !== 3
      for (const n of g) expect(n.tech?.palmMute === true).toBe(muted)
    })
  })

  it('subdivisionSwitch note counts per bar follow the sequence', () => {
    const ex = subdivisionSwitchGenerator.generate(skill, subdivisionSwitchGenerator.defaults(skill, 80), DEFAULT_TUNING)
    const barDur = (4 * 60) / 80
    const perBar = (bar: number) => ex.chart.notes.filter((n) => n.time >= bar * barDur - 1e-6 && n.time < (bar + 1) * barDur - 1e-6).length
    expect(perBar(0)).toBe(4)
    expect(perBar(1)).toBe(8)
    expect(perBar(2)).toBe(16)
    expect(perBar(3)).toBe(12)
    expect(perBar(4)).toBe(4)
  })

  it('metronomeSteady has bars x 4 notes', () => {
    const ex = metronomeSteadyGenerator.generate(skill, { tempo: 80, bars: 8 }, DEFAULT_TUNING)
    expect(ex.chart.notes).toHaveLength(32)
    for (const n of ex.chart.notes) expect(n.velocity).toBe(0.9)
  })
})
