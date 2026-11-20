import { describe, expect, it } from 'vitest'
import { PlaybackClock } from './PlaybackClock'

/** A media element whose clock is a function of wall time (ms), as a browser's is. */
function rig(clockAt: (wallMs: number) => number, rate = 1) {
  let wall = 0
  const el = {
    paused: false,
    ended: false,
    playbackRate: rate,
    get currentTime() {
      return clockAt(wall)
    },
  }
  const clock = new PlaybackClock(el as unknown as HTMLMediaElement, () => wall)
  return {
    el,
    clock,
    /** Reads the clock every `stepMs` up to `untilMs` and returns [wall, clock time] pairs. */
    run(untilMs: number, stepMs = 8) {
      const out: [number, number][] = []
      for (; wall <= untilMs; wall += stepMs) out.push([wall, clock.time])
      return out
    },
  }
}

describe('PlaybackClock', () => {
  it('follows a steady element clock', () => {
    const r = rig((w) => w / 1000)
    for (const [w, t] of r.run(2000)) expect(Math.abs(t - w / 1000)).toBeLessThan(0.002)
  })

  it('smooths an element whose clock only updates a few times a second', () => {
    // currentTime moves in 250 ms steps; the song really runs in between.
    const r = rig((w) => Math.floor(w / 250) * 0.25)
    const reads = r.run(3000).filter(([w]) => w > 600)
    for (let i = 1; i < reads.length; i++) expect(reads[i][1]).toBeGreaterThanOrEqual(reads[i - 1][1])
    for (const [w, t] of reads) expect(Math.abs(t - w / 1000)).toBeLessThan(0.03)
  })

  it('does not keep the error of the first moments of playback: it settles on the element’s clock', () => {
    // As measured in Chromium: for the first 100 ms the element's clock runs ahead of where it settles (here by 30 ms, fading out).
    const r = rig((w) => w / 1000 + 0.03 * Math.max(0, 1 - w / 100))
    const reads = r.run(3000)
    for (const [w, t] of reads.filter(([w]) => w > 600)) expect(Math.abs(t - w / 1000), `at ${w} ms`).toBeLessThan(0.005)
  })

  it('never runs backwards while it settles, except for a real jump of the element', () => {
    const r = rig((w) => w / 1000 + 0.03 * Math.max(0, 1 - w / 100))
    const reads = r.run(1500, 3)
    for (let i = 1; i < reads.length; i++) expect(reads[i][1]).toBeGreaterThanOrEqual(reads[i - 1][1])
    // A seek back by two seconds is followed at once.
    const s = rig((w) => (w < 1000 ? 5 + w / 1000 : 3 + w / 1000))
    const after = s.run(1200).filter(([w]) => w >= 1000)
    expect(after[0][1]).toBeLessThan(4.1)
  })

  it('follows the playback rate', () => {
    const r = rig((w) => (w / 1000) * 0.75, 0.75)
    for (const [w, t] of r.run(2000)) expect(Math.abs(t - (w / 1000) * 0.75)).toBeLessThan(0.002)
  })

  it('reports the element’s own time while paused', () => {
    const r = rig(() => 12.5)
    r.el.paused = true
    expect(r.clock.time).toBe(12.5)
  })
})
