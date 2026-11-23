import { describe, expect, it } from 'vitest'
import { MIN_RANGE_SPAN } from '../music/keys'
import { RATING_HEADROOM } from './constants'
import { itemDifficulty } from './difficulty'
import { GENERATORS } from './exercises'
import { tempoProgressRating } from './learner'
import { maxStepFor } from './planner'
import { SKILLS, topologicalOrder } from './skills'
import type { SkillCategory, SkillDef } from './types'
import { VOICE_SKILLS } from './voiceSkills'

const byId = (id: string): SkillDef => {
  const skill = VOICE_SKILLS.find((s) => s.id === id)
  if (!skill) throw new Error(`No voice skill ${id}`)
  return skill
}

/**
 * The skill table of docs/SINGING.md §6, written out by hand: id, name, tier, what it builds on, area,
 * generator and pace. A pace of four numbers is a tempo skill (ref / start / target / floor); a single
 * number is a step skill, sung at that one tempo.
 */
type Row = [id: string, name: string, tier: number, needs: string[], category: SkillCategory, generator: string, pace: number | [ref: number, start: number, target: number, min: number]]
const TABLE: Row[] = [
  ['voice.pitch.match', 'Match a note', 0, [], 'pitch', 'voiceEcho', 60],
  ['voice.pitch.steps', 'Step up and down', 1, ['voice.pitch.match'], 'pitch', 'voicePattern', [66, 60, 88, 54]],
  ['voice.pitch.five-note', 'Five notes up and back', 1, ['voice.pitch.steps'], 'pitch', 'voicePattern', [66, 60, 96, 54]],
  ['voice.pitch.hold', 'Hold a note steady', 1, ['voice.pitch.match'], 'breath', 'voiceHold', 60],
  ['voice.range.slides', 'Slides', 1, ['voice.pitch.match'], 'range', 'voiceSlide', 60],
  ['voice.pitch.echo', 'Echo a short tune', 1, ['voice.pitch.match'], 'pitch', 'voiceEcho', 72],
  ['voice.interval.thirds', 'Small jumps', 2, ['voice.pitch.five-note'], 'range', 'voicePattern', [66, 56, 92, 50]],
  ['voice.interval.triad', 'Chord notes up to the top', 2, ['voice.interval.thirds', 'voice.range.slides'], 'range', 'voicePattern', [72, 60, 92, 60]],
  ['voice.breath.phrases', 'A whole line on one breath', 2, ['voice.pitch.hold', 'voice.pitch.five-note'], 'breath', 'voicePattern', 72],
  ['voice.interval.leaps', 'Bigger jumps', 3, ['voice.interval.triad'], 'range', 'voicePattern', 66],
  ['voice.pitch.runs', 'Quick notes', 3, ['voice.pitch.five-note', 'voice.interval.thirds'], 'pitch', 'voicePattern', [100, 100, 132, 92]],
  ['voice.pitch.alone', 'Stay in tune on your own', 4, ['voice.pitch.hold', 'voice.interval.leaps'], 'pitch', 'voiceEcho', 60],
]

/** The ladders of §6: for each step its band in cents and its bonus, and the semitones it needs where §12 gives a number. */
const LADDERS: Record<string, [band: number, bonus: number, span?: number][]> = {
  'voice.pitch.match': [[80, 0], [65, 12], [50, 20], [35, 28]],
  'voice.pitch.hold': [[65, 0], [50, 8], [50, 16], [35, 24]],
  'voice.range.slides': [[80, 0], [80, 8, 7], [65, 16, 12]],
  'voice.pitch.echo': [[80, 0], [65, 8], [50, 16]],
  'voice.breath.phrases': [[65, 0], [50, 8], [50, 16]],
  'voice.interval.leaps': [[65, 0, 5], [50, 6, 7], [50, 12, 9], [50, 18, 12]],
  'voice.pitch.alone': [[50, 0], [50, 10], [35, 20]],
}

describe('voice skills', () => {
  it('are the twelve skills of the design, in its order, each as its row says', () => {
    expect(VOICE_SKILLS.map((s) => s.id)).toEqual(TABLE.map((row) => row[0]))
    for (const [id, name, tier, needs, category, generator, pace] of TABLE) {
      const skill = byId(id)
      expect(skill.name, id).toBe(name)
      expect(skill.tier, id).toBe(tier)
      expect(skill.prerequisites, id).toEqual(needs)
      expect(skill.category, id).toBe(category)
      expect(skill.generators, id).toEqual([generator])
      const [ref, start, target, min] = typeof pace === 'number' ? [pace, pace, pace, pace] : pace
      expect([skill.refTempo, skill.startTempo, skill.targetTempo, skill.minTempo], id).toEqual([ref, start, target, min])
    }
  })

  it('have ids that say they are sung, and none that a guitar skill has', () => {
    const guitar = new Set(SKILLS.map((s) => s.id))
    for (const s of VOICE_SKILLS) {
      expect(s.id.startsWith('voice.'), s.id).toBe(true)
      expect(guitar.has(s.id), s.id).toBe(false)
    }
    expect(new Set(VOICE_SKILLS.map((s) => s.id)).size).toBe(VOICE_SKILLS.length)
  })

  it('build only on skills that exist, without a circle, and never on a harder tier', () => {
    const order = topologicalOrder(VOICE_SKILLS)
    expect(order).toHaveLength(VOICE_SKILLS.length)
    const place = new Map(order.map((s, i) => [s.id, i]))
    for (const s of VOICE_SKILLS) {
      for (const p of s.prerequisites) {
        expect(place.get(p), `${s.id} -> ${p}`).toBeLessThan(place.get(s.id)!)
        expect(byId(p).tier, `${s.id} -> ${p}`).toBeLessThanOrEqual(s.tier)
      }
    }
    // One way in: everything is reached from the one skill that needs nothing.
    expect(VOICE_SKILLS.filter((s) => s.prerequisites.length === 0).map((s) => s.id)).toEqual(['voice.pitch.match'])
  })

  it('name only generators that are registered, and only sung ones', () => {
    for (const s of VOICE_SKILLS) {
      expect(s.generators.length, s.id).toBeGreaterThan(0)
      for (const g of s.generators) {
        expect(Object.hasOwn(GENERATORS, g), `${s.id} -> ${g}`).toBe(true)
        expect(GENERATORS[g].id, `${s.id} -> ${g}`).toBe(g)
        expect(g.startsWith('voice'), `${s.id} -> ${g}`).toBe(true)
      }
    }
  })

  it('never ask for a tempo under the floor, and start no faster than they aim', () => {
    for (const s of VOICE_SKILLS) {
      expect(s.minTempo, s.id).toBeDefined()
      expect(s.minTempo!, s.id).toBeLessThanOrEqual(s.startTempo)
      expect(s.startTempo, s.id).toBeLessThanOrEqual(s.targetTempo)
      expect(s.refTempo, s.id).toBeLessThanOrEqual(s.targetTempo)
    }
  })

  it('a step skill has one tempo and a ladder of at least two steps; a tempo skill has room to speed up and no ladder', () => {
    expect(VOICE_SKILLS.filter((s) => s.steps).map((s) => s.id).sort()).toEqual(Object.keys(LADDERS).sort())
    for (const s of VOICE_SKILLS) {
      if (s.steps) {
        expect(s.steps.length, s.id).toBeGreaterThanOrEqual(2)
        expect(new Set([s.refTempo, s.startTempo, s.targetTempo, s.minTempo]).size, s.id).toBe(1)
      } else {
        expect(s.targetTempo, s.id).toBeGreaterThan(s.startTempo)
      }
    }
  })

  it('each step is judged as the design says, and is worth more than the one before', () => {
    for (const [id, rungs] of Object.entries(LADDERS)) {
      const steps = byId(id).steps!
      expect(steps.map((step) => [step.params.band, step.bonus, ...(step.span === undefined ? [] : [step.span])]), id).toEqual(rungs)
      expect(steps[0].bonus, id).toBe(0)
      for (let i = 1; i < steps.length; i++) expect(steps[i].bonus, `${id} step ${i}`).toBeGreaterThan(steps[i - 1].bonus)
    }
  })

  it('a step says how much room it needs only where it needs more than the smallest range, and a ladder never gets narrower on the way up', () => {
    for (const s of VOICE_SKILLS) {
      const spans = (s.steps ?? []).map((step) => step.span ?? 0)
      for (let i = 1; i < spans.length; i++) expect(spans[i], `${s.id} step ${i}`).toBeGreaterThanOrEqual(spans[i - 1])
      // The first step of every skill is sung in the smallest range the app stores.
      if (spans.length > 0) expect(spans[0], s.id).toBeLessThanOrEqual(MIN_RANGE_SPAN)
    }
    expect(VOICE_SKILLS.filter((s) => s.steps?.some((step) => step.span !== undefined)).map((s) => s.id)).toEqual(['voice.range.slides', 'voice.interval.leaps'])
  })

  it('in the smallest range the slides and the bigger jumps stop below their last step; with an octave of room they do not', () => {
    const small = { low: 48, high: 48 + MIN_RANGE_SPAN }
    expect(maxStepFor(byId('voice.range.slides'), small)).toBe(1)
    expect(maxStepFor(byId('voice.interval.leaps'), small)).toBe(1)
    // A sixth needs nine semitones, an octave twelve: both ends of a range can be sung.
    expect(maxStepFor(byId('voice.interval.leaps'), { low: 48, high: 56 })).toBe(1)
    expect(maxStepFor(byId('voice.interval.leaps'), { low: 48, high: 57 })).toBe(2)
    expect(maxStepFor(byId('voice.interval.leaps'), { low: 48, high: 59 })).toBe(2)
    expect(maxStepFor(byId('voice.range.slides'), { low: 48, high: 59 })).toBe(1)
    for (const id of ['voice.range.slides', 'voice.interval.leaps']) expect(maxStepFor(byId(id), { low: 48, high: 60 }), id).toBe(byId(id).steps!.length - 1)
    // Every other ladder is sung to its end in any range.
    for (const s of VOICE_SKILLS) {
      if (!s.steps || ['voice.range.slides', 'voice.interval.leaps'].includes(s.id)) continue
      expect(maxStepFor(s, small), s.id).toBe(s.steps.length - 1)
    }
  })

  it('lead to the rating stops worked out in the design', () => {
    // A gain stops RATING_HEADROOM above the difficulty of the step, and below the last step no further
    // than the way from "solid" to just under "mastered" (docs/SINGING.md §6, "Worked caps").
    const stops = (id: string) => {
      const skill = byId(id)
      const last = skill.steps!.length - 1
      return skill.steps!.slice(0, last).map((step, i) =>
        Math.round(Math.min(itemDifficulty(skill, { tempo: skill.refTempo, bonus: step.bonus }) + RATING_HEADROOM, tempoProgressRating(i, { start: 0, target: last }))),
      )
    }
    expect(stops('voice.pitch.match')).toEqual([50, 62, 70])
    expect(stops('voice.pitch.hold')).toEqual([60, 68, 76])
    expect(stops('voice.breath.phrases')).toEqual([75, 82])
  })

  it('name every step in a few words of its own', () => {
    for (const s of VOICE_SKILLS) {
      const labels = (s.steps ?? []).map((step) => step.label)
      expect(new Set(labels).size, s.id).toBe(labels.length)
      for (const label of labels) {
        expect(label.length, `${s.id}: ${label}`).toBeGreaterThan(2)
        expect(label.length, `${s.id}: ${label}`).toBeLessThanOrEqual(40)
        // It follows "Next round: " and "Skill name: " on a card, so it is not a sentence of its own.
        expect(label, s.id).not.toMatch(/[.!?]$/)
        // ...and it is read there without the step before it: a milestone or a check shows one label
        // alone, so none may lean on another ("the same", "then", "also").
        expect(label, s.id).not.toMatch(/^(the same|same|then|and|also|as before)\b/i)
      }
    }
  })

  it('are described in plain, kind words', () => {
    // Words that judge, words that ask for force, numbers a beginner cannot use, and the other instrument.
    // ...and the words of a music lesson that someone who has never sung does not have yet.
    const banned = /\b(wrong|fail\w*|tone.?deaf|loud\w*|push\w*|belt\w*|cents?|ratings?|bpm|tier|accuracy|guitar|strings?|frets?|fingers?|pick|keys?|octaves?|semitones?|intervals?|scales?|tonic|tempo|pitch\w*)\b/i
    for (const s of VOICE_SKILLS) {
      const texts = [s.name, s.description, ...s.tips, ...(s.steps ?? []).map((step) => step.label)]
      for (const text of texts) expect(text, s.id).not.toMatch(banned)
      expect(s.description.length, s.id).toBeGreaterThan(20)
      expect(s.description.length, s.id).toBeLessThanOrEqual(160)
      expect(s.tips.length, s.id).toBeGreaterThanOrEqual(2)
      for (const tip of s.tips) {
        expect(tip.length, `${s.id}: ${tip}`).toBeLessThanOrEqual(160)
        expect(tip, s.id).toMatch(/[.!?]$/)
      }
    }
  })
})
