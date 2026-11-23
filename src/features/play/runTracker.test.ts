/**
 * The seam between the player and what scores a run. For a guitar chart it has to be the tracker the
 * player has always used, frame for frame: the recorded guitar is analysed once and fed both through
 * `scoreFrame` on a `ScoreTracker`, as the player does today, and through the seam, and everything
 * that comes out is compared. The simulation's own loop is compared with the loop it was taken from.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { SampleBank } from '../../audio/instrument/bank'
import { loadRealBank } from '../../audio/instrument/realBank.testutil'
import { constantBeatGrid } from '../../chart/timing'
import { emptyChart, type Chart, type ChartNote } from '../../chart/types'
import { PitchSmoother } from './pitchTracker'
import { createRunTracker, guitarRunTracker, type RunTracker } from './runTracker'
import { scoreFrame, type FrameOutcome } from './scoreFrame'
import { ScoreTracker } from './scoring'
import { delayed, lessonCases, mix, clickTrack, perform, phoneMic, type SimCase } from './simCases.testutil'
import { analyseMic, runHeard, scoreHeard, simulateRun, type HeardFrame, type SimulationOptions, type SimulationResult } from './simulate'
import { VoiceTracker } from './voice/voiceTracker'

let bank: SampleBank
beforeAll(async () => {
  bank = await loadRealBank()
})

const SETTINGS = { clarityThreshold: 0.85, a4: 440 }
const ATTEMPT = { playedTempo: 80, targetTempo: 90, speed: 1, durationSec: 12 }

/** A picked drill and a strummed chord song: single notes and whole chords both go through the seam. */
function recordedCases(): SimCase[] {
  const cases = lessonCases()
  const drill = cases.find((c) => c.kind === 'lesson-drill' && /firstFrets/.test(c.name))
  const chords = cases.find((c) => c.kind === 'lesson-song' && c.notes.some((n) => n.chordName))
  return [drill, chords].filter((c): c is SimCase => !!c)
}

/**
 * The loop `scoreHeard` had before the seam, kept here word for word as the reference: a `ScoreTracker`,
 * a `PitchSmoother`, every frame through `scoreFrame`, the tracker advanced with the same clock.
 */
function scoreHeardBefore(notes: ChartNote[], beats: Chart['beats'], heard: HeardFrame[], durationSec: number, options: SimulationOptions): SimulationResult {
  const speed = options.speed ?? 1
  const latency = options.latencySec ?? 0
  const tracker = new ScoreTracker(notes, { octaveTolerance: options.octaveTolerance ?? 'chords', beats, a4: options.a4, recognition: options.recognition })
  tracker.setSpeed(speed)
  const smoother = new PitchSmoother()
  const settings = { clarityThreshold: options.clarityThreshold ?? 0.85, a4: options.a4 ?? 440 }
  const loop = options.loop
  const origin = loop?.from ?? 0
  tracker.seek(origin - latency * speed)
  if (loop) tracker.setRange(loop.from, loop.to)
  const jitter = options.startJitter ?? 0
  let pass = 0
  for (const { wall, frame } of heard) {
    let position = origin + wall * speed
    if (loop && wall >= 0) {
      const length = (loop.to - loop.from) / speed
      const stall = loop.wrapStall ?? 0
      const p = wall < length ? 0 : 1 + Math.floor((wall - length) / (length + stall))
      if (p >= loop.passes) break
      if (p > pass) {
        tracker.nextPass()
        pass = p
      }
      const sinceWrap = p === 0 ? wall : wall - length - (p - 1) * (length + stall)
      position = loop.from + (p === 0 || sinceWrap < stall ? sinceWrap : sinceWrap - stall) * speed
    }
    const songTime = position - latency * speed + (wall < 0 ? jitter * speed : 0)
    scoreFrame(tracker, smoother, { ...frame, time: wall }, songTime, settings)
    tracker.advance(songTime)
  }
  tracker.advance(Number.POSITIVE_INFINITY)
  const summary = tracker.summary()
  const result = tracker.toAttemptResult({ playedTempo: 0, targetTempo: 0, speed, durationSec })
  return { summary, result, deltasMs: tracker.hitDeltas().map((d) => d * 1000), statuses: tracker.groups.map((g) => g.status) }
}

describe('the guitar tracker behind the seam', () => {
  it('has a picked drill and a chord song to play', () => {
    const cases = recordedCases()
    expect(cases.length).toBe(2)
    expect(cases[1].notes.some((n) => n.chordName)).toBe(true)
  })

  it.each(recordedCases().map((c) => [c.name, c] as const))('%s: every frame comes out as it does from scoreFrame, and so do the summary and the result', (_name, c) => {
    // The single-pitch detector is on here, as it is in the app, so the pitch for the indicator is compared too.
    const heard = analyseMic(phoneMic(mix(perform(c, bank, 44100), clickTrack(c, 44100), 0.5), 44100), { sampleRate: 44100, detector: { pitch: true } })
    expect(heard.length).toBeGreaterThan(300)

    const direct = new ScoreTracker(c.notes, { octaveTolerance: 'chords', a4: 440, beats: c.chart.beats })
    const smoother = new PitchSmoother()
    const seam = createRunTracker(c.chart, c.notes, { octaveTolerance: 'chords', a4: 440, sampleRate: 44100 })
    direct.seek(0)
    seam.seek(0)

    const outcomes: FrameOutcome[] = []
    let judged = 0
    for (const { wall, frame } of heard) {
      // The player: no song time before the run plays, the count-in's own timeline, then the song.
      const songTime = wall < -0.4 ? null : wall
      const a = scoreFrame(songTime === null ? null : direct, smoother, { ...frame, time: wall }, songTime, SETTINGS)
      const b = seam.frame({ ...frame, time: wall }, songTime, SETTINGS)
      expect(b, `frame at ${wall.toFixed(3)}`).toEqual(a)
      outcomes.push(b)
      if (b.judgement) judged++
      if (songTime !== null) expect(seam.advance(songTime).length, `advance at ${wall.toFixed(3)}`).toBe(direct.advance(songTime).length)
      expect(seam.summary()).toEqual(direct.summary())
    }
    direct.advance(Number.POSITIVE_INFINITY)
    seam.advance(Number.POSITIVE_INFINITY)

    // Something was really compared: notes were hit, a pitch was shown, attacks were heard.
    expect(judged).toBeGreaterThanOrEqual(Math.floor(0.8 * direct.summary().total))
    expect(outcomes.some((o) => o.isAttack)).toBe(true)
    if (c.kind === 'lesson-drill') expect(outcomes.filter((o) => o.midi !== null).length).toBeGreaterThan(50)

    expect(seam.summary()).toEqual(direct.summary())
    expect(seam.toAttemptResult(ATTEMPT)).toEqual(direct.toAttemptResult(ATTEMPT))
    for (const n of c.notes) expect(seam.stateOfNote(n.id)).toEqual(direct.stateOfNote(n.id))
    expect(seam.stateOfNote(-5)).toBeUndefined()
  })

  it('everything else the player asks of its tracker goes to the same tracker: speed, range, passes, reset, no microphone', () => {
    const c = recordedCases()[0]
    const heard = analyseMic(perform(c, bank, 44100), { sampleRate: 44100 })
    const from = c.notes[4].time - 0.05
    const to = c.notes[8].time - 0.05
    const run = (tracker: RunTracker | ScoreTracker, speed: number, frame: (f: HeardFrame, songTime: number) => void) => {
      tracker.setSpeed(speed)
      tracker.seek(from)
      tracker.setRange(from, to)
      let wrapped = false
      for (const f of heard) {
        if (f.wall < from - 0.5) continue
        // The same stretch twice (a wrap in the middle), on a clock that runs 0.12 s ahead: every stroke
        // is heard that much late, which is inside the window at full speed and outside it at half speed.
        const songTime = (f.wall < to ? f.wall : f.wall - (to - from)) + 0.12
        if (f.wall >= to && !wrapped) {
          tracker.nextPass()
          wrapped = true
        }
        if (f.wall >= to + (to - from)) break
        frame(f, songTime)
        tracker.advance(songTime)
      }
      tracker.advance(Number.POSITIVE_INFINITY)
    }
    const hits: number[] = []
    for (const speed of [1, 0.5]) {
      const direct = new ScoreTracker(c.notes, { octaveTolerance: 'all', a4: 442, beats: c.chart.beats })
      const smoother = new PitchSmoother()
      const seam = createRunTracker(c.chart, c.notes, { octaveTolerance: 'all', a4: 442, sampleRate: 44100 })
      run(direct, speed, (f, songTime) => scoreFrame(direct, smoother, { ...f.frame, time: f.wall }, songTime, SETTINGS))
      run(seam, speed, (f, songTime) => seam.frame({ ...f.frame, time: f.wall }, songTime, SETTINGS))
      expect(direct.summary().total).toBe(8)
      expect(seam.summary()).toEqual(direct.summary())
      expect(seam.toAttemptResult(ATTEMPT)).toEqual(direct.toAttemptResult(ATTEMPT))
      hits.push(direct.summary().perfects + direct.summary().goods)

      direct.reset()
      seam.reset()
      expect(seam.summary()).toEqual(direct.summary())
      expect(seam.summary().total).toBe(c.notes.length)
      direct.markUnscored()
      seam.markUnscored()
      expect(seam.summary()).toEqual(direct.summary())
      expect(seam.summary().total).toBe(0)
    }
    // The speed did reach the tracker: late strokes that count at full speed do not at half.
    expect(hits[0]).toBeGreaterThan(0)
    expect(hits[1]).toBeLessThan(hits[0])
  })

  it('needs the spectrum, and has none of the sung run\'s extras', () => {
    const c = recordedCases()[0]
    const seam = createRunTracker(c.chart, c.notes, { octaveTolerance: 'chords', a4: 440, sampleRate: 48000 })
    expect(seam.needsSpectrum).toBe(true)
    expect(seam.progressOf).toBeUndefined()
    expect(seam.ownSoundHeard).toBeUndefined()
  })

  it('when the song\'s sound starts, the pitch smoothing starts afresh, as the player resets its smoother there', () => {
    const loud: HeardFrame['frame'] = { freq: 220, clarity: 0.95, rms: 0.2 }
    const seam = guitarRunTracker([], {})
    const smoother = new PitchSmoother()
    for (let i = 0; i < 5; i++) {
      expect(seam.frame({ ...loud, time: i }, null, SETTINGS)).toEqual(scoreFrame(null, smoother, { ...loud, time: i }, null, SETTINGS))
    }
    // Still as loud: no attack. After the start it is one again.
    expect(seam.frame({ ...loud, time: 5 }, null, SETTINGS).isAttack).toBe(false)
    seam.onPlaybackStart()
    expect(seam.frame({ ...loud, time: 6 }, null, SETTINGS).isAttack).toBe(true)
  })

  it('can be given the player\'s own smoother, which then outlives the tracker', () => {
    const smoother = new PitchSmoother()
    const loud = { freq: 220, clarity: 0.95, rms: 0.2 }
    guitarRunTracker([], {}, smoother).frame({ ...loud, time: 0 }, null, SETTINGS)
    // A new tracker for the same run (the level changed): the level heard a moment ago is still known.
    expect(guitarRunTracker([], {}, smoother).frame({ ...loud, time: 1 }, null, SETTINGS).isAttack).toBe(false)
    expect(guitarRunTracker([], {}).frame({ ...loud, time: 1 }, null, SETTINGS).isAttack).toBe(true)
  })
})

describe('which tracker a chart gets', () => {
  const note: ChartNote = { id: 0, time: 1, duration: 1, midi: 60, string: 0, fret: 0, velocity: 0.8, chordId: 0 }
  const base = emptyChart({ duration: 4, notes: [note], beats: constantBeatGrid(60, 0, 4), tempos: [{ time: 0, bpm: 60 }] })
  const options = { octaveTolerance: 'chords' as const, a4: 440, sampleRate: 44100 }

  it('a chart that says it is sung gets the voice tracker; every other chart the guitar one', () => {
    const sung: Chart = { ...base, voice: { judge: { band: 80, minShare: 0.5 }, cues: [], low: 60, high: 60, tonic: 60, shift: 0, lineStarts: [1] } }
    const voice = createRunTracker(sung, sung.notes, options)
    expect(voice).toBeInstanceOf(VoiceTracker)
    expect(voice.needsSpectrum).toBe(false)
    expect(typeof voice.progressOf).toBe('function')
    expect(typeof voice.ownSoundHeard).toBe('function')
    const guitar = createRunTracker(base, base.notes, options)
    expect(guitar).not.toBeInstanceOf(VoiceTracker)
    expect(guitar.needsSpectrum).toBe(true)
  })

  it('asks for the sample rate only when a sung run\'s first frame arrives, and never for a guitar chart', () => {
    const sung: Chart = { ...base, voice: { judge: { band: 80, minShare: 0.5 }, cues: [], low: 60, high: 60, tonic: 60, shift: 0, lineStarts: [1] } }
    let asked = 0
    const sampleRate = () => {
      asked++
      return 44100
    }
    const frame = { freq: 0, clarity: 0, rms: 0.001, time: 0 }
    const guitar = createRunTracker(base, base.notes, { ...options, sampleRate })
    guitar.seek(0)
    guitar.frame(frame, 0, SETTINGS)
    expect(asked).toBe(0)
    const voice = createRunTracker(sung, sung.notes, { ...options, sampleRate })
    voice.seek(0)
    expect(asked).toBe(0)
    voice.frame(frame, 0, SETTINGS)
    voice.frame({ ...frame, time: 0.0116 }, 0.0116, SETTINGS)
    expect(asked).toBe(1)
  })

  it('a guitar chart is read against the reference pitch setting, a sung chart against the app\'s own 440 Hz', () => {
    const sung: Chart = { ...base, voice: { judge: { band: 80, minShare: 0.5 }, cues: [], low: 60, high: 60, tonic: 60, shift: 0, lineStarts: [1] } }
    // A string, or a voice, sounding at 432 Hz: the pitch each tracker reports for the screen.
    const shown = (tracker: RunTracker, a4: number) => {
      let midi: number | null = null
      for (let k = 0; k < 4; k++) midi = tracker.frame({ freq: 432, clarity: 0.95, rms: 0.05, time: k * 0.0116 }, null, { clarityThreshold: 0.85, a4 }).midi
      return midi
    }
    const flat = 69 + 12 * Math.log2(432 / 440)
    // A guitar tuned to 432 with the setting at 432 is on its A; with the setting at 440 it is a third of a semitone flat.
    expect(shown(createRunTracker(base, base.notes, { ...options, a4: 432 }), 432)).toBeCloseTo(69, 3)
    expect(shown(createRunTracker(base, base.notes, options), 440)).toBeCloseTo(flat, 3)
    // What the app plays for singing is at 440 whatever that setting says, so a voice is read against 440.
    expect(shown(createRunTracker(sung, sung.notes, { ...options, a4: 432 }), 432)).toBeCloseTo(flat, 3)
    expect(shown(createRunTracker(sung, sung.notes, options), 440)).toBeCloseTo(flat, 3)
  })

  it('a held C is a sung note on the sung chart and no picked note on the guitar chart', () => {
    const sung: Chart = { ...base, voice: { judge: { band: 80, minShare: 0.5 }, cues: [], low: 60, high: 60, tonic: 60, shift: 0, lineStarts: [1] } }
    const hop = 512 / 44100
    const hum = (tracker: RunTracker) => {
      tracker.seek(0)
      for (let k = 0; k * hop < 3; k++) {
        const t = k * hop
        const sounding = t >= 1.05 && t < 2
        tracker.frame({ freq: sounding ? 261.63 : 0, clarity: sounding ? 0.95 : 0, rms: sounding ? 0.05 : 0.001, time: t }, t, SETTINGS)
        tracker.advance(t)
      }
      tracker.advance(Number.POSITIVE_INFINITY)
      return tracker.summary()
    }
    expect(hum(createRunTracker(sung, sung.notes, options))).toMatchObject({ perfects: 1, misses: 0 })
    // No spectrum, no stroke: the guitar tracker has nothing to go on.
    expect(hum(createRunTracker(base, base.notes, options))).toMatchObject({ perfects: 0, goods: 0, misses: 1 })
  })
})

describe('the simulation loop on the seam', () => {
  const variants: Array<[string, (c: SimCase) => { mic: Float32Array; options: Omit<SimulationOptions, 'sampleRate'> }]> = [
    ['as written', (c) => ({ mic: perform(c, bank, 44100), options: {} })],
    ['a late microphone taken out by the latency setting, with the song starting late', (c) => ({ mic: delayed(perform(c, bank, 44100), 0.09, 44100), options: { latencySec: 0.09, startJitter: 0.03, octaveTolerance: 'all', a4: 441 } })],
    [
      'a section looped three times with a stall at each wrap',
      (c) => {
        const from = c.notes[2].time - 0.02
        const to = c.notes[6].time - 0.02
        const all = perform(c, bank, 44100)
        const one = all.subarray(Math.round(from * 44100), Math.round(to * 44100))
        const stall = Math.round(0.06 * 44100)
        const mic = new Float32Array(3 * one.length + 2 * stall + 44100)
        for (let p = 0; p < 3; p++) mic.set(one, p * (one.length + stall))
        return { mic, options: { loop: { from, to, passes: 3, wrapStall: 0.06 } } }
      },
    ],
  ]

  it.each(variants)('%s: scoreHeard gives what it gave before', (_name, make) => {
    const c = recordedCases()[0]
    const { mic, options } = make(c)
    const all: SimulationOptions = { sampleRate: 44100, ...options }
    const heard = analyseMic(mic, all)
    const seconds = mic.length / 44100
    const before = scoreHeardBefore(c.notes, c.chart.beats, heard, seconds, all)
    expect(before.summary.perfects + before.summary.goods).toBeGreaterThan(0)
    expect(scoreHeard(c.notes, c.chart.beats, heard, seconds, all)).toEqual(before)
    expect(simulateRun(c.notes, c.chart.beats, mic, all)).toEqual(before)
  })

  it('runHeard drives any tracker with the player\'s clock: count-in first, the start told once, the end closed', () => {
    const calls: string[] = []
    const times: Array<number | null> = []
    const spy: RunTracker = {
      needsSpectrum: false,
      setSpeed: (s) => void calls.push(`speed ${s}`),
      reset: () => void calls.push('reset'),
      seek: (t) => void calls.push(`seek ${t.toFixed(2)}`),
      setRange: (from, to) => void calls.push(`range ${from}-${to}`),
      nextPass: () => void calls.push('pass'),
      markUnscored: () => void calls.push('unscored'),
      advance: (t) => {
        if (t === Number.POSITIVE_INFINITY) calls.push('close')
        return []
      },
      onPlaybackStart: () => void calls.push('start'),
      frame: (_frame, songTime) => {
        if (!calls.includes('frames')) calls.push('frames')
        times.push(songTime)
        return { midi: null, isAttack: false, matches: false, judgement: null }
      },
      stateOfNote: () => undefined,
      summary: () => ({ score: 0, streak: 0, maxStreak: 0, multiplier: 1, perfects: 0, goods: 0, misses: 0, total: 0, judged: 0, accuracy: 0 }),
      toAttemptResult: (o) => ({ perfects: 0, goods: 0, misses: 0, total: 0, timingMedianMs: null, timingStdevMs: null, coverage: 1, durationSec: o.durationSec, playedTempo: o.playedTempo, targetTempo: o.targetTempo, speed: o.speed }),
    }
    const heard = analyseMic(new Float32Array(44100), { sampleRate: 44100 })
    const seen: number[] = []
    const out = runHeard(spy, heard, 1, { sampleRate: 44100, latencySec: 0.1, speed: 0.5 }, (_outcome, wall) => seen.push(wall))
    expect(calls).toEqual(['speed 0.5', 'seek -0.05', 'frames', 'start', 'close'])
    // The count-in comes first, on the song's timeline, with the latency taken off.
    expect(times[0]).toBeLessThan(-0.2)
    expect(times.every((t) => t !== null)).toBe(true)
    expect(seen.length).toBe(heard.length)
    expect(out.result).toMatchObject({ durationSec: 1, speed: 0.5 })
  })
})
