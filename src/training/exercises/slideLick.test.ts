import { describe, expect, it } from 'vitest'
import { SKILLS } from '../skills'
import type { SkillDef } from '../types'
import { DEFAULT_TUNING, NOTE_VALUE_BEATS } from './builder'
import { slideLickGenerator as gen } from './slideLick'

const skill: SkillDef = SKILLS.find((s) => s.id === 'lead.slides') as SkillDef

describe('slideLick generator', () => {
  it('has stable ids', () => {
    const p = gen.defaults(skill, 80)
    const a = gen.generate(skill, p, DEFAULT_TUNING)
    const b = gen.generate(skill, { ...p }, DEFAULT_TUNING)
    expect(a.id).toBe(b.id)
    expect(a.id.startsWith('slideLick:')).toBe(true)
    expect(a.chart).toEqual(b.chart)
    expect(a.backing).toBeNull()
  })

  it.each(['quarter', 'eighth'] as const)('note counts, slides and frets for %s', (noteValue) => {
    const p = { ...gen.defaults(skill, 80), noteValue }
    const { chart } = gen.generate(skill, p, DEFAULT_TUNING)
    const perBar = 4 / NOTE_VALUE_BEATS[noteValue]
    const beatSec = 60 / 80
    for (let bar = 0; bar < p.bars; bar++) {
      const n = chart.notes.filter((x) => Math.floor(x.time / (4 * beatSec) + 1e-6) === bar).length
      expect(n).toBeLessThanOrEqual(perBar)
      expect(n).toBeGreaterThanOrEqual(perBar / 2)
    }
    const slides = chart.notes.filter((x) => x.tech?.slideIn || x.tech?.slideOut).length
    expect(slides / chart.notes.length).toBeGreaterThanOrEqual(0.4)
    for (const n of chart.notes) {
      expect(n.fret).toBeGreaterThanOrEqual(0)
      expect(n.fret).toBeLessThanOrEqual(5 + 2 + 7)
      expect(n.string).toBeGreaterThanOrEqual(4)
    }
  })

  it('keeps midi consistent under a non-standard tuning', () => {
    const drop = [38, 45, 50, 55, 59, 64]
    const { chart } = gen.generate(skill, gen.defaults(skill, 80), drop)
    for (const n of chart.notes) expect(n.midi).toBe(drop[n.string] + n.fret)
  })

  it('difficulty rises with tempo', () => {
    const d = (t: number) => gen.generate(skill, gen.defaults(skill, t), DEFAULT_TUNING).difficulty
    expect(d(70)).toBeLessThan(d(100))
    expect(d(100)).toBeLessThan(d(130))
  })

  it('generates for lead.slides', () => {
    const ex = gen.generate(skill, gen.defaults(skill, 70), DEFAULT_TUNING)
    expect(ex.chart.duration).toBeGreaterThan(0)
    expect(ex.chart.beats.length).toBeGreaterThan(0)
    expect(ex.instructions).toContain('arrive on the beat'.replace('arrive', 'Arrive'))
  })

  it('eighth variant has more notes than quarter', () => {
    const base = gen.defaults(skill, 80)
    const q = gen.generate(skill, base, DEFAULT_TUNING).chart.notes.length
    const e = gen.generate(skill, { ...base, noteValue: 'eighth' }, DEFAULT_TUNING).chart.notes.length
    expect(e).toBeGreaterThan(q)
  })
})
