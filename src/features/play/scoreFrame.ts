import type { PitchFrame } from '../../audio/AudioEngine'
import type { PitchSmoother } from './pitchTracker'
import { RECOGNITION, type Judgement, type ScoreTracker } from './scoring'
import { strongestPeak } from './noteEvidence'

export interface FrameSettings {
  clarityThreshold: number
  a4: number
}

export interface FrameOutcome {
  /** Smoothed single pitch (fractional MIDI) for the on-screen indicator, or null when nothing clear is heard. */
  midi: number | null
  /** A sudden level jump: a new pick. */
  isAttack: boolean
  /** The pitch belongs to a note that was just hit or is due now (for the on-screen indicator). */
  matches: boolean
  /** Set when this frame confirmed a note or chord. */
  judgement: Judgement | null
}

/**
 * One detector frame through the scoring pipeline: smooth the single pitch for the display, then,
 * while a run is playing (`songTime` is the latency-compensated song position of the frame; null
 * otherwise), let the tracker check its pending notes against the frame's spectrum. The player and
 * the scoring simulation both go through here.
 */
export function scoreFrame(tracker: ScoreTracker | null, smoother: PitchSmoother, frame: PitchFrame, songTime: number | null, settings: FrameSettings): FrameOutcome {
  const { midi, isAttack } = smoother.push(frame, settings.clarityThreshold, settings.a4)
  if (!tracker || songTime === null) return { midi, isAttack, matches: false, judgement: null }
  tracker.observe(songTime, !!frame.peaks && strongestPeak(frame.peaks) >= RECOGNITION.heard)
  const hit = tracker.onFrame(songTime, frame.peaks, frame.flux ?? 0, frame.fluxBand ?? 0)
  if (hit) return { midi, isAttack, matches: true, judgement: hit.judgement ?? null }
  return { midi, isAttack, matches: midi !== null && tracker.isUpcomingPitch(midi, songTime), judgement: null }
}
