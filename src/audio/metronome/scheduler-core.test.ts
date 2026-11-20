import { describe, expect, it } from 'vitest'
import { scheduleWindow, skipMissed, tapTempo, type MetronomeSettings } from './scheduler-core'

describe('scheduleWindow', () => {
  const settings: MetronomeSettings = { bpm: 120, beatsPerBar: 4, subdivision: 2, accentFirst: true }

  it('schedules every click strictly before the horizon and advances the state', () => {
    const { events, state } = scheduleWindow({ nextTime: 0, beat: 0, sub: 0 }, settings, 1.0)
    // 120 bpm with eighth subdivisions → a click every 0.25 s: 0, .25, .5, .75
    expect(events.map((e) => e.time)).toEqual([0, 0.25, 0.5, 0.75])
    expect(events.map((e) => e.accent)).toEqual(['high', 'low', 'mid', 'low'])
    expect(state).toEqual({ nextTime: 1.0, beat: 2, sub: 0 })
  })

  it('wraps beats at the bar boundary', () => {
    let state = { nextTime: 0, beat: 0, sub: 0 }
    const all: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = scheduleWindow(state, { ...settings, subdivision: 1 }, (i + 1) * 1.0)
      all.push(...r.events.map((e) => e.beat))
      state = r.state
    }
    expect(all).toEqual([0, 1, 2, 3, 0, 1, 2, 3])
  })

  it('emits nothing when the horizon has not been reached', () => {
    const { events, state } = scheduleWindow({ nextTime: 5, beat: 1, sub: 0 }, settings, 4.9)
    expect(events).toEqual([])
    expect(state).toEqual({ nextTime: 5, beat: 1, sub: 0 })
  })
})

describe('skipMissed', () => {
  const settings = { bpm: 120, beatsPerBar: 4, subdivision: 2, accentFirst: true }

  it('leaves the state alone while the next click is still ahead, or only just due', () => {
    const state = { nextTime: 10, beat: 1, sub: 1 }
    expect(skipMissed(state, settings, 9.9)).toEqual(state)
    expect(skipMissed(state, settings, 10.01)).toEqual(state)
  })

  it('after a stall drops the clicks that are already past and keeps the bar position', () => {
    // Eighth notes at 120 bpm are 0.25 s apart. The timer stalled for 3 s.
    const state = { nextTime: 10, beat: 0, sub: 0 }
    const next = skipMissed(state, settings, 13.1)
    expect(next.nextTime).toBeCloseTo(13.25, 9)
    // 13 clicks were skipped: 13 eighths after beat 0 is beat 2, second half (6 full beats and one eighth).
    expect(next.beat).toBe(2)
    expect(next.sub).toBe(1)
    const { events } = scheduleWindow(next, settings, 13.1 + 0.12)
    expect(events.length).toBeLessThanOrEqual(1)
  })
})

describe('tapTempo', () => {
  it('averages recent tap intervals', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120)
    expect(tapTempo([0, 600, 1200])).toBe(100)
  })
  it('ignores stale taps separated by a long pause', () => {
    expect(tapTempo([0, 500, 10000, 10500, 11000])).toBe(120)
  })
  it('returns null without enough taps', () => {
    expect(tapTempo([1000])).toBeNull()
  })
})
