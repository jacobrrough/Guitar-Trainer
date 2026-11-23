/**
 * The singing side is built piece by piece and stays out of sight until all of it is there. Every door
 * into it (the instrument switch, the voice routes, the voice set-up) asks `voiceEnabled()` first.
 */
export const VOICE_RELEASED = false

/** A device can look at the voice side before the release by storing '1' under this key. */
const PREVIEW_KEY = 'gt.voice'

export function voiceEnabled(): boolean {
  if (VOICE_RELEASED) return true
  try {
    return localStorage.getItem(PREVIEW_KEY) === '1'
  } catch {
    // No storage (private mode, or no browser at all): no preview.
    return false
  }
}
