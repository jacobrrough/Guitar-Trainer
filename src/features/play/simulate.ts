import { FrameAnalyzer, type FrameAnalyzerOptions } from '../../audio/pitch/frameAnalyzer'
import type { OctaveTolerance } from '../../app/settings'
import type { Beat, ChartNote } from '../../chart/types'
import type { AttemptResult } from '../../training/types'
import { PitchSmoother } from './pitchTracker'
import { scoreFrame } from './scoreFrame'
import { ScoreTracker, type GroupStatus, type ScoreSummary } from './scoring'

export interface SimulationOptions {
  /** Sample rate of `mic` (44100 on desktop, 48000 on iOS). */
  sampleRate: number
  /** What the player subtracts from the clock before scoring (the latency setting), in seconds. */
  latencySec?: number
  speed?: number
  clarityThreshold?: number
  a4?: number
  octaveTolerance?: OctaveTolerance
  /** Detector options as the player passes them to the microphone. The single-pitch detector is off by default: it only feeds the on-screen indicator. */
  detector?: FrameAnalyzerOptions
  /** Samples per audio callback (128 in every browser). */
  quantum?: number
  /**
   * Seconds the tracker listens before the song starts (the count-in; 0.5 by default). The player
   * only knows when the song should start until it does: `startJitter` is how much later it really
   * started, in seconds, so the clock steps back by that much at song time 0.
   */
  preRoll?: number
  startJitter?: number
  /** Seconds of `mic` that come before song time 0 (what was played during the count-in); 0 by default. */
  micLead?: number
  /**
   * A section loop: `mic` holds `passes` passes of the bars between `from` and `to` (song time) played
   * back to back, sample 0 at `from`. The song position wraps the way the player wraps it.
   * `wrapStall` (seconds, 0 by default) is how long the song's sound takes to start again after each
   * wrap: the clock runs on for that long and then steps back, as the player's clock does when the
   * media element is slow to seek. The learner plays to what they hear, so in `mic` every pass after
   * the first starts `wrapStall` later than back to back.
   */
  loop?: { from: number; to: number; passes: number; wrapStall?: number }
  /** Overrides of the tracker's recognition thresholds. */
  recognition?: ConstructorParameters<typeof ScoreTracker>[1] extends infer O ? (O extends { recognition?: infer R } ? R : never) : never
}

export interface SimulationResult {
  summary: ScoreSummary
  result: AttemptResult
  /** Signed timing error of each hit, ms (positive = late). */
  deltasMs: number[]
  statuses: GroupStatus[]
}

/**
 * Scores a recording against a chart exactly as the player would score the microphone: the audio goes
 * through the worklet's framing and detector, each frame through `scoreFrame`, and the tracker is
 * advanced with the same clock. `mic` is what the microphone heard, with sample 0 at song time 0 (at
 * speed 1; at other speeds the chart is played `speed` times as fast).
 */
export function simulateRun(notes: ChartNote[], beats: Beat[], mic: Float32Array, options: SimulationOptions): SimulationResult {
  const speed = options.speed ?? 1
  const latency = options.latencySec ?? 0
  const tracker = new ScoreTracker(notes, { octaveTolerance: options.octaveTolerance ?? 'chords', beats, a4: options.a4, recognition: options.recognition })
  tracker.setSpeed(speed)
  const smoother = new PitchSmoother()
  const analyzer = new FrameAnalyzer(options.sampleRate, { windowSize: 2048, spectrumWindow: 4096, hop: 512, minFreq: 55, maxFreq: 1500, threshold: 0.9, pitch: false, ...options.detector, spectrum: true })
  const settings = { clarityThreshold: options.clarityThreshold ?? 0.85, a4: options.a4 ?? 440 }
  const quantum = options.quantum ?? 128
  const loop = options.loop
  const origin = loop?.from ?? 0
  tracker.seek(origin - latency * speed)
  if (loop) tracker.setRange(loop.from, loop.to)
  // In the app the microphone is open and the tracker listens during the count-in: silence comes first.
  const micLead = Math.round(((options.micLead ?? 0) * options.sampleRate) / quantum) * quantum
  const lead = Math.max(micLead, Math.round(((options.preRoll ?? 0.5) * options.sampleRate) / quantum) * quantum)
  const jitter = options.startJitter ?? 0
  const silence = new Float32Array(quantum)
  let pass = 0
  for (let i = -lead; i + micLead + quantum <= mic.length; i += quantum) {
    const frame = analyzer.push(i + micLead < 0 ? silence : mic.subarray(i + micLead, i + micLead + quantum))
    if (!frame) continue
    // The worklet stamps a frame with the time its last render quantum started; the player maps that stamp to song time.
    const wall = i / options.sampleRate
    let position = origin + wall * speed
    if (loop && wall >= 0) {
      const length = (loop.to - loop.from) / speed
      const stall = loop.wrapStall ?? 0
      // The first pass runs straight through; every later one begins with the stall.
      const p = wall < length ? 0 : 1 + Math.floor((wall - length) / (length + stall))
      if (p >= loop.passes) break
      if (p > pass) {
        tracker.nextPass()
        pass = p
      }
      const sinceWrap = p === 0 ? wall : wall - length - (p - 1) * (length + stall)
      // During the stall the clock still runs on from the loop's start; then it is set right.
      position = loop.from + (p === 0 || sinceWrap < stall ? sinceWrap : sinceWrap - stall) * speed
    }
    const songTime = position - latency * speed + (wall < 0 ? jitter * speed : 0)
    scoreFrame(tracker, smoother, { ...frame, time: wall }, songTime, settings)
    tracker.advance(songTime)
  }
  tracker.advance(Number.POSITIVE_INFINITY)
  const summary = tracker.summary()
  const result = tracker.toAttemptResult({ playedTempo: 0, targetTempo: 0, speed, durationSec: mic.length / options.sampleRate })
  return { summary, result, deltasMs: tracker.hitDeltas().map((d) => d * 1000), statuses: tracker.groups.map((g) => g.status) }
}
