import { renderChartBacking } from '../../audio/synth'
import { BACKING_SAMPLE_RATE } from '../constants'
import type { GeneratedExercise } from '../types'

/**
 * Generators return `backing: null` (cheap, synchronous, test-friendly); the
 * UI renders audio right before a block starts. Chord/strum exercises use a
 * click-only backing so the player's own strumming is what is heard.
 */
export function renderExerciseBacking(exercise: GeneratedExercise, options: { plucks?: boolean } = {}): GeneratedExercise {
  const backing = renderChartBacking(exercise.chart, { sampleRate: BACKING_SAMPLE_RATE, plucks: options.plucks ?? true, click: true })
  return { ...exercise, backing, backingSampleRate: BACKING_SAMPLE_RATE }
}
