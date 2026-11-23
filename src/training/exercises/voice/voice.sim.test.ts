/**
 * Every sung exercise the daily plan can hand out, sung by the virtual singer and scored the way the
 * microphone is scored in the app: each skill at every step of its ladder (a tempo skill at the tempo
 * it starts at and at the tempo it aims for), built by the real generators, with the app's own scored
 * track (click and cues, as `renderExerciseBacking` renders it) coming out of the speaker at the same
 * level as the voice, through the phone microphone model, after a count-in of room noise.
 *
 * Three takes of each, and what has to come of them:
 * - sung in tune: a clean round for the Coach, 85 % or more (`attemptPerformance(...).acc`, never the
 *   summary's own accuracy). A slide is sung as a slide, gliding from note to note;
 * - every note 150 cents flat: heard, counted, and nowhere near a pass;
 * - nobody sings, only the app's own track sounds: no note counts, and the run is "nothing was scored"
 *   rather than a round of misses. This is the rule the whole speaker policy rests on: on a bare phone
 *   the app must not score itself, and must not mark a learner who did not sing. The tracker also knows
 *   the call for the app's own sound, which is how a run with the guide on a speaker is stopped.
 *
 * All of it is a quarter of an hour in one process, so a plain run sings one exercise of every skill
 * as a stand-in for the rest (about half a minute): from skill to skill it takes the easy end (the
 * first step, the starting tempo) and the far end (the last step, the tempo the skill aims for) in
 * turn, and moves on to the next of the four pairings of range and rate, which is also another day's
 * exercise: other notes, another key. FULL_SIM=1 sings everything: each exercise in a low and in a high
 * range at 44.1 and at 48 kHz, the tempo skills at their floor as well, and three more takes that have
 * to count: sung joined-up, sung an octave away from the lanes, and every note 30 cents flat
 * (`VOICE_ONLY='low range'` and `VOICE_ONLY='high range'` are its two halves, about six minutes each).
 * Run it after any change to the voice tracker, to a generator or to a ladder. VOICE_ONLY=<regexp> on
 * its own runs the exercises of the whole list whose name matches, with the three takes of a plain run.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { resampleLinear } from '../../../audio/resample'
import { runVerdict, type RunVerdict } from '../../../features/play/runVerdict'
import { mix, phoneMic } from '../../../features/play/simCases.testutil'
import { hearVoice, scoreVoiceHeard } from '../../../features/play/voice/simulateVoice'
import { sing, type SingOptions, type SungNote } from '../../../features/play/voice/virtualSinger.testutil'
import { attemptPerformance } from '../../performance'
import { maxStepFor } from '../../planner'
import type { AttemptResult, GeneratedExercise, Performance, SkillDef } from '../../types'
import { VOICE_SKILLS } from '../../voiceSkills'
import { renderExerciseBacking } from '../backing'
import { DEFAULT_TUNING } from '../builder'
import { exerciseParams, generateExercise } from '../index'

interface Range {
  low: number
  high: number
  easy: number
}

/** An octave each, so every step of every ladder fits: a low voice (G2 to G3) and a high one (C4 to C5). */
const RANGES: [name: string, range: Range][] = [
  ['low', { low: 43, high: 55, easy: 48 }],
  ['high', { low: 60, high: 72, easy: 65 }],
]
const RATES = [44100, 48000]
/** Seconds of room noise before the song starts: the count-in, from which the tracker takes the level of the room. */
const COUNT_IN = 2
/** A round of 4 bars is the shortest that holds one whole turn of every exercise but one (which takes its 7). */
const BARS = 4
/** What the Coach calls a clean round. */
const CLEAN = 0.85

const whole = !!process.env.FULL_SIM
const only = process.env.VOICE_ONLY ? new RegExp(process.env.VOICE_ONLY) : null

interface Sweep {
  name: string
  skill: SkillDef
  step?: number
  tempo: number
  range: Range
  sampleRate: number
  /** Which day's exercise: the planner counts the days a skill was practised, and the notes or the key change with it. */
  day: number
}

/** All there is to sing: each skill at every step, or from its floor to the tempo it aims for, in both ranges at both rates. */
function everySweep(): Sweep[] {
  const out: Sweep[] = []
  for (const skill of VOICE_SKILLS) {
    const steps = skill.steps ? skill.steps.map((_, i) => i) : [undefined]
    const tempos = skill.steps ? [skill.startTempo] : [...new Set([skill.minTempo!, skill.startTempo, skill.targetTempo])]
    for (const step of steps) {
      for (const tempo of tempos) {
        const what = `${skill.id}${step === undefined ? ` at ${tempo}` : ` step ${step}`}`
        // The four pairings of range and rate: 0 and 1 are the low range at 44.1 kHz and the high one
        // at 48, 2 and 3 the other way round. Each is the exercise of another day as well.
        for (const p of [0, 1, 2, 3]) {
          const [rangeName, range] = RANGES[p % 2]
          const sampleRate = RATES[p < 2 ? p : 3 - p]
          out.push({ name: `${what}, ${rangeName} range, ${sampleRate / 1000} kHz, day ${p}`, skill, step, tempo, range, sampleRate, day: p })
        }
      }
    }
  }
  return out
}

/**
 * What a plain run sings: one exercise of every skill. From skill to skill it is the easy end (the
 * first step, the starting tempo) and the far end (the last step, the target tempo) in turn, in the
 * next of the four pairings of range and rate. So a step skill, a tempo skill and the slide are all
 * there, low and high, at both rates.
 */
function standIns(all: Sweep[]): Sweep[] {
  return VOICE_SKILLS.map((skill, k) => {
    const far = k % 2 === 1
    const mine = all.filter((s) => s.skill === skill && s.day === k % 4)
    const one = skill.steps ? mine.find((s) => s.step === (far ? skill.steps!.length - 1 : 0)) : mine.find((s) => s.tempo === (far ? skill.targetTempo : skill.startTempo))
    if (!one) throw new Error(`no exercise of ${skill.id} to stand in for the rest`)
    return one
  })
}

/** The exercise as the block runner gets it: built for the range, with the scored track rendered. */
function exerciseOf(s: Sweep): GeneratedExercise {
  const generatorId = s.skill.generators[0]
  const params = exerciseParams(s.skill, generatorId, s.tempo, { ...s.range, bars: BARS, seed: s.day, ...(s.step === undefined ? {} : { step: s.step, startStep: s.step }) })
  return renderExerciseBacking(generateExercise(s.skill, generatorId, params, DEFAULT_TUNING), { guide: false })
}

/**
 * The notes as a singer sings them. A slide is sung as one: between the notes it is scored on, the
 * voice glides from one to the next. Everything else is sung note by note.
 */
function asSung(ex: GeneratedExercise): SungNote[] {
  if (!ex.chart.voice!.glide) return ex.chart.notes
  const beat = 60 / ex.params.tempo
  const sung: SungNote[] = []
  ex.chart.notes.forEach((n, i) => {
    sung.push(n)
    const next = ex.chart.notes[i + 1]
    const end = n.time + n.duration
    if (next && next.time - end > 0 && next.time - end < 2 * beat) sung.push({ time: end, duration: next.time - end, midi: n.midi, slideTo: next.midi })
  })
  return sung
}

interface Run {
  result: AttemptResult
  /** What the Coach makes of it. */
  coach: Performance
  hits: number
  verdict: RunVerdict
  /** The tracker heard one of the app's own calls come back through the microphone. */
  ownSound: boolean
}

interface Takes {
  notes: number
  inTune: Run
  flat: Run
  alone: Run
  joined?: Run
  octaveAway?: Run
  slightlyFlat?: Run
}

/** Sings and scores the takes of one exercise. Each recording is analysed once; every check reads from the results. */
function takesOf(s: Sweep): Takes {
  const ex = exerciseOf(s)
  expect(ex.params.step, 'the range holds the step').toBe(s.step)
  const { sampleRate } = s
  // What the speaker plays at this device's rate: the rendered track, as the audio element resamples it.
  const track = resampleLinear(ex.backing!, ex.backingSampleRate, sampleRate)
  const seconds = track.length / sampleRate
  const options = { sampleRate, micLead: COUNT_IN }
  const heardBy = (room: Float32Array): Run => {
    const mic = new Float32Array(COUNT_IN * sampleRate + room.length)
    mic.set(room, COUNT_IN * sampleRate)
    const recording = phoneMic(mic, sampleRate)
    const scored = scoreVoiceHeard(ex.chart, ex.chart.notes, hearVoice(ex.chart, recording, options), recording.length / sampleRate, options)
    return { result: scored.result, coach: attemptPerformance(scored.result), hits: scored.result.perfects + scored.result.goods, verdict: runVerdict(scored.summary, scored.result), ownSound: scored.ownSound }
  }
  // The voice and the app's own track reach the microphone at the same level.
  const take = (notes: SungNote[], how: Partial<SingOptions> = {}) => heardBy(mix(sing(notes, { sampleRate, seconds, ...how }), track))
  const sung = asSung(ex)
  const takes: Takes = { notes: ex.chart.notes.length, inTune: take(sung), flat: take(sung, { cents: -150 }), alone: heardBy(track) }
  if (whole) {
    takes.joined = take(sung, { legato: true })
    // A voice that sits an octave from the lanes: a high voice on low lanes sings up, a low one on high lanes down.
    takes.octaveAway = take(sung, { octave: s.range.low < 50 ? 1 : -1 })
    takes.slightlyFlat = take(ex.chart.notes, { cents: -30 })
  }
  return takes
}

const ALL = everySweep()
/** The whole list under FULL_SIM, and to pick from by name; otherwise the stand-ins. */
const SWEEPS = (whole || only ? ALL : standIns(ALL)).filter((s) => !only || only.test(s.name))

describe('what is sung', () => {
  it('is every skill at every step its range holds, and every tempo skill from where it starts to where it aims', () => {
    for (const skill of VOICE_SKILLS) {
      const mine = ALL.filter((s) => s.skill === skill)
      if (skill.steps) {
        for (const [, range] of RANGES) expect(maxStepFor(skill, range), skill.id).toBe(skill.steps.length - 1)
        expect(new Set(mine.map((s) => s.step)), skill.id).toEqual(new Set(skill.steps.map((_, i) => i)))
      } else {
        const tempos = new Set(mine.map((s) => s.tempo))
        expect(tempos.has(skill.startTempo) && tempos.has(skill.targetTempo), skill.id).toBe(true)
      }
    }
    // Every exercise is sung in the low and in the high range...
    const ranges = new Map<string, Set<number>>()
    for (const s of ALL) {
      const what = `${s.skill.id} ${s.step ?? ''} ${s.tempo}`
      ranges.set(what, (ranges.get(what) ?? new Set()).add(s.range.low))
    }
    expect(ranges.size).toBeGreaterThanOrEqual(34)
    for (const [what, sung] of ranges) expect(sung.size, what).toBe(RANGES.length)
    // ...each range at both rates, and on more than one day.
    expect(new Set(ALL.map((s) => `${s.range.low} ${s.sampleRate}`)).size).toBe(4)
    expect(new Set(ALL.map((s) => s.day)).size).toBe(4)
    // And the whole gate sings all of it.
    if (whole && !only) expect(SWEEPS).toEqual(ALL)
  })

  it('in a plain run is one exercise of every skill, with every kind among them', () => {
    const quick = standIns(ALL)
    expect(quick.map((s) => s.skill.id)).toEqual(VOICE_SKILLS.map((s) => s.id))
    for (const s of quick) expect(ALL, s.name).toContain(s)
    // A step skill on its first step and one on its last, a tempo skill where it starts and one where it aims, and the slide.
    expect(quick.some((s) => s.step === 0)).toBe(true)
    expect(quick.some((s) => s.skill.steps && s.step === s.skill.steps.length - 1 && s.step > 0)).toBe(true)
    expect(quick.some((s) => !s.skill.steps && s.tempo === s.skill.startTempo)).toBe(true)
    expect(quick.some((s) => !s.skill.steps && s.tempo === s.skill.targetTempo && s.tempo > s.skill.startTempo)).toBe(true)
    expect(quick.some((s) => s.skill.generators[0] === 'voiceSlide')).toBe(true)
    // Every generator, both ranges at both rates, four different days.
    expect(new Set(quick.map((s) => s.skill.generators[0]))).toEqual(new Set(VOICE_SKILLS.map((s) => s.generators[0])))
    expect(new Set(quick.map((s) => `${s.range.low} ${s.sampleRate}`)).size).toBe(4)
    expect(new Set(quick.map((s) => s.day)).size).toBe(4)
    if (!whole && !only) expect(SWEEPS).toEqual(quick)
  })
})

describe.each(SWEEPS)('$name', (sweep) => {
  let takes: Takes
  beforeAll(() => {
    takes = takesOf(sweep)
  }, 120_000)

  it('sung in tune is a clean round', () => {
    const { result, coach, verdict } = takes.inTune
    expect(result.total).toBe(takes.notes)
    expect(coach.acc, `${result.perfects} perfect, ${result.goods} good, ${result.misses} missed`).toBeGreaterThanOrEqual(CLEAN)
    // Heard well enough to count as evidence, and saved as a result.
    expect(coach.reliable, coach.reasons.join(', ')).toBe(true)
    expect(verdict).toBe('counted')
  })

  it('sung 150 cents flat is heard, and far from a pass', () => {
    const { result, coach, verdict } = takes.flat
    expect(coach.acc, `${result.perfects} perfect, ${result.goods} good, ${result.misses} missed`).toBeLessThan(0.5)
    // It is a singer the app heard, not a silent run: it counts, as a weak one.
    expect(result.coverage).toBeGreaterThanOrEqual(0.6)
    expect(verdict).toBe('counted')
  })

  it('with nobody singing, the app\'s own click and cues score no note', () => {
    const { result, hits } = takes.alone
    expect(hits, `${result.perfects} perfect, ${result.goods} good`).toBe(0)
  })

  it('...and that run is "nothing was scored", not a round of misses', () => {
    // A run counts as heard when a voice sounded during a fifth of its notes or more. Nobody sang
    // here: whatever was heard during the notes was the click.
    const { result, verdict } = takes.alone
    expect(verdict, `heard during ${Math.round(result.coverage * 100)} % of the notes`).toBe('unscored')
  })

  it('...and the call is known for the app\'s own voice', () => {
    // Every exercise opens with a call, and the tracker recognises it coming out of the speaker. That is
    // what ends a run when the listening guide (these same calls, with the answers sung as well) is on
    // without headphones: a guide that sang the answers unnoticed would score every one of them.
    expect(takes.alone.ownSound).toBe(true)
  })

  it.skipIf(!whole)('sung joined-up, or an octave away from the lanes, is a clean round as well', () => {
    for (const run of [takes.joined!, takes.octaveAway!]) {
      expect(run.coach.acc, `${run.result.perfects} perfect, ${run.result.goods} good, ${run.result.misses} missed`).toBeGreaterThanOrEqual(CLEAN)
      expect(run.verdict).toBe('counted')
    }
  })

  it.skipIf(!whole)('sung 30 cents flat, every note still counts', () => {
    const { result, coach } = takes.slightlyFlat!
    expect(result.misses, `${result.perfects} perfect, ${result.goods} good, ${result.misses} missed`).toBe(0)
    // All good and none perfect is the least it can be: counted, though not clean.
    expect(coach.acc).toBeGreaterThanOrEqual(0.8 - 1e-9)
  })
})
