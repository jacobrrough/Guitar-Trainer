/**
 * The speaker and the microphone of one phone. With the guide switched on, the app plays the notes
 * themselves, and on a bare speaker it would be marking its own singing. Two things have to catch
 * that, and both are played through here as the player sees them:
 *
 * - the count-in: the player counts the attacks the tracker reports during its own four clicks
 *   (`detectBleed`, the rule the guitar side has always used), so a sung run's tracker has to report
 *   attacks the same way;
 * - the cues: every cue of the chart that comes back on time and on pitch (`ownSoundHeard`), for the
 *   runs in which the count-in could not tell (no count-in, or the headphones came out later).
 *
 * A plain test run plays every scene once, at one of the two rates, which take turns (about twenty
 * seconds). FULL_SIM=1 plays each at both rates, with the speaker loud, half as loud and faint in the
 * microphone, and with the latency setting off both ways, and the bare speaker once more where the
 * microphone runs at 16 or 24 kHz (about fifty seconds). Run that after any change to the tracker's
 * attack flag or to its rule for its own cues.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderDrums } from '../../../audio/synth'
import { renderVoiceNotes } from '../../../audio/voice'
import { constantBeatGrid } from '../../../chart/timing'
import { emptyChart, type Chart, type ChartNote, type VoiceCue } from '../../../chart/types'
import { attemptPerformance } from '../../../training/performance'
import { detectBleed } from '../bleed'
import { delayed, mix, phoneMic } from '../simCases.testutil'
import { simulateVoice, type VoiceSimulationResult } from './simulateVoice'
import { sing, type SungNote } from './virtualSinger.testutil'

// Every test renders and analyses whole runs at two sample rates: seconds each on a slow machine.
vi.setConfig({ testTimeout: 120_000 })

const RATES = [44100, 48000]
const whole = !!process.env.FULL_SIM
/** The rates a scene is played at: both, or in a plain run the one whose turn it is. */
const rates = (turn = 0): number[] => (whole ? RATES : [RATES[turn % 2]])
/** Seconds from the speaker to the detector on a phone, and the latency setting that takes them out. */
const DEVICE = 0.04

interface Piece {
  name: string
  bpm: number
  chart: Chart
  notes: ChartNote[]
}

interface Written {
  beat: number
  beats: number
  midi: number
}

function piece(name: string, bpm: number, sung: Written[], cued: Written[]): Piece {
  const beat = 60 / bpm
  const notes: ChartNote[] = sung.map((n, id) => ({ id, time: n.beat * beat, duration: n.beats * beat, midi: n.midi, string: 0, fret: 0, velocity: 0.8, chordId: id }))
  const cues: VoiceCue[] = cued.map((c) => ({ time: c.beat * beat, duration: c.beats * beat, midi: c.midi }))
  const duration = (Math.ceil(Math.max(...sung.map((n) => n.beat + n.beats)) / 4) * 4 + 2) * beat
  const midis = [...sung, ...cued].map((n) => n.midi)
  const chart = emptyChart({
    title: name,
    source: 'builtin',
    duration,
    notes,
    beats: constantBeatGrid(bpm, 0, duration),
    tempos: [{ time: 0, bpm }],
    voice: { judge: { band: 65, minShare: 0.5 }, cues, low: Math.min(...midis), high: Math.max(...midis), tonic: 57, shift: -3, lineStarts: [notes[0].time] },
  })
  return { name, bpm, chart, notes }
}

/** A tune: its starting note as a cue for two beats, two silent beats, then the notes. One cue in all. */
function tunePiece(): Piece {
  const steps = [4, 4, 5, 7, 7, 5, 4, 2, 0, 0, 2, 4]
  const sung = steps.map((s, i) => ({ beat: 4 + i, beats: i === steps.length - 1 ? 2 : 1, midi: 57 + s }))
  return piece('a tune after its starting note', 100, sung, [{ beat: 0, beats: 2, midi: 57 + steps[0] }])
}

/** An echo: the guide sings three notes, the learner answers in the next bar. A call every two bars. */
function echoPiece(): Piece {
  const sung: Written[] = []
  const cued: Written[] = []
  const figures = [[0, 2, 4], [4, 2, 0], [0, 4, 2]]
  figures.forEach((figure, k) => {
    let b = 8 * k
    for (const [i, beats] of [0.5, 0.5, 1].entries()) {
      cued.push({ beat: b, beats, midi: 57 + figure[i] })
      sung.push({ beat: b + 4, beats, midi: 57 + figure[i] })
      b += beats
    }
  })
  return piece('an echo of three notes', 72, sung, cued)
}

/**
 * The count-in as the player plays it (Player.tsx, `start`): four clicks, one per beat of the chart's
 * tempo, the first 0.15 s after the tap, the song when the fourth beat is over. A click is the
 * metronome's (Metronome.ts, `playClick`, at 0.6 of its level): a square wave, 1760 Hz for the first and
 * 1175 Hz for the others, raised to its peak in 2 ms and let fall to nothing in 80 or 50 ms.
 */
function countIn(bpm: number, sampleRate: number): { sound: Float32Array; clicks: number[]; seconds: number } {
  const interval = 60 / bpm
  const seconds = 0.15 + 4 * interval
  const sound = new Float32Array(Math.round(seconds * sampleRate))
  const clicks: number[] = []
  for (let k = 0; k < 4; k++) {
    const at = 0.15 + k * interval
    // On the song's clock, which starts when the count-in is over.
    clicks.push(at - seconds)
    const freq = k === 0 ? 1760 : 1175
    const peak = (k === 0 ? 0.5 : 0.4) * 0.6
    const fall = k === 0 ? 0.08 : 0.05
    const start = Math.round(at * sampleRate)
    for (let i = 0; i < 0.1 * sampleRate && start + i < sound.length; i++) {
      const t = i / sampleRate
      const gain = t < 0.002 ? 0.0001 * (peak / 0.0001) ** (t / 0.002) : t < fall ? peak * (0.0001 / peak) ** ((t - 0.002) / (fall - 0.002)) : 0
      sound[start + i] += gain * (Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1)
    }
  }
  return { sound, clicks, seconds }
}

/** The click and the cues: what plays while the microphone scores with the guide off. */
function scoredTrack(p: Piece, sampleRate: number): Float32Array {
  const click = renderDrums(p.chart, { sampleRate })
  return mix(click, renderVoiceNotes(p.chart.voice!.cues, { sampleRate, length: click.length }))
}

/** The same with the notes themselves sung by the guide voice: what plays with the guide on. */
function guideTrack(p: Piece, sampleRate: number): Float32Array {
  const track = scoredTrack(p, sampleRate)
  return mix(track, renderVoiceNotes(p.notes, { sampleRate, length: track.length }))
}

interface Scene {
  /** What the app plays once the count-in is over; null = nothing reaches the microphone (headphones). */
  speaker: ((p: Piece, sampleRate: number) => Float32Array) | null
  /** How much of the speaker the microphone picks up. */
  gain?: number
  /** The speaker is heard only from this song time on (the headphones were pulled out). */
  speakerFrom?: number
  /** The count-in was not played (a run carried on after a pause has none). */
  noCountIn?: boolean
  /** What the learner sings, on the song's clock; negative times fall in the count-in. */
  sung?: SungNote[]
  /** Seconds the latency setting is off by (positive: larger than the delay really is). Default 0: matched. */
  settingOff?: number
}

interface Outcome {
  run: VoiceSimulationResult
  /** What the player's count-in check says: its own clicks were followed by attacks in the microphone. */
  clicksHeard: boolean
}

/** One run as the phone hears it: the count-in, then the song, the speaker's sound arriving `DEVICE` late. */
function play(p: Piece, sampleRate: number, scene: Scene): Outcome {
  const intro = countIn(p.bpm, sampleRate)
  const lead = Math.round(intro.seconds * sampleRate)
  const song = renderDrums(p.chart, { sampleRate }).length
  const speaker = new Float32Array(lead + song)
  if (scene.speaker) {
    if (!scene.noCountIn) speaker.set(intro.sound, 0)
    const track = scene.speaker(p, sampleRate)
    const from = Math.max(0, Math.round((scene.speakerFrom ?? 0) * sampleRate))
    speaker.set(track.subarray(from), lead + from)
    if (scene.speakerFrom !== undefined) speaker.fill(0, 0, lead + from)
  }
  const heardSpeaker = delayed(speaker, DEVICE, sampleRate)
  const voice = new Float32Array(lead + song)
  if (scene.sung?.length) {
    // The singer's clock starts with the count-in.
    const shifted = scene.sung.map((n) => ({ ...n, time: n.time + lead / sampleRate }))
    voice.set(sing(shifted, { sampleRate, seconds: (lead + song) / sampleRate }))
  }
  const mic = phoneMic(mix(voice, heardSpeaker, scene.gain ?? 0.5), sampleRate)
  const run = simulateVoice(p.chart, p.notes, mic, { sampleRate, micLead: lead / sampleRate, latencySec: DEVICE + (scene.settingOff ?? 0) })
  // Player.tsx, the microphone subscription: during the count-in the time of every frame flagged as an
  // attack is kept, and `start` hands them to `detectBleed` with the times its clicks were played at.
  const clicksHeard = !scene.noCountIn && detectBleed(intro.clicks, run.attacks.filter((a) => a < 0))
  return { run, clicksHeard }
}

/**
 * Player.tsx, `start` and `finish`: a run is bleed when what plays has pitches in it (the guide is on)
 * and the count-in's clicks came back, or (the second proof) the tracker heard its own cues.
 */
const bleed = (guideOn: boolean, o: Outcome) => guideOn && (o.clicksHeard || o.run.ownSound)
const coach = (r: VoiceSimulationResult) => attemptPerformance(r.result).acc
const hits = (r: VoiceSimulationResult) => r.summary.perfects + r.summary.goods

describe('the guide on a bare speaker', () => {
  const pieces = [tunePiece(), echoPiece()].map((p, k) => [p.name, p, k] as const)

  it.each(pieces)('%s: the count-in clicks come back as attacks, and the run does not count', (_name, p, k) => {
    for (const sampleRate of rates(k)) {
      // A plain run: the faint speaker only, which is the hardest to hear the clicks of.
      for (const gain of whole ? [1, 0.5, 0.2] : [0.2]) {
        const alone = play(p, sampleRate, { speaker: guideTrack, gain })
        expect(alone.clicksHeard, `${sampleRate} x${gain}`).toBe(true)
        expect(bleed(true, alone)).toBe(true)
        // Why it must not count: left alone, the app's own voice hits the notes.
        expect(hits(alone.run), `${sampleRate} x${gain}`).toBeGreaterThanOrEqual(p.notes.length - 1)
      }
      const along = play(p, sampleRate, { speaker: guideTrack, sung: p.notes })
      expect(along.clicksHeard, `${sampleRate} with a singer`).toBe(true)
      expect(bleed(true, along)).toBe(true)
    }
  })

  it.each(pieces)('%s: without a count-in the cues tell', (_name, p, k) => {
    for (const sampleRate of rates(k + 1)) {
      const o = play(p, sampleRate, { speaker: guideTrack, noCountIn: true })
      expect(o.clicksHeard).toBe(false)
      expect(o.run.ownSound, `${sampleRate}`).toBe(true)
      expect(bleed(true, o)).toBe(true)
    }
  })

  it.each(pieces)('%s: the cues still tell with the latency setting 50 ms off, either way', (_name, p, k) => {
    // The second proof leans on the latency setting (the first, the count-in, does not): a phone whose
    // sound sync was never measured is this far off easily.
    for (const sampleRate of rates(k)) {
      // A plain run: too small on one piece, too large on the other.
      for (const off of whole ? [-0.05, 0.05] : [[-0.05, 0.05][k % 2]]) {
        const o = play(p, sampleRate, { speaker: guideTrack, noCountIn: true, settingOff: off })
        expect(o.run.ownSound, `${sampleRate} setting off by ${off}`).toBe(true)
      }
    }
  })

  it.skipIf(!whole)('where the microphone runs at 16 or 24 kHz the count-in may miss a faint speaker, and the cues still tell', () => {
    // A frame's level is taken over its whole window, which is 128 or 85 ms long there (46 at 44.1 kHz):
    // a click of 50 ms is a small part of it. With the speaker faint in the microphone only the first,
    // louder click is still flagged as an attack, which is not enough for the count-in check. So at
    // these rates it is the cues that catch a faint speaker; from half the voice's level up both do.
    for (const p of [tunePiece(), echoPiece()]) {
      for (const sampleRate of [16000, 24000]) {
        const faint = play(p, sampleRate, { speaker: guideTrack, gain: 0.2 })
        expect(faint.run.ownSound, `${p.name} ${sampleRate} x0.2`).toBe(true)
        expect(bleed(true, faint), `${p.name} ${sampleRate} x0.2`).toBe(true)
        const half = play(p, sampleRate, { speaker: guideTrack, gain: 0.5 })
        expect(half.clicksHeard, `${p.name} ${sampleRate} x0.5`).toBe(true)
        expect(half.run.ownSound, `${p.name} ${sampleRate} x0.5`).toBe(true)
      }
    }
  })

  it('headphones pulled out after the first call: a later cue tells, so every cue is listened to', () => {
    const p = echoPiece()
    const secondCall = p.chart.voice!.cues[3].time
    for (const sampleRate of rates(0)) {
      const o = play(p, sampleRate, { speaker: guideTrack, speakerFrom: secondCall - 0.5, sung: p.notes })
      expect(o.clicksHeard).toBe(false)
      expect(o.run.ownSound, `${sampleRate}`).toBe(true)
      expect(bleed(true, o)).toBe(true)
    }
  })
})

describe('the guide in headphones', () => {
  const pieces = [tunePiece(), echoPiece()].map((p, k) => [p.name, p, k] as const)

  it.each(pieces)('%s: nothing comes back, and the singing counts', (_name, p, k) => {
    for (const sampleRate of rates(k + 1)) {
      const o = play(p, sampleRate, { speaker: null, sung: p.notes })
      expect(o.clicksHeard).toBe(false)
      expect(o.run.ownSound).toBe(false)
      expect(bleed(true, o)).toBe(false)
      expect(coach(o.run), `${sampleRate}`).toBeGreaterThanOrEqual(0.85)
    }
  })

  it('a learner who hums the starting note through the count-in is not the speaker', () => {
    const p = tunePiece()
    for (const sampleRate of rates(1)) {
      const o = play(p, sampleRate, { speaker: null, sung: [{ time: -2, duration: 1.8, midi: p.notes[0].midi }, ...p.notes] })
      expect(o.clicksHeard, `${sampleRate}`).toBe(false)
      expect(bleed(true, o)).toBe(false)
    }
  })

  it('a learner who sings along with the calls, a moment behind them as people are, is not the speaker', () => {
    const p = echoPiece()
    const along: SungNote[] = p.chart.voice!.cues.map((c) => ({ time: c.time + 0.25, duration: c.duration - 0.1, midi: c.midi }))
    for (const sampleRate of rates(0)) {
      const o = play(p, sampleRate, { speaker: null, sung: [...along, ...p.notes] })
      expect(o.run.ownSound, `${sampleRate}`).toBe(false)
      expect(bleed(true, o)).toBe(false)
      // What was sung over the calls is not credited and not held against the answers.
      expect(coach(o.run), `${sampleRate}`).toBeGreaterThanOrEqual(0.85)
    }
  })

  it('the limit of the second proof: a voice that doubles a call from its very first moment cannot be told from the speaker', () => {
    const p = echoPiece()
    const first = p.chart.voice!.cues[0]
    const o = play(p, 44100, { speaker: null, sung: [{ time: first.time, duration: first.duration, midi: first.midi }, ...p.notes] })
    expect(o.run.ownSound).toBe(true)
  })
})

describe('the guide off, on a bare speaker', () => {
  it.each([tunePiece(), echoPiece()].map((p, k) => [p.name, p, k] as const))('%s: the click and the cues come back and count for nothing; the singing counts', (_name, p, k) => {
    for (const sampleRate of rates(k)) {
      const silent = play(p, sampleRate, { speaker: scoredTrack })
      expect(hits(silent.run), `${sampleRate}`).toBe(0)
      const o = play(p, sampleRate, { speaker: scoredTrack, sung: p.notes })
      expect(coach(o.run), `${sampleRate}`).toBeGreaterThanOrEqual(0.85)
      // The clicks and the cues are heard here too. That is no bleed: nothing that plays can score. It
      // is why the player asks `ownSoundHeard` only while the guide is on.
      expect(o.clicksHeard).toBe(true)
      expect(o.run.ownSound).toBe(true)
      expect(bleed(false, o)).toBe(false)
    }
  })
})
