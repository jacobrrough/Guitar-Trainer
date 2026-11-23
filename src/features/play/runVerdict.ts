import type { AttemptResult, InstrumentId } from '../../training/types'
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
 *
 * A sung run gets its verdict by the same rule: not heard is a voice that was not heard, `bleed` is the
 * guide voice coming back through the microphone, and headphones changed on the way with the guide on
 * make a run `partial`. Only the words differ (`NOT_COUNTED_VOICE`).
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

/**
 * The same three cards for a singer. Never "sing louder": a voice that was not heard means the phone
 * is too far away. And the card about the app's own sound allows for the one case where the app is
 * mistaken: a singer with headphones on who joins in with the guide from its first moment looks, to
 * the microphone, exactly like the speaker.
 */
export const NOT_COUNTED_VOICE: Record<Exclude<RunVerdict, 'counted'>, { title: string; body: string }> = {
  unscored: {
    title: 'Nothing was scored',
    body: 'The app could not hear you sing. Check that the microphone is on and move the phone a little closer. This run was not saved.',
  },
  partial: {
    title: 'This run did not count',
    body: 'Only part of it was sung and scored this time: it was started from the middle, moved on the way, the microphone was off for a while, or the headphones were changed. That is fine for practice. Sing it from the start to have it count.',
  },
  bleed: {
    title: 'This run did not count',
    body: 'The phone was hearing its own sound. Use headphones or turn the guide off. If you have headphones on, wait for the guide to finish before you sing. This run was not saved.',
  },
}

/** The words for a run that does not count, for the instrument it was made on (the guitar unless told otherwise). */
export function notCountedCopy(verdict: Exclude<RunVerdict, 'counted'>, instrument: InstrumentId = 'guitar'): { title: string; body: string } {
  return (instrument === 'voice' ? NOT_COUNTED_VOICE : NOT_COUNTED)[verdict]
}
