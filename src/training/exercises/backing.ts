import { renderChartBacking } from '../../audio/synth'
import { BACKING_SAMPLE_RATE } from '../constants'
import type { GeneratedExercise } from '../types'

/**
 * Generators return `backing: null` (cheap, synchronous, test-friendly); the UI
 * renders audio right before a block starts.
 *
 * `backing` is click and drums only: it is what plays while the microphone is
 * scoring, so a phone speaker cannot feed the part back into the mic and score
 * itself. `guide` adds the plucked part for listening (off for chord/strum
 * drills, whose point is the player's own strumming, and for tests).
 */
export function renderExerciseBacking(exercise: GeneratedExercise, options: { guide?: boolean } = {}): GeneratedExercise {
  const backing = renderChartBacking(exercise.chart, { sampleRate: BACKING_SAMPLE_RATE, plucks: false, click: true })
  const guide = options.guide ?? true ? renderChartBacking(exercise.chart, { sampleRate: BACKING_SAMPLE_RATE, plucks: true, click: true }) : null
  return { ...exercise, backing, guide, backingSampleRate: BACKING_SAMPLE_RATE }
}
