import { describe, expect, it } from 'vitest'
import type { SkillDef } from '../types'
import { bendTargetsGenerator as gen } from './bendTargets'
import { DEFAULT_TUNING } from './builder'

const mk = (id: string): SkillDef => ({
  id,
  name: id,
  category: 'lead',
  tier: 3,
  prerequisites: [],
  refTempo: 60,
  startTempo: 50,
  targetTempo: 100,
  description: 'x',
  tips: [],
  generators: ['bendTargets'],
})
const bends = mk('lead.bends')
const vibrato = mk('lead.vibrato')

describe('bendTargets', () => {
  for (const semis of [1, 2]) {
    it(`bend pairs reach the straight target (${semis} semis)`, () => {
      const params = { ...gen.defaults(bends, 60), bendSemis: semis, bars: 6 }
      const { chart } = gen.generate(bends, params, DEFAULT_TUNING)
      const bn = chart.notes.filter((n) => n.tech?.bend)
      expect(bn.length).toBe(6)
      expect(chart.notes.length).toBe(12)
      for (const n of bn) {
        expect(n.tech?.bend).toBe(true)
        expect(n.midi - (chart.tuning[n.string] + n.fret)).toBe(semis)
        expect([3, 4]).toContain(n.string)
        const prev = chart.notes[chart.notes.indexOf(n) - 1]
        expect(prev.midi).toBe(n.midi)
        expect(prev.tech).toBeUndefined()
        expect(prev.string).toBe(n.string)
      }
    })
  }

  it('plays the classic fret 8 to 10 on the B string at position 5', () => {
    const { chart } = gen.generate(bends, gen.defaults(bends, 60), DEFAULT_TUNING)
    expect(chart.notes.some((n) => n.tech?.bend && n.string === 4 && n.fret === 8)).toBe(true)
  })

  it('vibrato mode has vibrato, fret pitch and no bends', () => {
    const { chart } = gen.generate(vibrato, gen.defaults(vibrato, 60), DEFAULT_TUNING)
    expect(chart.notes.length).toBe(8)
    for (const n of chart.notes) {
      expect(n.tech?.vibrato).toBe(true)
      expect(n.tech?.bend).toBeFalsy()
      expect(n.midi).toBe(chart.tuning[n.string] + n.fret)
      expect([3, 4]).toContain(n.string)
    }
  })

  it('ids are stable and tempo-sensitive', () => {
    const a = gen.generate(bends, gen.defaults(bends, 60), DEFAULT_TUNING)
    const b = gen.generate(bends, gen.defaults(bends, 60), DEFAULT_TUNING)
    const c = gen.generate(bends, gen.defaults(bends, 70), DEFAULT_TUNING)
    expect(a.id).toBe(b.id)
    expect(a.id).not.toBe(c.id)
    expect(a.id.startsWith('bendTargets:')).toBe(true)
    expect(a.backing).toBeNull()
  })

  it('difficulty rises with tempo and for whole-step bends', () => {
    const d = (tempo: number, bendSemis: number) =>
      gen.generate(bends, { ...gen.defaults(bends, tempo), bendSemis }, DEFAULT_TUNING).difficulty
    expect(d(60, 2)).toBeLessThan(d(90, 2))
    expect(d(60, 2)).toBeGreaterThan(d(60, 1))
  })

  it('keeps frets valid and consistent in drop D', () => {
    const tuning = [38, 45, 50, 55, 59, 64]
    for (const sk of [bends, vibrato]) {
      const { chart } = gen.generate(sk, gen.defaults(sk, 60), tuning)
      for (const n of chart.notes) {
        expect(n.fret).toBeGreaterThanOrEqual(0)
        const base = tuning[n.string] + n.fret
        expect(n.midi - base).toBe(n.tech?.bend ? 2 : 0)
      }
    }
  })

  it.each([bends, vibrato])('generates a chart for $id', (sk) => {
    const ex = gen.generate(sk, gen.defaults(sk, 60), DEFAULT_TUNING)
    expect(ex.chart.duration).toBeGreaterThan(0)
    expect(ex.chart.beats.length).toBeGreaterThan(0)
    expect(ex.instructions.length).toBeGreaterThan(0)
  })
})
