import { EAR_GOOD_CENTS, EAR_PERFECT_CENTS } from '../../training/constants'
import type { AttemptResult } from '../../training/types'
import type { ScoreSummary } from '../play/scoring'

export type EarJudgement = 'perfect' | 'good' | 'miss'

/** Signed distance of the played pitch from the target, folded to the nearest octave. */
export function judgeCents(playedMidi: number, targetMidi: number): { cents: number; octaves: number } {
  const diff = playedMidi - targetMidi
  const octaves = Math.round(diff / 12)
  return { cents: 100 * (diff - 12 * octaves), octaves }
}

/** Judges one prompt; a null pitch (nothing heard) is a miss. Right note in the wrong octave is at most "good". */
export function judgePrompt(playedMidi: number | null, targetMidi: number): EarJudgement {
  if (playedMidi === null) return 'miss'
  const { cents, octaves } = judgeCents(playedMidi, targetMidi)
  const abs = Math.abs(cents)
  if (octaves === 0) {
    if (abs <= EAR_PERFECT_CENTS) return 'perfect'
    if (abs <= EAR_GOOD_CENTS) return 'good'
    return 'miss'
  }
  return abs <= EAR_PERFECT_CENTS ? 'good' : 'miss'
}

/** Median of the last 4 pitches when they agree within 0.3 semitones, else null. */
export function stablePitch(history: number[]): number | null {
  if (history.length < 4) return null
  const last = history.slice(-4)
  if (Math.max(...last) - Math.min(...last) > 0.3) return null
  const sorted = [...last].sort((a, b) => a - b)
  return (sorted[1] + sorted[2]) / 2
}

/** Builds the standard attempt numbers for an ear-training run. */
export function earAttemptResult(
  judgements: EarJudgement[],
  opts: { durationSec: number; tempo: number; heard: number },
): AttemptResult {
  const perfects = judgements.filter((j) => j === 'perfect').length
  const goods = judgements.filter((j) => j === 'good').length
  const misses = judgements.filter((j) => j === 'miss').length
  const total = judgements.length
  return {
    perfects,
    goods,
    misses,
    total,
    timingMedianMs: null,
    timingStdevMs: null,
    coverage: total === 0 ? 1 : opts.heard / total,
    durationSec: opts.durationSec,
    playedTempo: opts.tempo,
    targetTempo: opts.tempo,
    speed: 1,
  }
}

/**
 * Score summary shown by the shared rep flow. Pass the ordered judgements for the exact
 * longest non-miss run; without them maxStreak is the upper bound perfects + goods.
 */
export function earSummary(result: AttemptResult, judgements?: EarJudgement[]): ScoreSummary {
  const { perfects, goods, misses, total } = result
  let run = 0
  let best = perfects + goods
  if (judgements) {
    best = 0
    for (const j of judgements) {
      run = j === 'miss' ? 0 : run + 1
      best = Math.max(best, run)
    }
  }
  return {
    score: 100 * perfects + 50 * goods,
    streak: run,
    maxStreak: best,
    multiplier: 1,
    perfects,
    goods,
    misses,
    total,
    judged: total,
    accuracy: total === 0 ? 0 : (perfects + 0.8 * goods) / total,
  }
}

/** Short feedback such as "30 cents sharp" or "right note, an octave high". */
export function feedbackText(cents: number, octaves: number): string {
  const abs = Math.round(Math.abs(cents))
  if (octaves !== 0) {
    const where = `${Math.abs(octaves) === 1 ? 'an octave' : `${Math.abs(octaves)} octaves`} ${octaves > 0 ? 'high' : 'low'}`
    if (abs <= EAR_PERFECT_CENTS) return `right note, ${where}`
    return `${abs} cents ${cents > 0 ? 'sharp' : 'flat'}, ${where}`
  }
  if (abs < 5) return 'spot on'
  return `${abs} cents ${cents > 0 ? 'sharp' : 'flat'}`
}
