/**
 * The seam between the player and what scores a run. The player knows one thing about scoring: it has
 * a tracker, feeds it every microphone frame with the song time, moves it along with the clock, and at
 * the end asks it for a summary and a result. Which tracker that is follows from the chart alone: a
 * chart that says it is sung (`chart.voice`) is scored by listening for a voice, every other chart by
 * listening for strokes on a guitar. No screen passes a flag, so none can forget one.
 */
import type { PitchFrame } from '../../audio/AudioEngine'
import type { OctaveTolerance } from '../../app/settings'
import type { Chart, ChartNote } from '../../chart/types'
import type { AttemptResult } from '../../training/types'
import { PitchSmoother } from './pitchTracker'
import { scoreFrame, type FrameOutcome, type FrameSettings } from './scoreFrame'
import { ScoreTracker, type GroupState, type ScoreOptions, type ScoreSummary } from './scoring'
import { VoiceTracker, type NoteProgress } from './voice/voiceTracker'

export type { NoteProgress } from './voice/voiceTracker'

/**
 * A note (or chord) as a tracker reports it: what the highway and the pitch lanes read. A sung note
 * comes as a group of one, so the highway's own `statusOf` takes a tracker of either kind as it is.
 */
export type NoteState = Pick<GroupState, 'group' | 'status' | 'judgement' | 'hitAt'>

export interface RunTracker {
  /** The run is scored from spectral peaks: the player switches the spectrum analysis on only then. */
  readonly needsSpectrum: boolean
  /** Playback speed (1 = normal). */
  setSpeed(speed: number): void
  reset(): void
  /** Resets, and leaves out what lies before `songTime`. What is heard before it from then on is the count-in. */
  seek(songTime: number): void
  /** Limits scoring to the notes that start in [from, to) of song time (a section loop). After `reset` or `seek`. */
  setRange(from: number, to: number): void
  /** The loop wrapped: another pass over the range, the totals carry on. */
  nextPass(): void
  /** No microphone: nothing of this run counts. */
  markUnscored(): void
  /** Moves the tracker to `songTime`; returns what was newly missed. `Infinity` closes the run. */
  advance(songTime: number): NoteState[]
  /** The song's sound has started (after the count-in, or after a pause). */
  onPlaybackStart(): void
  /**
   * One microphone frame. `songTime` is the latency-compensated song position of the frame while a
   * run plays or counts in, and null otherwise (listening only, paused, before the start): then
   * nothing is scored and only the pitch for the screen and the attack flag come back.
   */
  frame(frame: PitchFrame, songTime: number | null, settings: FrameSettings): FrameOutcome
  stateOfNote(noteId: number): NoteState | undefined
  /** Sung runs: how far a note is filled, and what was the matter with it. */
  progressOf?(noteId: number): NoteProgress | undefined
  /** Sung runs: the app's own cue was heard through the microphone (see `VoiceTracker.ownSoundHeard`). */
  ownSoundHeard?(): boolean
  summary(): ScoreSummary
  toAttemptResult(opts: { playedTempo: number; targetTempo: number; speed: number; durationSec: number }): AttemptResult
}

/**
 * The guitar tracker as the player has always driven it: a `ScoreTracker` for the notes, a
 * `PitchSmoother` for the pitch on screen, and every frame through `scoreFrame`. Nothing is added and
 * nothing is left out; the simulation tests hold it to that, number for number.
 */
export class GuitarRunTracker implements RunTracker {
  readonly needsSpectrum = true
  /** The tracker itself, for what only a guitar run has (the timing of each hit, the groups). */
  readonly score: ScoreTracker
  private readonly smoother: PitchSmoother

  constructor(notes: ChartNote[], options: ScoreOptions, smoother: PitchSmoother) {
    this.score = new ScoreTracker(notes, options)
    this.smoother = smoother
  }

  setSpeed(speed: number): void {
    this.score.setSpeed(speed)
  }

  reset(): void {
    this.score.reset()
  }

  seek(songTime: number): void {
    this.score.seek(songTime)
  }

  setRange(from: number, to: number): void {
    this.score.setRange(from, to)
  }

  nextPass(): void {
    this.score.nextPass()
  }

  markUnscored(): void {
    this.score.markUnscored()
  }

  advance(songTime: number): GroupState[] {
    return this.score.advance(songTime)
  }

  onPlaybackStart(): void {
    this.smoother.reset()
  }

  frame(frame: PitchFrame, songTime: number | null, settings: FrameSettings): FrameOutcome {
    return scoreFrame(this.score, this.smoother, frame, songTime, settings)
  }

  stateOfNote(noteId: number): GroupState | undefined {
    return this.score.stateOfNote(noteId)
  }

  summary(): ScoreSummary {
    return this.score.summary()
  }

  toAttemptResult(opts: { playedTempo: number; targetTempo: number; speed: number; durationSec: number }): AttemptResult {
    return this.score.toAttemptResult(opts)
  }
}

/**
 * A guitar tracker for `notes`. `smoother` may be the caller's own: the player keeps one for as long
 * as it is on screen, so a tracker rebuilt in the middle of a run (the level or the speed changed)
 * still knows the level heard a moment ago.
 */
export function guitarRunTracker(notes: ChartNote[], options: ScoreOptions = {}, smoother: PitchSmoother = new PitchSmoother()): GuitarRunTracker {
  return new GuitarRunTracker(notes, options, smoother)
}

export interface RunTrackerOptions {
  /** Guitar only: which octave errors count. */
  octaveTolerance: OctaveTolerance
  /**
   * Guitar only: the reference pitch of A4 in Hz (the "Reference pitch" setting). A sung chart is read
   * against the app's own 440 Hz whatever this says, because that is where the notes the app plays for
   * singing are (`VOICE.a4` in voice/judge.ts).
   */
  a4: number
  /**
   * Sample rate of the microphone (the audio context's): a sung run's frames are timed with it. As a
   * function it is only called for a sung chart, when the first frame arrives, so the player need not
   * have an audio context when it builds its tracker (and never asks for one on a guitar chart).
   */
  sampleRate: number | (() => number)
  /** Guitar only: the caller's own smoother (see `guitarRunTracker`). */
  smoother?: PitchSmoother
}

/** The tracker for a chart and the notes of it that are shown and scored: sung when the chart says so, guitar otherwise. */
export function createRunTracker(chart: Chart, notes: ChartNote[], o: RunTrackerOptions): RunTracker {
  if (chart.voice) return new VoiceTracker(chart, notes, { sampleRate: o.sampleRate })
  return guitarRunTracker(notes, { octaveTolerance: o.octaveTolerance, a4: o.a4, beats: chart.beats }, o.smoother)
}
