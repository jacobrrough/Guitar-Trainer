import { CLICK_COUNT, CLICK_INTERVAL, MATCH_AFTER, PREROLL } from './calibration'

/** Sample rate of the calibration click track. */
export const CLICK_TRACK_RATE = 44100

/** Where each calibration click sits in the click track, in seconds from its start. */
export function clickTimes(): number[] {
  return Array.from({ length: CLICK_COUNT }, (_, i) => PREROLL + i * CLICK_INTERVAL)
}

/** Length of the click track: the quiet lead-in, the clicks, and room for the answer to the last one. */
export function clickTrackSeconds(): number {
  return PREROLL + (CLICK_COUNT - 1) * CLICK_INTERVAL + MATCH_AFTER + 0.4
}

/**
 * The calibration clicks as one piece of audio. It is played through the same kind of player the
 * songs use, and the answers are timed on that player's clock, so the delay that is measured is the
 * very delay scoring has to allow for. (Clicks scheduled on the Web Audio clock would measure a
 * different path, off by that clock's own output delay.)
 * Each click is a short bright tone that starts at full level on its exact sample and dies away.
 */
export function renderClickTrack(sampleRate = CLICK_TRACK_RATE): Float32Array {
  const out = new Float32Array(Math.ceil(clickTrackSeconds() * sampleRate))
  clickTimes().forEach((time, i) => {
    const start = Math.round(time * sampleRate)
    const accent = i % 4 === 0
    const freq = accent ? 1760 : 1175
    const length = Math.round((accent ? 0.08 : 0.05) * sampleRate)
    for (let n = 0; n < length && start + n < out.length; n++) {
      const t = n / sampleRate
      // A square-ish tone (the first two odd partials) with a fast exponential decay.
      const tone = Math.sin(2 * Math.PI * freq * t) + Math.sin(2 * Math.PI * 3 * freq * t) / 3
      out[start + n] = (accent ? 0.5 : 0.4) * tone * Math.exp(-t * (accent ? 45 : 70))
    }
  })
  return out
}
