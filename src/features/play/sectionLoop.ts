import type { Chart } from '../../chart/types'
import { SONG_SLOW_DOWN_ACCURACY, SONG_TARGET_ACCURACY, WEAK_BAR_ACCURACY } from '../../training/constants'

/** Lowest and highest playback speed the auto-step policy will pick. */
export const MIN_LOOP_SPEED = 0.5
export const MAX_LOOP_SPEED = 1
/** Speed change applied per auto-step. */
export const LOOP_SPEED_STEP = 0.1

/** Selectable pass counts for a section loop. */
export const LOOP_PASS_OPTIONS = [1, 2, 4]

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Auto-step policy: speed up after a clean pass, slow down after a rough one,
 * otherwise stay. Result is clamped to 0.5..1 and rounded to one decimal.
 */
export function nextLoopSpeed(accuracy: number, speed: number): number {
  let next = speed
  if (accuracy >= SONG_TARGET_ACCURACY) next = speed + LOOP_SPEED_STEP
  else if (accuracy < SONG_SLOW_DOWN_ACCURACY) next = speed - LOOP_SPEED_STEP
  return round1(Math.min(MAX_LOOP_SPEED, Math.max(MIN_LOOP_SPEED, next)))
}

/**
 * The worst contiguous run (at most `maxBars` bars) of bars below `threshold`.
 * "Worst" means the largest total shortfall; bars with -1 (no notes) are ignored
 * and break runs. Returns a 0-based inclusive range, or null when nothing is weak.
 */
export function weakestRange(perBar: number[], threshold = WEAK_BAR_ACCURACY, maxBars = 4): [number, number] | null {
  let best: [number, number] | null = null
  let bestDeficit = 0
  for (let start = 0; start < perBar.length; start++) {
    let deficit = 0
    for (let end = start; end < perBar.length && end - start < maxBars; end++) {
      const acc = perBar[end]
      if (acc < 0 || acc >= threshold) break
      deficit += threshold - acc
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit
        best = [start, end]
      }
    }
  }
  return best
}

/** Number of bars in a chart (from the last beat's bar index), at least 1. */
export function barCount(chart: Pick<Chart, 'beats'>): number {
  const last = chart.beats[chart.beats.length - 1]
  return last ? last.bar + 1 : 1
}

/** Clamp a 0-based inclusive bar range into 0..barCount-1 and order it. */
export function clampRange(range: [number, number], count: number): [number, number] {
  const max = Math.max(0, count - 1)
  const a = Math.min(max, Math.max(0, Math.round(range[0])))
  const b = Math.min(max, Math.max(0, Math.round(range[1])))
  return a <= b ? [a, b] : [b, a]
}

/** Ready-screen text, e.g. `Loop bars 5–8 · 2 passes · 70% speed` (bars 1-based). */
export function loopHint(range: [number, number], passes: number, speed: number): string {
  const bars = range[0] === range[1] ? `bar ${range[0] + 1}` : `bars ${range[0] + 1}–${range[1] + 1}`
  return `Loop ${bars} · ${passes} ${passes === 1 ? 'pass' : 'passes'} · ${Math.round(speed * 100)}% speed`
}

/** Result message after a loop run, or the new speed to apply on "Go again". */
export function loopOutcome(accuracy: number, speed: number, autoStep: boolean): { message: string; nextSpeed: number } {
  if (!autoStep) return { message: `Again at ${Math.round(speed * 100)}%`, nextSpeed: speed }
  if (speed >= MAX_LOOP_SPEED && accuracy >= SONG_TARGET_ACCURACY) {
    return { message: 'Section mastered. Try the whole song.', nextSpeed: speed }
  }
  const next = nextLoopSpeed(accuracy, speed)
  const pct = Math.round(next * 100)
  if (next > speed) return { message: `Clean! Speeding up to ${pct}%`, nextSpeed: next }
  if (next < speed) return { message: `Slowing down to ${pct}%`, nextSpeed: next }
  return { message: `Again at ${pct}%`, nextSpeed: next }
}
