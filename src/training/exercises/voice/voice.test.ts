/**
 * What a singer is handed, checked the way a singing teacher would check a sheet before giving it
 * out: is every note one this voice has, is there time to breathe, does the app's own voice stop
 * well before the singer's turn, and is the exercise the thing its skill is called.
 */
import { describe, expect, it } from 'vitest'
import { renderDrums } from '../../../audio/synth'
import { renderVoiceNotes } from '../../../audio/voice'
import type { ChartNote, VoiceCue } from '../../../chart/types'
import { DEFAULT_RANGES, MIN_RANGE_SPAN, easyRange } from '../../../music/keys'
import { VOICE } from '../../../features/play/voice/judge'
import { BACKING_SAMPLE_RATE } from '../../constants'
import { itemDifficulty } from '../../difficulty'
import { maxStepFor } from '../../planner'
import { SKILLS_BY_ID } from '../../skills'
import type { ExerciseParams, GeneratedExercise, SkillDef } from '../../types'
import { VOICE_SKILLS } from '../../voiceSkills'
import { renderExerciseBacking, renderExerciseGuide } from '../backing'
import { DEFAULT_TUNING } from '../builder'
import { GENERATORS, exerciseParams, generateExercise, getGenerator, resolveGeneratorId } from '../index'
import { VoiceBuilder, beatsOf, numberOf, takeFor, turnBars, turnsThatFit } from './builder'

interface Range {
  low: number
  high: number
  easy: number
}

const LOWER: Range = DEFAULT_RANGES.lower
const HIGHER: Range = DEFAULT_RANGES.higher
/** The widest range the app stores: an octave and a tone, so every step of every ladder fits. */
const WIDE: Range = { low: 45, high: 59, easy: 52 }

const skillOf = (id: string): SkillDef => {
  const skill = VOICE_SKILLS.find((s) => s.id === id)
  if (!skill) throw new Error(`No voice skill ${id}`)
  return skill
}

/** The exercise as the Coach builds it: the skill's first generator, its defaults, and what the block says on top. */
function build(skill: SkillDef, range: Partial<Range> | null, over: Partial<ExerciseParams> = {}): GeneratedExercise {
  const generatorId = skill.generators[0]
  const params = exerciseParams(skill, generatorId, over.tempo ?? skill.startTempo, { ...(range ?? {}), ...over })
  return generateExercise(skill, generatorId, params, DEFAULT_TUNING)
}

interface Case {
  name: string
  skill: SkillDef
  /** Undefined for a skill without a ladder. */
  step?: number
}

/** Every skill at every step of its ladder. */
const CASES: Case[] = VOICE_SKILLS.flatMap((skill) =>
  skill.steps ? skill.steps.map((_, step) => ({ name: `${skill.id} step ${step}`, skill, step })) : [{ name: skill.id, skill }],
)

const stepOver = (c: Case): Partial<ExerciseParams> => (c.step === undefined ? {} : { step: c.step, startStep: c.step })

/** The cases a range can hold: a step that needs more room than the range has is never asked for. */
const casesFor = (range: Range): Case[] => CASES.filter((c) => c.step === undefined || c.step <= maxStepFor(c.skill, range))

const beatSeconds = (ex: GeneratedExercise) => 60 / ex.params.tempo
/** Seconds as beats, rounded so that two tempos can be compared. */
const inBeats = (ex: GeneratedExercise, seconds: number) => Math.round((seconds / beatSeconds(ex)) * 1000) / 1000
const endOf = (n: { time: number; duration: number }) => n.time + n.duration
const cuesOf = (ex: GeneratedExercise): VoiceCue[] => ex.chart.voice!.cues

/** The singer's turns: the scored notes, split wherever nothing is sung for two beats or more. */
function answers(ex: GeneratedExercise): ChartNote[][] {
  const out: ChartNote[][] = []
  for (const n of ex.chart.notes) {
    const turn = out[out.length - 1]
    const before = turn?.[turn.length - 1]
    if (before && inBeats(ex, n.time - endOf(before)) < 2) turn.push(n)
    else out.push([n])
  }
  return out
}

/** For each of the singer's turns, what the app sings between the turn before and this one. */
function calls(ex: GeneratedExercise): VoiceCue[][] {
  const turns = answers(ex)
  return turns.map((turn, i) => {
    const from = i === 0 ? -Infinity : endOf(turns[i - 1][turns[i - 1].length - 1])
    return cuesOf(ex).filter((c) => c.time >= from - 1e-6 && c.time < turn[0].time)
  })
}

/** The notes of a turn in semitones above the home note of the exercise. */
const fromHome = (ex: GeneratedExercise, turn: ChartNote[]) => turn.map((n) => n.midi - ex.chart.voice!.tonic)
/** ...and above the turn's own first note, for exercises that move up a key from turn to turn. */
const fromFirst = (turn: ChartNote[]) => turn.map((n) => n.midi - turn[0].midi)
const lengths = (ex: GeneratedExercise, turn: ChartNote[]) => turn.map((n) => inBeats(ex, n.duration))
/** Bars of the chart: it ends one second after its last bar, as every exercise does. */
const barsOf = (ex: GeneratedExercise) => inBeats(ex, ex.chart.duration - 1) / 4

/** Small deterministic generator of floats in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Ranges as the app stores them: 7 to 14 semitones somewhere between a low bass and a high soprano, the easy note anywhere inside. */
function randomRanges(count: number): Range[] {
  const next = lcg(20260615)
  return Array.from({ length: count }, () => {
    const span = MIN_RANGE_SPAN + Math.floor(next() * 8)
    const low = 38 + Math.floor(next() * (83 - span - 38 + 1))
    return { low, high: low + span, easy: low + Math.floor(next() * (span + 1)) }
  })
}

describe('VoiceBuilder', () => {
  const judge = { band: 80, minShare: 0.5 } as const

  it('writes notes in beats and gives each its whole length', () => {
    const b = new VoiceBuilder({ bpm: 90, title: 'Test' })
    b.cue(0, 2, 52, 'la').note(4, 1.5, 52, 'la').note(5.5, 0.5, 54)
    const chart = b.build(judge, LOWER, { tonic: 52 })
    expect(chart.notes.map((n) => [n.time, n.duration, n.midi, n.lyric])).toEqual([
      [4 * (60 / 90), 1.5 * (60 / 90), 52, 'la'],
      [5.5 * (60 / 90), 0.5 * (60 / 90), 54, undefined],
    ])
    expect(chart.voice!.cues).toEqual([{ time: 0, duration: 2 * (60 / 90), midi: 52, lyric: 'la' }])
    expect(chart.title).toBe('Test')
  })

  it('builds a chart that every part of the app written for the guitar can still read', () => {
    const b = new VoiceBuilder({ bpm: 60 })
    b.note(6, 1, 50).note(4, 2, 52).cue(0, 3, 52)
    const chart = b.build(judge, LOWER)
    // In order of time, numbered from 0, one note at a time, on a stand-in string.
    expect(chart.notes.map((n) => [n.id, n.midi, n.string, n.fret, n.chordId])).toEqual([
      [0, 52, 0, 0, 0],
      [1, 50, 0, 0, 1],
    ])
    for (const n of chart.notes) expect(n.velocity).toBeGreaterThan(0)
    expect(chart.tuning).toEqual(DEFAULT_TUNING)
    expect(chart.capo).toBe(0)
    expect(chart.tempos).toEqual([{ time: 0, bpm: 60 }])
    expect(chart.timeSignatures).toEqual([{ time: 0, numerator: 4, denominator: 4 }])
    // Two bars of four beats, then a second of quiet in which the last note can still be judged.
    expect(chart.duration).toBe(9)
    expect(chart.beats.filter((beat) => beat.time < 8).map((beat) => [beat.time, beat.bar, beat.beatInBar, beat.isDownbeat])).toEqual([
      [0, 0, 0, true], [1, 0, 1, false], [2, 0, 2, false], [3, 0, 3, false],
      [4, 1, 0, true], [5, 1, 1, false], [6, 1, 2, false], [7, 1, 3, false],
    ])
  })

  it('marks the chart as sung: how it is judged, the range, the key and where each line starts', () => {
    const b = new VoiceBuilder({ bpm: 120 })
    // Two turns, the second after three beats of rest; the gap of one beat inside the first is not a new line.
    b.cue(0, 2, 62).note(4, 1, 62).note(6, 1, 64).cue(8, 1, 65).note(10, 2, 65)
    const chart = b.build({ band: 50, minShare: 0.6, sustain: true }, HIGHER, { tonic: 62, hideAnswers: true, glide: true })
    expect(chart.voice).toEqual({
      judge: { band: 50, minShare: 0.6, sustain: true },
      cues: [
        { time: 0, duration: 1, midi: 62 },
        { time: 4, duration: 0.5, midi: 65 },
      ],
      low: 60,
      high: 67,
      tonic: 62,
      shift: 2,
      lineStarts: [2, 5],
      hideAnswers: true,
      glide: true,
    })
    // Nothing is switched on that was not asked for.
    const plain = new VoiceBuilder({ bpm: 120 }).note(0, 1, 62).build(judge, HIGHER)
    expect('hideAnswers' in plain.voice!).toBe(false)
    expect('glide' in plain.voice!).toBe(false)
    expect(plain.voice!.tonic).toBe(62)
  })

  it('starts a new line after two beats without singing, and not after less', () => {
    const b = new VoiceBuilder({ bpm: 60 })
    // Rests of 1.5, 2, 1 and 2.5 beats.
    b.note(0, 1, 50).note(2.5, 1, 50).note(5.5, 1, 52).note(7.5, 1, 52).note(11, 1, 53)
    expect(b.build(judge, LOWER).voice!.lineStarts).toEqual([0, 5.5, 11])
  })

  it('refuses a note or a cue outside the range: both ends of the range can be sung, nothing beyond', () => {
    const at = (midi: number, cue = false) => {
      const b = new VoiceBuilder({ bpm: 60 })
      if (cue) b.cue(0, 1, midi).note(4, 1, 52)
      else b.note(0, 1, midi)
      return () => b.build(judge, LOWER)
    }
    expect(at(48)).not.toThrow()
    expect(at(55)).not.toThrow()
    expect(at(47)).toThrow(/range/)
    expect(at(56)).toThrow(/range/)
    expect(at(48, true)).not.toThrow()
    expect(at(55, true)).not.toThrow()
    expect(at(47, true)).toThrow(/range/)
    expect(at(56, true)).toThrow(/range/)
  })

  it('refuses a cue that ends less than a beat before the singer comes in, or that sounds while the singer sings', () => {
    const chart = (cueBeat: number, cueBeats: number) => () => new VoiceBuilder({ bpm: 60 }).note(4, 2, 52).cue(cueBeat, cueBeats, 52).build(judge, LOWER)
    expect(chart(0, 3)).not.toThrow()
    expect(chart(0, 3.5)).toThrow(/beat/)
    expect(chart(0, 4)).toThrow(/beat/)
    // During the note, and overlapping its end.
    expect(chart(4.5, 1)).toThrow()
    expect(chart(5.5, 1)).toThrow()
    // Straight after the note is fine: the singer is resting by then.
    expect(chart(6, 1)).not.toThrow()
  })

  it('refuses two notes to sing at once', () => {
    expect(() => new VoiceBuilder({ bpm: 60 }).note(0, 2, 52).note(1, 2, 54).build(judge, LOWER)).toThrow()
    expect(() => new VoiceBuilder({ bpm: 60 }).note(0, 2, 52).note(2, 2, 54).build(judge, LOWER)).not.toThrow()
  })

  it('refuses a round of more than 8 bars, whether it is the singer or the app that sings into the ninth', () => {
    const upTo = (beat: number, beats: number) => () => new VoiceBuilder({ bpm: 60 }).cue(0, 2, 52).note(beat, beats, 52).build(judge, LOWER)
    // The last beat of bar 8 is the last there is.
    expect(upTo(31, 1)).not.toThrow()
    expect(upTo(28, 4)).not.toThrow()
    expect(upTo(32, 1)).toThrow(/8 bars/)
    expect(upTo(31, 1.5)).toThrow(/8 bars/)
    expect(() => new VoiceBuilder({ bpm: 60 }).note(4, 2, 52).cue(32, 1, 52).build(judge, LOWER)).toThrow(/8 bars/)
    // Bars are counted in the builder's own time: eight bars of three beats end at beat 24.
    const waltz = (beat: number) => () => new VoiceBuilder({ bpm: 60, beatsPerBar: 3 }).note(beat, 1, 52).build(judge, LOWER)
    expect(waltz(23)).not.toThrow()
    expect(waltz(24)).toThrow(/8 bars/)
  })

  it('refuses a note that starts before the round does, or that has no place in time at all', () => {
    expect(() => new VoiceBuilder({ bpm: 60 }).note(-1, 1, 52).build(judge, LOWER)).toThrow()
    expect(() => new VoiceBuilder({ bpm: 60 }).note(Number.NaN, 1, 52).build(judge, LOWER)).toThrow()
    expect(() => new VoiceBuilder({ bpm: 60 }).note(0, Number.NaN, 52).build(judge, LOWER)).toThrow()
    expect(() => new VoiceBuilder({ bpm: 60 }).note(0, 1, Number.NaN).build(judge, LOWER)).toThrow(/range/)
    expect(() => new VoiceBuilder({ bpm: 60 }).note(4, 1, 52).cue(-0.5, 1, 52).build(judge, LOWER)).toThrow()
  })
})

describe('the parts every generator is made of', () => {
  it('measure a line up to the end of its last note: a rest at the end takes no room, a rest in the middle does', () => {
    expect(beatsOf([[0, 1], [null, 2], [4, 1]])).toBe(4)
    expect(beatsOf([[0, 1], [null, 3]])).toBe(1)
    expect(beatsOf([[null, 2], [0, 1]])).toBe(3)
    // Nothing to sing is no length at all, not a crash.
    expect(beatsOf([[null, 4]])).toBe(0)
    expect(beatsOf([])).toBe(0)
  })

  it('count the bars of a turn: the call with its silent beat, then the answer, and a fourth bar for a turn of three', () => {
    // A call of three beats and its silent beat fill one bar; an answer of four beats fills the next.
    expect(turnBars({ call: [[0, 3]], answer: [[0, 4]] })).toBe(2)
    // A call that leaves no beat free in its bar takes the next bar too.
    expect(turnBars({ call: [[0, 4]], answer: [[0, 4]] })).toBe(4)
    expect(turnBars({ call: [[0, 3.5]], answer: [[0, 3]] })).toBe(4)
    // One bar and two bars are three: a fourth is added, and four stay four.
    expect(turnBars({ call: [[0, 3]], answer: [[0, 4.5]] })).toBe(4)
    expect(turnBars({ call: [[0, 7]], answer: [[0, 8]] })).toBe(4)
    expect(turnBars({ call: [[0, 2]], answer: [[0, 10], [null, 10], [0, 3]] })).toBe(7)
    // A rest at the end of an answer does not make the turn longer.
    expect(turnBars({ call: [[0, 3]], answer: [[0, 4], [null, 4]] })).toBe(2)
  })

  it('fit whole turns into the bars asked for: never more than 8 bars of them, and always one', () => {
    expect(turnsThatFit(8, 2)).toBe(4)
    expect(turnsThatFit(7, 2)).toBe(3)
    expect(turnsThatFit(4, 4)).toBe(1)
    expect(turnsThatFit(32, 2)).toBe(4)
    expect(turnsThatFit(4, 7)).toBe(1)
    expect(turnsThatFit(0, 2)).toBe(1)
  })

  it('take the next items of a list each day and start again at its end; an empty list gives nothing', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f']
    expect([0, 1, 2, 3].map((day) => takeFor(list, 4, day).join(''))).toEqual(['abcd', 'efab', 'cdef', 'abcd'])
    expect([0, 1, 2].map((day) => takeFor(list, 2, day).join(''))).toEqual(['ab', 'cd', 'ef'])
    // As many as the list holds: the same ones each day, in an order that moves on.
    expect([0, 1].map((day) => takeFor(['a', 'b', 'c'], 3, day).join(''))).toEqual(['abc', 'bca'])
    expect(takeFor(list, 0, 3)).toEqual([])
    expect(takeFor([], 3, 2)).toEqual([])
  })

  it('name the notes of the scale by number and every note between them "la"', () => {
    expect([0, 2, 4, 5, 7, 9, 11, 12].map(numberOf)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    for (const offset of [1, 3, 6, 8, 10, -1, -2, 13, 14, 0.5]) expect(numberOf(offset), String(offset)).toBe('la')
  })
})

describe('the registry', () => {
  it('holds the four sung generators under their own ids', () => {
    for (const id of ['voiceEcho', 'voiceHold', 'voicePattern', 'voiceSlide']) {
      expect(Object.hasOwn(GENERATORS, id), id).toBe(true)
      expect(GENERATORS[id].id).toBe(id)
      expect(resolveGeneratorId(id)).toBe(id)
    }
  })

  it('throws for a sung exercise it does not know, and never hands out a guitar melody in its place', () => {
    for (const id of ['voiceWhistle', 'voice', 'voice.pattern', 'voicepattern']) {
      expect(() => resolveGeneratorId(id), id).toThrow(/voice/i)
      expect(() => getGenerator(id), id).toThrow()
      expect(() => generateExercise(skillOf('voice.pitch.match'), id, { tempo: 60, bars: 4 }, DEFAULT_TUNING), id).toThrow()
      expect(() => exerciseParams(skillOf('voice.pitch.match'), id, 60), id).toThrow()
    }
    // A guitar id without a generator still gets the stand-in it always got.
    expect(resolveGeneratorId('someFutureDrill')).toBe('melody')
    expect(getGenerator('someFutureDrill').id).toBe('melody')
  })
})

describe('every sung exercise', () => {
  it('is built for every skill and step, with the plain facts an exercise carries', () => {
    for (const c of CASES) {
      const ex = build(c.skill, WIDE, stepOver(c))
      expect(ex.generatorId, c.name).toBe(c.skill.generators[0])
      expect(ex.skillId, c.name).toBe(c.skill.id)
      expect(ex.id.startsWith(`${ex.generatorId}:`), c.name).toBe(true)
      expect(ex.interaction, c.name).toBe('highway')
      expect(ex.backing, c.name).toBeNull()
      expect(ex.backingSampleRate, c.name).toBe(BACKING_SAMPLE_RATE)
      expect(ex.params.tempo, c.name).toBe(c.skill.startTempo)
      expect(ex.chart.notes.length, c.name).toBeGreaterThan(0)
      expect(ex.chart.voice, c.name).toBeDefined()
      expect(ex.chart.tempos[0].bpm, c.name).toBe(c.skill.startTempo)
    }
  })

  it('is the same exercise every time it is asked for in the same way', () => {
    for (const c of CASES) {
      const over = { ...stepOver(c), seed: 3 }
      const a = build(c.skill, WIDE, over)
      const b = build(c.skill, { ...WIDE }, { ...over })
      expect(b.id, c.name).toBe(a.id)
      expect(b.chart, c.name).toEqual(a.chart)
      expect(b.params, c.name).toEqual(a.params)
      expect(b.title, c.name).toBe(a.title)
    }
  })

  it('has an id that changes with the range, the easy note, the step, the tempo, the length and the day', () => {
    for (const skill of VOICE_SKILLS) {
      const base = build(skill, WIDE, { bars: 8, seed: 0, ...(skill.steps ? { step: 0 } : {}) })
      const others: [string, GeneratedExercise][] = [
        ['low', build(skill, { ...WIDE, low: WIDE.low + 1 }, { bars: 8, seed: 0, ...(skill.steps ? { step: 0 } : {}) })],
        ['high', build(skill, { ...WIDE, high: WIDE.high - 1 }, { bars: 8, seed: 0, ...(skill.steps ? { step: 0 } : {}) })],
        ['easy', build(skill, { ...WIDE, easy: WIDE.easy + 1 }, { bars: 8, seed: 0, ...(skill.steps ? { step: 0 } : {}) })],
        ['tempo', build(skill, WIDE, { bars: 8, seed: 0, tempo: skill.startTempo + 4, ...(skill.steps ? { step: 0 } : {}) })],
        ['bars', build(skill, WIDE, { bars: 4, seed: 0, ...(skill.steps ? { step: 0 } : {}) })],
        ['seed', build(skill, WIDE, { bars: 8, seed: 1, ...(skill.steps ? { step: 0 } : {}) })],
      ]
      if (skill.steps) others.push(['step', build(skill, WIDE, { bars: 8, seed: 0, step: 1 })])
      for (const [what, other] of others) expect(other.id, `${skill.id}: ${what}`).not.toBe(base.id)
    }
  })

  it('has an id no other exercise has: two skills built by one generator from the same params are two exercises', () => {
    // "Match a note" and "Stay in tune on your own" share a generator, a tempo and, on equal steps,
    // every param. What is sung is in the skill's ladder, so the skill has to be part of the id.
    for (const range of [LOWER, WIDE]) {
      const ids = new Map<string, string>()
      for (const c of casesFor(range)) {
        // One tempo for all of them: the worst case, where nothing but the skill tells two apart.
        const ex = build(c.skill, range, { ...stepOver(c), tempo: 60, bars: 8, seed: 0 })
        expect(ids.get(ex.id), `${c.name} and ${ids.get(ex.id)}`).toBeUndefined()
        ids.set(ex.id, c.name)
      }
    }
    const match = build(skillOf('voice.pitch.match'), LOWER, { step: 1 })
    const alone = build(skillOf('voice.pitch.alone'), LOWER, { step: 1 })
    expect({ ...match.params }).toEqual({ ...alone.params })
    expect(match.chart.notes).not.toEqual(alone.chart.notes)
    expect(match.id).not.toBe(alone.id)
  })

  it('is the same exercise when it is built again from the params it returned, as a run stores them', () => {
    const again = (ex: GeneratedExercise, skill: SkillDef, where: string) => {
      // Straight from the stored params, and through the defaults as the Coach does.
      for (const params of [ex.params, exerciseParams(skill, ex.generatorId, ex.params.tempo, ex.params)]) {
        const rebuilt = generateExercise(skill, ex.generatorId, params, DEFAULT_TUNING)
        expect(rebuilt.id, where).toBe(ex.id)
        expect(rebuilt.params, where).toEqual(ex.params)
        expect(rebuilt.chart, where).toEqual(ex.chart)
        expect(rebuilt.difficulty, where).toBe(ex.difficulty)
      }
    }
    for (const range of [LOWER, HIGHER, WIDE]) {
      for (const c of casesFor(range)) again(build(c.skill, range, { ...stepOver(c), seed: 2 }), c.skill, c.name)
    }
    // Also where the exercise is not what was asked: no range given, and a step the range has no room for.
    for (const skill of VOICE_SKILLS) again(build(skill, null), skill, `${skill.id} without a range`)
    for (const id of ['voice.range.slides', 'voice.interval.leaps']) {
      const skill = skillOf(id)
      const lowered = build(skill, LOWER, { step: skill.steps!.length - 1, startStep: skill.steps!.length - 1 })
      expect(lowered.params.step, id).toBe(1)
      again(lowered, skill, `${id} lowered`)
    }
  })

  it('reads a step, a limit, a length or a day from a damaged record without leaving the ladder, the range or the 8 bars', () => {
    const odd: unknown[] = ['2', 1.7, Number.NaN, -1, 99, null, undefined, Number.POSITIVE_INFINITY, true, {}]
    const range = { low: 48, high: 62, easy: 55 }
    let built = 0
    for (const skill of VOICE_SKILLS) {
      const last = (skill.steps?.length ?? 1) - 1
      const check = (over: Record<string, unknown>) => {
        const where = `${skill.id} with ${JSON.stringify(over)}`
        const ex = build(skill, range, over as Partial<ExerciseParams>)
        for (const n of [...ex.chart.notes, ...cuesOf(ex)]) expect(n.midi >= range.low && n.midi <= range.high && Number.isFinite(n.time) && n.duration > 0, where).toBe(true)
        expect(ex.chart.notes.length, where).toBeGreaterThan(0)
        expect(barsOf(ex), where).toBeLessThanOrEqual(8)
        if (skill.steps) {
          expect(Number.isInteger(ex.params.step), where).toBe(true)
          expect(ex.params.step as number, where).toBeGreaterThanOrEqual(0)
          expect(ex.params.step as number, where).toBeLessThanOrEqual(last)
          expect(ex.title, where).toContain(skill.steps[ex.params.step as number].label)
        }
        built++
        return ex
      }
      for (const step of odd) for (const maxStep of odd) check({ step, maxStep })
      for (const bars of [...odd, 0, 2.5, '8']) check({ bars })
      for (const seed of [...odd, 'monday', '', 1e9, -3, 2.5]) check({ seed })
      if (skill.steps) {
        // A step that is not a whole number is the whole step below it; one that is no number at all is the first.
        expect(check({ step: 1.7 }).params.step, skill.id).toBe(1)
        expect(check({ step: '2' }).params.step, skill.id).toBe(0)
        // A limit that is no number is no limit.
        expect(check({ step: last, maxStep: 'x' }).params.step, skill.id).toBe(last)
        expect(check({ step: last, maxStep: 0 }).params.step, skill.id).toBe(0)
      }
    }
    expect(built).toBeGreaterThan(1000)
  })

  it('takes a range from a damaged record as no range at all, never as half of one', () => {
    const match = skillOf('voice.pitch.match')
    for (const range of [{ low: 60 }, { high: 67 }, { low: '60', high: 67 }, { low: null, high: null }, { low: Number.NaN, high: 67 }] as unknown as Partial<Range>[]) {
      const ex = build(match, range)
      expect([ex.params.low, ex.params.high, ex.params.easy], JSON.stringify(range)).toEqual([LOWER.low, LOWER.high, LOWER.easy])
    }
    // An easy note that is no number is the middle of the range.
    for (const easy of [null, 'x', Number.NaN, undefined] as unknown as number[]) expect(build(match, { low: 60, high: 67, easy }).params.easy, String(easy)).toBe(63)
  })

  it('stays inside a range wider than any the app stores, wherever the easy note is said to be, on any day', () => {
    const ranges: Range[] = [
      { low: 40, high: 64, easy: 52 },
      { low: 40, high: 64, easy: 40 },
      { low: 40, high: 64, easy: 64 },
      { low: 36, high: 86, easy: 60 },
      { low: 48, high: 55, easy: 0 },
      { low: 48, high: 55, easy: 200 },
      { low: 48, high: 60, easy: 60 },
      { low: 48, high: 61, easy: 48 },
    ]
    for (const range of ranges) {
      for (const c of casesFor(range)) {
        for (const seed of [0, 5, 6, 11, 23, 1e9, 'monday'] as unknown as number[]) {
          for (const bars of [4, 8]) {
            const ex = build(c.skill, range, { ...stepOver(c), bars, seed })
            const where = `${c.name} in ${range.low}-${range.high} (easy ${range.easy}), day ${seed}`
            for (const n of [...ex.chart.notes, ...cuesOf(ex)]) expect(Number.isInteger(n.midi) && n.midi >= range.low && n.midi <= range.high, `${where}: ${n.midi}`).toBe(true)
            // The easy note recorded is one the voice has.
            expect((ex.params.easy as number) >= range.low && (ex.params.easy as number) <= range.high, where).toBe(true)
            if (c.step !== undefined) expect(ex.params.step, where).toBe(c.step)
          }
        }
      }
    }
  })

  it('records the range it was built for, so a run says which notes were asked', () => {
    for (const c of CASES) {
      for (const range of [LOWER, HIGHER]) {
        if (c.step !== undefined && c.step > maxStepFor(c.skill, range)) continue
        const ex = build(c.skill, range, stepOver(c))
        expect([ex.params.low, ex.params.high, ex.params.easy], c.name).toEqual([range.low, range.high, range.easy])
        expect([ex.chart.voice!.low, ex.chart.voice!.high], c.name).toEqual([range.low, range.high])
      }
    }
  })

  it('keeps every note and every cue inside the range, both ends included, for 30 ranges', () => {
    const ranges = randomRanges(30)
    expect(ranges.some((r) => r.high - r.low === MIN_RANGE_SPAN)).toBe(true)
    expect(ranges.some((r) => r.high - r.low >= 12)).toBe(true)
    expect(ranges.some((r) => r.easy === r.low || r.easy === r.high)).toBe(true)
    let built = 0
    for (const range of ranges) {
      for (const c of casesFor(range)) {
        for (const bars of [4, 8]) {
          for (const seed of [0, 1, 2, 3, 4, 7]) {
            const ex = build(c.skill, range, { ...stepOver(c), bars, seed })
            const where = `${c.name} in ${range.low}-${range.high} (easy ${range.easy}), ${bars} bars, day ${seed}`
            for (const n of [...ex.chart.notes, ...cuesOf(ex)]) {
              expect(Number.isInteger(n.midi), where).toBe(true)
              if (n.midi < range.low || n.midi > range.high) throw new Error(`${where}: note ${n.midi} is outside the range`)
            }
            built++
          }
        }
      }
    }
    expect(built).toBeGreaterThan(5000)
  })

  it('uses the very top and the very bottom of a range that an exercise fills', () => {
    // Five notes up and back span seven semitones: in the smallest range that is every note the voice has.
    for (const range of [LOWER, HIGHER, easyRange(57)]) {
      const midis = build(skillOf('voice.pitch.five-note'), range).chart.notes.map((n) => n.midi)
      expect([Math.min(...midis), Math.max(...midis)]).toEqual([range.low, range.high])
    }
    // An octave slide in a range of exactly an octave.
    const octave = { low: 50, high: 62, easy: 55 }
    const slide = build(skillOf('voice.range.slides'), octave, { step: 2 }).chart.notes.map((n) => n.midi)
    expect([Math.min(...slide), Math.max(...slide)]).toEqual([50, 62])
  })

  it('builds the first step of every skill inside both starting ranges and inside the smallest range around any easy note', () => {
    const ranges = [LOWER, HIGHER, ...[40, 47, 52, 58, 64, 69, 76].map((easy) => easyRange(easy))]
    for (const range of ranges) {
      expect(range.high - range.low).toBe(MIN_RANGE_SPAN)
      for (const skill of VOICE_SKILLS) {
        const ex = build(skill, range, skill.steps ? { step: 0 } : {})
        for (const n of [...ex.chart.notes, ...cuesOf(ex)]) expect(n.midi >= range.low && n.midi <= range.high, `${skill.id} in ${range.low}-${range.high}: ${n.midi}`).toBe(true)
        if (skill.steps) expect(ex.params.step, skill.id).toBe(0)
      }
    }
  })

  it('builds every step a range has room for, as that step', () => {
    for (const span of [7, 8, 9, 11, 12, 14]) {
      const range = { low: 50, high: 50 + span, easy: 53 }
      for (const skill of VOICE_SKILLS.filter((s) => s.steps)) {
        skill.steps!.forEach((step, i) => {
          if ((step.span ?? 0) > span) return
          const ex = build(skill, range, { step: i, startStep: i })
          expect(ex.params.step, `${skill.id} step ${i} in ${span} semitones`).toBe(i)
          expect(ex.title, skill.id).toContain(step.label)
          for (const n of [...ex.chart.notes, ...cuesOf(ex)]) expect(n.midi >= range.low && n.midi <= range.high, `${skill.id} step ${i} in ${span} semitones: ${n.midi}`).toBe(true)
        })
      }
    }
  })

  it('sings the highest step the range can hold when a step is asked that it cannot, and says so', () => {
    // A plan made in the morning, and a range made smaller since: the octave slide no longer fits.
    const slides = skillOf('voice.range.slides')
    const asked = build(slides, LOWER, { step: 2, startStep: 2 })
    const fits = build(slides, LOWER, { step: 1, startStep: 2, maxStep: 1 })
    expect(asked.chart).toEqual(fits.chart)
    expect(asked.params.step).toBe(1)
    // The run carries the limit, because the rating reads it there.
    expect(asked.params.maxStep).toBe(1)
    expect(asked.difficulty).toBe(itemDifficulty(slides, { tempo: slides.refTempo, bonus: slides.steps![1].bonus }))
    expect(asked.title).toContain(slides.steps![1].label)
    // A limit stored with the block holds even when the range has grown since.
    const held = build(slides, WIDE, { step: 2, maxStep: 1 })
    expect([held.params.step, held.params.maxStep]).toEqual([1, 1])
    // A step past the end of the ladder is its last step.
    expect(build(slides, WIDE, { step: 9 }).params.step).toBe(2)
    expect(build(slides, WIDE, { step: -3 }).params.step).toBe(0)
  })

  it('leaves the step, the step the block started on and the limit as the plan gave them when they hold', () => {
    const hold = skillOf('voice.pitch.hold')
    const ex = build(hold, LOWER, { step: 2, startStep: 1 })
    expect([ex.params.step, ex.params.startStep]).toEqual([2, 1])
    expect('maxStep' in ex.params).toBe(false)
    const leaps = skillOf('voice.interval.leaps')
    const limited = build(leaps, LOWER, { step: 1, startStep: 0, maxStep: 1 })
    expect([limited.params.step, limited.params.startStep, limited.params.maxStep]).toEqual([1, 0, 1])
    // Other things a block stores travel with the run untouched.
    const kept = build(hold, LOWER, { step: 0, startTempo: 60, maxTempo: 60, minTempo: 60, seed: 4 })
    expect(kept.params).toMatchObject({ startTempo: 60, maxTempo: 60, minTempo: 60, seed: 4, bars: 8, tempo: 60 })
  })

  it('lets a step decide what is sung: params passed beside it cannot turn it into another step', () => {
    const hold = skillOf('voice.pitch.hold')
    const ex = build(hold, LOWER, { step: 1, beats: 2, band: 80 })
    expect(lengths(ex, ex.chart.notes)).toEqual([6, 6])
    expect(ex.chart.voice!.judge.band).toBe(50)
    expect(ex.chart).toEqual(build(hold, LOWER, { step: 1 }).chart)
    const match = skillOf('voice.pitch.match')
    expect(build(match, LOWER, { step: 0, form: 'tune', pool: 'range', cueBeats: 1 }).chart).toEqual(build(match, LOWER, { step: 0 }).chart)
  })

  it('falls back to the lower starting range when no range is given, and says which notes it used', () => {
    for (const skill of VOICE_SKILLS) {
      const ex = build(skill, null)
      expect([ex.params.low, ex.params.high, ex.params.easy], skill.id).toEqual([LOWER.low, LOWER.high, LOWER.easy])
      expect(ex.chart, skill.id).toEqual(build(skill, LOWER).chart)
    }
    // The defaults themselves name no range: a stored task must not carry one that is not the singer's.
    for (const skill of VOICE_SKILLS) {
      const defaults = getGenerator(skill.generators[0]).defaults(skill, skill.startTempo)
      for (const key of ['low', 'high', 'easy']) expect(key in defaults, `${skill.id}: ${key}`).toBe(false)
    }
  })

  it('reads a range with fractions inwards, moves an easy note inside it, and refuses a range that is too small to sing in', () => {
    const match = skillOf('voice.pitch.match')
    const ex = build(match, { low: 47.5, high: 55.5, easy: 80 })
    expect([ex.params.low, ex.params.high, ex.params.easy]).toEqual([48, 55, 55])
    expect(build(match, { low: 48, high: 55 }).params.easy).toBe(51)
    expect(() => build(match, { low: 50, high: 56, easy: 52 })).toThrow(/range/i)
    expect(() => build(match, { low: 60, high: 50, easy: 55 })).toThrow(/range/i)
  })

  it('never lasts more than 8 bars, however many are asked for, and never more than asked while one turn fits', () => {
    for (const c of CASES) {
      const lengthAt = (bars: number) => barsOf(build(c.skill, WIDE, { ...stepOver(c), bars }))
      for (const bars of [1, 2, 3, 4, 6, 8, 16, 32]) {
        const built = lengthAt(bars)
        expect(Number.isInteger(built), `${c.name}, ${bars} bars`).toBe(true)
        expect(built, `${c.name}, ${bars} bars`).toBeGreaterThanOrEqual(1)
        expect(built, `${c.name}, ${bars} bars`).toBeLessThanOrEqual(8)
      }
      // One whole call and answer is the least there is, and it is the same however few bars were asked.
      const one = lengthAt(1)
      for (const bars of [4, 8]) if (bars >= one) expect(lengthAt(bars), `${c.name}, ${bars} bars`).toBeLessThanOrEqual(bars)
      expect(lengthAt(16), c.name).toBe(lengthAt(8))
      expect(lengthAt(8), c.name).toBeGreaterThanOrEqual(lengthAt(4))
    }
  })

  it('ends on the bar its last note is in, with no empty bar to wait through', () => {
    for (const c of CASES) {
      for (const bars of [4, 8]) {
        const ex = build(c.skill, WIDE, { ...stepOver(c), bars })
        const last = ex.chart.notes[ex.chart.notes.length - 1]
        expect(barsOf(ex), `${c.name}, ${bars} bars`).toBe(Math.ceil(inBeats(ex, endOf(last)) / 4))
        // The last note can still be judged: the chart goes on for a moment after it.
        expect(ex.chart.duration - endOf(last), c.name).toBeGreaterThanOrEqual(0.5)
      }
    }
  })

  it('is the same written notes at any tempo', () => {
    for (const c of CASES) {
      const written = (tempo: number) => {
        const ex = build(c.skill, WIDE, { ...stepOver(c), tempo })
        return [ex.chart.notes.map((n) => [inBeats(ex, n.time), inBeats(ex, n.duration), n.midi]), cuesOf(ex).map((n) => [inBeats(ex, n.time), inBeats(ex, n.duration), n.midi])]
      }
      expect(written(c.skill.targetTempo + 7), c.name).toEqual(written(c.skill.minTempo!))
    }
  })

  it('changes key or notes from day to day, and is the same all day', () => {
    for (const c of CASES) {
      const notesOn = (seed: number | undefined) => build(c.skill, WIDE, { ...stepOver(c), ...(seed === undefined ? {} : { seed }) }).chart.notes.map((n) => n.midi).join(' ')
      const days = [0, 1, 2, 3, 4].map(notesOn)
      expect(new Set(days).size, c.name).toBeGreaterThan(1)
      // No seed is day 0.
      expect(notesOn(undefined), c.name).toBe(days[0])
    }
  })
})

/**
 * What each exercise looks like when split into the singer's turns: how many notes each turn has, for
 * a round of 8 bars and for a round of 4. Written out by hand from docs/SINGING.md §6.
 */
const TURNS: Record<string, { eight: number[]; four: number[] }[]> = {
  // One note every two bars: listen for a bar, sing for a bar.
  'voice.pitch.match': [0, 1, 2, 3].map(() => ({ eight: [1, 1, 1, 1], four: [1, 1] })),
  // 1-2-3-2-1, called over two bars and answered over two.
  'voice.pitch.steps': [{ eight: [5, 5], four: [5] }],
  'voice.pitch.five-note': [{ eight: [9, 9], four: [9] }],
  // A 4-beat note fits a bar; a 6 or 8 beat note takes two, after a bar of listening.
  'voice.pitch.hold': [{ eight: [1, 1, 1, 1], four: [1, 1] }, { eight: [1, 1], four: [1] }, { eight: [1, 1], four: [1] }, { eight: [1, 1], four: [1] }],
  // Home, top, home: the three notes a slide starts, turns and ends on.
  'voice.range.slides': [0, 1, 2].map(() => ({ eight: [3, 3], four: [3] })),
  'voice.pitch.echo': [3, 4, 5].map((notes) => ({ eight: [notes, notes, notes, notes], four: [notes, notes] })),
  'voice.interval.thirds': [{ eight: [5, 5, 5, 5], four: [5, 5] }],
  // 1-3-5-8-5-3-1 where the range holds an octave.
  'voice.interval.triad': [{ eight: [7, 7], four: [7] }],
  // The five-note scale once, then twice in one breath.
  'voice.breath.phrases': [{ eight: [9, 9], four: [9] }, { eight: [17, 17], four: [17] }, { eight: [17, 17], four: [17] }],
  'voice.interval.leaps': [0, 1, 2, 3].map(() => ({ eight: [3, 3, 3, 3], four: [3, 3] })),
  'voice.pitch.runs': [{ eight: [13, 13], four: [13] }],
  // The scale; from the second step on, the home note once more after the silence. That takes seven bars.
  'voice.pitch.alone': [{ eight: [9, 9], four: [9] }, { eight: [9, 1], four: [9, 1] }, { eight: [9, 1], four: [9, 1] }],
}

describe('time to breathe', () => {
  it('follows every turn of the singer by at least two beats without singing', () => {
    // Split at rests of two beats, the notes fall into exactly the turns the exercise is meant to have:
    // were two turns closer together than that, they would come out as one.
    for (const c of CASES) {
      const shape = TURNS[c.skill.id][c.step ?? 0]
      for (const [bars, expected] of [[8, shape.eight], [4, shape.four]] as const) {
        const ex = build(c.skill, WIDE, { ...stepOver(c), bars })
        expect(answers(ex).map((turn) => turn.length), `${c.name}, ${bars} bars`).toEqual(expected)
      }
    }
  })

  it('gives a turn of three bars a fourth to rest in: after a long answer the app waits a whole bar before it sings again', () => {
    // A note held over two bars, the chord notes to the octave and back, the run of quick notes, the
    // first line on one breath: each is called in one bar and answered in two.
    const long: Case[] = CASES.filter((c) => ['voice.interval.triad', 'voice.pitch.runs'].includes(c.skill.id) || (c.skill.id === 'voice.pitch.hold' && c.step! >= 1) || (c.skill.id === 'voice.breath.phrases' && c.step === 0))
    expect(long).toHaveLength(6)
    for (const c of long) {
      const ex = build(c.skill, WIDE, { ...stepOver(c), bars: 8 })
      const [first, second] = answers(ex)
      const call = cuesOf(ex).find((cue) => cue.time > first[0].time)!
      // Both turns start on the first beat of a four-bar phrase.
      expect([inBeats(ex, cuesOf(ex)[0].time), inBeats(ex, call.time)], c.name).toEqual([0, 16])
      expect([inBeats(ex, first[0].time), inBeats(ex, second[0].time)], c.name).toEqual([4, 20])
      expect(inBeats(ex, call.time - endOf(first[first.length - 1])), c.name).toBeGreaterThanOrEqual(4)
      // The rest is between the turns, not after the last one: the round ends with its last note's bar.
      expect(barsOf(ex), c.name).toBe(7)
    }
  })

  it('marks the start of each turn as a line, in seconds', () => {
    for (const c of CASES) {
      const ex = build(c.skill, WIDE, { ...stepOver(c), tempo: c.skill.minTempo })
      expect(ex.chart.voice!.lineStarts, c.name).toEqual(answers(ex).map((turn) => turn[0].time))
    }
  })

  it('never asks for more than 8 seconds of singing in one go in the first two tiers, or 10 seconds above, at the slowest tempo of the skill', () => {
    for (const c of CASES) {
      const limit = c.skill.tier <= 1 ? 8 : 10
      for (const bars of [4, 8]) {
        const ex = build(c.skill, WIDE, { ...stepOver(c), bars, tempo: c.skill.minTempo })
        for (const turn of answers(ex)) {
          const seconds = endOf(turn[turn.length - 1]) - turn[0].time
          expect(seconds, `${c.name}: a turn of ${seconds.toFixed(2)} s`).toBeLessThanOrEqual(limit + 1e-6)
        }
      }
    }
  })

  it('never has two notes to sing at once, and never a note too short to place', () => {
    for (const c of CASES) {
      const ex = build(c.skill, WIDE, { ...stepOver(c), tempo: c.skill.targetTempo })
      const notes = ex.chart.notes
      for (let i = 1; i < notes.length; i++) expect(notes[i].time, c.name).toBeGreaterThanOrEqual(endOf(notes[i - 1]) - 1e-6)
      // The quickest thing a voice is asked for is 4.4 notes a second.
      for (const n of notes) expect(n.duration, c.name).toBeGreaterThanOrEqual(60 / 132 / 2 - 1e-6)
    }
  })
})

describe('the app sings first', () => {
  it('opens with a call from the first beat, and gives every turn its own call', () => {
    for (const c of CASES) {
      for (const bars of [4, 8]) {
        const ex = build(c.skill, WIDE, { ...stepOver(c), bars })
        expect(cuesOf(ex)[0].time, c.name).toBe(0)
        const heard = calls(ex)
        const turns = answers(ex)
        turns.forEach((turn, i) => {
          // The one turn with no call: finding the home note again after the silence.
          const unaided = c.skill.id === 'voice.pitch.alone' && turn.length === 1
          if (unaided) expect(heard[i], `${c.name}, turn ${i}`).toEqual([])
          else expect(heard[i].length, `${c.name}, turn ${i}`).toBeGreaterThan(0)
        })
        expect(heard.flat(), c.name).toEqual(cuesOf(ex))
      }
    }
  })

  it('starts every call and every answer on the first beat of a bar, so the singer comes in where the app did', () => {
    for (const c of CASES) {
      for (const bars of [4, 8]) {
        for (const tempo of [c.skill.minTempo!, c.skill.targetTempo]) {
          const ex = build(c.skill, WIDE, { ...stepOver(c), bars, tempo, seed: 3 })
          const heard = calls(ex)
          answers(ex).forEach((turn, i) => {
            expect(inBeats(ex, turn[0].time) % 4, `${c.name} at ${tempo}, turn ${i}`).toBe(0)
            if (heard[i].length > 0) expect(inBeats(ex, heard[i][0].time) % 4, `${c.name} at ${tempo}, call ${i}`).toBe(0)
          })
        }
      }
    }
  })

  it('sings the whole turn first in tiers 0 and 1', () => {
    for (const c of CASES.filter((x) => x.skill.tier <= 1)) {
      const ex = build(c.skill, WIDE, stepOver(c))
      const heard = calls(ex)
      answers(ex).forEach((turn, i) => expect(heard[i].map((cue) => cue.midi), `${c.name}, turn ${i}`).toEqual(turn.map((n) => n.midi)))
    }
  })

  it('gives only the first note from tier 2 on', () => {
    for (const c of CASES.filter((x) => x.skill.tier >= 2)) {
      const ex = build(c.skill, WIDE, stepOver(c))
      const heard = calls(ex)
      answers(ex).forEach((turn, i) => {
        if (heard[i].length === 0) return
        expect(heard[i].map((cue) => cue.midi), `${c.name}, turn ${i}`).toEqual([turn[0].midi])
      })
    }
  })

  it('stops at least a beat before the singer comes in, and is silent while the singer sings', () => {
    for (const range of [LOWER, HIGHER, WIDE]) {
      for (const c of casesFor(range)) {
        for (const bars of [4, 8]) {
          for (const tempo of [c.skill.minTempo!, c.skill.targetTempo]) {
            const ex = build(c.skill, range, { ...stepOver(c), bars, tempo })
            const beat = beatSeconds(ex)
            for (const cue of cuesOf(ex)) {
              expect(cue.duration, c.name).toBeGreaterThan(0)
              for (const n of ex.chart.notes) {
                const where = `${c.name} at ${tempo}: cue at ${cue.time.toFixed(2)}, note at ${n.time.toFixed(2)}`
                if (n.time >= cue.time) expect(n.time - endOf(cue), where).toBeGreaterThanOrEqual(beat - 1e-6)
                else expect(endOf(n), where).toBeLessThanOrEqual(cue.time + 1e-6)
              }
            }
            // One voice: the app never sings two notes at once either.
            const cues = cuesOf(ex)
            for (let i = 1; i < cues.length; i++) expect(cues[i].time, c.name).toBeGreaterThanOrEqual(endOf(cues[i - 1]) - 1e-6)
          }
        }
      }
    }
  })
})

describe('the app stops singing in good time', () => {
  it('leaves its own voice time to die away: twice what the scorer waits after a call, at every tempo a skill is sung at', () => {
    // After a call the scorer gives no credit for a moment (`VOICE.cueAfter`): the speaker and the room
    // are still sounding. A beat is a long time at 60 and a short one at 132, so the rule "one beat" is
    // also checked in seconds, where the quick skills are quickest.
    let shortest = Infinity
    for (const c of CASES) {
      for (const tempo of new Set([c.skill.minTempo!, c.skill.startTempo, c.skill.targetTempo])) {
        for (const bars of [4, 8]) {
          const ex = build(c.skill, WIDE, { ...stepOver(c), bars, tempo })
          for (const cue of cuesOf(ex)) {
            const next = ex.chart.notes.find((n) => n.time >= cue.time)
            if (!next) continue
            const quiet = next.time - endOf(cue)
            expect(quiet, `${c.name} at ${tempo}: ${quiet.toFixed(2)} s between the call and the answer`).toBeGreaterThanOrEqual(2 * VOICE.cueAfter)
            shortest = Math.min(shortest, quiet)
          }
        }
      }
    }
    // The check looked at something: the closest a call comes to its answer is a beat, in the exercises
    // that are sung at one tempo. The quick ones get two beats.
    expect(shortest).toBeLessThan(1.01)
    const runs = skillOf('voice.pitch.runs')
    const quickest = build(runs, WIDE, { tempo: runs.targetTempo })
    expect(inBeats(quickest, quickest.chart.notes[0].time - endOf(cuesOf(quickest)[0]))).toBe(2)
  })
})

describe('Match a note', () => {
  const skill = skillOf('voice.pitch.match')
  const range = { low: 50, high: 62, easy: 55 }
  const midis = (step: number, over: Partial<ExerciseParams> = {}) => build(skill, range, { step, ...over }).chart.notes.map((n) => n.midi)

  it('holds each note for three beats after hearing it for three, and for one from the last step', () => {
    for (const step of [0, 1, 2, 3]) {
      const ex = build(skill, range, { step })
      for (const n of ex.chart.notes) expect(inBeats(ex, n.duration), `step ${step}`).toBe(3)
      for (const cue of cuesOf(ex)) expect(inBeats(ex, cue.duration), `step ${step}`).toBe(step === 3 ? 1 : 3)
      // Listen for a bar, sing for a bar.
      expect(ex.chart.notes.map((n) => inBeats(ex, n.time)), `step ${step}`).toEqual([4, 12, 20, 28])
      expect(cuesOf(ex).map((cue) => inBeats(ex, cue.time)), `step ${step}`).toEqual([0, 8, 16, 24])
    }
  })

  it('starts with four notes within two semitones of the easy note, then four within four', () => {
    const close = midis(0)
    expect(new Set(close).size).toBe(4)
    expect(close[0]).toBe(range.easy)
    for (const m of close) expect(Math.abs(m - range.easy)).toBeLessThanOrEqual(2)
    const wider = midis(1)
    expect(new Set(wider).size).toBe(4)
    for (const m of wider) expect(Math.abs(m - range.easy)).toBeLessThanOrEqual(4)
    expect(Math.max(...wider.map((m) => Math.abs(m - range.easy)))).toBeGreaterThan(2)
  })

  it('then goes over the whole range: six notes from the bottom to the top, four of them a round, all six within three days', () => {
    for (const step of [2, 3]) {
      const sung = new Set([0, 1, 2].flatMap((seed) => midis(step, { seed })))
      expect(sung.size, `step ${step}`).toBe(6)
      expect(Math.min(...sung), `step ${step}`).toBe(range.low)
      expect(Math.max(...sung), `step ${step}`).toBe(range.high)
      expect(new Set(midis(step)).size, `step ${step}`).toBe(4)
    }
  })

  it('is judged more closely step by step', () => {
    expect([0, 1, 2, 3].map((step) => build(skill, range, { step }).chart.voice!.judge)).toEqual([
      { band: 80, minShare: 0.5 },
      { band: 65, minShare: 0.5 },
      { band: 50, minShare: 0.5 },
      { band: 35, minShare: 0.5 },
    ])
  })
})

describe('Hold a note steady', () => {
  const skill = skillOf('voice.pitch.hold')

  it('holds notes 1, 3 and 5 of one key for 4, 6 and 8 beats, each to its end', () => {
    for (const [step, beats] of [[0, 4], [1, 6], [2, 8], [3, 8]] as const) {
      for (const seed of [0, 1, 2, 3]) {
        const ex = build(skill, LOWER, { step, seed })
        expect(lengths(ex, ex.chart.notes), `step ${step}`).toEqual(ex.chart.notes.map(() => beats))
        for (const offset of fromHome(ex, ex.chart.notes)) expect([0, 4, 7], `step ${step}, day ${seed}`).toContain(offset)
        expect(ex.chart.voice!.judge.sustain, `step ${step}`).toBe(true)
      }
    }
    // Over a few days all three notes are held, also on the long steps with two notes a round.
    const held = new Set([0, 1, 2, 3].flatMap((seed) => fromHome(build(skill, LOWER, { step: 2, seed }), build(skill, LOWER, { step: 2, seed }).chart.notes)))
    expect([...held].sort((a, b) => a - b)).toEqual([0, 4, 7])
  })

  it('is judged as the ladder says', () => {
    expect([0, 1, 2, 3].map((step) => build(skill, LOWER, { step }).chart.voice!.judge.band)).toEqual([65, 50, 50, 35])
  })
})

describe('Slides', () => {
  const skill = skillOf('voice.range.slides')

  it('goes from home to the top and back, with the glide left unscored between the three notes', () => {
    for (const [step, top] of [[0, 4], [1, 7], [2, 12]] as const) {
      const ex = build(skill, WIDE, { step })
      expect(ex.chart.voice!.glide, `step ${step}`).toBe(true)
      for (const turn of answers(ex)) {
        expect(fromFirst(turn), `step ${step}`).toEqual([0, top, 0])
        // Room to slide: nothing is scored for a beat between one note and the next.
        expect(inBeats(ex, turn[1].time - endOf(turn[0])), `step ${step}`).toBeGreaterThanOrEqual(1)
        expect(inBeats(ex, turn[2].time - endOf(turn[1])), `step ${step}`).toBeGreaterThanOrEqual(1)
      }
    }
    expect([0, 1, 2].map((step) => build(skill, WIDE, { step }).chart.voice!.judge.band)).toEqual([80, 80, 65])
  })

  it('starts a little higher the second time where the range has room, and stays put where it has none', () => {
    const homes = (range: Range, step: number) => answers(build(skill, range, { step })).map((turn) => turn[0].midi)
    const [first, second] = homes(WIDE, 0)
    expect(second).toBe(first + 1)
    // To the fifth in a range of a fifth: there is one place for it.
    expect(homes(LOWER, 1)).toEqual([LOWER.low, LOWER.low])
  })
})

describe('Echo a short tune', () => {
  const skill = skillOf('voice.pitch.echo')

  it('hides the notes to sing until they are judged; no other exercise does', () => {
    for (const c of CASES) expect(build(c.skill, WIDE, stepOver(c)).chart.voice!.hideAnswers === true, c.name).toBe(c.skill.id === 'voice.pitch.echo')
  })

  it('sings tunes of 3 notes from 1-2-3, then 4 notes with the 5, then 5 notes with a jump, each within three beats', () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      for (const step of [0, 1, 2]) {
        const ex = build(skill, LOWER, { step, seed })
        const turns = answers(ex)
        const where = `step ${step}, day ${seed}`
        // Four different tunes a round.
        expect(new Set(turns.map((turn) => fromHome(ex, turn).join(','))).size, where).toBe(4)
        for (const turn of turns) {
          const offsets = fromHome(ex, turn)
          expect(inBeats(ex, endOf(turn[turn.length - 1]) - turn[0].time), where).toBeLessThanOrEqual(3)
          // No note twice in a row: a repeated note would be heard as one.
          for (let i = 1; i < offsets.length; i++) expect(offsets[i], where).not.toBe(offsets[i - 1])
          if (step === 0) for (const o of offsets) expect([0, 2, 4], where).toContain(o)
          if (step === 1) {
            for (const o of offsets) expect([0, 2, 4, 7], where).toContain(o)
            expect(offsets, where).toContain(7)
          }
          if (step === 2) {
            for (const o of offsets) expect([0, 2, 4, 5, 7], where).toContain(o)
            const widest = Math.max(...offsets.slice(1).map((o, i) => Math.abs(o - offsets[i])))
            expect(widest, where).toBeGreaterThanOrEqual(5)
          }
        }
      }
    }
    expect([0, 1, 2].map((step) => build(skill, LOWER, { step }).chart.voice!.judge.band)).toEqual([80, 65, 50])
  })
})

describe('Stay in tune on your own', () => {
  const skill = skillOf('voice.pitch.alone')

  it('gives one note, then the scale is sung over clicks alone', () => {
    const ex = build(skill, LOWER, { step: 0 })
    const turns = answers(ex)
    expect(cuesOf(ex)).toHaveLength(turns.length)
    for (const turn of turns) expect(fromFirst(turn)).toEqual([0, 2, 4, 5, 7, 5, 4, 2, 0])
  })

  it('from the second step waits two silent bars and then asks for the home note again, without help', () => {
    for (const step of [1, 2]) {
      const ex = build(skill, LOWER, { step })
      const [scale, again] = answers(ex)
      expect(cuesOf(ex), `step ${step}`).toHaveLength(1)
      expect(fromHome(ex, scale), `step ${step}`).toEqual([0, 2, 4, 5, 7, 5, 4, 2, 0])
      expect(again.map((n) => n.midi), `step ${step}`).toEqual([ex.chart.voice!.tonic])
      expect(inBeats(ex, again[0].time - endOf(scale[scale.length - 1])), `step ${step}`).toBeGreaterThanOrEqual(8)
      expect(inBeats(ex, again[0].time) % 4, `step ${step}`).toBe(0)
    }
    expect([0, 1, 2].map((step) => build(skill, LOWER, { step }).chart.voice!.judge.band)).toEqual([50, 50, 35])
  })
})

describe('the patterns', () => {
  const written = (id: string, range: Range, over: Partial<ExerciseParams> = {}) => {
    const ex = build(skillOf(id), range, over)
    return answers(ex).map((turn) => ({ notes: fromFirst(turn), beats: lengths(ex, turn) }))
  }
  const eighths = (count: number) => Array.from({ length: count }, () => 0.5)

  it('Step up and down is 1-2-3-2-1 in quarter notes', () => {
    for (const turn of written('voice.pitch.steps', LOWER)) expect(turn).toEqual({ notes: [0, 2, 4, 2, 0], beats: [1, 1, 1, 1, 2] })
  })

  it('Five notes up and back is the scale to the fifth note in eighth notes', () => {
    for (const turn of written('voice.pitch.five-note', LOWER)) expect(turn).toEqual({ notes: [0, 2, 4, 5, 7, 5, 4, 2, 0], beats: [...eighths(8), 2] })
  })

  it('Small jumps is 1-3-5-3-1 in eighth notes', () => {
    for (const turn of written('voice.interval.thirds', LOWER)) expect(turn).toEqual({ notes: [0, 4, 7, 4, 0], beats: [...eighths(4), 2] })
  })

  it('Chord notes go up to the octave where the range holds one, and to the fifth note where it does not', () => {
    for (const turn of written('voice.interval.triad', { low: 50, high: 62, easy: 55 })) expect(turn).toEqual({ notes: [0, 4, 7, 12, 7, 4, 0], beats: [1, 1, 1, 1, 1, 1, 2] })
    for (const range of [LOWER, { low: 50, high: 61, easy: 55 }]) {
      for (const turn of written('voice.interval.triad', range)) expect(turn).toEqual({ notes: [0, 4, 7, 4, 0], beats: [1, 1, 1, 1, 2] })
    }
  })

  it('A whole line on one breath is the scale once, then twice without a gap, then twice with a last note of four beats: ten seconds', () => {
    const once = [0, 2, 4, 5, 7, 5, 4, 2]
    expect(written('voice.breath.phrases', LOWER, { step: 0 })[0]).toEqual({ notes: [...once, 0], beats: [...eighths(8), 2] })
    expect(written('voice.breath.phrases', LOWER, { step: 1 })[0]).toEqual({ notes: [...once, ...once, 0], beats: [...eighths(16), 2] })
    expect(written('voice.breath.phrases', LOWER, { step: 2 })[0]).toEqual({ notes: [...once, ...once, 0], beats: [...eighths(16), 4] })
    const skill = skillOf('voice.breath.phrases')
    const longest = build(skill, LOWER, { step: 2 })
    const turn = answers(longest)[0]
    expect(endOf(turn[turn.length - 1]) - turn[0].time).toBeCloseTo(10, 6)
    // One breath: no rest anywhere inside the line.
    for (let i = 1; i < turn.length; i++) expect(turn[i].time - endOf(turn[i - 1])).toBeLessThan(1e-6)
    expect([0, 1, 2].map((step) => build(skill, LOWER, { step }).chart.voice!.judge.band)).toEqual([65, 50, 50])
  })

  it('Bigger jumps go from home to the fourth, the fifth, the sixth and the octave, and back', () => {
    for (const [step, top] of [[0, 5], [1, 7], [2, 9], [3, 12]] as const) {
      for (const turn of written('voice.interval.leaps', WIDE, { step })) expect(turn, `step ${step}`).toEqual({ notes: [0, top, 0], beats: [1, 1, 2] })
    }
    expect([0, 1, 2, 3].map((step) => build(skillOf('voice.interval.leaps'), WIDE, { step }).chart.voice!.judge.band)).toEqual([65, 50, 50, 50])
  })

  it('Quick notes run in eighth notes inside a fifth, never faster than 4.4 notes a second', () => {
    const skill = skillOf('voice.pitch.runs')
    for (const turn of written('voice.pitch.runs', LOWER)) {
      expect(turn.beats).toEqual([...eighths(12), 2])
      expect(Math.max(...turn.notes) - Math.min(...turn.notes)).toBe(7)
      expect(turn.notes[0]).toBe(0)
      expect(turn.notes[turn.notes.length - 1]).toBe(0)
    }
    const fastest = build(skill, LOWER, { tempo: skill.targetTempo })
    expect(1 / Math.min(...fastest.chart.notes.map((n) => n.duration))).toBeLessThanOrEqual(4.4 + 1e-6)
  })

  it('moves up a key from turn to turn where the range has room', () => {
    const firsts = (id: string, range: Range) => answers(build(skillOf(id), range)).map((turn) => turn[0].midi)
    const thirds = firsts('voice.interval.thirds', WIDE)
    expect(thirds.slice(0, 3).map((m) => m - thirds[0])).toEqual([0, 1, 2])
    // In a range the pattern fills there is one key.
    expect(new Set(firsts('voice.interval.thirds', LOWER)).size).toBe(1)
    expect(firsts('voice.pitch.steps', WIDE)[1] - firsts('voice.pitch.steps', WIDE)[0]).toBe(1)
  })

  it('names the home note of its first key, and how far that is from middle C', () => {
    for (const c of CASES) {
      const ex = build(c.skill, HIGHER, stepOver(c))
      const voice = ex.chart.voice!
      expect(voice.tonic >= HIGHER.low && voice.tonic <= HIGHER.high, c.name).toBe(true)
      expect(voice.shift, c.name).toBe(voice.tonic - 60)
    }
    // The pattern exercises start on their home note.
    for (const id of ['voice.pitch.steps', 'voice.pitch.five-note', 'voice.interval.thirds', 'voice.interval.triad', 'voice.breath.phrases', 'voice.interval.leaps', 'voice.pitch.runs', 'voice.range.slides', 'voice.pitch.alone']) {
      const ex = build(skillOf(id), HIGHER)
      expect(ex.chart.notes[0].midi, id).toBe(ex.chart.voice!.tonic)
    }
  })
})

describe('how hard an exercise counts', () => {
  it('a step skill is rated by its step alone, whatever the tempo', () => {
    for (const skill of VOICE_SKILLS.filter((s) => s.steps)) {
      skill.steps!.forEach((step, i) => {
        const expected = itemDifficulty(skill, { tempo: skill.refTempo, bonus: step.bonus })
        expect(build(skill, WIDE, { step: i }).difficulty, `${skill.id} step ${i}`).toBe(expected)
        expect(build(skill, WIDE, { step: i, tempo: skill.startTempo + 20 }).difficulty, `${skill.id} step ${i}`).toBe(expected)
      })
    }
  })

  it('a tempo skill is rated by its tempo and its note values, as every guitar skill is', () => {
    const quick: Record<string, 'quarter' | 'eighth'> = {
      'voice.pitch.steps': 'quarter',
      'voice.pitch.five-note': 'eighth',
      'voice.interval.thirds': 'eighth',
      'voice.interval.triad': 'quarter',
      'voice.pitch.runs': 'eighth',
    }
    const paced = VOICE_SKILLS.filter((s) => !s.steps)
    expect(paced.map((s) => s.id).sort()).toEqual(Object.keys(quick).sort())
    for (const skill of paced) {
      for (const tempo of [skill.minTempo!, skill.startTempo, skill.refTempo, skill.targetTempo]) {
        const ex = build(skill, LOWER, { tempo })
        expect(ex.difficulty, `${skill.id} at ${tempo}`).toBe(itemDifficulty(skill, { tempo, noteValue: quick[skill.id] }))
        // A check reads the note value from the params to rate its task.
        expect(ex.params.noteValue, skill.id).toBe(quick[skill.id])
      }
      expect(build(skill, LOWER, { tempo: skill.targetTempo }).difficulty, skill.id).toBeGreaterThan(build(skill, LOWER, { tempo: skill.startTempo }).difficulty)
      // The quickest notes written are the note value it is rated for.
      const ex = build(skill, LOWER)
      expect(Math.min(...lengths(ex, ex.chart.notes)), skill.id).toBe(quick[skill.id] === 'eighth' ? 0.5 : 1)
    }
  })

  it('is judged with a band the scorer knows, and never asks for less than half a note in tune', () => {
    for (const c of CASES) {
      const judge = build(c.skill, WIDE, stepOver(c)).chart.voice!.judge
      expect([80, 65, 50, 35], c.name).toContain(judge.band)
      expect([0.5, 0.6], c.name).toContain(judge.minShare)
      if (c.step !== undefined) expect(judge.band, c.name).toBe(c.skill.steps![c.step].params.band)
      // Only the held notes have to last to their end.
      expect(judge.sustain === true, c.name).toBe(c.skill.id === 'voice.pitch.hold')
    }
    // The tempo skills have no ladder to name a band. The first one a singer meets is judged as widely
    // as the first notes were; the others as the second step of "Match a note" is.
    const bandOf = (id: string) => build(skillOf(id), LOWER).chart.voice!.judge.band
    expect(bandOf('voice.pitch.steps')).toBe(80)
    for (const id of ['voice.pitch.five-note', 'voice.interval.thirds', 'voice.interval.triad', 'voice.pitch.runs']) expect(bandOf(id), id).toBe(65)
    // A held note has to be in tune for more of its length than a passing one.
    for (const c of CASES) expect(build(c.skill, WIDE, stepOver(c)).chart.voice!.judge.minShare, c.name).toBe(c.skill.id === 'voice.pitch.hold' ? 0.6 : 0.5)
  })
})

describe('the words on an exercise', () => {
  it('are plain and kind, and name the step', () => {
    // Words that judge, words that ask for force, numbers a beginner cannot use, the other instrument,
    // and the words of a music lesson that someone who has never sung does not have yet.
    const banned = /\b(wrong|fail\w*|tone.?deaf|loud\w*|push\w*|belt\w*|cents?|ratings?|bpm|accuracy|guitar|strings?|frets?|fingers?|pluck\w*|strum\w*|keys?|octaves?|semitones?|intervals?|scales?|tonic|tempo|pitch\w*)\b/i
    for (const c of CASES) {
      const ex = build(c.skill, WIDE, stepOver(c))
      for (const text of [ex.title, ex.instructions]) {
        expect(text.length, c.name).toBeGreaterThan(5)
        expect(text, c.name).not.toMatch(banned)
      }
      expect(ex.title, c.name).toContain(c.skill.name)
      if (c.step !== undefined) expect(ex.title, c.name).toContain(c.skill.steps![c.step].label)
      expect(ex.instructions.length, c.name).toBeLessThanOrEqual(220)
      expect(ex.instructions, c.name).toMatch(/[.!?]$/)
      expect(ex.chart.title, c.name).toBe(ex.title)
    }
  })

  it('puts something to sing on every note', () => {
    for (const c of CASES) {
      const ex = build(c.skill, WIDE, stepOver(c))
      for (const n of ex.chart.notes) expect(n.lyric, c.name).toMatch(/^(la|oo|[1-8])$/)
    }
    // Where the notes have numbers, they are the notes of the scale counted from the home note.
    const five = build(skillOf('voice.pitch.five-note'), LOWER)
    expect(answers(five)[0].map((n) => n.lyric)).toEqual(['1', '2', '3', '4', '5', '4', '3', '2', '1'])
    const triad = build(skillOf('voice.interval.triad'), WIDE)
    expect(answers(triad)[0].map((n) => n.lyric)).toEqual(['1', '3', '5', '8', '5', '3', '1'])
  })
})

describe('the sound of a sung exercise', () => {
  const exercise = build(skillOf('voice.pitch.steps'), LOWER, { bars: 4 })
  const rate = BACKING_SAMPLE_RATE
  const at = (seconds: number) => Math.round(seconds * rate)
  /** Largest difference between two tracks from `from` to `to` seconds. */
  const apart = (a: Float32Array, b: Float32Array, from: number, to: number) => {
    let worst = 0
    for (let i = at(from); i < Math.min(at(to), a.length); i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
    return worst
  }

  it('plays the click and the calls while the microphone scores, and nothing else', () => {
    const r = renderExerciseBacking(exercise)
    const click = renderDrums(exercise.chart, { sampleRate: rate })
    const calls = renderVoiceNotes(cuesOf(exercise), { sampleRate: rate, length: click.length })
    expect(r.backing).toHaveLength(click.length)
    expect(r.backingSampleRate).toBe(rate)
    const expected = new Float32Array(click.length)
    for (let i = 0; i < click.length; i++) expected[i] = click[i] + calls[i]
    expect(apart(r.backing!, expected, 0, exercise.chart.duration)).toBe(0)
    // The call can be heard...
    const cue = cuesOf(exercise)[0]
    expect(apart(r.backing!, click, cue.time, endOf(cue))).toBeGreaterThan(0.05)
    // ...and from a beat before the singer's turn to its end there is only the click: nothing of the
    // notes to be sung is on the track the microphone can hear.
    const turn = answers(exercise)[0]
    expect(apart(r.backing!, click, turn[0].time - beatSeconds(exercise), endOf(turn[turn.length - 1]))).toBe(0)
    expect(r.guide).toBeNull()
    expect(r.wantsGuide).toBe(true)
    expect(renderExerciseBacking(exercise, { guide: false }).wantsGuide).toBe(false)
  })

  it('renders a listening guide that is the same track with the answers sung as well', async () => {
    const r = renderExerciseBacking(exercise)
    const guide = await renderExerciseGuide(r)
    expect(guide).toHaveLength(r.backing!.length)
    const sung = renderVoiceNotes(exercise.chart.notes, { sampleRate: rate, length: guide.length })
    const expected = new Float32Array(guide.length)
    for (let i = 0; i < guide.length; i++) expected[i] = r.backing![i] + sung[i]
    expect(apart(guide, expected, 0, exercise.chart.duration)).toBe(0)
    const turn = answers(exercise)[0]
    expect(apart(guide, r.backing!, turn[0].time, endOf(turn[turn.length - 1]))).toBeGreaterThan(0.05)
    // Outside the singer's turns the two tracks are one and the same.
    expect(apart(guide, r.backing!, 0, turn[0].time)).toBe(0)
    let peak = 0
    for (const v of guide) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThan(1)
  })

  it('plays the click alone under a sung chart that has no call, and still never the notes to be sung', () => {
    const bare: GeneratedExercise = { ...exercise, chart: { ...exercise.chart, voice: { ...exercise.chart.voice!, cues: [] } } }
    const r = renderExerciseBacking(bare)
    const click = renderDrums(bare.chart, { sampleRate: rate })
    expect(r.backing).toHaveLength(click.length)
    expect(apart(r.backing!, click, 0, bare.chart.duration)).toBe(0)
  })

  it('keeps the calls off every note to be sung, for every exercise: where the singer sings, the scored track is the click', () => {
    for (const c of CASES) {
      const ex = renderExerciseBacking(build(c.skill, WIDE, { ...stepOver(c), bars: 4 }), { guide: false })
      const click = renderDrums(ex.chart, { sampleRate: rate })
      const guard = beatSeconds(ex)
      for (const n of ex.chart.notes) {
        // From a beat before a note that follows a call, and through the whole of every note.
        const follows = cuesOf(ex).some((cue) => cue.time < n.time && endOf(cue) > n.time - guard - 1e-6)
        expect(apart(ex.backing!, click, n.time - (follows ? guard : 0) + 1e-4, endOf(n) - 1e-4), `${c.name}: the app sings during the note at ${n.time.toFixed(2)} s`).toBe(0)
      }
      // And every call is there to be heard.
      for (const cue of cuesOf(ex)) expect(apart(ex.backing!, click, cue.time, endOf(cue)), `${c.name}: the call at ${cue.time.toFixed(2)} s`).toBeGreaterThan(0.05)
    }
  })

  it('leaves a guitar exercise as it was: its click alone, and the part on the guitar for listening', () => {
    const skill = SKILLS_BY_ID['fret.single-string']
    const guitar = generateExercise(skill, 'melody', exerciseParams(skill, 'melody', 60), DEFAULT_TUNING)
    expect(guitar.chart.voice).toBeUndefined()
    const r = renderExerciseBacking(guitar)
    expect(r.backing).toEqual(renderDrums(guitar.chart, { sampleRate: r.backingSampleRate }))
  })
})
