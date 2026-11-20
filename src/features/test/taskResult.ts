import { GOOD_HIT_WEIGHT, MIN_HITS_FOR_TIMING } from '../../training/constants'
import type { AttemptResult, PassCriteria } from '../../training/types'

export type FailedCriterion = 'accuracy' | 'timing' | 'spread'

/** Accuracy as the pass rule counts it (0..1): a note that is a little early or late counts for less than a clean one. */
export function ruleAccuracy(result: Pick<AttemptResult, 'perfects' | 'goods' | 'total'>): number {
  return result.total > 0 ? (result.perfects + GOOD_HIT_WEIGHT * result.goods) / result.total : 0
}

/** Which parts of the pass rule a result misses; empty when the task is passed. Mirrors `meetsCriteria`. */
export function failedCriteria(criteria: PassCriteria, result: AttemptResult): FailedCriterion[] {
  const failed: FailedCriterion[] = []
  if (ruleAccuracy(result) < criteria.minAccuracy) failed.push('accuracy')
  const hits = result.perfects + result.goods
  const timingOff = result.timingMedianMs === null ? hits >= MIN_HITS_FOR_TIMING : Math.abs(result.timingMedianMs) > criteria.maxMedianMs
  if (timingOff) failed.push('timing')
  if (result.timingStdevMs !== null && result.timingStdevMs > criteria.maxStdevMs) failed.push('spread')
  return failed
}

/**
 * The accuracy to show, in whole percent. A result under the pass mark is never rounded up to it:
 * "85%" next to "below 85%" would read as a mistake.
 */
export function shownAccuracyPct(accuracy: number, minAccuracy: number): number {
  const rounded = Math.round(Math.max(0, Math.min(1, accuracy)) * 100)
  if (accuracy >= minAccuracy) return rounded
  return Math.min(rounded, Math.ceil(minAccuracy * 100) - 1)
}

const BADGE: Record<FailedCriterion, string> = { accuracy: 'accuracy below target', timing: 'timing off target', spread: 'timing not steady' }

/** Short label for the result badge: which part of the rule was missed. */
export function verdictBadge(failed: FailedCriterion[]): string {
  if (failed.length === 0) return 'on target'
  return failed.map((f) => BADGE[f]).join(' · ')
}

/** One plain sentence for each missed part of the rule, with the number that was needed. */
export function failureReasons(criteria: PassCriteria, result: AttemptResult): string[] {
  const part = Math.round(GOOD_HIT_WEIGHT * 100)
  return failedCriteria(criteria, result).map((f) => {
    if (f === 'accuracy') {
      const got = shownAccuracyPct(ruleAccuracy(result), criteria.minAccuracy)
      const close = result.goods > 0 ? ` A note that is a little early or late counts as ${part}% of a note, and ${result.goods} of yours were.` : ''
      return `Accuracy: you scored ${got}%, and ${Math.round(criteria.minAccuracy * 100)}% is needed.${close}`
    }
    if (f === 'timing') {
      const ms = result.timingMedianMs
      if (ms === null) return 'Timing: it could not be measured this time.'
      return `Timing: most of your notes came ${ms > 0 ? 'after' : 'before'} the beat, by about ${Math.round(Math.abs(ms))} ms. ${criteria.maxMedianMs} ms or less is needed.`
    }
    return `Steadiness: some notes came early and some late (spread ${Math.round(result.timingStdevMs ?? 0)} ms). ${criteria.maxStdevMs} ms or less is needed.`
  })
}

/** The pass rule in one line, shown before a task is played. */
export function passRuleText(criteria: PassCriteria): string {
  return `To pass: ${Math.round(criteria.minAccuracy * 100)}% accuracy with steady timing. A note that is a little early or late counts as ${Math.round(GOOD_HIT_WEIGHT * 100)}% of a note.`
}
