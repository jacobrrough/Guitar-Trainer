/**
 * One table over every skill and the exercise the Coach gives it by default (the first generator
 * with its own defaults). These are the checks a teacher would make before handing a sheet to a pupil:
 * can it be played as written at that stage, and is it practice for the thing the skill is called.
 */
import { describe, expect, it } from 'vitest'
import { SKILLS } from '../skills'
import type { GeneratedExercise, SkillDef } from '../types'
import { DEFAULT_TUNING } from './builder'
import { exerciseParams, generateExercise } from './index'

function defaultExercise(skill: SkillDef, tempo = skill.startTempo, overrides: Record<string, unknown> = {}): GeneratedExercise {
  const generatorId = skill.generators[0]
  return generateExercise(skill, generatorId, exerciseParams(skill, generatorId, tempo, overrides), DEFAULT_TUNING)
}

/** Where a note starts, in beats from the start, so two tempos can be compared. */
function beatOf(ex: GeneratedExercise, time: number): number {
  return Math.round(((time * ex.params.tempo) / 60) * 1000) / 1000
}

/** The exercise as a player sees it: when, which string, which fret, which mark. Tempo does not show. */
function written(ex: GeneratedExercise): string {
  return ex.chart.notes
    .map((n) => `${beatOf(ex, n.time)}:${n.string}:${n.fret}:${Object.keys(n.tech ?? {}).sort().join('+')}`)
    .join(' ')
}

/** Beats at which something is struck, in order, each once (a chord is one strike). */
function strikes(ex: GeneratedExercise): number[] {
  return [...new Set(ex.chart.notes.map((n) => beatOf(ex, n.time)))].sort((a, b) => a - b)
}

/** The shortest distance between two strikes, in beats (1 = a quarter note). */
function shortestStep(ex: GeneratedExercise): number {
  const at = strikes(ex)
  let min = Infinity
  for (let i = 1; i < at.length; i++) min = Math.min(min, at[i] - at[i - 1])
  return Math.round(min * 1000) / 1000
}

function hasChords(ex: GeneratedExercise): boolean {
  return new Set(ex.chart.notes.map((n) => n.chordId)).size < ex.chart.notes.length
}

/**
 * Highest fret a learner of each tier is asked to reach. Tier 0 knows frets 1 to 3, tier 1 the first four
 * frets; later tiers go up the neck, but not past where an acoustic guitar's neck meets the body.
 */
const HIGHEST_FRET: Record<SkillDef['tier'], number> = { 0: 3, 1: 4, 2: 13, 3: 13, 4: 13 }

/** The quickest notes in each skill's default exercise, in beats: 2 = half notes, 1 = quarters, 0.5 = eighths. */
const QUICKEST_NOTE: Record<string, number> = {
  'basics.open-strings': 2,
  'basics.first-frets': 2,
  'fret.single-string': 1,
  'fret.cross-string': 1,
  'fret.chromatic': 1,
  'fret.shifts': 1,
  'pick.downstrokes': 1,
  'pick.alternate-8': 0.5,
  'pick.alternate-16': 0.25,
  'rhythm.syncopation': 0.5,
  'rhythm.triplets': 0.333,
  'chord.open': 2,
  'chord.changes-open': 2,
  'chord.power': 0.5,
  'chord.barre': 2,
  'chord.strum-patterns': 0.5,
  'chord.sevenths': 2,
  'lead.pent-box1': 0.5,
  'lead.pent-boxes': 0.5,
  'lead.major-scale': 0.5,
  'lead.hammer-pull': 0.5,
  'lead.slides': 1,
  'lead.bends': 1,
  'lead.vibrato': 2,
  'time.metronome': 1,
  'time.subdivisions': 0.25,
  // One reference note a bar; the learner answers in their own time.
  'ear.tuning': 4,
}

describe('the default exercise of every skill', () => {
  it('has an expected note value for every skill', () => {
    expect(Object.keys(QUICKEST_NOTE).sort()).toEqual(SKILLS.map((s) => s.id).sort())
  })

  describe.each(SKILLS.map((skill) => ({ skill, id: skill.id })))('$id', ({ skill }) => {
    const ex = defaultExercise(skill)

    it('writes every note where it sounds', () => {
      expect(ex.chart.notes.length).toBeGreaterThan(0)
      for (const n of ex.chart.notes) {
        expect(n.string, `note ${n.id}`).toBeGreaterThanOrEqual(0)
        expect(n.string, `note ${n.id}`).toBeLessThan(ex.chart.tuning.length)
        // A bend is marked at the fret that is pressed and judged on the pitch it is pushed up to.
        const reached = n.tech?.bend ? Number(ex.params.bendSemis ?? 2) : 0
        expect(n.midi, `note ${n.id}`).toBe(ex.chart.tuning[n.string] + n.fret + reached)
      }
    })

    it('stays on frets a learner of this tier can reach', () => {
      for (const n of ex.chart.notes) {
        expect(n.fret, `note ${n.id}`).toBeGreaterThanOrEqual(0)
        if (ex.interaction === 'ear') {
          // The ear trainer asks for a pitch, not a place: it is enough that the pitch can be found in reach.
          const inReach = ex.chart.tuning.some((open) => n.midi - open >= 0 && n.midi - open <= HIGHEST_FRET[skill.tier])
          expect(inReach, `note ${n.id}`).toBe(true)
        } else {
          expect(n.fret, `note ${n.id}`).toBeLessThanOrEqual(HIGHEST_FRET[skill.tier])
        }
      }
    })

    it('never asks for a bend, slide, vibrato or hammer-on on an open string', () => {
      for (const n of ex.chart.notes) {
        if (n.fret > 0) continue
        expect(n.tech?.bend, `note ${n.id}`).toBeFalsy()
        expect(n.tech?.vibrato, `note ${n.id}`).toBeFalsy()
        expect(n.tech?.slideIn, `note ${n.id}`).toBeFalsy()
        expect(n.tech?.slideOut, `note ${n.id}`).toBeFalsy()
        expect(n.tech?.hammerOn, `note ${n.id}`).toBeFalsy()
      }
    })

    it('uses the note values the skill is about', () => {
      expect(shortestStep(ex)).toBeCloseTo(QUICKEST_NOTE[skill.id], 2)
    })

    it('is the same notes at every tempo, so a slower or faster round is the same drill', () => {
      // The ear trainer is the exception: a new order each round is the point, or the answers get memorised.
      if (ex.interaction === 'ear') return
      // What the Coach sends: a fixed length and the tempo the block started at, then a tempo nudge per round.
      const fixed = { bars: 4, startTempo: skill.startTempo }
      const first = written(defaultExercise(skill, skill.startTempo, fixed))
      for (const tempo of [skill.startTempo - 4, skill.startTempo + 3, skill.targetTempo, 104]) {
        expect(written(defaultExercise(skill, tempo, fixed)), `${tempo} bpm`).toBe(first)
      }
    })
  })

  it('is a different exercise for every skill', () => {
    const seen = new Map<string, string>()
    for (const skill of SKILLS) {
      const key = written(defaultExercise(skill, skill.startTempo, { bars: 4 }))
      expect(seen.get(key), `${skill.id} has the same exercise as ${seen.get(key)}`).toBeUndefined()
      seen.set(key, skill.id)
    }
  })

  it('keeps chords, palm muting and quick notes out of the first two tiers unless the skill says so', () => {
    for (const skill of SKILLS.filter((s) => s.tier <= 1)) {
      const ex = defaultExercise(skill)
      const says = (re: RegExp) => re.test(skill.description)
      if (hasChords(ex)) expect(says(/chord/i), `${skill.id} strums chords`).toBe(true)
      if (ex.chart.notes.some((n) => n.tech?.palmMute)) expect(says(/palm/i), `${skill.id} is palm muted`).toBe(true)
      if (shortestStep(ex) < 1) expect(says(/eighth|sixteenth|triplet/i), `${skill.id} has notes shorter than a quarter`).toBe(true)
    }
  })

  it('downstrokes on the beat is still one note per click, and not the same sheet as playing to a click', () => {
    const downstrokes = defaultExercise(SKILLS.find((s) => s.id === 'pick.downstrokes')!)
    expect(downstrokes.generatorId).toBe('metronomeSteady')
    expect(hasChords(downstrokes)).toBe(false)
    expect(strikes(downstrokes).every((b) => Number.isInteger(b))).toBe(true)
    for (const n of downstrokes.chart.notes) expect(n.fret).toBe(0)
    // The picking hand has to find more than one string.
    expect(new Set(downstrokes.chart.notes.map((n) => n.string)).size).toBeGreaterThan(1)
  })

  it('gives the rhythm skills the rhythm in their name', () => {
    const of = (id: string) => defaultExercise(SKILLS.find((s) => s.id === id)!)
    const offBeat = (b: number) => Math.abs((b % 1) - 0.5) < 1e-6
    const sync = strikes(of('rhythm.syncopation'))
    // Off-beat notes, and at least one that is held across the next beat (nothing new is struck on it).
    expect(sync.some(offBeat)).toBe(true)
    expect(sync.some((b) => offBeat(b) && !sync.includes(b + 0.5))).toBe(true)
    const triplets = strikes(of('rhythm.triplets'))
    expect(triplets.some((b) => Math.abs((b % 1) - 0.333) < 1e-3)).toBe(true)
    // Triplets come before sixteenth notes in the skill tree: no sixteenths here.
    expect(triplets.some((b) => Math.abs((b % 1) - 0.25) < 1e-6)).toBe(false)
  })
})
