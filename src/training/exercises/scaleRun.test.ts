import { describe, expect, it } from 'vitest'
import { getSkill } from '../skills'
import { DEFAULT_TUNING } from './builder'
import { exerciseParams, generateExercise } from './index'

const box1 = getSkill('lead.pent-box1')
const boxes = getSkill('lead.pent-boxes')
const major = getSkill('lead.major-scale')

function run(skill: typeof box1, overrides: Record<string, unknown> = {}) {
  return generateExercise(skill, 'scaleRun', exerciseParams(skill, 'scaleRun', 60, { bars: 4, ...overrides }), DEFAULT_TUNING)
}
const frets = (ex: ReturnType<typeof run>) => ex.chart.notes.map((n) => `${n.string}/${n.fret}`).join(' ')
const pitchClasses = (ex: ReturnType<typeof run>) => [...new Set(ex.chart.notes.map((n) => n.midi % 12))].sort((a, b) => a - b)

describe('scale runs', () => {
  it('the major scale skill plays a major scale: seven notes, in one hand position', () => {
    const ex = run(major)
    expect(pitchClasses(ex)).toEqual([1, 2, 4, 6, 8, 9, 11]) // A B C# D E F# G#
    const used = ex.chart.notes.map((n) => n.fret)
    // One finger per fret across four frets.
    expect(Math.max(...used) - Math.min(...used)).toBeLessThanOrEqual(3)
    expect(ex.title).toMatch(/major/i)
    // It starts on the root and comes back to it on the way down.
    expect(ex.chart.notes[0].midi % 12).toBe(9)
    expect(new Set(ex.chart.notes.map((n) => n.midi)).size).toBeGreaterThanOrEqual(15)
  })

  it('pentatonic boxes 2 to 5 is never box 1 again', () => {
    const first = frets(run(box1))
    for (const seed of [undefined, 0, 1, 2, 3, 4, 5, 6, 7]) {
      const ex = run(boxes, seed === undefined ? {} : { seed })
      expect(frets(ex), `seed ${seed}`).not.toBe(first)
      expect(pitchClasses(ex)).toEqual([0, 2, 4, 7, 9]) // A C D E G
    }
  })

  it('pentatonic boxes gets through boxes 2, 3, 4 and 5 as the days go by', () => {
    const lowest = new Set<number>()
    for (let day = 0; day < 4; day++) lowest.add(Math.min(...run(boxes, { seed: 19_000 + day }).chart.notes.map((n) => n.fret)))
    // Boxes 2 and 3 of A minor pentatonic start at frets 7 and 9. Boxes 4 and 5 would start at 12 and 14,
    // past where an acoustic guitar's neck meets the body, so they are shown an octave down: frets 0 and 2.
    expect([...lowest].sort((a, b) => a - b)).toEqual([0, 2, 7, 9])
  })

  it('names the box it shows', () => {
    expect(run(boxes, { seed: 1 }).title).toMatch(/box [2-5]/)
    expect(run(box1).title).toMatch(/box 1/)
  })

  it('keeps every box where any guitar can reach it', () => {
    for (let seed = 0; seed < 4; seed++) {
      for (const n of run(boxes, { seed }).chart.notes) expect(n.fret).toBeLessThanOrEqual(13)
    }
  })

  it('box 1 is unchanged', () => {
    const ex = run(box1)
    expect(Math.min(...ex.chart.notes.map((n) => n.fret))).toBe(5)
    expect(Math.max(...ex.chart.notes.map((n) => n.fret))).toBe(8)
    expect(ex.chart.notes[0]).toMatchObject({ string: 0, fret: 5 })
  })
})
