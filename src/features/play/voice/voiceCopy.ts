/**
 * What a singer is told after a run: one line with the count of notes, and at most one tip.
 *
 * A sung result has no timing line. The tracker measures when a note was first on pitch, but being a
 * little behind the click is not what a singer needs to hear about: the notes are. So the line is the
 * count, and the tip is chosen from the reasons the tracker kept for each note (`VoiceFeedback`).
 *
 * The words follow docs/SINGING.md §10. The app never asks for more voice: a note that was not heard
 * means the phone is too far away. Nothing is "wrong", and no number a beginner cannot use (cents,
 * shares) reaches the screen.
 */
import type { VoiceChart } from '../../../chart/types'
import type { ScoreSummary } from '../scoring'
import { voiceFeedbackOf, type NoteReason, type VoiceFeedback } from './voiceTracker'

export const VOICE_TIPS = {
  silent: 'We could not hear you there. Move the phone a little closer.',
  low: 'A little under the note. Think a bit higher and try again.',
  high: 'A little over the note. Sing softer and let it settle.',
  unsteady: 'You were close to the notes. Hold each one a little longer and keep it steady.',
  slid: 'You slid up to the notes. Hear the note first, then start right on it.',
  octaveLower: 'You sang it an octave lower. That counts.',
  octaveHigher: 'You sang it an octave higher. That counts.',
} as const

/**
 * The reasons a note did not count, in the order they are spoken of when two cost the same number of
 * notes: first what the singer can do nothing about by singing differently (the phone did not hear),
 * then under, over, and last the vaguest one.
 */
const MISSED: readonly Exclude<NoteReason, 'slid'>[] = ['silent', 'low', 'high', 'unsteady']

/** Sliding up to notes is worth a word when at least this many notes, and this share of the notes that counted, began under. */
const SLID_NOTES = 2
const SLID_SHARE = 0.25

/** "You were on the note for 5 of 8 notes." */
export function voiceResultLine(run: { hits: number; notes: number }): string {
  return `You were on the note for ${run.hits} of ${run.notes} ${run.notes === 1 ? 'note' : 'notes'}.`
}

/**
 * One tip for the run, or none.
 *
 * What cost the most notes comes first. When no note was lost, a habit of sliding up to the notes is
 * worth a word; and a singer who sang everything in another octave is told that this counts, because
 * the dot was on the bars all along and they may wonder.
 *
 * `voice` is the chart's own word about itself (`chart.voice`). On a chart of slides (`glide`) the
 * singer is asked to slide up to the notes, so sliding is never what the tip is about.
 */
export function voiceTip(feedback: VoiceFeedback, voice?: Pick<VoiceChart, 'glide'>): string | null {
  let worst: Exclude<NoteReason, 'slid'> | null = null
  for (const reason of MISSED) {
    const count = feedback.reasons[reason]
    if (count > 0 && (worst === null || count > feedback.reasons[worst])) worst = reason
  }
  if (worst) return VOICE_TIPS[worst]
  if (!voice?.glide && feedback.reasons.slid >= SLID_NOTES && feedback.reasons.slid >= SLID_SHARE * feedback.hits) return VOICE_TIPS.slid
  // (The octave is only ever other than 0 when notes counted: it is the octave they were sung in.)
  if (feedback.octave <= -1) return VOICE_TIPS.octaveLower
  if (feedback.octave >= 1) return VOICE_TIPS.octaveHigher
  return null
}

/**
 * The result line and the tip of a sung run, from the summary the player hands to `onFinished` and
 * the chart that was sung (`chart.voice`). A summary that carries no feedback (it was put together
 * from a stored result) still gets its line.
 */
export function voiceResultCopy(summary: ScoreSummary, voice?: Pick<VoiceChart, 'glide'>): { line: string; tip: string | null } {
  const feedback = voiceFeedbackOf(summary)
  if (!feedback) return { line: voiceResultLine({ hits: summary.perfects + summary.goods, notes: summary.perfects + summary.goods + summary.misses }), tip: null }
  return { line: voiceResultLine(feedback), tip: voiceTip(feedback, voice) }
}
