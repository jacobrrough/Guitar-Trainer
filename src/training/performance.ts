import {
  CALIBRATION_MAX_AGE_DAYS,
  GOOD_HIT_WEIGHT,
  MIN_COVERAGE,
  MIN_HITS_FOR_TIMING,
  PERF_WEIGHTS,
  TIMING_BIAS_WARN_MS,
  TIMING_SIGMA_FULL_MS,
} from './constants'
import type { AttemptResult, Performance } from './types'

export interface PerformanceContext {
  /** Age of the latency calibration in days; null/undefined = never calibrated. */
  calibrationAgeDays?: number | null
  /** Median hit delta across the whole session, ms. */
  sessionTimingBiasMs?: number | null
  isTest?: boolean
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** Combine raw attempt numbers into acc / tim / tmp / p and an evidence-quality flag (docs §4.2, §5). */
export function attemptPerformance(result: AttemptResult, ctx: PerformanceContext = {}): Performance {
  const acc = result.total > 0 ? (result.perfects + GOOD_HIT_WEIGHT * result.goods) / result.total : 0
  const hits = result.perfects + result.goods
  const tim =
    result.timingStdevMs === null || hits < MIN_HITS_FOR_TIMING
      ? acc
      : clamp(1 - result.timingStdevMs / TIMING_SIGMA_FULL_MS, 0, 1)
  const tmp = result.targetTempo > 0 ? clamp(result.playedTempo / result.targetTempo, 0.5, 1) : 1
  const p = PERF_WEIGHTS.acc * acc + PERF_WEIGHTS.tim * tim + PERF_WEIGHTS.tmp * tmp

  const reasons: string[] = []
  if (result.coverage < MIN_COVERAGE) reasons.push('low coverage')
  if (ctx.isTest && (ctx.calibrationAgeDays == null || ctx.calibrationAgeDays > CALIBRATION_MAX_AGE_DAYS)) {
    reasons.push('calibration stale')
  }
  if (ctx.sessionTimingBiasMs != null && Math.abs(ctx.sessionTimingBiasMs) > TIMING_BIAS_WARN_MS) reasons.push('timing bias')
  return { acc, tim, tmp, p, reliable: reasons.length === 0, reasons }
}
