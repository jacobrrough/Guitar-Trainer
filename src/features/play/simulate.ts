import { FrameAnalyzer, type AnalyzedFrame, type FrameAnalyzerOptions } from '../../audio/pitch/frameAnalyzer'
import type { OctaveTolerance } from '../../app/settings'
import type { Beat, ChartNote } from '../../chart/types'
import type { AttemptResult } from '../../training/types'
import { guitarRunTracker, type RunTracker } from './runTracker'
import type { FrameOutcome } from './scoreFrame'
import type { GroupStatus, ScoreSummary, ScoreTracker } from './scoring'

export interface SimulationOptions {
  /** Sample rate of `mic` (44100 on desktop, 48000 on iOS). */
  sampleRate: number
  /** What the player subtracts from the clock before scoring (the latency setting), in seconds. */
  latencySec?: number
  speed?: number
  clarityThreshold?: number
  a4?: number
  octaveTolerance?: OctaveTolerance
  /** Detector options as the player passes them to the microphone. The single-pitch detector is off by default: on a guitar run it only feeds the on-screen indicator. */
  detector?: FrameAnalyzerOptions
  /** Spectral peaks and attack strength in every frame (on by default: a guitar run is scored from them; a sung run does without). */
  spectrum?: boolean
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

/** What any run comes to, guitar or sung. */
export interface RunResult {
  summary: ScoreSummary
  result: AttemptResult
}

export interface SimulationResult extends RunResult {
  /** Signed timing error of each hit, ms (positive = late). */
  deltasMs: number[]
  statuses: GroupStatus[]
}

/** One analysis frame of the microphone signal and the wall-clock time (seconds, 0 = the song's start) the worklet stamps it with. */
export interface HeardFrame {
  wall: number
  frame: AnalyzedFrame
}

/**
 * The microphone signal as the worklet frames and analyses it: silence for the count-in, then `mic`
 * in render quanta through the detector. Nothing here depends on the chart or the tracker, so one
 * analysis can be scored more than once.
 */
export function analyseMic(mic: Float32Array, options: SimulationOptions): HeardFrame[] {
  const analyzer = new FrameAnalyzer(options.sampleRate, { windowSize: 2048, spectrumWindow: 4096, hop: 512, minFreq: 55, maxFreq: 1500, threshold: 0.9, pitch: false, ...options.detector, spectrum: options.spectrum ?? true })
  const quantum = options.quantum ?? 128
  // In the app the microphone is open and the tracker listens during the count-in: silence comes first.
  const micLead = Math.round(((options.micLead ?? 0) * options.sampleRate) / quantum) * quantum
  const lead = Math.max(micLead, Math.round(((options.preRoll ?? 0.5) * options.sampleRate) / quantum) * quantum)
  const silence = new Float32Array(quantum)
  const heard: HeardFrame[] = []
  for (let i = -lead; i + micLead + quantum <= mic.length; i += quantum) {
    const frame = analyzer.push(i + micLead < 0 ? silence : mic.subarray(i + micLead, i + micLead + quantum))
    // The worklet stamps a frame with the time its last render quantum started; the player maps that stamp to song time.
    if (frame) heard.push({ wall: i / options.sampleRate, frame })
  }
  return heard
}

/**
 * Drives a tracker with analysed frames (see `analyseMic`) exactly as the player drives it with the
 * microphone: the count-in on the song's own timeline, the start of the song's sound told once, every
 * frame with its latency-compensated song time, the tracker moved along with the same clock, loop
 * wraps as the player wraps them. Guitar and sung runs both go through here. `durationSec` is the
 * length of the recording; `onFrame` sees what each frame came to (the player reads the attack flag
 * during the count-in).
 */
export function runHeard(
  tracker: RunTracker,
  heard: HeardFrame[],
  durationSec: number,
  options: SimulationOptions,
  onFrame?: (outcome: FrameOutcome, wall: number, songTime: number) => void,
): RunResult {
  const speed = options.speed ?? 1
  const latency = options.latencySec ?? 0
  tracker.setSpeed(speed)
  const settings = { clarityThreshold: options.clarityThreshold ?? 0.85, a4: options.a4 ?? 440 }
  const loop = options.loop
  const origin = loop?.from ?? 0
  tracker.seek(origin - latency * speed)
  if (loop) tracker.setRange(loop.from, loop.to)
  const jitter = options.startJitter ?? 0
  let pass = 0
  let started = false
  for (const { wall, frame } of heard) {
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
    if (!started && wall >= 0) {
      // The count-in is over and the song's sound begins: the player tells its tracker so.
      tracker.onPlaybackStart()
      started = true
    }
    const songTime = position - latency * speed + (wall < 0 ? jitter * speed : 0)
    const outcome = tracker.frame({ ...frame, time: wall }, songTime, settings)
    onFrame?.(outcome, wall, songTime)
    tracker.advance(songTime)
  }
  tracker.advance(Number.POSITIVE_INFINITY)
  const summary = tracker.summary()
  const result = tracker.toAttemptResult({ playedTempo: 0, targetTempo: 0, speed, durationSec })
  return { summary, result }
}

/**
 * Scores analysed frames (see `analyseMic`) against a guitar chart exactly as the player scores the
 * microphone: the guitar tracker behind the seam, driven by `runHeard`. `durationSec` is the length of
 * the recording.
 */
export function scoreHeard(notes: ChartNote[], beats: Beat[], heard: HeardFrame[], durationSec: number, options: SimulationOptions): SimulationResult {
  const tracker = guitarRunTracker(notes, { octaveTolerance: options.octaveTolerance ?? 'chords', beats, a4: options.a4, recognition: options.recognition })
  const { summary, result } = runHeard(tracker, heard, durationSec, options)
  return { summary, result, deltasMs: tracker.score.hitDeltas().map((d) => d * 1000), statuses: tracker.score.groups.map((g) => g.status) }
}

/**
 * Scores a recording against a chart exactly as the player would score the microphone: the audio goes
 * through the worklet's framing and detector, each frame through `scoreFrame`, and the tracker is
 * advanced with the same clock. `mic` is what the microphone heard, with sample 0 at song time 0 (at
 * speed 1; at other speeds the chart is played `speed` times as fast).
 */
export function simulateRun(notes: ChartNote[], beats: Beat[], mic: Float32Array, options: SimulationOptions): SimulationResult {
  return scoreHeard(notes, beats, analyseMic(mic, options), mic.length / options.sampleRate, options)
}
