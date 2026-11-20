import type { AttemptResult } from '../../training/types'
import type { ScoreSummary } from './scoring'

/**
 * Whether a finished run may count towards progress.
 * - `unscored`: the app did not hear the guitar. Either the microphone delivered nothing (denied, off
 *   or dead), or no note was hit and there was hardly a sound during the notes (phone too far away,
 *   or nobody played). That says nothing about the learner's playing.
 * - `bleed`: the microphone was hearing the app's own guitar part from the speaker, so the app
 *   would be marking its own playing.
 * - `partial`: only part of the piece was played and scored (begun in the middle, moved on the way,
 *   or the microphone was off for a stretch). Fine as practice, but not a result for the piece.
 * In each case the run is shown as "not counted" and nothing is saved.
 */
export type RunVerdict = 'counted' | 'unscored' | 'bleed' | 'partial'

/** With no hit at all, sound during fewer than this share of the notes means the guitar was not heard. */
export const UNHEARD_COVERAGE = 0.2

export function runVerdict(summary: Pick<ScoreSummary, 'total' | 'perfects' | 'goods'>, result: Pick<AttemptResult, 'bleed' | 'coverage' | 'partial'>): RunVerdict {
  if (summary.total === 0) return 'unscored'
  if (result.bleed) return 'bleed'
  if (summary.perfects + summary.goods === 0 && result.coverage < UNHEARD_COVERAGE) return 'unscored'
  if (result.partial) return 'partial'
  return 'counted'
}

export const NOT_COUNTED: Record<Exclude<RunVerdict, 'counted'>, { title: string; body: string }> = {
  unscored: {
    title: 'Nothing was scored',
    body: 'The app could not hear your guitar. Check that the microphone is on and allowed, and bring the phone closer to the guitar. Then try again. This run was not saved.',
  },
  partial: {
    title: 'This run did not count',
    body: 'Only part of it was played and scored this time: it was started from the middle, moved on the way, or the microphone was off for a while. That is fine for practice. Play it from the start to have it count.',
  },
  bleed: {
    title: 'This run did not count',
    body: 'The microphone was hearing the guitar part from the speaker, so the app would be marking its own playing. Turn the guitar part off with the speaker button, or use headphones, then try again. This run was not saved.',
  },
}
