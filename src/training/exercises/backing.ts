import { renderChartAudio } from '../../audio/guitar'
import { renderDrums } from '../../audio/synth'
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
 */
export function renderExerciseBacking(exercise: GeneratedExercise, options: { guide?: boolean } = {}): GeneratedExercise {
  const backing = renderDrums(exercise.chart, { sampleRate: BACKING_SAMPLE_RATE })
  return { ...exercise, backing, guide: null, wantsGuide: options.guide ?? true, backingSampleRate: BACKING_SAMPLE_RATE }
}

/** The exercise played on the guitar over its click track, at the exercise's sample rate. */
export function renderExerciseGuide(exercise: GeneratedExercise): Promise<Float32Array> {
  return renderChartAudio(exercise.chart, { sampleRate: exercise.backingSampleRate || BACKING_SAMPLE_RATE, plucks: true, click: true })
}
