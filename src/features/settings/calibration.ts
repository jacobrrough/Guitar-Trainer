/**
 * Latency calibration, the pure part. The dialog plays clicks and the player strums a muted
 * string on each one; these helpers turn the pitch worklet's level frames into onset times, match
 * them to the clicks and summarise the gap.
 *
 * The earliest sound inside each click's window counts. Through headphones that is the strum. On a
 * phone speaker it is usually the click's own echo reaching the microphone, which is just as good:
 * it measures the same output-plus-input delay that scoring has to compensate for, without
 * depending on anyone's reaction time.
 */

export interface LevelFrame {
  rms: number
  /** AudioContext time of the frame. */
  time: number
}

export const CLICK_COUNT = 8
/** Seconds between clicks (100 bpm). */
export const CLICK_INTERVAL = 0.6
/** Quiet seconds before the first click, used to measure the room's noise floor. */
export const PREROLL = 0.8
/** A strum may land a little ahead of the click... */
export const MATCH_BEFORE = 0.06
/** ...or well behind it (slow reaction, Bluetooth headphones). Shorter than the click gap so windows never overlap. */
export const MATCH_AFTER = 0.5
export const MIN_SAMPLES = 3
/** Median spread (ms) above which the strums are called unsteady. */
export const STEADY_SPREAD_MS = 40
/** Frame lag of the onset detector: the hop is ~11 ms, so a transient is seen ~5 ms late on average. */
const DETECTOR_LAG = 0.005

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * The room's level while nobody plays: the median of the pre-roll frames, so a pluck or two while
 * waiting does not count as noise, never below a small constant so a dead-silent input does not make
 * the detector hair-trigger.
 */
export function noiseFloor(quietRms: number[]): number {
  if (quietRms.length === 0) return 0.0015
  return Math.max(0.0015, median(quietRms))
}

export interface OnsetDetectorOptions {
  /** Noise floor from `noiseFloor`. */
  floor: number
  /** A frame must be this many times the floor... */
  floorRatio?: number
  /** ...and at least this loud (keeps a phone mic without gain usable: a muted strum is quiet). */
  minRms?: number
  /** ...and this many times the decaying envelope, so a ringing note is one onset, not many. */
  rise?: number
  /** Envelope decay per frame. */
  decay?: number
  /** Seconds after an onset during which nothing else counts. */
  lockout?: number
}

/** Returns a function that takes frames in time order and yields the onset time when a frame starts a new sound. */
export function createOnsetDetector(opts: OnsetDetectorOptions): (frame: LevelFrame) => number | null {
  const threshold = Math.max(opts.floor * (opts.floorRatio ?? 3), opts.minRms ?? 0.003)
  const rise = opts.rise ?? 2
  const decay = opts.decay ?? 0.9
  const lockout = opts.lockout ?? 0.08
  let envelope = 0
  let last = -Infinity
  return (frame) => {
    const isOnset = frame.rms > threshold && frame.rms > envelope * rise && frame.time - last > lockout
    envelope = Math.max(frame.rms, envelope * decay)
    if (!isOnset) return null
    last = frame.time
    return frame.time - DETECTOR_LAG
  }
}

/** Assigns onsets to clicks as they arrive. The first onset in a click's window stands; later ones are ignored. */
export class ClickMatcher {
  readonly clicks: number[]
  readonly offsets: Array<number | null>
  private readonly before: number
  private readonly after: number

  constructor(clicks: number[], before = MATCH_BEFORE, after = MATCH_AFTER) {
    this.clicks = clicks
    this.offsets = clicks.map(() => null)
    this.before = before
    this.after = after
  }

  /** Records an onset. Returns the index of the click it was matched to, or -1. */
  onset(time: number): number {
    for (let i = 0; i < this.clicks.length; i++) {
      const d = time - this.clicks[i]
      if (d < -this.before || d > this.after) continue
      if (this.offsets[i] !== null) return -1
      this.offsets[i] = d
      return i
    }
    return -1
  }

  get heard(): number {
    return this.offsets.filter((o) => o !== null).length
  }
}

export interface CalibrationSummary {
  /** Median gap between click and sound, in ms (can be slightly negative when the player anticipates). */
  ms: number
  /** Clicks that got a sound. */
  samples: number
  /** Median absolute deviation of the gaps, in ms. */
  spreadMs: number
  /** False when the gaps scattered, so the number is rough. */
  steady: boolean
}

export function summarise(offsets: Array<number | null>): CalibrationSummary | null {
  const found = offsets.filter((o): o is number => o !== null)
  if (found.length < MIN_SAMPLES) return null
  const med = median(found)
  const spread = median(found.map((o) => Math.abs(o - med)))
  return { ms: Math.round(med * 1000), samples: found.length, spreadMs: Math.round(spread * 1000), steady: spread * 1000 <= STEADY_SPREAD_MS }
}

/** Plain words for a run that heard too few clicks. */
export function calibrationAdvice(heard: number, total: number, floor: number): string {
  if (floor > 0.03) {
    return 'It is noisy here, so the strums did not stand out. Find a quieter spot or hold the phone closer to the guitar, then try again.'
  }
  return `We heard ${heard} of ${total} strums. Strum a little harder and closer to the microphone, and watch the bar jump on each click.`
}
