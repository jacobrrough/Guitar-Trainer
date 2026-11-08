/**
 * Speaker-bleed detection. During the count-in the app plays clicks at known
 * AudioContext times; if the microphone reports attacks right after most of
 * them, it is hearing the device's own speaker, and the run would score itself.
 */
export const BLEED_MAX_LAG_SEC = 0.15
export const BLEED_MIN_HITS = 3

/** True when at least `minHits` clicks are followed within `maxLag` seconds by a microphone attack. */
export function detectBleed(clickTimes: number[], attackTimes: number[], maxLag = BLEED_MAX_LAG_SEC, minHits = BLEED_MIN_HITS): boolean {
  if (clickTimes.length === 0) return false
  let hits = 0
  for (const c of clickTimes) {
    if (attackTimes.some((a) => a >= c && a - c <= maxLag)) hits++
  }
  return hits >= Math.min(minHits, clickTimes.length)
}
