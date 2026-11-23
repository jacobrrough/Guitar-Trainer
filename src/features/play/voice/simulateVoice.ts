/**
 * A sung run without a singer or a phone: the recording goes through the worklet's framing with the
 * detector set as the player sets it for the chart, and the frames through the voice tracker with the
 * player's clock (`runHeard`, the same loop the guitar simulation uses). What comes out is what the
 * app would have shown and saved.
 */
import type { Chart, ChartNote } from '../../../chart/types'
import { analyseMic, runHeard, type HeardFrame, type RunResult, type SimulationOptions } from '../simulate'
import { voiceDetector } from './judge'
import { VoiceTracker, voiceFeedbackOf, type NoteProgress, type VoiceFeedback } from './voiceTracker'

export interface VoiceSimulationResult extends RunResult {
  /** Each scored note as the screen would show it once the run is over, in the order of `notes`. */
  notes: NoteProgress[]
  feedback: VoiceFeedback
  /** What `ownSoundHeard()` says at the end: one of the app's cues came back through the microphone. */
  ownSound: boolean
  /** Times (seconds, 0 = the song's start; negative = the count-in) of the frames flagged as attacks: what the player's count-in check collects. */
  attacks: number[]
}

/**
 * The recording as the microphone frames of a sung run: the single-pitch detector on, in the chart's
 * range, no spectrum. `options.a4` is the guitar's reference pitch setting and moves nothing here: the
 * range lies where the app's own notes are (`VOICE.a4`), as the tracker reads them.
 */
export function hearVoice(chart: Chart, mic: Float32Array, options: SimulationOptions): HeardFrame[] {
  if (!chart.voice) throw new Error('hearVoice: the chart is not a sung one')
  return analyseMic(mic, { ...options, spectrum: false, detector: { ...options.detector, pitch: true, ...voiceDetector(chart.voice) } })
}

/** Scores analysed frames (see `hearVoice`) against a sung chart exactly as the player would. */
export function scoreVoiceHeard(chart: Chart, notes: ChartNote[], heard: HeardFrame[], durationSec: number, options: SimulationOptions): VoiceSimulationResult {
  const tracker = new VoiceTracker(chart, notes, { sampleRate: options.sampleRate })
  const attacks: number[] = []
  const { summary, result } = runHeard(tracker, heard, durationSec, options, (outcome, wall) => {
    if (outcome.isAttack) attacks.push(wall)
  })
  const feedback = voiceFeedbackOf(summary)
  if (!feedback) throw new Error('scoreVoiceHeard: the summary of a sung run carries its feedback')
  const progress = notes.map((n) => tracker.progressOf(n.id)).filter((p): p is NoteProgress => !!p)
  return { summary, result, notes: progress, feedback, ownSound: tracker.ownSoundHeard(), attacks }
}

/**
 * Scores a recording against a sung chart. `mic` is what the microphone heard, with sample 0 at song
 * time 0, or `options.micLead` seconds before it when the recording holds the count-in as well (the
 * tracker takes the level of the room from there).
 */
export function simulateVoice(chart: Chart, notes: ChartNote[], mic: Float32Array, options: SimulationOptions): VoiceSimulationResult {
  return scoreVoiceHeard(chart, notes, hearVoice(chart, mic, options), mic.length / options.sampleRate, options)
}
