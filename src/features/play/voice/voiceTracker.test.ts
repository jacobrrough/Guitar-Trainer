/**
 * The rules of sung scoring, one at a time, on frames written by hand: what the detector would report
 * for a voice that does exactly one thing. (What a voice through a phone really reports is the business
 * of voice.sim.test.ts.) Every test names the rule it would fail without.
 */
import { describe, expect, it } from 'vitest'
import type { PitchFrame } from '../../../audio/AudioEngine'
import { constantBeatGrid } from '../../../chart/timing'
import { emptyChart, type Chart, type ChartNote, type VoiceCue, type VoiceJudge } from '../../../chart/types'
import { midiToFreq } from '../../../music/pitch'
import { attemptPerformance } from '../../../training/performance'
import { PitchSmoother } from '../pitchTracker'
import { runVerdict } from '../runVerdict'
import type { FrameOutcome } from '../scoreFrame'
import { VOICE, noteWindows, perfectCents, voiceDetector } from './judge'
import { hearVoice } from './simulateVoice'
import { LevelJump, RoomFloor, VoiceEar, foldCents, isVoiced, octavesFrom, steadyMean } from './voiceEar'
import { VoiceTracker, voiceFeedbackOf } from './voiceTracker'

const SR = 44100
/** Seconds between two detector frames. */
const HOP = 512 / SR
/** A frame reports the pitch of the middle of its window, which lies this far before its time stamp. */
const CENTRE = 1024 / SR
const SETTINGS = { clarityThreshold: 0.85, a4: 440 }

type NoteSpec = [time: number, duration: number, midi: number]

function sungChart(specs: NoteSpec[], o: { judge?: Partial<VoiceJudge>; cues?: VoiceCue[]; bpm?: number } = {}): { chart: Chart; notes: ChartNote[] } {
  const bpm = o.bpm ?? 60
  const notes: ChartNote[] = specs.map(([time, duration, midi], id) => ({ id, time, duration, midi, string: 0, fret: 0, velocity: 0.8, chordId: id }))
  const duration = Math.max(...specs.map(([time, length]) => time + length)) + 2
  const midis = [...specs.map((s) => s[2]), ...(o.cues ?? []).map((c) => c.midi)]
  const chart = emptyChart({
    source: 'builtin',
    duration,
    notes,
    beats: constantBeatGrid(bpm, 0, duration),
    tempos: [{ time: 0, bpm }],
    voice: { judge: { band: 80, minShare: 0.5, ...o.judge }, cues: o.cues ?? [], low: Math.min(...midis), high: Math.max(...midis), tonic: 60, shift: 0, lineStarts: [specs[0][0]] },
  })
  return { chart, notes }
}

function trackerFor(specs: NoteSpec[], o: Parameters<typeof sungChart>[1] = {}, sampleRate = SR): VoiceTracker {
  const { chart, notes } = sungChart(specs, o)
  return new VoiceTracker(chart, notes, { sampleRate })
}

/** Something sounding from `from` to `to` (song time): a pitch, or one that moves. */
interface Sound {
  from: number
  to: number
  midi: number | ((t: number) => number)
  rms?: number
  clarity?: number
}

interface Listening {
  /** Where the frames begin (song time); half a second of count-in by default. */
  from?: number
  /** Level of the frames in which nothing sounds. */
  room?: number
  speed?: number
  /** The microphone's sample rate: a frame is 512 samples of it, and its window 2048. 44.1 kHz unless told. */
  sampleRate?: number
  /** The guitar's "Reference pitch" setting, which the player hands over with every frame. 440 unless told. */
  a4?: number
  /** Seconds the player's clock is ahead of the frames it is handed (they come from another thread). None unless told. */
  clockLead?: number
}

const pitchOf = (s: Sound, t: number) => (typeof s.midi === 'number' ? s.midi : s.midi(t))

/** The detector frame whose window is centred on song time `t`, hearing the first of `sounds` that is sounding then. */
function frameAt(sounds: Sound[], t: number, time: number, room = 0.001): PitchFrame {
  const s = sounds.find((x) => t >= x.from && t < x.to)
  return s ? { freq: midiToFreq(pitchOf(s, t)), clarity: s.clarity ?? 0.95, rms: s.rms ?? 0.05, time } : { freq: 0, clarity: 0, rms: room, time }
}

/**
 * Feeds the tracker what a detector would report up to song time `until`, the way the player does:
 * every frame with the song time of its stamp, then the clock.
 */
function listen(tracker: VoiceTracker, sounds: Sound[], until: number, o: Listening = {}): FrameOutcome[] {
  const speed = o.speed ?? 1
  const hop = 512 / (o.sampleRate ?? SR)
  const centre = 1024 / (o.sampleRate ?? SR)
  const settings = { ...SETTINGS, a4: o.a4 ?? SETTINGS.a4 }
  const outcomes: FrameOutcome[] = []
  for (let k = Math.round((o.from ?? -0.5) / speed / hop); k * hop * speed < until; k++) {
    const time = k * hop
    const songTime = time * speed
    // The render loop moves the tracker along with its own clock; the frame it is then handed is older.
    if (o.clockLead) tracker.advance(songTime + o.clockLead * speed)
    outcomes.push(tracker.frame(frameAt(sounds, (time - centre) * speed, time, o.room), songTime, settings))
    tracker.advance(songTime + (o.clockLead ?? 0) * speed)
  }
  return outcomes
}

/** A whole run: the tracker armed at the start, the sounds heard, the run closed. */
function sing(tracker: VoiceTracker, sounds: Sound[], until: number, o: Listening = {}): VoiceTracker {
  tracker.setSpeed(o.speed ?? 1)
  tracker.seek(0)
  listen(tracker, sounds, until, o)
  tracker.advance(Number.POSITIVE_INFINITY)
  return tracker
}

const ONE: NoteSpec[] = [[1, 1, 60]]
const hits = (t: VoiceTracker) => t.summary().perfects + t.summary().goods
const result = (t: VoiceTracker) => t.toAttemptResult({ playedTempo: 60, targetTempo: 60, speed: 1, durationSec: 10 })

describe('the constants and what follows from them', () => {
  it('the judged part of a note leaves out its start and its end, in seconds and never in frames', () => {
    const judge: VoiceJudge = { band: 80, minShare: 0.5 }
    // A long note: 0.12 s for the way in, 0.06 s for the way out.
    expect(noteWindows(1, judge).judged).toBeCloseTo(0.82)
    // A short one gives up a share of itself instead: 30 % and 15 %.
    expect(noteWindows(0.3, judge).judged).toBeCloseTo(0.3 - 0.09 - 0.045)
    // Never under 0.08 s, however short the note.
    expect(noteWindows(0.05, judge).judged).toBeCloseTo(0.08)
  })

  it('credit from outside a note is capped under any share that makes a hit', () => {
    for (const duration of [0.1, 0.2, 0.3, 0.5, 1, 4]) {
      for (const minShare of [0.5, 0.6] as const) {
        const w = noteWindows(duration, { band: 80, minShare })
        expect(w.late, `${duration}`).toBeLessThanOrEqual(0.25)
        expect(w.late, `${duration}`).toBeLessThan(w.need)
        expect(w.need / w.judged, `${duration}`).toBeGreaterThanOrEqual(0.5)
      }
    }
  })

  it('a note under a quarter of a second needs 0.08 s in tune, whatever its share', () => {
    expect(noteWindows(0.2, { band: 80, minShare: 0.5 }).need).toBeCloseTo(0.08)
    expect(noteWindows(0.3, { band: 80, minShare: 0.5 }).need).toBeCloseTo(0.5 * 0.165)
  })

  it('windows are real time: at half speed they are half as long in song time', () => {
    const judge: VoiceJudge = { band: 80, minShare: 0.5 }
    expect(noteWindows(1, judge, 0.5).judged).toBeCloseTo(1 - 0.06 - 0.03)
    expect(noteWindows(1, judge, 0.5).early).toBeCloseTo(0.05)
  })

  it('perfect is relative to the band: 48, 39, 30 and 25 cents, or what the chart says', () => {
    expect([80, 65, 50, 35].map((band) => perfectCents({ band: band as VoiceJudge['band'], minShare: 0.5 }))).toEqual([48, 39, 30, 25])
    expect(perfectCents({ band: 80, minShare: 0.5, perfectCents: 10 })).toBe(10)
  })

  it('the detector listens an octave and a tone either side of the lanes, inside what a voice can do', () => {
    const mid = voiceDetector({ low: 57, high: 69 })
    expect(mid.minFreq).toBeCloseTo(midiToFreq(43))
    expect(mid.maxFreq).toBeCloseTo(midiToFreq(83))
    expect(mid.threshold).toBe(0.9)
    expect(voiceDetector({ low: 40, high: 52 }).minFreq).toBe(60)
    expect(voiceDetector({ low: 72, high: 84 }).maxFreq).toBe(1200)
  })
})

describe('the ear', () => {
  it('folds any octave onto the note and keeps which octave it was', () => {
    expect(foldCents(1230)).toBeCloseTo(30)
    expect(foldCents(-1170)).toBeCloseTo(30)
    expect(foldCents(590)).toBeCloseTo(590)
    expect(foldCents(610)).toBeCloseTo(-590)
    expect(octavesFrom(47.7, 60)).toBe(-1)
    expect(octavesFrom(72.4, 60)).toBe(1)
    expect(octavesFrom(60.3, 60)).toBe(0)
  })

  it('takes a frame for a voice only when it has a pitch, is clear enough and is above the room', () => {
    expect(isVoiced({ freq: 220, clarity: 0.6, rms: 0.004 })).toBe(true)
    expect(isVoiced({ freq: 0, clarity: 0.9, rms: 0.05 })).toBe(false)
    expect(isVoiced({ freq: 220, clarity: 0.59, rms: 0.05 })).toBe(false)
    expect(isVoiced({ freq: 220, clarity: 0.9, rms: 0.0039 })).toBe(false)
    expect(isVoiced({ freq: 220, clarity: 0.9, rms: 0.01 }, 0.012)).toBe(false)
  })

  it('sets the level a voice has to reach from the quiet fifth of what the room sounded like, within limits', () => {
    const floor = new RoomFloor()
    expect(floor.gate).toBe(VOICE.minRms)
    // A room at 0.003 with a click now and then: the clicks do not count.
    for (let i = 0; i < 200; i++) floor.add(i % 10 === 0 ? 0.2 : 0.003)
    expect(floor.gate).toBeCloseTo(Math.max(VOICE.minRms, VOICE.floorFactor * 0.003))
    // A loud room: the gate stops at its cap, or nobody could sing over it.
    const loud = new RoomFloor()
    for (let i = 0; i < 200; i++) loud.add(0.05)
    expect(loud.gate).toBe(VOICE.gateCap)
    // A dead quiet one: never under the least a voice is taken for.
    const dead = new RoomFloor()
    for (let i = 0; i < 200; i++) dead.add(0)
    expect(dead.gate).toBe(VOICE.minRms)
    // A handful of frames is not a measurement.
    const few = new RoomFloor()
    for (let i = 0; i < 5; i++) few.add(0.006)
    expect(few.gate).toBe(VOICE.minRms)
  })

  it('flags a sudden jump in level exactly as the guitar side does, so the count-in check hears the clicks on a sung run too', () => {
    const quiet = (frames: number) => Array.from({ length: frames }, () => 0.001)
    // A click in a quiet room, a faint one, one just under the least level, a loud one that grows, and one while the last still rings.
    const levels = [...quiet(5), 0.05, 0.05, 0.04, 0.02, ...quiet(60), 0.007, 0.005, ...quiet(60), 0.0059, ...quiet(60), 0.3, 0.5, 0.95, 0.4, ...quiet(8), 0.5, ...quiet(80), 0.02]
    const jump = new LevelJump()
    const smoother = new PitchSmoother()
    const ours = levels.map((rms) => jump.push(rms))
    const theirs = levels.map((rms) => smoother.push({ freq: 0, clarity: 0, rms, time: 0 }, 0.85).isAttack)
    expect(ours).toEqual(theirs)
    // The clicks at 0.05, 0.007, 0.3 and 0.02, and 0.95 straight after 0.5; not the one under the least
    // level, nor 0.5 a tenth of a second after 0.95 (the level heard dies away slowly).
    expect(ours.filter(Boolean).length).toBe(5)
    // After a reset the next loud frame is an attack again, as after `PitchSmoother.reset`.
    jump.reset()
    smoother.reset()
    expect(jump.push(0.3)).toBe(true)
    expect(smoother.push({ freq: 0, clarity: 0, rms: 0.3, time: 0 }, 0.85).isAttack).toBe(true)
  })

  const heardMidis = (midis: Array<number | null>) => {
    const ear = new VoiceEar(SR)
    const out: number[] = []
    midis.forEach((midi, k) => {
      const frame = midi === null ? { freq: 0, clarity: 0, rms: 0.001, time: k * HOP } : { freq: midiToFreq(midi), clarity: 0.95, rms: 0.05, time: k * HOP }
      for (const h of ear.listen(frame, k * HOP)) out.push(Math.round(h.midi))
    })
    for (const h of ear.flush()) out.push(Math.round(h.midi))
    return out
  }

  it('drops one frame that is over 900 cents from both its neighbours: the detector slipped', () => {
    expect(heardMidis([60, 60, 79, 60, 60])).toEqual([60, 60, 60, 60])
    expect(heardMidis([60, 60, 41, 60])).toEqual([60, 60, 60])
  })

  it('keeps a leap that stays, a step of 900 cents or less, and a frame with silence beside it', () => {
    expect(heardMidis([60, 60, 79, 79, 79])).toEqual([60, 60, 79, 79, 79])
    expect(heardMidis([60, 68.9, 60])).toEqual([60, 69, 60])
    expect(heardMidis([60, 60, 79, null, 60])).toEqual([60, 60, 79, 60])
    expect(heardMidis([60, 60, 79])).toEqual([60, 60, 79])
  })

  it('gives every heard frame the seconds it stands for, from the time stamps', () => {
    const ear = new VoiceEar(SR)
    const frame = (time: number): PitchFrame => ({ freq: 440, clarity: 0.95, rms: 0.05, time })
    expect(ear.listen(frame(1), 1)[0].seconds).toBeCloseTo(HOP)
    expect(ear.listen(frame(1 + HOP), 1)[0].seconds).toBeCloseTo(HOP)
    // The stream stopped for a while (a pause): the next frame does not stand for the pause.
    expect(ear.listen(frame(9), 1)[0].seconds).toBeCloseTo(HOP)
  })

  it('the steady mean: a swing around the note averages out, a steady offset does not, and a stranger in the window forbids it', () => {
    const swing = Array.from({ length: 15 }, (_, k) => ({ cents: 70 * Math.sin((2 * Math.PI * k) / 15), seconds: HOP }))
    expect(Math.abs(steadyMean(swing)!)).toBeLessThan(5)
    const flat = Array.from({ length: 15 }, () => ({ cents: -70, seconds: HOP }))
    expect(steadyMean(flat)).toBeCloseTo(-70)
    // Too little to tell (under 0.09 s).
    expect(steadyMean(swing.slice(0, 6))).toBeNull()
    // One frame over 150 cents away: this is not vibrato.
    expect(steadyMean([...swing, { cents: 160, seconds: HOP }])).toBeNull()
  })
})

describe('in tune, in any octave', () => {
  it('a note sung where it is written, an octave lower or an octave higher counts; a fifth away does not', () => {
    for (const [midi, octave] of [[60, 0], [48, -1], [72, 1]] as const) {
      const t = sing(trackerFor(ONE), [{ from: 1, to: 2, midi }], 3)
      expect(t.stateOfNote(0), `${midi}`).toMatchObject({ status: 'hit', judgement: 'perfect' })
      expect(t.progressOf(0)?.octave, `${midi}`).toBe(octave)
    }
    expect(sing(trackerFor(ONE), [{ from: 1, to: 2, midi: 67 }], 3).stateOfNote(0)?.status).toBe('miss')
  })

  it('60 cents flat is inside a band of 80 and outside a band of 50', () => {
    const wide = sing(trackerFor(ONE, { judge: { band: 80 } }), [{ from: 1, to: 2, midi: 59.4 }], 3)
    expect(wide.stateOfNote(0)?.status).toBe('hit')
    const narrow = sing(trackerFor(ONE, { judge: { band: 50 } }), [{ from: 1, to: 2, midi: 59.4 }], 3)
    expect(narrow.stateOfNote(0)?.status).toBe('miss')
    expect(narrow.progressOf(0)).toMatchObject({ share: 0, reason: 'low' })
    expect(narrow.progressOf(0)?.cents).toBeCloseTo(-60, 0)
  })

  it('one held pitch cannot satisfy two notes a whole tone apart, not even from half way between them', () => {
    const two: NoteSpec[] = [[1, 1, 60], [2, 1, 62]]
    expect(hits(sing(trackerFor(two), [{ from: 1, to: 3, midi: 61 }], 4))).toBe(0)
    // On the first note's own pitch: that one counts, the other does not.
    const t = sing(trackerFor(two), [{ from: 1, to: 3, midi: 60 }], 4)
    expect(t.stateOfNote(0)?.status).toBe('hit')
    expect(t.stateOfNote(1)?.status).toBe('miss')
  })
})

describe('perfect or good', () => {
  const judgementAt = (band: VoiceJudge['band'], cents: number, perfectWithin?: number) =>
    sing(trackerFor(ONE, { judge: { band, perfectCents: perfectWithin } }), [{ from: 1, to: 2, midi: 60 + cents / 100 }], 3).stateOfNote(0)?.judgement

  it('a singer comfortably inside the band is perfect: 30 cents flat at bands 80, 65 and 50', () => {
    expect(judgementAt(80, -30)).toBe('perfect')
    expect(judgementAt(65, -30)).toBe('perfect')
    expect(judgementAt(50, -30)).toBe('perfect')
  })

  it('a singer near the edge of the band is good: the limit is 0.6 of the band, and never under 25 cents', () => {
    expect(judgementAt(80, -45)).toBe('perfect')
    expect(judgementAt(80, -60)).toBe('good')
    expect(judgementAt(65, -45)).toBe('good')
    expect(judgementAt(35, 24)).toBe('perfect')
    expect(judgementAt(35, 30)).toBe('good')
  })

  it('the chart can set its own limit', () => {
    expect(judgementAt(80, -30, 10)).toBe('good')
    expect(judgementAt(80, -8, 10)).toBe('perfect')
  })

  it('a hit with less than four fifths of the note in tune is good', () => {
    // 0.5 s of a judged 0.82 s: 61 %.
    const t = sing(trackerFor(ONE), [{ from: 1.2, to: 1.7, midi: 60 }], 3)
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'good' })
    expect(t.progressOf(0)?.share).toBeCloseTo(0.5 / 0.82, 1)
  })

  it('the share that makes a hit is the chart\'s: 55 % is a hit at 0.5 and a miss at 0.6', () => {
    const sounds = [{ from: 1.2, to: 1.2 + 0.55 * 0.82, midi: 60 }]
    expect(sing(trackerFor(ONE, { judge: { minShare: 0.5 } }), sounds, 3).stateOfNote(0)?.status).toBe('hit')
    const strict = sing(trackerFor(ONE, { judge: { minShare: 0.6 } }), sounds, 3)
    expect(strict.stateOfNote(0)?.status).toBe('miss')
    expect(strict.progressOf(0)?.reason).toBe('unsteady')
  })
})

describe('each frame is credited to one note at most', () => {
  const FOUR: NoteSpec[] = [[1, 0.5, 60], [1.5, 0.5, 64], [2, 0.5, 67], [2.5, 0.5, 72]]
  const judged = 0.5 - 0.12 - 0.06

  it('one sung note does not pay for two written ones of the same pitch', () => {
    const twice: NoteSpec[] = [[1, 0.5, 60], [1.5, 0.5, 60]]
    const second = sing(trackerFor(twice), [{ from: 1.5, to: 2, midi: 60 }], 3)
    expect(second.stateOfNote(0)?.status).toBe('miss')
    expect(second.stateOfNote(1)?.status).toBe('hit')
    const first = sing(trackerFor(twice), [{ from: 1, to: 1.5, midi: 60 }], 3)
    expect(first.stateOfNote(0)?.status).toBe('hit')
    expect(first.stateOfNote(1)?.status).toBe('miss')
  })

  it('a singer a little late is still on the note: 150 ms late counts in full', () => {
    const late = FOUR.map(([time, duration, midi]) => ({ from: time + 0.15, to: time + duration + 0.15, midi }))
    const t = sing(trackerFor(FOUR), late, 4)
    expect(t.summary()).toMatchObject({ perfects: 4, goods: 0, misses: 0 })
  })

  it('late credit is capped: a singer a whole note behind hits nothing', () => {
    // Each pitch is sung while the next note is due.
    const behind = FOUR.map(([time, duration, midi]) => ({ from: time + 0.5, to: time + duration + 0.5, midi }))
    const t = sing(trackerFor(FOUR), behind, 4)
    expect(hits(t)).toBe(0)
    for (const id of [0, 1, 2]) {
      // The credit did flow to the note before, and stopped at 35 % of it.
      expect(t.progressOf(id)!.share, `note ${id}`).toBeGreaterThan(0.25)
      expect(t.progressOf(id)!.share, `note ${id}`).toBeLessThanOrEqual(VOICE.outsideShare + HOP / judged)
    }
  })

  it('early credit is capped the same way: a singer a whole note ahead hits nothing', () => {
    const ahead = FOUR.map(([time, duration, midi]) => ({ from: time - 0.5, to: time + duration - 0.5, midi }))
    const t = sing(trackerFor(FOUR), ahead, 4)
    expect(hits(t)).toBe(0)
    for (const id of [1, 2, 3]) expect(t.progressOf(id)!.share, `note ${id}`).toBeLessThanOrEqual(VOICE.outsideShare + HOP / judged)
  })

  it('early and late credit together stay under the cap: a note sung only before and after its own time is missed', () => {
    // The second note's pitch, in the last tenth of a second of the first note and again right after its own end.
    const around = [
      { from: 1.4, to: 1.5, midi: 64 },
      { from: 2, to: 2.11, midi: 64 },
    ]
    const t = sing(trackerFor(FOUR), around, 4)
    expect(t.stateOfNote(1)?.status).toBe('miss')
    expect(t.progressOf(1)!.share).toBeLessThanOrEqual(VOICE.outsideShare + HOP / judged)
    expect(t.progressOf(1)!.share).toBeGreaterThan(0.25)
  })

  it('a quick note needs 0.08 s in tune: more than half of its judged length is not enough when that is less', () => {
    const quick: NoteSpec[] = [[1, 0.2, 60]]
    // Judged 0.11 s. 0.065 s in tune is 59 % of it, and too little to tell a note from a slip.
    expect(sing(trackerFor(quick), [{ from: 1.06, to: 1.125, midi: 60 }], 2).stateOfNote(0)?.status).toBe('miss')
    expect(sing(trackerFor(quick), [{ from: 1.06, to: 1.16, midi: 60 }], 2).stateOfNote(0)?.status).toBe('hit')
  })

  it('the way into a note and the way out of it are not required: a scoop and an early breath cost nothing', () => {
    const t = sing(trackerFor(ONE), [
      { from: 1, to: 1.12, midi: 58 },
      { from: 1.12, to: 1.94, midi: 60 },
    ], 3)
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
    expect(t.progressOf(0)!.share).toBeGreaterThan(0.97)
    // The frames of the scoop are not held against the note's tuning either.
    expect(Math.abs(t.progressOf(0)!.cents!)).toBeLessThan(1)
    // Even when the scoop is the longer part: a short note scooped into, on pitch for a moment and let
    // go was on the note, not for long enough. It was not "under the note".
    const short = sing(trackerFor([[1, 0.4, 60]]), [
      { from: 1, to: 1.12, midi: 58 },
      { from: 1.12, to: 1.21, midi: 60 },
    ], 3)
    expect(short.progressOf(0)).toMatchObject({ status: 'miss', reason: 'unsteady' })
    expect(Math.abs(short.progressOf(0)!.cents!)).toBeLessThan(1)
  })
})

describe('long notes', () => {
  const LONG: NoteSpec[] = [[1, 4, 60]]

  it('with sustain on, a note of a beat or more that is let go more than 0.25 s early is good at most', () => {
    const early = [{ from: 1, to: 4.6, midi: 60 }]
    expect(sing(trackerFor(LONG, { judge: { sustain: true } }), early, 6).stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'good' })
    expect(sing(trackerFor(LONG), early, 6).stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
  })

  it('held to within 0.25 s of its end it is perfect', () => {
    expect(sing(trackerFor(LONG, { judge: { sustain: true } }), [{ from: 1, to: 4.8, midi: 60 }], 6).stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
  })

  it('a note shorter than a beat is not asked to be held', () => {
    // On the note from a tenth of a second before it, and let go 0.26 s before its end.
    const sounds = [{ from: 0.9, to: 1.24, midi: 60 }]
    // Half a second is half a beat at 60 bpm: nothing is asked.
    expect(sing(trackerFor([[1, 0.5, 60]], { judge: { sustain: true }, bpm: 60 }), sounds, 3).stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
    // At 120 bpm the same half second is a whole beat.
    expect(sing(trackerFor([[1, 0.5, 60]], { judge: { sustain: true }, bpm: 120 }), sounds, 3).stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'good' })
  })

  it('vibrato: a swing of 70 cents around the note is on the note, at a band of 50', () => {
    const swing = (t: number) => 60 + 0.7 * Math.sin(2 * Math.PI * 6 * (t - 1))
    const t = sing(trackerFor([[1, 2, 60]], { judge: { band: 50 } }), [{ from: 1, to: 3, midi: swing }], 4)
    // Frame by frame only half of it is inside the band: the rest counts through the mean.
    expect(t.progressOf(0)!.share).toBeGreaterThan(0.9)
    expect(t.stateOfNote(0)?.judgement).toBe('perfect')
  })

  it('a steady 70 cents flat is not vibrato', () => {
    const t = sing(trackerFor([[1, 2, 60]], { judge: { band: 50 } }), [{ from: 1, to: 3, midi: 59.3 }], 4)
    expect(t.stateOfNote(0)?.status).toBe('miss')
    expect(t.progressOf(0)!.share).toBe(0)
  })

  it('a steady offset is not made into vibrato by the step before it', () => {
    // A falling semitone at a band of 50, sung 60 cents flat throughout: the first note's flat pitch is
    // 40 cents above the second, so for a moment the frames of both share the window and average out.
    const step: NoteSpec[] = [[1, 0.6, 65], [1.6, 0.6, 64]]
    const onTime = sing(trackerFor(step, { judge: { band: 50 } }), [
      { from: 1, to: 1.6, midi: 64.4 },
      { from: 1.6, to: 2.2, midi: 63.4 },
    ], 4)
    expect(hits(onTime)).toBe(0)
    expect(onTime.progressOf(1)).toMatchObject({ status: 'miss', reason: 'low' })
    expect(onTime.progressOf(1)!.share).toBeLessThanOrEqual(VOICE.outsideShare + 0.03)
    // The same singer changing note a tenth of a second late: that tenth is on the second note, the rest is not.
    const late = sing(trackerFor(step, { judge: { band: 50 } }), [
      { from: 1, to: 1.7, midi: 64.4 },
      { from: 1.7, to: 2.2, midi: 63.4 },
    ], 4)
    expect(late.stateOfNote(1)?.status).toBe('miss')
    expect(late.progressOf(1)!.share).toBeLessThan(0.5)
  })

  it('a detector slip in the middle of vibrato does not break it', () => {
    const swing = (t: number) => {
      const k = Math.round(t / HOP)
      return k % 8 === 0 ? 79 : 60 + 0.7 * Math.sin(2 * Math.PI * 6 * (t - 1))
    }
    const t = sing(trackerFor([[1, 2, 60]], { judge: { band: 50 } }), [{ from: 1, to: 3, midi: swing }], 4)
    // An eighth of the frames is lost with the slips; everything else is on the note.
    expect(t.progressOf(0)!.share).toBeGreaterThan(0.85)
    expect(t.stateOfNote(0)?.judgement).toBe('perfect')
  })
})

describe('what is taken for a voice', () => {
  it('an unclear frame, or one under the least level, is not singing', () => {
    const unclear = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: 60, clarity: 0.55 }], 3)
    expect(unclear.stateOfNote(0)?.status).toBe('miss')
    expect(unclear.progressOf(0)?.reason).toBe('silent')
    const faint = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: 60, rms: 0.003 }], 3)
    expect(faint.stateOfNote(0)?.status).toBe('miss')
    expect(result(faint).coverage).toBe(0)
  })

  it('a pitch that is not held from one frame to the next is not a voice: a drum falling through the note counts for nothing', () => {
    // Two and a half semitones down in every frame, through the note's pitch again and again.
    const falling = (t: number) => 66 - ((Math.round(t / HOP) % 6) * 2.5)
    const drum = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: falling }], 3)
    expect(drum.progressOf(0)).toMatchObject({ status: 'miss', share: 0, reason: 'silent' })
    expect(result(drum).coverage).toBe(0)
    // A slow slide through the note is a voice, on the note for as long as it is inside the band.
    const slide = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: (t) => 59 + 2 * (t - 1) }], 3)
    expect(slide.stateOfNote(0)?.status).toBe('hit')
    expect(slide.progressOf(0)!.share).toBeCloseTo(0.8 / 0.82, 1)
    // An octave is not a jump: a low voice the detector flips on is still heard.
    const flipping = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: (t) => (Math.round(t / HOP) % 4 < 2 ? 60 : 48) }], 3)
    expect(flipping.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
  })

  it('the room heard in the count-in sets the level: what clears a quiet room does not clear a noisy one', () => {
    const level = VOICE.floorFactor * 0.005 * 0.9
    expect(level).toBeGreaterThan(VOICE.minRms)
    const sounds = [{ from: 1, to: 2, midi: 60, rms: level }]
    expect(sing(trackerFor(ONE), sounds, 3, { from: -2, room: 0.0005 }).stateOfNote(0)?.status).toBe('hit')
    expect(sing(trackerFor(ONE), sounds, 3, { from: -2, room: 0.005 }).stateOfNote(0)?.status).toBe('miss')
    // And the cap: in a loud room a voice of 0.025 still counts.
    expect(sing(trackerFor(ONE), [{ from: 1, to: 2, midi: 60, rms: 0.025 }], 3, { from: -2, room: 0.012 }).stateOfNote(0)?.status).toBe('hit')
  })

  it('only the count-in tells about the room: loud singing does not raise the level for what follows', () => {
    // Nearly six seconds of full voice, then a soft note. Were the song itself taken for the room, the soft note would be under it.
    const t = sing(trackerFor([[0.2, 5.6, 60], [6, 1, 60]]), [
      { from: 0.2, to: 5.8, midi: 60, rms: 0.3 },
      { from: 6, to: 7, midi: 60, rms: 0.006 },
    ], 8)
    expect(hits(t)).toBe(2)
  })
})

describe('the app\'s own cues', () => {
  const cue: VoiceCue = { time: 1, duration: 1, midi: 60 }

  it('nothing heard while a cue sounds, or in the 0.3 s after it, is credited', () => {
    // A note that (against the builders\' rule) starts right after the cue, on the cue\'s pitch.
    const t = sing(trackerFor([[2.1, 1, 60]], { cues: [cue] }), [{ from: 1, to: 2.3, midi: 60 }], 4)
    expect(t.progressOf(0)!.share).toBe(0)
    expect(t.stateOfNote(0)?.status).toBe('miss')
    // Not even as "something was heard": a speaker is not a singer.
    expect(t.progressOf(0)?.reason).toBe('silent')
    expect(result(t).coverage).toBe(0)
  })

  it('what is sung after the guard counts', () => {
    const t = sing(trackerFor([[2.1, 1, 60]], { cues: [cue] }), [{ from: 2.3, to: 3.1, midi: 60 }], 4)
    expect(t.stateOfNote(0)?.status).toBe('hit')
    expect(t.progressOf(0)!.share).toBeGreaterThan(0.9)
  })

  it('the guard opens a little before the cue', () => {
    // A note ending where the cue begins: its last 0.05 s are already the cue\'s.
    const t = sing(trackerFor([[0.5, 0.5, 60]], { cues: [cue] }), [{ from: 0.955, to: 1, midi: 60 }], 3)
    expect(t.progressOf(0)!.share).toBe(0)
  })

  it('a run in which only the cue sounded is not a run with misses: nothing was heard', () => {
    const t = sing(trackerFor([[3, 1, 60], [4, 1, 62]], { cues: [cue] }), [{ from: 1, to: 2, midi: 60 }], 6)
    expect(t.summary()).toMatchObject({ perfects: 0, goods: 0, misses: 2 })
    expect(runVerdict(t.summary(), result(t))).toBe('unscored')
  })

  describe('heard through the microphone', () => {
    const answer: NoteSpec[] = [[3, 1, 60], [7, 1, 62]]
    const cues: VoiceCue[] = [cue, { time: 5, duration: 1, midi: 62 }]

    it('a cue that arrives on time and on pitch is the speaker', () => {
      const t = sing(trackerFor(answer, { cues }), [{ from: 1.02, to: 2, midi: 60 }], 9)
      expect(t.ownSoundHeard()).toBe(true)
    })

    it('every cue is looked at, not only the first', () => {
      const t = sing(trackerFor(answer, { cues }), [{ from: 5.02, to: 6, midi: 62 }], 9)
      expect(t.ownSoundHeard()).toBe(true)
    })

    it('silence during the cues is headphones', () => {
      const t = sing(trackerFor(answer, { cues }), [
        { from: 3, to: 4, midi: 60 },
        { from: 7, to: 8, midi: 62 },
      ], 9)
      expect(t.ownSoundHeard()).toBe(false)
      expect(hits(t)).toBe(2)
    })

    it('a person humming along starts later than a speaker does', () => {
      const t = sing(trackerFor(answer, { cues }), [{ from: 1.25, to: 2, midi: 60 }], 9)
      expect(t.ownSoundHeard()).toBe(false)
    })

    it('someone already on the note before the cue began is not the speaker either', () => {
      const t = sing(trackerFor(answer, { cues }), [{ from: 0.5, to: 2, midi: 60 }], 9)
      expect(t.ownSoundHeard()).toBe(false)
    })

    it('another pitch during the cue, or a moment of the right one, is not the cue', () => {
      expect(sing(trackerFor(answer, { cues }), [{ from: 1.02, to: 2, midi: 61 }], 9).ownSoundHeard()).toBe(false)
      expect(sing(trackerFor(answer, { cues }), [{ from: 1.02, to: 1.1, midi: 60 }], 9).ownSoundHeard()).toBe(false)
    })

    it('a new run starts with a clean slate', () => {
      const t = sing(trackerFor(answer, { cues }), [{ from: 1.02, to: 2, midi: 60 }], 9)
      t.reset()
      expect(t.ownSoundHeard()).toBe(false)
    })
  })
})

describe('while the run is going', () => {
  it('a note fills as it is sung and is settled a moment after its end, not before', () => {
    const t = trackerFor(ONE)
    t.seek(0)
    listen(t, [{ from: 1, to: 2, midi: 60 }], 1.5)
    expect(t.stateOfNote(0)?.status).toBe('pending')
    const half = t.progressOf(0)!.share
    expect(half).toBeGreaterThan(0.4)
    expect(half).toBeLessThan(0.65)
    // The late window (0.25 s for a long note) is still open at the note's end.
    listen(t, [{ from: 1, to: 2, midi: 60 }], 2.2, { from: 1.5 })
    expect(t.stateOfNote(0)?.status).toBe('pending')
    const outcomes = listen(t, [], 2.6, { from: 2.2 })
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
    // The frame that follows the verdict carries it, once.
    expect(outcomes.filter((o) => o.judgement === 'perfect').length).toBe(1)
  })

  it('a verdict reached by the clock is still handed to the next frame', () => {
    const t = trackerFor(ONE)
    t.seek(0)
    listen(t, [{ from: 1, to: 2, midi: 60 }], 2.1)
    expect(t.advance(3)).toEqual([])
    expect(t.stateOfNote(0)?.status).toBe('hit')
    expect(t.frame({ freq: 0, clarity: 0, rms: 0.001, time: 3 }, 3, SETTINGS).judgement).toBe('perfect')
    expect(t.frame({ freq: 0, clarity: 0, rms: 0.001, time: 3 + HOP }, 3 + HOP, SETTINGS).judgement).toBeNull()
  })

  it('the clock passing a note nobody sang returns it as missed, in the shape the highway knows', () => {
    const t = trackerFor([[1, 1, 60], [2, 1, 62]])
    t.seek(0)
    expect(t.advance(2.2)).toEqual([])
    const missed = t.advance(2.5)
    expect(missed.length).toBe(1)
    expect(missed[0]).toMatchObject({ status: 'miss', group: { time: 1, chordId: 0, notes: [{ id: 0, midi: 60 }] } })
    expect(t.stateOfNote(0)?.status).toBe('miss')
    expect(t.stateOfNote(1)?.status).toBe('pending')
  })

  it('reports the pitch it hears for the dot, unrounded and in its own octave, and whether it is on a note', () => {
    const t = trackerFor(ONE)
    t.seek(0)
    const before = listen(t, [], 0.5)
    expect(before.every((o) => o.midi === null && !o.matches)).toBe(true)
    const during = listen(t, [{ from: 1, to: 2, midi: 47.7 }], 1.8, { from: 1.2 })
    expect(during[during.length - 1].midi).toBeCloseTo(47.7, 3)
    expect(during[during.length - 1].matches).toBe(true)
    const off = listen(t, [{ from: 1, to: 2, midi: 50 }], 1.95, { from: 1.85 })
    expect(off[off.length - 1].matches).toBe(false)
  })

  it('the level heard a moment ago outlives a reset and starts afresh when the song\'s sound starts, as the guitar side\'s smoother does', () => {
    const t = trackerFor(ONE)
    const loud = (k: number) => t.frame({ freq: 0, clarity: 0, rms: 0.3, time: k * HOP }, null, SETTINGS).isAttack
    expect(loud(0)).toBe(true)
    expect(loud(1)).toBe(false)
    t.reset()
    expect(loud(2)).toBe(false)
    t.onPlaybackStart()
    expect(loud(3)).toBe(true)
  })

  it('one stray reading does not make the dot jump: it shows the middle one of the last three', () => {
    const t = trackerFor(ONE)
    const shown = [60, 60, 60.4, 60, 60].map((midi, k) => t.frame({ freq: midiToFreq(midi), clarity: 0.95, rms: 0.05, time: k * HOP }, null, SETTINGS).midi)
    for (const midi of shown) expect(midi).toBeCloseTo(60, 3)
    // Silence empties it: the next pitch is shown as it is.
    t.frame({ freq: 0, clarity: 0, rms: 0.001, time: 5 * HOP }, null, SETTINGS)
    expect(t.frame({ freq: midiToFreq(62), clarity: 0.95, rms: 0.05, time: 6 * HOP }, null, SETTINGS).midi).toBeCloseTo(62, 3)
  })

  it('outside a run it still shows the pitch and touches nothing', () => {
    const t = trackerFor(ONE)
    t.seek(0)
    for (let k = 0; k < 200; k++) t.frame({ freq: midiToFreq(60), clarity: 0.95, rms: 0.05, time: k * HOP }, null, SETTINGS)
    const out = t.frame({ freq: midiToFreq(60), clarity: 0.95, rms: 0.05, time: 200 * HOP }, null, SETTINGS)
    expect(out).toMatchObject({ matches: false, judgement: null })
    expect(out.midi).toBeCloseTo(60, 3)
    expect(t.progressOf(0)!.share).toBe(0)
    expect(t.summary().judged).toBe(0)
  })

  it('at half speed a quarter of a note is still a quarter of a note', () => {
    // The note lasts two seconds of real time; half a second of it is sung.
    const t = sing(trackerFor(ONE), [{ from: 1.3, to: 1.55, midi: 60 }], 3, { speed: 0.5 })
    expect(t.progressOf(0)!.share).toBeCloseTo(0.25 / 0.91, 1)
    expect(t.stateOfNote(0)?.status).toBe('miss')
  })
})

describe('parts of a piece', () => {
  const EIGHT: NoteSpec[] = [[0, 0.5, 60], [0.5, 0.5, 62], [1, 0.5, 64], [1.5, 0.5, 65], [2, 0.5, 67], [2.5, 0.5, 65], [3, 0.5, 64], [3.5, 0.5, 62]]
  const asSounds = (specs: NoteSpec[]) => specs.map(([time, duration, midi]) => ({ from: time, to: time + duration, midi }))

  it('a run begun in the middle skips what came before: skipped, not missed', () => {
    const t = trackerFor(EIGHT)
    t.seek(2)
    listen(t, asSounds(EIGHT), 5, { from: 1.5 })
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.summary()).toMatchObject({ total: 4, perfects: 4, misses: 0 })
    expect(t.stateOfNote(0)?.status).toBe('skipped')
  })

  it('a range limits scoring to the notes that start inside it', () => {
    const t = trackerFor(EIGHT)
    t.seek(1)
    t.setRange(1, 2)
    listen(t, asSounds(EIGHT), 5, { from: 0.5 })
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.summary()).toMatchObject({ total: 2, perfects: 2, misses: 0 })
    expect(t.stateOfNote(4)?.status).toBe('skipped')
  })

  /** A section loop the way the player runs it: the song position wraps, the tracker is told, the sound arrives `lag` late. */
  function loop(t: VoiceTracker, from: number, to: number, passes: number, lag: number, sung: (pass: number) => boolean): VoiceTracker {
    const length = to - from
    t.seek(from - lag)
    t.setRange(from, to)
    let pass = 0
    for (let k = Math.round(-0.5 / HOP); k * HOP < passes * length + 0.3; k++) {
      const wall = k * HOP
      const p = wall < 0 ? 0 : Math.min(passes - 1, Math.floor(wall / length))
      if (p > pass) {
        t.nextPass()
        pass = p
      }
      const position = from + (wall < 0 ? wall : wall - p * length)
      // What reaches the detector now was sung `lag` ago.
      const then = wall - lag - CENTRE
      const thenPass = Math.floor(then / length)
      const thenAt = from + then - thenPass * length
      const sounds = then >= 0 && thenPass < passes && sung(thenPass) ? asSounds(EIGHT) : []
      t.frame(frameAt(sounds, thenAt, wall), position - lag, SETTINGS)
      t.advance(position - lag)
    }
    t.advance(Number.POSITIVE_INFINITY)
    return t
  }

  it('loop passes add up: two passes of four notes are eight, and a silent pass is four misses', () => {
    const both = loop(trackerFor(EIGHT), 0, 2, 2, 0, () => true)
    expect(both.summary()).toMatchObject({ total: 8, perfects: 8, misses: 0, score: 800 })
    const one = loop(trackerFor(EIGHT), 0, 2, 2, 0, (pass) => pass === 0)
    expect(one.summary()).toMatchObject({ total: 8, perfects: 4, misses: 4 })
    expect(result(one).coverage).toBeCloseTo(0.5)
  })

  it('the last note of a pass still counts in full when half of its sound arrives after the wrap', () => {
    const t = loop(trackerFor(EIGHT), 0, 2, 3, 0.25, () => true)
    // Perfect, which takes four fifths of the note: what was heard before the wrap is under three quarters of it.
    expect(t.summary()).toMatchObject({ total: 12, perfects: 12, misses: 0 })
  })

  it('a note carried over the wrap keeps when it began: one note on repeat is as late as it was sung, not a loop late', () => {
    // The loop is the last half second: every pass's note is still on its way when the loop wraps.
    const t = loop(trackerFor(EIGHT), 1.5, 2, 9, 0.25, () => true)
    expect(t.summary()).toMatchObject({ total: 9, misses: 0 })
    expect(result(t).timingMedianMs).toBeGreaterThanOrEqual(0)
    expect(result(t).timingMedianMs).toBeLessThan(60)
  })

  it('what arrives after the wrap is judged where it was sung: a cue before the loop does not silence the end of the loop', () => {
    // The loop is the second half; a cue sounds just before it, where the late frames of each pass land on the clock.
    const { chart, notes } = sungChart(EIGHT, { cues: [{ time: 1.5, duration: 0.3, midi: 65 }] })
    const t = loop(new VoiceTracker(chart, notes, { sampleRate: SR }), 2, 4, 3, 0.25, () => true)
    expect(t.summary()).toMatchObject({ total: 12, perfects: 12, misses: 0 })
  })

  it('the bars of a loop report every pass', () => {
    const t = loop(trackerFor(EIGHT, { bpm: 120 }), 0, 2, 2, 0, (pass) => pass === 0)
    // 120 bpm: a bar is two seconds, so the loop is bar 1; it was sung once out of twice.
    expect(result(t).perBar?.[0]).toBeCloseTo(0.5)
  })

  it('a run without a microphone is not scored at all', () => {
    const t = trackerFor(EIGHT)
    t.seek(0)
    t.markUnscored()
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.summary()).toMatchObject({ total: 0, judged: 0, perfects: 0, goods: 0, misses: 0, accuracy: 0 })
    expect(result(t).total).toBe(0)
    expect(runVerdict(t.summary(), result(t))).toBe('unscored')
  })

  it('reset forgets the run', () => {
    const t = sing(trackerFor(EIGHT), asSounds(EIGHT), 5)
    expect(hits(t)).toBe(8)
    t.reset()
    expect(t.summary()).toMatchObject({ total: 8, judged: 0, perfects: 0, score: 0, streak: 0, maxStreak: 0 })
    expect(t.stateOfNote(0)?.status).toBe('pending')
    expect(t.progressOf(0)!.share).toBe(0)
  })
})

describe('the result of a run', () => {
  // Nine notes of half a second in two-second bars (120 bpm); the top note is the fifth.
  const NINE: NoteSpec[] = [0, 2, 4, 5, 7, 5, 4, 2, 0].map((semis, i) => [1 + i * 0.5, 0.5, 60 + semis] as NoteSpec)
  const sungAs = (change: (spec: NoteSpec, i: number) => Sound | null) =>
    NINE.map((spec, i) => change(spec, i)).filter((s): s is Sound => s !== null)
  const plain = ([time, duration, midi]: NoteSpec): Sound => ({ from: time + 0.05, to: time + duration, midi })

  it('counts perfects, goods and misses, and scores 100 for a perfect and 80 for a good', () => {
    // The top note is left out; the second note is 60 cents flat (good at a band of 80).
    const t = sing(trackerFor(NINE, { bpm: 120 }), sungAs((spec, i) => (i === 4 ? null : i === 1 ? { ...plain(spec), midi: spec[2] - 0.6 } : plain(spec))), 7)
    const s = t.summary()
    expect(s).toMatchObject({ perfects: 7, goods: 1, misses: 1, total: 9, judged: 9, score: 780, multiplier: 1, maxStreak: 4, streak: 4 })
    expect(s.accuracy).toBeCloseTo(8 / 9)
    const r = result(t)
    expect(r).toMatchObject({ perfects: 7, goods: 1, misses: 1, total: 9, timingStdevMs: null, playedTempo: 60, targetTempo: 60, speed: 1, durationSec: 10 })
    // The Coach counts a good as 0.8.
    expect(attemptPerformance(r).acc).toBeCloseTo((7 + 0.8) / 9)
    expect(r.coverage).toBeCloseTo(8 / 9)
    // Bars of two seconds: the first two notes in bar 1, the next four in bar 2, the last three in bar 3; the miss is in bar 2.
    expect(r.perBar).toEqual([1, 0.75, 1])
    // The top note was not heard: the sign that the key sits too high.
    expect(r.voice).toMatchObject({ topMissed: 1 })
    expect(Math.abs(r.voice!.medianCents!)).toBeLessThan(1)
  })

  it('reports how late the notes began, as measured, once there are eight hits', () => {
    const t = sing(trackerFor(NINE, { bpm: 120 }), sungAs(plain), 7)
    expect(hits(t)).toBe(9)
    const r = result(t)
    // Sung 50 ms after each note's start. A frame is 12 ms, and a pitch is held from its second frame on.
    expect(r.timingMedianMs).toBeGreaterThan(55)
    expect(r.timingMedianMs).toBeLessThan(80)
    expect(r.timingStdevMs).toBeNull()
    const seven = sing(trackerFor(NINE, { bpm: 120 }), sungAs((spec, i) => (i < 7 ? plain(spec) : null)), 7)
    expect(hits(seven)).toBe(7)
    expect(result(seven).timingMedianMs).toBeNull()
  })

  it('times the frames with the microphone\'s sample rate, also when it is only known once frames arrive', () => {
    const { chart, notes } = sungChart(NINE, { bpm: 120 })
    // The frames here come 11.6 ms apart whatever rate the tracker is told. So each note is begun 80 ms
    // in: a rest of 50 ms would be one dropped frame to a tracker that believes its frames are 23 ms long,
    // and the first frame after it part of the same held sound.
    const begun = ([time, duration, midi]: NoteSpec): Sound => ({ from: time + 0.08, to: time + duration, midi })
    const timing = (sampleRate: number | (() => number)) => result(sing(new VoiceTracker(chart, notes, { sampleRate }), sungAs(begun), 7)).timingMedianMs!
    expect(timing(() => SR)).toBeCloseTo(timing(SR), 6)
    // At half the rate the middle of a frame's window lies 23 ms further back: every note begins that much earlier.
    expect(timing(SR) - timing(() => SR / 2)).toBeCloseTo(1000 * CENTRE, 0)
  })

  it('the median distance from the notes is signed, and null when nothing was heard', () => {
    const flat = sing(trackerFor(NINE, { bpm: 120 }), sungAs((spec) => ({ ...plain(spec), midi: spec[2] - 0.3 })), 7)
    expect(result(flat).voice!.medianCents).toBeCloseTo(-30, 0)
    const silent = sing(trackerFor(NINE, { bpm: 120 }), [], 7)
    // Three of the nine notes lie in the top three semitones, and none of them was heard.
    expect(result(silent).voice).toEqual({ medianCents: null, topMissed: 3 })
    expect(result(silent).coverage).toBe(0)
    expect(runVerdict(silent.summary(), result(silent))).toBe('unscored')
  })

  it('a top note that came out low counts towards "the key sits too high"; one that came out high, or a low note, does not', () => {
    const top = (cents: number) => sing(trackerFor(NINE, { bpm: 120, judge: { band: 50 } }), sungAs((spec, i) => (i === 4 ? { ...plain(spec), midi: spec[2] + cents / 100 } : plain(spec))), 7)
    expect(result(top(-90)).voice!.topMissed).toBe(1)
    expect(result(top(90)).voice!.topMissed).toBe(0)
    // The two notes next to the top (5 semitones above home, 2 under the top) are in the top three semitones as well.
    const nearTop = sing(trackerFor(NINE, { bpm: 120 }), sungAs((spec, i) => (i === 3 || i === 5 ? null : plain(spec))), 7)
    expect(result(nearTop).voice!.topMissed).toBe(2)
    const bottom = sing(trackerFor(NINE, { bpm: 120 }), sungAs((spec, i) => (i === 0 ? null : plain(spec))), 7)
    expect(result(bottom).voice!.topMissed).toBe(0)
  })

  it('says why a note was missed, for the tip on the result card', () => {
    const reasonOf = (sound: Sound | null, judge: Partial<VoiceJudge> = { band: 50 }) => {
      const t = sing(trackerFor(ONE, { judge }), sound ? [sound] : [], 3)
      return { status: t.stateOfNote(0)?.status, reason: t.progressOf(0)?.reason }
    }
    expect(reasonOf(null)).toEqual({ status: 'miss', reason: 'silent' })
    expect(reasonOf({ from: 1, to: 2, midi: 59.1 })).toEqual({ status: 'miss', reason: 'low' })
    expect(reasonOf({ from: 1, to: 2, midi: 60.9 })).toEqual({ status: 'miss', reason: 'high' })
    // On the note, for a third of it: there, but not held.
    expect(reasonOf({ from: 1.2, to: 1.5, midi: 60 })).toEqual({ status: 'miss', reason: 'unsteady' })
    // A breath of sound is not "there".
    expect(reasonOf({ from: 1.2, to: 1.3, midi: 60 })).toEqual({ status: 'miss', reason: 'silent' })
  })

  it('notices a slide up to a note that then counts', () => {
    const slide = (t: number) => (t < 1.1 ? 58.5 : 60)
    const t = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: slide }], 3)
    expect(t.stateOfNote(0)?.status).toBe('hit')
    expect(t.progressOf(0)?.reason).toBe('slid')
    // A note begun on its pitch has nothing to notice.
    const straight = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: 60 }], 3)
    expect(straight.progressOf(0)?.reason).toBeUndefined()
  })

  it('a singer who is late did not slide: the note before, held over, is not a slide up to this one', () => {
    // Rising notes sung 150 ms late (or on a phone whose sound sync is 150 ms off): each note starts on
    // the pitch of the note before, well under it. That is lateness, and the tip about sliding would be
    // untrue on a round in which every note counted.
    for (const length of [0.5, 0.3]) {
      const rising: NoteSpec[] = [60, 62, 64, 67, 72].map((midi, i) => [1 + i * length, length, midi] as NoteSpec)
      const late = rising.map(([time, duration, midi]) => ({ from: time + 0.15, to: time + duration + 0.15, midi }))
      const t = sing(trackerFor(rising), late, 5)
      expect(hits(t), `${length}`).toBe(5)
      expect(voiceFeedbackOf(t.summary())?.reasons.slid, `${length}`).toBe(0)
    }
    // A note begun under its pitch on a pitch of its own is a slide, whatever came before it: after a
    // higher note, after a lower one that is further away, and after the same note.
    for (const before of [64, 55, 60]) {
      const t = sing(trackerFor([[1, 0.5, before], [1.5, 1, 60]]), [
        { from: 1, to: 1.5, midi: before },
        { from: 1.5, to: 1.6, midi: 58.5 },
        { from: 1.6, to: 2.5, midi: 60 },
      ], 4)
      expect(t.progressOf(1), `after ${before}`).toMatchObject({ status: 'hit', reason: 'slid' })
    }
    // Lateness goes a quarter of a second and no further: the lower pitch picked up again after a rest
    // longer than that is where this note was begun, not the note before running on.
    const again = sing(trackerFor([[1, 0.5, 58], [1.7, 1.5, 60]]), [
      { from: 1, to: 1.5, midi: 58 },
      { from: 1.77, to: 1.9, midi: 58 },
      { from: 1.9, to: 3.2, midi: 60 },
    ], 4)
    expect(again.progressOf(1)).toMatchObject({ status: 'hit', reason: 'slid' })
  })

  it('hands the reasons on with the summary, so a result card can choose its tip', () => {
    const t = sing(trackerFor(NINE, { bpm: 120, judge: { band: 50 } }), sungAs((spec, i) => (i === 4 ? null : i === 1 ? { ...plain(spec), midi: spec[2] - 0.9 } : { ...plain(spec), midi: spec[2] - 12 })), 7)
    const feedback = voiceFeedbackOf(t.summary())
    expect(feedback).toMatchObject({ notes: 9, hits: 7, octave: -1 })
    expect(feedback?.reasons).toEqual({ silent: 1, low: 1, high: 0, unsteady: 0, slid: 0 })
    // A guitar summary has none.
    expect(voiceFeedbackOf({ score: 0, streak: 0, maxStreak: 0, multiplier: 1, perfects: 0, goods: 0, misses: 0, total: 0, judged: 0, accuracy: 0 })).toBeUndefined()
  })
})

describe('what the first tests did not think of', () => {
  it('a note missed while only frames were arriving is still handed to the clock\'s next advance', () => {
    // The player shows a miss when `advance` returns one. Frames settle notes too (the render loop can
    // be held up while the microphone keeps delivering), and a miss settled by a frame must not be lost.
    const t = trackerFor([[1, 1, 60], [3, 1, 62]])
    t.seek(0)
    for (let k = 0; k * HOP < 2.6; k++) t.frame({ freq: 0, clarity: 0, rms: 0.001, time: k * HOP }, k * HOP, SETTINGS)
    expect(t.stateOfNote(0)?.status).toBe('miss')
    const missed = t.advance(2.6)
    expect(missed.length).toBe(1)
    expect(missed[0]).toMatchObject({ status: 'miss', group: { notes: [{ id: 0 }] } })
    // Once: the next advance has nothing new to tell.
    expect(t.advance(2.7)).toEqual([])
    // A note that counted is no miss, whoever settled it.
    const sung = trackerFor(ONE)
    sung.seek(0)
    for (let k = 0; k * HOP < 2.6; k++) sung.frame(frameAt([{ from: 1, to: 2, midi: 60 }], k * HOP - CENTRE, k * HOP), k * HOP, SETTINGS)
    expect(sung.stateOfNote(0)?.status).toBe('hit')
    expect(sung.advance(2.6)).toEqual([])
    // And a new run does not inherit the last one's misses.
    const again = trackerFor(ONE)
    again.seek(0)
    for (let k = 0; k * HOP < 2.6; k++) again.frame({ freq: 0, clarity: 0, rms: 0.001, time: k * HOP }, k * HOP, SETTINGS)
    again.seek(0)
    expect(again.advance(0.5)).toEqual([])
  })

  it('another pass without a section to repeat starts the piece again: nothing is left open out of place', () => {
    const TWO: NoteSpec[] = [[0, 0.5, 60], [0.5, 0.5, 62]]
    const sounds = [{ from: 0, to: 0.5, midi: 60 }, { from: 0.5, to: 1, midi: 62 }]
    const t = trackerFor(TWO)
    t.seek(0)
    // The first pass is cut off a tenth of a second before its end; the second is sung in full.
    listen(t, sounds, 0.9)
    t.nextPass()
    listen(t, sounds, 2, { from: 0 })
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.summary()).toMatchObject({ total: 4, perfects: 4, misses: 0 })
  })

  it('a piece with nothing to sing gives an empty result, not an error', () => {
    const { chart } = sungChart(ONE)
    const t = new VoiceTracker(chart, [], { sampleRate: SR })
    sing(t, [{ from: 1, to: 2, midi: 60 }], 3)
    expect(t.summary()).toMatchObject({ total: 0, judged: 0, score: 0, accuracy: 0 })
    const r = result(t)
    expect(r).toMatchObject({ total: 0, perfects: 0, misses: 0, coverage: 1, timingMedianMs: null, voice: { medianCents: null, topMissed: 0 } })
    expect(r.perBar).toBeUndefined()
    expect(attemptPerformance(r).acc).toBe(0)
    expect(runVerdict(t.summary(), r)).toBe('unscored')
    expect(t.stateOfNote(0)).toBeUndefined()
    expect(t.progressOf(0)).toBeUndefined()
    expect(t.ownSoundHeard()).toBe(false)
    t.setRange(0, 1)
    t.nextPass()
    t.markUnscored()
    expect(t.advance(Number.POSITIVE_INFINITY)).toEqual([])
  })

  it('a first note at the very start of the piece counts in full, after a count-in and with the sound arriving late', () => {
    const lag = 0.12
    const t = trackerFor([[0, 1, 60], [1, 1, 62]])
    // The player arms its tracker at the start less the sound delay; the count-in is what comes before.
    t.seek(0 - lag)
    const sounds = [{ from: 0, to: 1, midi: 60 }, { from: 1, to: 2, midi: 62 }]
    for (let k = Math.round(-2 / HOP); k * HOP < 3; k++) {
      const wall = k * HOP
      t.frame(frameAt(sounds, wall - lag - CENTRE, wall), wall - lag, SETTINGS)
      t.advance(wall - lag)
    }
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.summary()).toMatchObject({ total: 2, perfects: 2, misses: 0 })
    expect(t.progressOf(0)!.share).toBe(1)
  })

  it('a detector that drops a frame now and then costs that frame and no more', () => {
    const flicker = (unclear: (k: number) => boolean) => {
      const t = trackerFor(ONE)
      t.seek(0)
      for (let k = Math.round(-0.5 / HOP); k * HOP < 3; k++) {
        const time = k * HOP
        const f = frameAt([{ from: 1, to: 2, midi: 60 }], time - CENTRE, time)
        t.frame(unclear(k) ? { ...f, freq: 0, clarity: 0.3 } : f, time, SETTINGS)
        t.advance(time)
      }
      t.advance(Number.POSITIVE_INFINITY)
      return t
    }
    // Every third frame unclear: two thirds of the second that was sung are heard (of a judged 0.82 s).
    const third = flicker((k) => k % 3 === 0)
    expect(third.stateOfNote(0)?.status).toBe('hit')
    expect(third.progressOf(0)!.share).toBeGreaterThan(0.76)
    // Every other frame: half of it, still the same note from one clear frame to the next.
    const half = flicker((k) => k % 2 === 0)
    expect(half.stateOfNote(0)?.status).toBe('hit')
    expect(half.progressOf(0)!.share).toBeGreaterThan(0.56)
    expect(half.progressOf(0)!.share).toBeLessThan(0.65)
  })

  it('a level that is not a number during the count-in does not shut the singer out', () => {
    const t = trackerFor(ONE)
    t.seek(0)
    for (let k = Math.round(-2 / HOP); k * HOP < 3; k++) {
      const time = k * HOP
      const f = frameAt([{ from: 1, to: 2, midi: 60 }], time - CENTRE, time)
      // A microphone that is just waking up can hand over frames without a level.
      t.frame(time < 0 ? { ...f, rms: Number.NaN } : f, time, SETTINGS)
      t.advance(time)
    }
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
    const floor = new RoomFloor()
    for (let i = 0; i < 200; i++) floor.add(i % 2 ? Number.NaN : 0.003)
    expect(floor.gate).toBeCloseTo(Math.max(VOICE.minRms, VOICE.floorFactor * 0.003))
  })

  it('once the song has begun nothing more is taken for the room, not even a frame that lands before the start again', () => {
    // In a section loop the frames just after every wrap belong to the end of the pass before: by the
    // clock they lie before the loop's start, where the count-in was. They are singing, not the room.
    const t = trackerFor([[0, 1, 60], [1, 1, 62]])
    t.seek(0)
    t.setRange(0, 2)
    const quiet = (time: number, songTime: number) => t.frame({ freq: 0, clarity: 0, rms: 0.0005, time }, songTime, SETTINGS)
    let k = 0
    // Half a second of count-in in a quiet room, and the song begins.
    for (; k * HOP < 0.5; k++) quiet(k * HOP, k * HOP - 0.5)
    quiet(k * HOP, 0)
    k++
    // Many wraps later: each left a few frames of full voice before the start.
    for (let wraps = 0; wraps < 400; wraps++, k++) t.frame({ freq: midiToFreq(62), clarity: 0.95, rms: 0.3, time: k * HOP }, -0.01, SETTINGS)
    t.nextPass()
    // A soft voice, well above the quiet room, still counts.
    const from = k * HOP
    for (; k * HOP - from < 1.4; k++) {
      const at = k * HOP - from
      t.frame(frameAt([{ from: 0, to: 1, midi: 60, rms: 0.006 }], at - CENTRE, k * HOP), at, SETTINGS)
      t.advance(at)
    }
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
  })

  it('humming the starting note on until the tune begins costs nothing, and is not taken for the speaker', () => {
    // The cue gives the first note; the learner picks it up half way through and holds it into the tune.
    const cue: VoiceCue = { time: 0, duration: 1, midi: 60 }
    const t = sing(trackerFor([[2, 1, 60], [3, 1, 62]], { cues: [cue] }), [
      { from: 0.5, to: 3, midi: 60 },
      { from: 3, to: 4, midi: 62 },
    ], 5)
    expect(t.summary()).toMatchObject({ perfects: 2, misses: 0 })
    expect(t.ownSoundHeard()).toBe(false)
    // What was hummed before the note is not the note begun early by more than the early window allows.
    expect(result(t).timingMedianMs).toBeNull()
    expect(t.progressOf(0)!.share).toBe(1)
  })

  it('two octaves under the written note is still the note, and is reported as two', () => {
    const t = sing(trackerFor(ONE), [{ from: 1, to: 2, midi: 36 }], 3)
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
    expect(t.progressOf(0)?.octave).toBe(-2)
    expect(voiceFeedbackOf(t.summary())?.octave).toBe(-2)
  })
})

describe('the pitch standard of a sung chart', () => {
  // Five notes up a scale, 0.6 s each, sung exactly where the app's own voice and chords have them.
  const FIVE: NoteSpec[] = [0, 2, 4, 5, 7].map((semis, i) => [1 + i * 0.6, 0.6, 60 + semis] as NoteSpec)
  const onTheNotes: Sound[] = FIVE.map(([time, duration, midi]) => ({ from: time, to: time + duration, midi }))

  it('is the app\'s own 440 Hz whatever the guitar\'s reference pitch is set to: a singer on the app\'s notes has every note perfect', () => {
    // The starting note, the guide voice and the recorded chords all sound at 440. Read against the
    // guitar's setting instead, a singer exactly on them was 31 cents flat at 432 (good at most from "In
    // tune" on, so never a clean round) and 39 cents out at 430 and 450 (nothing counts at the strictest band).
    for (const a4 of [430, 432, 446, 450]) {
      const t = sing(trackerFor(FIVE, { judge: { band: 35, minShare: 0.6 } }), onTheNotes, 5, { a4 })
      expect(t.summary(), `${a4}`).toMatchObject({ perfects: 5, goods: 0, misses: 0 })
      expect(Math.abs(result(t).voice!.medianCents!), `${a4}`).toBeLessThan(0.5)
      for (const id of [0, 1, 2, 3, 4]) expect(Math.abs(t.progressOf(id)!.cents!), `${a4}, note ${id}`).toBeLessThan(0.5)
    }
    expect(VOICE.a4).toBe(440)
  })

  it('the dot is drawn against the same standard: on a note sung in tune it sits on the note, in a run and outside one', () => {
    const t = trackerFor(ONE)
    t.seek(0)
    const during = listen(t, [{ from: 1, to: 2, midi: 60 }], 1.8, { from: 1.2, a4: 432 })
    expect(during[during.length - 1].midi).toBeCloseTo(60, 3)
    expect(during[during.length - 1].matches).toBe(true)
    const outside = [0, 1, 2].map((k) => t.frame({ freq: midiToFreq(64), clarity: 0.95, rms: 0.05, time: 5 + k * HOP }, null, { clarityThreshold: 0.85, a4: 446 }).midi)
    expect(outside[2]).toBeCloseTo(64, 3)
  })

  it('the detector of a sung run listens where the app\'s notes are, not where the guitar\'s setting would put them', () => {
    const { chart } = sungChart(ONE)
    // An octave and a tone above the lane, at 440: 587.3 Hz. A tone of 595 Hz is outside that, and
    // would be inside if the range were laid out from 450.
    expect(voiceDetector(chart.voice!).maxFreq).toBeLessThan(595)
    expect(voiceDetector(chart.voice!, 450).maxFreq).toBeGreaterThan(595)
    const tone = Float32Array.from({ length: SR / 2 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 595 * i) / SR))
    const pitches = (a4?: number) => hearVoice(chart, tone, { sampleRate: SR, a4 }).map((h) => Math.round(h.frame.freq))
    expect(pitches().some((f) => f > 0)).toBe(true)
    expect(pitches(450)).toEqual(pitches())
    expect(pitches(430)).toEqual(pitches())
  })

  it('the ear told no standard reads against the same 440 Hz, as the range finder uses it; told one, it still follows it', () => {
    const a = { freq: 440, clarity: 0.95, rms: 0.05, time: 0 }
    expect(new VoiceEar(SR).listen(a, 0)[0].midi).toBeCloseTo(69, 6)
    // The third argument is from before the standard was settled, and other screens may still hand it over.
    expect(new VoiceEar(SR).listen({ ...a, freq: 432 }, 0, 432)[0].midi).toBeCloseTo(69, 6)
    expect(new VoiceEar(SR).listen({ ...a, freq: 432 }, 0)[0].midi).toBeCloseTo(69 + 12 * Math.log2(432 / 440), 6)
  })
})

/**
 * The rates a microphone runs at: a phone's own (44.1 and 48 kHz) and a wireless headset's, which puts
 * the whole audio context at 16 or 24 kHz. A frame is 512 samples at every one of them: 32, 21, 12 and
 * 11 ms, and its window (2048 samples) 128, 85, 46 and 43 ms.
 */
const MIC_RATES = [16000, 24000, 44100, 48000]

describe('frames of any length: the rules are in seconds', () => {
  /** What each frame came to whose pitch lies in [from, to) of song time, from a run listened to from the start. */
  function outcomesBetween(tracker: VoiceTracker, sounds: Sound[], from: number, to: number, o: Listening): FrameOutcome[] {
    const speed = o.speed ?? 1
    const hop = 512 / (o.sampleRate ?? SR)
    const centre = 1024 / (o.sampleRate ?? SR)
    const first = Math.round(-0.5 / speed / hop)
    tracker.setSpeed(speed)
    tracker.seek(0)
    return listen(tracker, sounds, to + centre * speed, o).filter((_, i) => {
      const pitchTime = ((first + i) * hop - centre) * speed
      return pitchTime >= from && pitchTime < to
    })
  }

  it.each(MIC_RATES)('%i Hz: every frame of a vibrato is the voice, a swing of 80 cents at 6 a second and one of 100 at 7', (sampleRate) => {
    // From one frame to the next the first moves up to 35 cents at 44.1 kHz and up to 91 at 16 kHz, where
    // a frame is 32 ms long. Held to a number of cents a frame, more than half of it was thrown away there.
    for (const [cents, perSecond] of [[80, 6], [100, 7]]) {
      const swing = (t: number) => 60 + (cents / 100) * Math.sin(2 * Math.PI * perSecond * t)
      const t = trackerFor([[1, 2, 60]], { judge: { band: 50 } }, sampleRate)
      // Once there is enough of the note to take a mean over (a third of a second in), every frame counts.
      const during = outcomesBetween(t, [{ from: 1, to: 3, midi: swing }], 1.35, 2.9, { sampleRate })
      expect(during.length, `${cents} cents`).toBeGreaterThan((1.5 * sampleRate) / 512)
      expect(during.filter((o) => !o.matches).length, `${cents} cents: frames not taken for the voice`).toBe(0)
      t.advance(Number.POSITIVE_INFINITY)
      expect(t.stateOfNote(0), `${cents} cents`).toMatchObject({ status: 'hit', judgement: 'perfect' })
    }
  })

  it.each(MIC_RATES)('%i Hz: sung with that vibrato, the short notes of an echo and a line of quarter notes are perfect, every one', (sampleRate) => {
    const beat = 60 / 72
    const ECHO: NoteSpec[] = [[1, beat / 2, 52], [1 + beat / 2, beat / 2, 54], [1 + beat, beat, 56], [1 + 4 * beat, beat / 2, 56], [1 + 4.5 * beat, beat / 2, 54], [1 + 5 * beat, beat, 52]]
    const QUARTERS: NoteSpec[] = [4, 4, 5, 7, 7, 5, 4, 2].map((semis, i) => [1 + i * 0.6, 0.6, 57 + semis] as NoteSpec)
    for (const specs of [ECHO, QUARTERS]) {
      const sounds: Sound[] = specs.map(([time, duration, midi]) => ({ from: time, to: time + duration, midi: (t: number) => midi + 0.8 * Math.sin(2 * Math.PI * 6 * t) }))
      const t = sing(trackerFor(specs, { judge: { band: 50 } }, sampleRate), sounds, 8, { sampleRate })
      expect(t.summary(), `${specs.length} notes`).toMatchObject({ perfects: specs.length, goods: 0, misses: 0 })
    }
  })

  it.each(MIC_RATES)('%i Hz: the pace is over the time that passed: a swing goes on across a frame the detector dropped, and two dropped in a row are a new start', (sampleRate) => {
    const hop = 512 / sampleRate
    const centre = 1024 / sampleRate
    // 70 cents at 7 a second, inside the band all the way: from one frame to the next it moves up to 35
    // cents at 44.1 kHz, and up to 68 across a dropped frame, which is twice the time.
    const swing = (t: number) => 60 + 0.7 * Math.sin(2 * Math.PI * 7 * t)
    /** Whether each clear frame of the middle of the note counted, by its place in the pattern of `every` frames. */
    const matchedByPlace = (every: number, dropped: number): boolean[][] => {
      const t = trackerFor([[1, 2, 60]], {}, sampleRate)
      t.seek(0)
      const places: boolean[][] = Array.from({ length: every }, () => [])
      for (let k = Math.round(-0.5 / hop); k * hop < 3; k++) {
        const time = k * hop
        const place = ((k % every) + every) % every
        const f = frameAt([{ from: 1, to: 3, midi: swing }], time - centre, time)
        const out = t.frame(place < dropped ? { ...f, freq: 0, clarity: 0.3 } : f, time, SETTINGS)
        t.advance(time)
        if (place >= dropped && time - centre >= 1.3 && time - centre < 2.9) places[place].push(out.matches)
      }
      return places
    }
    // One frame in three dropped: both of the others count, the one right after the gap too.
    const one = matchedByPlace(3, 1)
    expect(one[1].length).toBeGreaterThan(10)
    expect(one[1].every(Boolean)).toBe(true)
    expect(one[2].every(Boolean)).toBe(true)
    // Two in four dropped, one after the other: what comes after them is not the same held sound, so
    // the first frame back does not count, and the one after it does.
    const two = matchedByPlace(4, 2)
    expect(two[2].length).toBeGreaterThan(10)
    expect(two[2].some(Boolean)).toBe(false)
    expect(two[3].every(Boolean)).toBe(true)
  })

  it.each(MIC_RATES)('%i Hz: the pace is by the singer\'s clock: with the song at half speed a vibrato is as fast as it was sung, and every frame of it is the voice', (sampleRate) => {
    // 80 cents at 6 a second in the room, which is 12 a second of song time while the song plays at
    // half speed. Measured over song time, the same swing looked twice as fast as a voice moves.
    const swing = (t: number) => 60 + 0.8 * Math.sin(2 * Math.PI * 12 * t)
    const t = trackerFor([[1, 2, 60]], { judge: { band: 50 } }, sampleRate)
    const during = outcomesBetween(t, [{ from: 1, to: 3, midi: swing }], 1.35, 2.9, { sampleRate, speed: 0.5 })
    expect(during.length).toBeGreaterThan((3 * sampleRate) / 512)
    expect(during.filter((o) => !o.matches).length, 'frames not taken for the voice').toBe(0)
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
  })

  it.each([...MIC_RATES, 96000])('%i Hz: the line between a held pitch and a falling one is the same pace at every rate: 60 cents in the 11.6 ms of a frame at 44.1 kHz', (sampleRate) => {
    const hop = 512 / sampleRate
    const centre = 1024 / sampleRate
    const line = (60 * 44100) / 512
    // A pitch that steps up and down by the same amount from every frame to the next, three semitones
    // over the note. It is never on the note, so all that can come of it is heard (and too high) or not
    // heard at all, and that turns on the pace alone.
    const stepping = (centsASecond: number) => (t: number) => 63 + ((Math.round((t + centre) / hop) % 2 ? 0.5 : -0.5) * centsASecond * hop) / 100
    const taken = (centsASecond: number) => {
      const t = sing(trackerFor(ONE, {}, sampleRate), [{ from: 1, to: 2, midi: stepping(centsASecond) }], 3, { sampleRate })
      return { reason: t.progressOf(0)!.reason, coverage: result(t).coverage }
    }
    expect(taken(0.95 * line)).toEqual({ reason: 'high', coverage: 1 })
    expect(taken(1.05 * line)).toEqual({ reason: 'silent', coverage: 0 })
  })

  it.each(MIC_RATES)('%i Hz: the room is known after a quarter of a second of count-in, however few frames that is', (sampleRate) => {
    // A room at 0.005 asks a voice for 0.01. This one, at 0.009, clears the least level and not the room.
    const soft: Sound[] = [{ from: 1, to: 2, midi: 60, rms: 0.009 }]
    const { chart, notes } = sungChart(ONE)
    // Told the rate, or asking for it when the first frame arrives, as the player has it.
    for (const rate of [sampleRate, () => sampleRate]) {
      const after = (countIn: number) => sing(new VoiceTracker(chart, notes, { sampleRate: rate }), soft, 3, { sampleRate, from: -countIn, room: 0.005 }).stateOfNote(0)?.status
      // 0.3 s is nine frames at 16 kHz. Taken for frames of 11.6 ms they are a tenth of a second: no
      // measurement, and the soft voice would pass for one above the room.
      expect(after(0.3), typeof rate).toBe('miss')
      // Under a quarter of a second there is no measurement at any rate, only the least level.
      expect(after(0.2), typeof rate).toBe('hit')
    }
  })

  it('a microphone that cannot say its rate yet is asked again with the next frame, and once it can, no more', () => {
    const { chart, notes } = sungChart(ONE)
    const sounds: Sound[] = [{ from: 1, to: 2, midi: 60 }]
    let asked = 0
    // Nothing to ask for the first five frames of the count-in, then a headset at 16 kHz.
    const t = sing(new VoiceTracker(chart, notes, { sampleRate: () => (asked++ < 5 ? 0 : 16000) }), sounds, 3, { sampleRate: 16000 })
    expect(asked).toBe(6)
    expect(t.stateOfNote(0)).toMatchObject({ status: 'hit', judgement: 'perfect' })
    expect(t.progressOf(0)).toEqual(sing(new VoiceTracker(chart, notes, { sampleRate: 16000 }), sounds, 3, { sampleRate: 16000 }).progressOf(0))
  })

  it.each([...MIC_RATES, 96000])('%i Hz: a pitch falling as fast as a drum\'s is not a voice, however short or long the frame', (sampleRate) => {
    // The click's kick drum falls 4000 to 24000 cents a second. This one falls 6000 a second, seven
    // semitones at a time, through the note again and again. At 96 kHz (a studio interface) that is 32
    // cents from one frame to the next: a rule in cents a frame takes it for a voice there.
    const falling = (t: number) => 63.5 - 60 * (t % (7 / 60))
    const drum = sing(trackerFor(ONE, {}, sampleRate), [{ from: 1, to: 2, midi: falling }], 3, { sampleRate })
    expect(drum.progressOf(0)).toMatchObject({ status: 'miss', share: 0, reason: 'silent' })
    expect(result(drum).coverage).toBe(0)
  })

  it.each(MIC_RATES)('%i Hz: a note is not settled while frames that count for it are still on their way, with the clock 50 ms ahead of them', (sampleRate) => {
    // 150 ms late on notes of 0.3 s: the end of each is sung after its written end and counts as lateness.
    // Those frames reach the tracker late: the pitch of a frame lies half a window before its stamp (64 ms
    // at 16 kHz, 23 ms at 44.1), and the render loop's clock is ahead of the frames it is handed.
    const THREE: NoteSpec[] = [[1, 0.3, 60], [1.3, 0.3, 62], [1.6, 0.3, 64]]
    const late: Sound[] = THREE.map(([time, duration, midi]) => ({ from: time + 0.15, to: time + duration + 0.15, midi }))
    const { chart, notes } = sungChart(THREE)
    const inStep = sing(new VoiceTracker(chart, notes, { sampleRate }), late, 3, { sampleRate })
    expect(hits(inStep)).toBe(3)
    const ahead = sing(new VoiceTracker(chart, notes, { sampleRate }), late, 3, { sampleRate, clockLead: 0.05 })
    // The rate may only be known once frames arrive: the notes wait as long then.
    const askedLate = sing(new VoiceTracker(chart, notes, { sampleRate: () => sampleRate }), late, 3, { sampleRate, clockLead: 0.05 })
    for (const id of [0, 1, 2]) {
      expect(ahead.progressOf(id), `note ${id}`).toEqual(inStep.progressOf(id))
      expect(askedLate.progressOf(id), `note ${id}, rate asked for late`).toEqual(inStep.progressOf(id))
    }
  })
})
