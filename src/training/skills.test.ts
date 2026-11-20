import { describe, expect, it } from 'vitest'
import { SKILLS, SKILLS_BY_ID, getSkill, isUnlocked, prerequisitesSolid, skillsForCategory, topologicalOrder } from './skills'

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
  'tuneByEar', 'openStrings', 'firstFrets']

describe('skills', () => {
  it('has exactly 27 skills with unique ids', () => {
    expect(SKILLS).toHaveLength(27)
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(27)
  })

  it('has existing prerequisites', () => {
    for (const s of SKILLS) for (const p of s.prerequisites) expect(SKILLS_BY_ID[p], `${s.id} -> ${p}`).toBeDefined()
  })

  it('is acyclic and orders prerequisites first', () => {
    const order = topologicalOrder()
    expect(order).toHaveLength(27)
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

  it('has tips, and six chord skills', () => {
    for (const s of SKILLS) expect(s.tips.length).toBeGreaterThanOrEqual(2)
    expect(skillsForCategory('chords').length).toBe(6)
  })

  it('getSkill throws on unknown id', () => {
    expect(() => getSkill('nope')).toThrow()
  })

  it('starts downstrokes with single notes on the click, and keeps the power chord riff for power chords', () => {
    expect(getSkill('pick.downstrokes').generators[0]).toBe('metronomeSteady')
    expect(getSkill('pick.downstrokes').generators).not.toContain('powerChordRiff')
    expect(getSkill('chord.power').generators).toContain('powerChordRiff')
    // No tier 0 or tier 1 skill uses the riff: it needs palm muting and two-string shapes.
    for (const s of SKILLS.filter((x) => x.tier <= 1)) expect(s.generators, s.id).not.toContain('powerChordRiff')
  })

  it('checks the whole chain under a skill, not only the skill right below it', () => {
    const byId = new Map(SKILLS.map((s) => [s.id, s]))
    const barre = getSkill('chord.barre')
    const solid = { 'chord.changes-open': 75, 'chord.open': 60, 'fret.cross-string': 60, 'fret.single-string': 60 }
    expect(prerequisitesSolid(barre, solid, byId)).toBe(true)
    expect(prerequisitesSolid(barre, { ...solid, 'chord.open': 29 }, byId)).toBe(false)
    expect(prerequisitesSolid(barre, { ...solid, 'fret.single-string': 59 }, byId)).toBe(false)
    expect(prerequisitesSolid(barre, { 'chord.changes-open': 75 }, byId)).toBe(false)
    expect(prerequisitesSolid(getSkill('fret.single-string'), {}, byId)).toBe(true)
  })

  it('computes unlocks from ratings', () => {
    expect(isUnlocked('fret.single-string', {})).toBe(true)
    expect(isUnlocked('chord.changes-open', { 'chord.open': 59 })).toBe(false)
    expect(isUnlocked('chord.changes-open', { 'chord.open': 60 })).toBe(true)
  })
})
