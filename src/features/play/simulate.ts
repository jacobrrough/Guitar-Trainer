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
  tracker.seek(-latency)
  // In the app the microphone is already open during the count-in: half a second of silence comes first.
  const lead = Math.round(0.5 * options.sampleRate / quantum) * quantum
  const silence = new Float32Array(quantum)
  for (let i = -lead; i + quantum <= mic.length; i += quantum) {
    const frame = analyzer.push(i < 0 ? silence : mic.subarray(i, i + quantum))
    if (!frame) continue
    // The worklet stamps a frame with the time its last render quantum started; the player maps that stamp to song time.
    const wall = i / options.sampleRate
    const songTime = (wall - latency) * speed
    scoreFrame(tracker, smoother, { ...frame, time: wall }, songTime, settings)
    tracker.advance(songTime)
  }
  tracker.advance(Number.POSITIVE_INFINITY)
  const summary = tracker.summary()
  const result = tracker.toAttemptResult({ playedTempo: 0, targetTempo: 0, speed, durationSec: mic.length / options.sampleRate })
  return { summary, result, deltasMs: tracker.hitDeltas().map((d) => d * 1000), statuses: tracker.groups.map((g) => g.status) }
}
