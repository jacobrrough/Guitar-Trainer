import { describe, expect, it } from 'vitest'
import { getTuning } from '../music/tunings'
import { GENERATORS, exerciseParams, generateExercise } from '../training/exercises'
import { SKILLS_BY_ID } from '../training/skills'
import { COURSE, unlockedSongIds } from './course'

const SONG_IDS = [
  'open-strings-groove',
  'ode-to-joy',
  'twinkle-twinkle',
  'happy-birthday',
  'jingle-bells',
  'em-groove',
  'em-am-groove',
  'd-a-groove',
  'tom-dooley',
  'amazing-grace',
  'saints',
  'first-riff',
]
const BANNED = /\b(bpm|ratings?|accuracy|reps?|tiers?|elo)\b/i

describe('course content', () => {
  it('has ten lessons with unique ids, numbered in order', () => {
    expect(COURSE).toHaveLength(10)
    expect(new Set(COURSE.map((l) => l.id)).size).toBe(10)
    COURSE.forEach((l, i) => expect(l.number).toBe(i + 1))
  })

  it('points drills at real skills and generators that produce charts', () => {
    const tuning = getTuning('standard').strings
    for (const l of COURSE) {
      if (!l.drill) continue
      const skill = SKILLS_BY_ID[l.drill.skillId]
      expect(skill, l.id).toBeDefined()
      expect(GENERATORS[l.drill.generatorId], l.id).toBeDefined()
      const params = exerciseParams(skill, l.drill.generatorId, l.drill.tempo, l.drill.params)
      const ex = generateExercise(skill, l.drill.generatorId, params, tuning)
      expect(ex.chart.notes.length, l.id).toBeGreaterThan(0)
    }
  })

  it('only references known songs', () => {
    for (const l of COURSE) {
      if (l.play) expect(SONG_IDS, l.id).toContain(l.play.songId)
      for (const id of l.unlocks) expect(SONG_IDS, l.id).toContain(id)
    }
    expect(unlockedSongIds(COURSE.map((l) => ({ id: l.id, status: 'done' as const })))).toEqual(expect.arrayContaining(SONG_IDS))
  })

  it('writes short plain cards', () => {
    for (const l of COURSE) {
      expect(l.learn.length).toBeGreaterThanOrEqual(2)
      expect(l.learn.length).toBeLessThanOrEqual(4)
      const texts = [l.title, l.subtitle, l.done]
      for (const c of l.learn) {
        expect(c.paragraphs.length, `${l.id} ${c.title}`).toBeGreaterThanOrEqual(1)
        expect(c.paragraphs.length, `${l.id} ${c.title}`).toBeLessThanOrEqual(4)
        for (const p of c.paragraphs) expect(p.length, p).toBeLessThan(220)
        expect((c.mistakes ?? []).length).toBeLessThanOrEqual(3)
        for (const m of c.mistakes ?? []) expect(m).toMatch(/^If .* then /)
        texts.push(c.title, ...c.paragraphs, ...(c.mistakes ?? []))
      }
      for (const t of texts) expect(t, t).not.toMatch(BANNED)
    }
  })
})
