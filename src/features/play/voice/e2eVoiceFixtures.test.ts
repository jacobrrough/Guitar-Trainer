/**
 * Writes what the browser check of the singing side (e2e/singer.mjs) feeds into the app as its
 * microphone: takes of the one exercise the hidden page /voice-check shows ("Match a note", first
 * step, in the "Lower voice" starting range). Skipped unless a folder is named:
 *   E2E_FIXTURES=e2e/output/fixtures npx vitest run src/features/play/voice/e2eVoiceFixtures.test.ts
 *
 * A take is what a phone would hear from the first beat of the song on: the virtual singer, the app's
 * own scored track (click and starting notes) coming out of the speaker at the same level, and the
 * room, as a phone's microphone on a table picks them up (`phoneMic`). The takes sung "with headphones
 * on" have no speaker in them.
 *
 * Every take is scored here first, the way the microphone is scored in the app, and is only written
 * when it comes out as the browser check will expect. So when that check fails, the take is known to
 * be what its name says, and the fault is on the way through the browser: the player, its clock, the
 * worklet. What the page and this file build has to be the same exercise: the index carries its id and
 * its notes (`chartOf`), and the browser check compares both with the page's.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resampleLinear } from '../../../audio/resample'
import { encodeWav } from '../../../audio/synth'
import type { Chart } from '../../../chart/types'
import { DEFAULT_RANGES } from '../../../music/keys'
import { renderExerciseBacking, renderExerciseGuide } from '../../../training/exercises/backing'
import { DEFAULT_TUNING } from '../../../training/exercises/builder'
import { exerciseParams, generateExercise } from '../../../training/exercises/index'
import { skillById } from '../../../training/instruments'
import { attemptPerformance } from '../../../training/performance'
import type { GeneratedExercise } from '../../../training/types'
import { runVerdict, type RunVerdict } from '../runVerdict'
import { mix, phoneMic } from '../simCases.testutil'
import { simulateVoice, type VoiceSimulationResult } from './simulateVoice'
import { sing } from './virtualSinger.testutil'

const dir = process.env.E2E_FIXTURES
/** The rate of the virtual microphone's audio context (e2e/lib/virtualMic.mjs). */
const SAMPLE_RATE = 48000
/** Seconds of room before the song when a take is scored here: the count-in, from which the tracker takes the level of the room. */
const COUNT_IN = 2
/** What the Coach calls a clean round. */
const CLEAN = 0.85

/**
 * What a take has to fit: every note to sing, then every note the app sings first, each as pitch (MIDI
 * number), start and length in seconds. The page puts the same line on itself (`chartOf` in
 * src/features/dev/VoiceCheckPage.tsx, to the letter), so a build whose exercise has other notes than
 * these takes is told apart at once. The exercise's id cannot do that: it names how the exercise was
 * asked for, not what came out.
 */
function chartOf(chart: Chart): string {
  const mark = (n: { midi: number; time: number; duration: number }) => `${n.midi}@${n.time.toFixed(2)}+${n.duration.toFixed(2)}`
  return [...chart.notes.map(mark), 'after', ...(chart.voice?.cues ?? []).map(mark)].join(' ')
}

/** The exercise of /voice-check, built by the same calls as src/features/dev/VoiceCheckPage.tsx. */
function checkExercise(): GeneratedExercise {
  const skill = skillById('voice.pitch.match')
  if (!skill) throw new Error('the skill "Match a note" is gone')
  const generatorId = skill.generators[0]
  const params = exerciseParams(skill, generatorId, skill.startTempo, { step: 0, bars: 8, ...DEFAULT_RANGES.lower })
  return renderExerciseBacking(generateExercise(skill, generatorId, params, DEFAULT_TUNING), { guide: true })
}

interface Take {
  /** From the first beat of the song on: what the browser check plays. */
  pcm: Float32Array
  scored: VoiceSimulationResult
  hits: number
  verdict: RunVerdict
  /** What the Coach makes of the round. */
  accuracy: number
}

describe.skipIf(!dir)('the takes of the voice check', () => {
  const out = path.resolve(dir ?? '.')
  const written: Record<string, { file: string }> = {}
  let exercise: GeneratedExercise
  /** The app's scored track and its guide track, as the speaker plays them, at the microphone's rate. */
  let track: Float32Array
  let guide: Float32Array
  let seconds: number
  let notes: number

  beforeAll(async () => {
    mkdirSync(out, { recursive: true })
    exercise = checkExercise()
    track = resampleLinear(exercise.backing!, exercise.backingSampleRate, SAMPLE_RATE)
    guide = resampleLinear(await renderExerciseGuide(exercise), exercise.backingSampleRate, SAMPLE_RATE)
    seconds = track.length / SAMPLE_RATE
    notes = exercise.chart.notes.length
  })

  /** What reaches the microphone in the room, heard by the phone after a count-in of room alone, and what the app makes of it. */
  const take = (room: Float32Array): Take => {
    const lead = COUNT_IN * SAMPLE_RATE
    const mic = new Float32Array(lead + room.length)
    mic.set(room, lead)
    const recording = phoneMic(mic, SAMPLE_RATE)
    const scored = simulateVoice(exercise.chart, exercise.chart.notes, recording, { sampleRate: SAMPLE_RATE, micLead: COUNT_IN })
    return {
      pcm: recording.subarray(lead),
      scored,
      hits: scored.result.perfects + scored.result.goods,
      verdict: runVerdict(scored.summary, scored.result),
      accuracy: attemptPerformance(scored.result).acc,
    }
  }
  const save = async (key: string, t: Take) => {
    // The file holds whole numbers of 16 bits and cuts off what is above full level. What was scored
    // above is the take before it was written: the two are the same sound only while nothing is cut.
    expect(t.pcm.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0), `the loudest moment of the take "${key}"`).toBeLessThan(1)
    const file = `voice-check-${key}.wav`
    writeFileSync(path.join(out, file), Buffer.from(await encodeWav(t.pcm, SAMPLE_RATE).arrayBuffer()))
    written[key] = { file }
  }
  const voice = (how: { octave?: number; cents?: number } = {}) => sing(exercise.chart.notes, { sampleRate: SAMPLE_RATE, seconds, ...how })

  it('is one round of "Match a note" on its first step, in the "Lower voice" range', () => {
    expect(exercise.skillId).toBe('voice.pitch.match')
    expect(exercise.params.step).toBe(0)
    expect(exercise.chart.voice).toMatchObject({ low: DEFAULT_RANGES.lower.low, high: DEFAULT_RANGES.lower.high })
    // Enough notes that "85 % of them" means something, and a starting note from the app before each.
    expect(notes).toBeGreaterThanOrEqual(4)
    expect(exercise.chart.voice!.cues.length).toBe(notes)
  })

  it('sung in tune an octave below the lanes, over the speaker: a clean round, and the octave is known', async () => {
    const t = take(mix(voice({ octave: -1 }), track))
    expect(t.verdict).toBe('counted')
    expect(t.hits).toBe(notes)
    expect(t.accuracy).toBeGreaterThanOrEqual(CLEAN)
    expect(t.scored.feedback.octave).toBe(-1)
    await save('octave-down', t)
  })

  it('sung 150 cents flat, over the speaker: heard and counted, and no note is on pitch', async () => {
    const t = take(mix(voice({ cents: -150 }), track))
    expect(t.verdict).toBe('counted')
    expect(t.hits).toBe(0)
    // Heard on every note: this is a singer who was under the notes, not a phone that was too far away.
    expect(t.scored.result.coverage).toBeGreaterThanOrEqual(0.8)
    expect(t.scored.feedback.reasons.low).toBe(notes)
    await save('flat', t)
  })

  it('nobody sings and the speaker is not heard: nothing is scored', async () => {
    const t = take(new Float32Array(track.length))
    expect(t.hits).toBe(0)
    expect(t.verdict).toBe('unscored')
    await save('silence', t)
  })

  it('nobody sings and the speaker plays the scored track: no note counts and nothing is scored', async () => {
    const t = take(track)
    expect(t.hits).toBe(0)
    expect(t.verdict).toBe('unscored')
    await save('own-track', t)
  })

  it('the guide track alone: the app scores its own notes, and knows them for its own', async () => {
    const t = take(guide)
    // Why the guide stays off on a bare speaker: left to itself it sings every note right.
    expect(t.hits).toBe(notes)
    // And how a run with the guide on is stopped from counting.
    expect(t.scored.ownSound).toBe(true)
    await save('guide', t)
  })

  it('sung in tune at pitch with headphones on: a clean round, and nothing of the app is heard', async () => {
    const t = take(voice())
    expect(t.verdict).toBe('counted')
    expect(t.hits).toBe(notes)
    expect(t.accuracy).toBeGreaterThanOrEqual(CLEAN)
    // A singer taken for the speaker would turn a headphones run into "the phone heard its own sound".
    expect(t.scored.ownSound).toBe(false)
    await save('in-tune', t)
  })

  it('writes the index of the takes', () => {
    expect(Object.keys(written).sort()).toEqual(['flat', 'guide', 'in-tune', 'octave-down', 'own-track', 'silence'])
    writeFileSync(path.join(out, 'voice-check.json'), JSON.stringify({ exercise: exercise.id, chart: chartOf(exercise.chart), title: exercise.title, notes, seconds, takes: written }, null, 1))
  })
})
