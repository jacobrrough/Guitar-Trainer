import { describe, expect, it } from 'vitest'
import { SKILLS, SKILLS_BY_ID, getSkill, isUnlocked, skillsForCategory, topologicalOrder } from './skills'

const GENERATORS = [
  'chromatic',
  'melody',
  'scaleRun',
  'chordChanges',
  'strumPattern',
  'powerChordRiff',
  'stringSkipping',
  'legatoLick',
  'slideLick',
  'bendTargets',
  'subdivisionSwitch',
  'metronomeSteady',
  'tuneByEar',
]

describe('skills', () => {
  it('has exactly 25 skills with unique ids', () => {
    expect(SKILLS).toHaveLength(25)
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(25)
  })

  it('has existing prerequisites', () => {
    for (const s of SKILLS) for (const p of s.prerequisites) expect(SKILLS_BY_ID[p], `${s.id} -> ${p}`).toBeDefined()
  })

  it('is acyclic and orders prerequisites first', () => {
    const order = topologicalOrder()
    expect(order).toHaveLength(25)
    const pos = new Map(order.map((s, i) => [s.id, i]))
    for (const s of SKILLS) for (const p of s.prerequisites) expect(pos.get(p)!).toBeLessThan(pos.get(s.id)!)
  })

  it('never has a tier below a prerequisite tier', () => {
    for (const s of SKILLS) for (const p of s.prerequisites) expect(s.tier).toBeGreaterThanOrEqual(getSkill(p).tier)
  })

  it('uses valid generators', () => {
    for (const s of SKILLS) {
      expect(s.generators.length).toBeGreaterThan(0)
      for (const g of s.generators) expect(GENERATORS).toContain(g)
    }
  })

  it('has consistent tempos', () => {
    for (const s of SKILLS) {
      expect(s.refTempo).toBeLessThanOrEqual(s.targetTempo)
      expect(s.startTempo).toBeLessThanOrEqual(s.targetTempo)
    }
  })

  it('has tips and marks chord skills provisional', () => {
    for (const s of SKILLS) expect(s.tips.length).toBeGreaterThanOrEqual(2)
    const chords = skillsForCategory('chords')
    expect(chords.length).toBe(6)
    for (const s of chords) expect(s.provisional).toBe(true)
  })

  it('getSkill throws on unknown id', () => {
    expect(() => getSkill('nope')).toThrow()
  })

  it('computes unlocks from ratings', () => {
    expect(isUnlocked('fret.single-string', {})).toBe(true)
    expect(isUnlocked('chord.changes-open', { 'chord.open': 59 })).toBe(false)
    expect(isUnlocked('chord.changes-open', { 'chord.open': 60 })).toBe(true)
  })
})
