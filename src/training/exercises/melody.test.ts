import { describe, expect, it } from 'vitest'
import { getSkill } from '../skills'
import { DEFAULT_TUNING } from './builder'
import { exerciseParams, generateExercise } from './index'
import { melodyGenerator } from './melody'

const crossString = getSkill('fret.cross-string')
const singleString = getSkill('fret.single-string')
const shifts = getSkill('fret.shifts')

const tune = (notes: { string: number; fret: number }[]) => notes.map((n) => `${n.string}/${n.fret}`).join(' ')

describe('melody', () => {
  it('is the same tune after a tempo nudge, so a round can be tried again slower', () => {
    // What the Coach sends for round 1, then for the slower and the faster round of the same block.
    const round = (tempo: number) =>
      generateExercise(crossString, 'melody', exerciseParams(crossString, 'melody', tempo, { bars: 4, startTempo: 50 }), DEFAULT_TUNING)
    const first = tune(round(50).chart.notes)
    expect(tune(round(46).chart.notes)).toBe(first)
    expect(tune(round(53).chart.notes)).toBe(first)
  })

  it('a longer round starts with the same tune', () => {
    const at = (bars: number) => melodyGenerator.generate(crossString, { ...melodyGenerator.defaults(crossString, 60), bars }, DEFAULT_TUNING)
    const short = at(4).chart.notes
    const long = at(8).chart.notes
    // All but the closing note, which is where the short round comes home.
    expect(tune(long.slice(0, short.length - 1))).toBe(tune(short.slice(0, -1)))
  })

  it('a seed gives another tune, and the same seed the same tune', () => {
    const withSeed = (seed: number) => tune(melodyGenerator.generate(crossString, { ...melodyGenerator.defaults(crossString, 60), seed }, DEFAULT_TUNING).chart.notes)
    expect(withSeed(1)).toBe(withSeed(1))
    expect(new Set([1, 2, 3, 4, 5].map(withSeed)).size).toBeGreaterThan(1)
  })

  it('the first cross-string melody stays in frets 0 to 3 on three neighbouring strings, in C', () => {
    for (const tempo of [42, 50, 60, 80, 100]) {
      for (const seed of [undefined, 1, 2, 3]) {
        const params = { ...melodyGenerator.defaults(crossString, tempo), ...(seed === undefined ? {} : { seed }) }
        const { chart } = melodyGenerator.generate(crossString, params, DEFAULT_TUNING)
        expect(params.key).toBe('C')
        for (const n of chart.notes) expect(n.fret, `${tempo} bpm`).toBeLessThanOrEqual(3)
        const strings = [...new Set(chart.notes.map((n) => n.string))].sort()
        expect(strings.length).toBeGreaterThan(1)
        expect(strings[strings.length - 1] - strings[0]).toBeLessThanOrEqual(2)
        // No sharps or flats: every note is a white key.
        for (const n of chart.notes) expect([0, 2, 4, 5, 7, 9, 11]).toContain(n.midi % 12)
        expect(chart.notes[chart.notes.length - 1].midi % 12).toBe(0)
      }
    }
  })

  it('writes a note that is an open string as the open string, not as a stretch on the string below', () => {
    // A major in open position with the old five-fret reach: B is the open B string, never G string fret 4.
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const { chart } = melodyGenerator.generate(shifts, { tempo: 60, bars: 8, noteValue: 'quarter', key: 'A', scale: 'major', position: 0, seed }, DEFAULT_TUNING)
      for (const n of chart.notes) {
        const open = DEFAULT_TUNING.indexOf(n.midi)
        if (open >= 0) expect(n, `seed ${seed}`).toMatchObject({ string: open, fret: 0 })
      }
    }
  })

  it('keeps to one string when asked for one string', () => {
    const { chart } = melodyGenerator.generate(singleString, { ...melodyGenerator.defaults(singleString, 70), strings: 1, bars: 10 }, DEFAULT_TUNING)
    expect(new Set(chart.notes.map((n) => n.string)).size).toBe(1)
    expect(new Set(chart.notes.map((n) => n.fret)).size).toBeGreaterThanOrEqual(3)
    for (const n of chart.notes) expect(n.fret).toBeLessThanOrEqual(4)
  })

  it('keeps to the number of neighbouring strings asked for', () => {
    for (const strings of [2, 3, 4]) {
      const { chart } = melodyGenerator.generate(shifts, { tempo: 70, bars: 10, key: 'E', position: 0, strings }, DEFAULT_TUNING)
      const used = [...new Set(chart.notes.map((n) => n.string))].sort()
      expect(used[0]).toBeGreaterThanOrEqual(6 - strings)
    }
  })

  it('position shifts really moves the hand: each bar sits in one of two places on the neck', () => {
    const params = melodyGenerator.defaults(shifts, 60)
    const { chart } = melodyGenerator.generate(shifts, params, DEFAULT_TUNING)
    const barOf = (time: number) => Math.floor((time * 60) / 60 / 4 + 1e-6)
    const low = chart.notes.filter((n) => barOf(n.time) % 2 === 0)
    const high = chart.notes.filter((n) => barOf(n.time) % 2 === 1)
    expect(Math.max(...low.map((n) => n.fret))).toBeLessThanOrEqual(3)
    expect(Math.min(...high.map((n) => n.fret))).toBeGreaterThanOrEqual(5)
    expect(Math.max(...high.map((n) => n.fret))).toBeLessThanOrEqual(8)
  })
})
