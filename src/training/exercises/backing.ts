import { renderChartAudio } from '../../audio/guitar'
import { renderDrums } from '../../audio/synth'
import { renderVoiceNotes } from '../../audio/voice'
import type { Chart } from '../../chart/types'
import { BACKING_SAMPLE_RATE } from '../constants'
import type { GeneratedExercise } from '../types'

/**
 * Generators return `backing: null` (cheap, synchronous, test-friendly); the UI adds audio right
 * before a block starts.
 *
 * `backing` is the click track only: it is what plays while the microphone scores, so a phone
 * speaker cannot feed the part back into the mic and score itself. The guide (the part played on the
 * guitar over the click, for listening) is rendered separately by `renderExerciseGuide`, because it
 * needs the recorded guitar, which loads asynchronously; `wantsGuide` says whether to make one (not
 * for tests).
 *
 * A sung exercise (`chart.voice`) follows the same rule with one addition: its scored track also
 * carries the cues, the notes the app sings in the singer's rests (a starting note, its turn of a
 * call and answer). The scorer gives no credit while a cue sounds, and a cue ends a beat before the
 * singer comes in. The notes the singer is asked for are never on the scored track: sung by the app,
 * they would score every one of themselves. They are on the guide only.
 */
export function renderExerciseBacking(exercise: GeneratedExercise, options: { guide?: boolean } = {}): GeneratedExercise {
  const backing = exercise.chart.voice ? voiceScoredTrack(exercise.chart, BACKING_SAMPLE_RATE) : renderDrums(exercise.chart, { sampleRate: BACKING_SAMPLE_RATE })
  return { ...exercise, backing, guide: null, wantsGuide: options.guide ?? true, backingSampleRate: BACKING_SAMPLE_RATE }
}

/**
 * The exercise played on the guitar over its click track, at the exercise's sample rate. For a sung
 * exercise: its scored track with the answers sung by the guide voice as well, and no chords.
 */
export function renderExerciseGuide(exercise: GeneratedExercise): Promise<Float32Array> {
  const sampleRate = exercise.backingSampleRate || BACKING_SAMPLE_RATE
  if (exercise.chart.voice) return Promise.resolve(voiceGuideTrack(exercise.chart, sampleRate))
  return renderChartAudio(exercise.chart, { sampleRate, plucks: true, click: true })
}

/** Click plus cues: what a sung exercise sounds like while the microphone scores. */
function voiceScoredTrack(chart: Chart, sampleRate: number): Float32Array {
  const track = renderDrums(chart, { sampleRate })
  const cues = renderVoiceNotes(chart.voice?.cues ?? [], { sampleRate, length: track.length })
  for (let i = 0; i < track.length; i++) track[i] += cues[i]
  return track
}

/**
 * The scored track with the singer's notes sung too. The answers are rendered apart from the cues and
 * added: the guide voice is one voice, and in one pass a note that follows a cue closely would cut it.
 */
function voiceGuideTrack(chart: Chart, sampleRate: number): Float32Array {
  const track = voiceScoredTrack(chart, sampleRate)
  const answers = renderVoiceNotes(chart.notes, { sampleRate, length: track.length })
  for (let i = 0; i < track.length; i++) track[i] += answers[i]
  return track
}
