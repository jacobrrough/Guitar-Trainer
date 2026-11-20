import type { GeneratedExercise } from '../../training/types'

/**
 * Whether an exercise is played to a beat. Ear training is not: the player answers in their own time,
 * so timing and tempo lines say nothing about it and are left out.
 */
export function hasPace(exercise: Pick<GeneratedExercise, 'interaction'>): boolean {
  return exercise.interaction !== 'ear'
}

/** What the next round will be like, in plain words, from the tempo it will really be played at. */
export function nextRoundText(currentTempo: number, nextTempo: number): string {
  const current = Math.round(currentTempo)
  const next = Math.round(nextTempo)
  if (next > current) return 'Next round a bit faster'
  if (next < current) return 'Next round a bit slower, to give you more time for each note'
  return 'Next round at the same pace'
}

/** The line under a finished block: accuracy, plus the tempo reached when the exercise has one. */
export function blockResultLine(accuracyPct: number, tempo: number, paced: boolean): string {
  return paced ? `${accuracyPct}% accuracy · reached ${Math.round(tempo)} bpm` : `${accuracyPct}% accuracy`
}

/**
 * A line for the result of a block whose score did not move although the playing was clean: the
 * score of a skill above "solid" only rises with the tempo, and a learner who sees "85 → 85" after a
 * clean block should know why. Empty when there is nothing to explain.
 */
export function scoreHint(o: { before: number; after: number; accuracy: number; tempo: number; targetTempo: number; paced: boolean }): string {
  if (!o.paced || o.accuracy < 0.85 || Math.round(o.after) > Math.round(o.before)) return ''
  if (o.after >= 100) return 'You play this at the tempo it aims for. It comes back now and then so it stays that way.'
  if (o.tempo < o.targetTempo) return 'Clean. This score goes up again as the rounds get faster.'
  return ''
}

