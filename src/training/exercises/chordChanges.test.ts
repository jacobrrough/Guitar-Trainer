import { describe, expect, it } from 'vitest'
import { getSkill } from '../skills'
import type { GeneratedExercise } from '../types'
import { DEFAULT_TUNING } from './builder'
import { exerciseParams, generateExercise } from './index'

const open = getSkill('chord.open')
const changes = getSkill('chord.changes-open')

function build(skill: typeof open, tempo: number, overrides: Record<string, unknown> = {}): GeneratedExercise {
  return generateExercise(skill, 'chordChanges', exerciseParams(skill, 'chordChanges', tempo, overrides), DEFAULT_TUNING)
}

/** [beat, chord name] of every strum. */
function strums(ex: GeneratedExercise): Array<[number, string]> {
  const seen = new Map<number, [number, string]>()
  for (const n of ex.chart.notes) seen.set(n.chordId, [Math.round((n.time * ex.params.tempo) / 60 * 100) / 100, n.chordName ?? ''])
  return [...seen.values()].sort((a, b) => a[0] - b[0])
}

describe('chord skills get their own chord drills', () => {
  it('open chords is not the chord-change drill of the tier above', () => {
    const a = build(open, 45, { bars: 4 })
    const b = build(changes, 45, { bars: 4 })
    expect(a.id).not.toBe(b.id)
    expect(strums(a)).not.toEqual(strums(b))
  })

  it('open chords holds each chord for a whole bar and strums it twice', () => {
    const s = strums(build(open, 45, { bars: 4 }))
    expect(s.map(([beat]) => beat)).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
    for (let bar = 0; bar < 4; bar++) expect(s[bar * 2][1]).toBe(s[bar * 2 + 1][1])
    // Two chords in turn, so there is one change a bar and four beats to get ready for it.
    expect(new Set(s.map(([, name]) => name)).size).toBe(2)
    expect(s[0][1]).not.toBe(s[2][1])
  })

  it('open chords gets through all eight chords of the skill as the days go by', () => {
    const shown = new Set<string>()
    for (let day = 0; day < 8; day++) for (const [, name] of strums(build(open, 45, { bars: 4, seed: 19_000 + day }))) shown.add(name)
    expect([...shown].sort()).toEqual(['A', 'Am', 'C', 'D', 'Dm', 'E', 'Em', 'G'])
  })

  it('open chords keeps the same chords through a block, whatever the tempo', () => {
    const names = (tempo: number) => strums(build(open, tempo, { bars: 4, seed: 19_003, startTempo: 45 })).map(([, n]) => n)
    expect(names(41)).toEqual(names(45))
    expect(names(48)).toEqual(names(45))
  })

  it('changes between open chords is still a new chord every two beats', () => {
    const s = strums(build(changes, 45, { bars: 4 }))
    expect(s.map(([beat]) => beat)).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
    expect(s.slice(0, 3).map(([, n]) => n)).toEqual(['Em', 'Am', 'D'])
  })
})
