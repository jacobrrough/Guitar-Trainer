import { describe, expect, it } from 'vitest'
import { CLICK_COUNT, CLICK_INTERVAL, MATCH_AFTER, PREROLL } from './calibration'
import { CLICK_TRACK_RATE, clickTimes, clickTrackSeconds, renderClickTrack } from './clickTrack'

describe('calibration click track', () => {
  const track = renderClickTrack()

  it('has every click start on its exact sample, with silence before it', () => {
    const times = clickTimes()
    expect(times).toHaveLength(CLICK_COUNT)
    expect(times[0]).toBe(PREROLL)
    expect(times[1] - times[0]).toBeCloseTo(CLICK_INTERVAL, 9)
    for (const time of times) {
      const start = Math.round(time * CLICK_TRACK_RATE)
      // Dead silent for the 100 ms before the click (the previous one has long died away)...
      let before = 0
      for (let n = start - Math.round(0.1 * CLICK_TRACK_RATE); n < start; n++) before = Math.max(before, Math.abs(track[n]))
      expect(before).toBeLessThan(1e-4)
      // ...and loud within the first millisecond.
      let first = 0
      for (let n = start; n < start + Math.round(0.001 * CLICK_TRACK_RATE); n++) first = Math.max(first, Math.abs(track[n]))
      expect(first).toBeGreaterThan(0.2)
    }
  })

  it('leaves room after the last click for its answer, and never clips', () => {
    expect(track.length / CLICK_TRACK_RATE).toBeCloseTo(clickTrackSeconds(), 3)
    expect(clickTrackSeconds()).toBeGreaterThan(clickTimes()[CLICK_COUNT - 1] + MATCH_AFTER + 0.2)
    let peak = 0
    for (const v of track) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(0.7)
    expect(peak).toBeGreaterThan(0.3)
  })
})
