import type { VoiceChart } from '../../chart/types'
import { REP_DOWN_ACCURACY } from '../../training/constants'
import { maxStepFor } from '../../training/planner'
import type { GeneratedExercise, SkillDef, VoiceRange } from '../../training/types'
import type { ScoreSummary } from '../play/scoring'
import { voiceResultCopy } from '../play/voice/voiceCopy'

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

/** Said after a rough sung round that the Coach cannot make easier: hearing it once more is what helps. */
export const LISTEN_FIRST = 'Listen first, then once more'

export interface SungRound {
  /**
   * A step exercise: the step that was sung, the step the next round will be on, and that step in the
   * words of its skill. Absent for a sung exercise that moves by tempo.
   */
  step?: { now: number; next: number; nextLabel: string }
  tempo: number
  nextTempo: number
  /** What the Coach made of the round (0..1). */
  accuracy: number
}

/**
 * What the next round of a sung exercise will be like, from what the Coach really picked for it.
 *
 * A step exercise has one tempo for good (slower is not easier for a held note or a slide), so its
 * card never speaks of a pace: it names the step. An exercise that gets faster speaks of the pace, as
 * a guitar round does. Either way, a rough round can come back unchanged: on the first step there is
 * nothing easier, and under the tempo floor of a sung exercise a line would outlast the breath. Then
 * "the same again" would be a poor thing to say; the card offers to listen first.
 */
export function nextSungRoundText(round: SungRound): string {
  const rough = round.accuracy < REP_DOWN_ACCURACY
  if (round.step) {
    const { now, next, nextLabel } = round.step
    if (next > now) return `Next round: ${nextLabel}`
    if (next < now) return `Next round a step easier: ${nextLabel}`
    return rough ? LISTEN_FIRST : 'Next round the same again'
  }
  const current = Math.round(round.tempo)
  const next = Math.round(round.nextTempo)
  if (next > current) return 'Next round a bit faster'
  if (next < current) return 'Next round a bit slower'
  return rough ? LISTEN_FIRST : 'Next round at the same pace'
}

/**
 * The step the next round of a step exercise is really built on.
 *
 * The Coach picks a step from how the round went. The singer may then say the slides felt tight, which
 * takes a note off the top of their easy notes, and a step that needed that note no longer fits. The
 * round is then built on the highest step that does (the builders ask `maxStepFor` too), so that is
 * the one the card has to name. It never moves a step up.
 */
export function stepThatFits(skill: SkillDef, step: number, range?: Pick<VoiceRange, 'low' | 'high'>): number {
  return range ? Math.min(step, maxStepFor(skill, range)) : step
}

/**
 * The result line and the one tip of a sung run, for the card it stands on. `blockOver` says the card
 * ends the block (its last round, or the last time through a song): no other go follows it, so its tip
 * keeps the advice and does not ask for one. "…and try again" under a block that is done would send
 * the singer looking for a button that is not there.
 * Before any run there is no summary, and nothing to say.
 */
export function sungCardCopy(summary: ScoreSummary | null, voice: Pick<VoiceChart, 'glide'> | undefined, blockOver: boolean): { line: string; tip: string | null } {
  if (!summary) return { line: '', tip: null }
  return voiceResultCopy(summary, voice, { anotherGo: !blockOver })
}

/** What a song block of a singing plan shows: a wait, a notice, or the player. */
export type SungSongView = 'getting-ready' | 'not-ready' | 'later' | 'player'

/** Where a song to sing is on its way to the screen (the shape `useVocalRunState` answers in, as far as it is read here). */
type SungSongState = { status: 'none' | 'preparing' | 'failed' } | { status: 'ready'; run: { key: string; fits: boolean } }

/**
 * Which of them it is. `movedFrom` names the arrangement that was on screen when the Coach moved the
 * song to a lower key (null when it has not).
 *
 * The trap is the moment after such a move. The key choice is already stored, but the screen has not
 * been handed the new arrangement yet, so the one that was just sung still looks like the latest. Put
 * back on screen with its start button, a pass sung in it would be counted as a run in the new key.
 * A moved song always gets another name (the key is part of it), so the old name is never shown again:
 * the screen waits for the new one.
 */
export function sungSongView(state: SungSongState, movedFrom: string | null): SungSongView {
  if (state.status === 'preparing') return 'getting-ready'
  if (state.status !== 'ready') return 'not-ready'
  if (state.run.key === movedFrom) return 'getting-ready'
  return state.run.fits ? 'player' : 'later'
}

/** What a round is called: a "rep" only to a guitarist who asked for the details. A singer never reads that word. */
export function roundWord(simple: boolean, sung = false): 'Round' | 'Rep' {
  return simple || sung ? 'Round' : 'Rep'
}

/**
 * The badge in the player's header. With details on, a step exercise shows its step where the tempo
 * would stand: its tempo is the same on every round and says nothing.
 */
export function roundBadge(o: { simple: boolean; rep: number; reps: number; tempo: number; sung?: boolean; stepLabel?: string | null }): string {
  if (o.simple) return `Round ${o.rep} of ${o.reps}`
  return `${roundWord(false, o.sung)} ${o.rep}/${o.reps} · ${o.stepLabel ?? `${Math.round(o.tempo)} bpm`}`
}

/** For a guitar block that went badly: most missed notes of a beginner are notes that did not ring. */
export const FRETTING_TIP = 'Buzzing or muted notes? Press each string firmly just behind the metal bar (fret), close to it.'

/**
 * One tip under the result of a block. A guitarist reads the fretting tip after a block that went
 * badly, else the first tip of the skill. A singer never reads about frets: what the run itself showed
 * (under the note, not heard) comes first, and when it showed nothing, the skill's own tip.
 */
export function blockTip(o: { accuracy: number; skillTips: string[]; sung?: { runTip: string | null } }): string {
  const own = o.skillTips[0] ?? ''
  if (o.sung) return o.sung.runTip ?? own
  return o.accuracy < 0.5 ? FRETTING_TIP : own
}

/** The line under a finished block: accuracy, plus the tempo reached when the exercise has one. */
export function blockResultLine(accuracyPct: number, tempo: number, paced: boolean): string {
  return paced ? `${accuracyPct}% accuracy · reached ${Math.round(tempo)} bpm` : `${accuracyPct}% accuracy`
}

/**
 * Under the big percentage of a finished block, for a learner who asked for the details: what the
 * number is, and how far the block got. A step exercise got to a step (`stepLabel`), not to a tempo.
 */
export function resultCaption(o: { paced: boolean; tempo: number; stepLabel?: string | null }): string {
  if (o.stepLabel) return `accuracy · last round: ${o.stepLabel}`
  return o.paced ? `accuracy · reached ${Math.round(o.tempo)} bpm` : 'accuracy'
}

/** For a singer with plain feedback: the step the block got to, and no number they cannot use. */
export function sungStepLine(stepLabel: string): string {
  return `Last round: ${stepLabel}`
}

/**
 * A line for the result of a block whose score did not move although the playing was clean: the
 * score of a skill above "solid" only rises with the tempo, and a learner who sees "85 → 85" after a
 * clean block should know why. Empty when there is nothing to explain.
 *
 * For a sung block (`sung`) the words are a singer's, and a step exercise (`step`: the step last sung
 * and the highest one this voice can reach) is told that the score follows the steps: it has no tempo
 * to go up.
 */
export function scoreHint(o: {
  before: number
  after: number
  accuracy: number
  tempo: number
  targetTempo: number
  paced: boolean
  sung?: boolean
  step?: { now: number; top: number }
}): string {
  if (!o.paced || o.accuracy < 0.85 || Math.round(o.after) > Math.round(o.before)) return ''
  if (o.after >= 100) {
    return o.sung
      ? 'You sing this as well as it asks for. It comes back now and then so it stays that way.'
      : 'You play this at the tempo it aims for. It comes back now and then so it stays that way.'
  }
  if (o.step) return o.step.now < o.step.top ? 'Clean. This score goes up again on the next step.' : ''
  if (o.tempo < o.targetTempo) return 'Clean. This score goes up again as the rounds get faster.'
  return ''
}
