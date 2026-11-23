/**
 * What a detector frame says about a voice: whether there is one, on which pitch, how far that is from
 * a note in any octave, and whether a jump in level was an attack. The sung-run tracker and the range
 * finder both listen through here, so "a voice was heard" means the same thing on every screen.
 *
 * Nothing in this file knows about charts or scoring.
 */
import { freqToMidi } from '../../../music/pitch'
import { VOICE, frameSeconds } from './judge'

/** The part of a detector frame the ear needs (a `PitchFrame` or an `AnalyzedFrame` is one). */
export interface EarFrame {
  freq: number
  clarity: number
  rms: number
}

/** Cents folded into the octave around a note: 1230 becomes 30, 610 becomes -590. */
export function foldCents(cents: number): number {
  return cents - 1200 * Math.round(cents / 1200)
}

/** How far `midi` is from `target` in cents when any octave counts as the note (negative = under it). */
export function centsFrom(midi: number, target: number): number {
  return foldCents((midi - target) * 100)
}

/** Whole octaves from `target` to the octave `midi` was sung in: -1 is an octave lower. */
export function octavesFrom(midi: number, target: number): number {
  // `+ 0`: never the negative zero that rounding a small negative number gives.
  return Math.round((midi - target) / 12) + 0
}

/** A frame is a voice when it has a pitch, is clear enough, and is at least as loud as `gate`. */
export function isVoiced(frame: EarFrame, gate: number = VOICE.minRms): boolean {
  return frame.freq > 0 && frame.clarity >= VOICE.clarity && frame.rms >= gate
}

/**
 * A sudden jump in level: the rule the guitar side's `PitchSmoother` flags a new pick with, number for
 * number (a test holds the two together). The player counts these during the count-in: attacks right
 * after its own clicks mean the microphone hears the speaker.
 */
export class LevelJump {
  private envelope = 0

  reset(): void {
    this.envelope = 0
  }

  push(rms: number): boolean {
    const isAttack = rms > VOICE.minRms * 1.5 && rms > this.envelope * 1.8
    this.envelope = Math.max(rms, this.envelope * 0.92)
    return isAttack
  }
}

/** Frames kept for the room's level: more than any count-in has. */
const FLOOR_FRAMES = 1500

/**
 * How loud the room is, from what was heard before the singing: the level a frame has to reach to be
 * taken for a voice is `floorFactor` times the quiet fifth of it, never under `minRms` and never over
 * `gateCap`.
 */
export class RoomFloor {
  /** Seconds one added level stands for (a detector frame); a frame at 44.1 kHz unless told. */
  hop: number
  private levels: number[] = []
  private cached: number | null = VOICE.minRms

  constructor(hopSeconds = frameSeconds(44100)) {
    this.hop = hopSeconds
  }

  reset(): void {
    this.levels = []
    this.cached = VOICE.minRms
  }

  add(rms: number): void {
    // A frame without a level (a microphone that is just waking up) says nothing about the room; kept,
    // it would make the gate "not a number", which no voice ever reaches.
    if (!(rms >= 0) || this.levels.length >= FLOOR_FRAMES) return
    this.levels.push(rms)
    this.cached = null
  }

  get gate(): number {
    if (this.cached !== null) return this.cached
    let gate: number = VOICE.minRms
    if (this.levels.length * this.hop >= VOICE.floorSeconds) {
      const sorted = [...this.levels].sort((a, b) => a - b)
      const quiet = sorted[Math.floor(VOICE.floorPercentile * (sorted.length - 1))]
      gate = Math.min(VOICE.gateCap, Math.max(VOICE.minRms, VOICE.floorFactor * quiet))
    }
    this.cached = gate
    return gate
  }
}

/** One frame in which a voice was heard. */
export interface Heard {
  /** The time the caller gave the frame (song time in a run, anything else elsewhere). */
  at: number
  /** The frame's own time stamp, real time. */
  time: number
  /** Fractional MIDI number, in the octave it was sung in. */
  midi: number
  rms: number
  clarity: number
  /** Real seconds this frame stands for: the time since the frame before it. */
  seconds: number
}

/**
 * Turns detector frames into heard pitches. Two things happen here and nowhere else:
 *
 * - every frame is given the real time it stands for, from the time stamps, so that nothing downstream
 *   counts frames;
 * - a single frame more than `slip` cents away from both its neighbours is dropped. The detector does
 *   that now and then on a real voice (it locks on to a harmonic for one frame), and one such frame in
 *   a window is enough to spoil a mean or a "lowest note held". A frame that jumps is therefore held
 *   back until the next one shows whether the voice stayed there (a leap: both are let through, in
 *   order) or came straight back (a slip: it is gone).
 */
export class VoiceEar {
  /** The level a frame has to reach; the tracker sets it from the room. */
  gate: number = VOICE.minRms
  /** Real seconds between two detector frames: what a frame stands for when the stamps do not say. */
  hop: number
  private lastTime: number | null = null
  private last: Heard | null = null
  private held: Heard | null = null

  constructor(sampleRate: number, hopSamples: number = VOICE.hopSamples) {
    this.hop = hopSamples / sampleRate
  }

  reset(): void {
    this.lastTime = null
    this.last = null
    this.held = null
  }

  /**
   * The heard frames this frame settles, oldest first: none, the frame itself, or a held one and the
   * frame. The pitch is read against the standard of everything sung (`VOICE.a4`) unless `a4` says
   * otherwise; a sung run never does.
   */
  listen(frame: EarFrame & { time: number }, at: number, a4: number = VOICE.a4): Heard[] {
    // The stamps tell how long a frame stands for. A gap (a pause, a wrap) is not singing time.
    const since = this.lastTime === null ? this.hop : frame.time - this.lastTime
    const seconds = since > 0 && since <= 3 * this.hop ? since : this.hop
    this.lastTime = frame.time
    if (!isVoiced(frame, this.gate)) {
      // Silence beside it: there is no second neighbour to be far from, so a held frame stands.
      const out = this.held ? [this.held] : []
      this.held = null
      this.last = null
      return out
    }
    const heard: Heard = { at, time: frame.time, midi: freqToMidi(frame.freq, a4), rms: frame.rms, clarity: frame.clarity, seconds }
    const far = (a: Heard, b: Heard) => Math.abs(a.midi - b.midi) * 100 > VOICE.slip
    if (this.held) {
      const held = this.held
      this.held = null
      if (!far(held, heard)) {
        // The voice stayed where it jumped to: a leap.
        this.last = heard
        return [held, heard]
      }
      // It came straight back, or jumped again: the held frame was a slip. This one is looked at afresh.
    }
    if (this.last && far(this.last, heard)) {
      this.held = heard
      return []
    }
    this.last = heard
    return [heard]
  }

  /** The end of the stream: a frame still held back has no next frame to wait for. */
  flush(): Heard[] {
    const out = this.held ? [this.held] : []
    this.held = null
    return out
  }
}

/**
 * The mean of a stretch of frames around a note, in cents, or null when the stretch says nothing: too
 * little of it is voiced, or a frame in it is further from the note than a swing goes. A vibrato
 * averages out to where the singer is aiming; a steady offset is its own mean.
 */
export function steadyMean(frames: ReadonlyArray<{ cents: number; seconds: number }>): number | null {
  let sum = 0
  let seconds = 0
  for (const f of frames) {
    if (Math.abs(f.cents) > VOICE.vibratoReach) return null
    sum += f.cents * f.seconds
    seconds += f.seconds
  }
  return seconds >= VOICE.vibratoVoiced ? sum / seconds : null
}
