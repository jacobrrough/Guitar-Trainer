import { describe, expect, it } from 'vitest'
import { EAR_PROMPTS } from '../constants'
import { SKILLS_BY_ID } from '../skills'
import { tuneByEarGenerator as gen } from './tuneByEar'

const tuning = [40, 45, 50, 55, 59, 64]
const skill = SKILLS_BY_ID['ear.tuning']
const midis = (p: Parameters<typeof gen.generate>[1]) => gen.generate(skill, p, tuning).chart.notes.map((n) => n.midi)

describe('tuneByEarGenerator', () => {
  it('is deterministic and varies with params', () => {
    const d = gen.defaults(skill, 60)
    expect(midis(d)).toEqual(midis({ ...d }))
    const others = [midis({ ...d, tempo: 61 }), midis({ ...d, mode: 'intervals' }), midis({ ...d, prompts: 12, bars: 12 })]
    expect(others.some((o) => JSON.stringify(o) !== JSON.stringify(midis(d)))).toBe(true)
  })

  it.each(['strings', 'intervals'])('builds a valid ear chart in %s mode', (mode) => {
    const d = { ...gen.defaults(skill, 60), mode }
    const ex = gen.generate(skill, d, tuning)
    expect(ex.interaction).toBe('ear')
    expect(ex.backing).toBeNull()
    expect(ex.chart.notes.length).toBe(EAR_PROMPTS)
    expect(ex.params.bars).toBe(EAR_PROMPTS)
    expect(ex.chart.notes[EAR_PROMPTS - 1].time).toBeCloseTo((EAR_PROMPTS - 1) * 4, 5)
    ex.chart.notes.forEach((n, i) => {
      expect(n.midi).toBe(tuning[n.string] + n.fret)
      expect(n.fret).toBeGreaterThanOrEqual(0)
      expect(n.fret).toBeLessThanOrEqual(12)
      if (i > 0) expect(n.midi).not.toBe(ex.chart.notes[i - 1].midi)
    })
    expect(ex.id.startsWith('tuneByEar:')).toBe(true)
  })

  it('defaults are well formed', () => {
    expect(gen.defaults(skill, 60)).toEqual({ tempo: 60, bars: EAR_PROMPTS, noteValue: 'quarter', prompts: EAR_PROMPTS, mode: 'strings' })
  })
})
