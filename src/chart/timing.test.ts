import { describe, expect, it } from 'vitest'
import { TickTimeMap, beatsFromBars, constantBeatGrid, findBeatIndex } from './timing'

describe('TickTimeMap', () => {
  it('converts ticks to seconds at a constant tempo', () => {
    const map = new TickTimeMap(120, [], 960)
    expect(map.toSeconds(0)).toBe(0)
    expect(map.toSeconds(960)).toBeCloseTo(0.5)
    expect(map.toSeconds(960 * 4)).toBeCloseTo(2)
  })

  it('handles tempo changes mid-song', () => {
    const map = new TickTimeMap(120, [{ tick: 960 * 4, bpm: 60 }], 960)
    expect(map.toSeconds(960 * 4)).toBeCloseTo(2)
    expect(map.toSeconds(960 * 5)).toBeCloseTo(3)
    expect(map.bpmAt(960 * 4)).toBe(60)
    expect(map.bpmAt(100)).toBe(120)
  })

  it('lets a tick-0 change override the initial tempo', () => {
    const map = new TickTimeMap(120, [{ tick: 0, bpm: 240 }], 960)
    expect(map.toSeconds(960)).toBeCloseTo(0.25)
  })
})

describe('beatsFromBars', () => {
  it('creates numerator beats per bar with correct downbeats', () => {
    const map = new TickTimeMap(120, [], 960)
    const beats = beatsFromBars(
      [
        { startTick: 0, endTick: 3840, numerator: 4, denominator: 4 },
        { startTick: 3840, endTick: 3840 + 2880, numerator: 3, denominator: 4 },
      ],
      map,
    )
    expect(beats.length).toBe(7)
    expect(beats[0]).toEqual({ time: 0, bar: 0, beatInBar: 0, isDownbeat: true })
    expect(beats[4].isDownbeat).toBe(true)
    expect(beats[4].time).toBeCloseTo(2)
    expect(beats[6].time).toBeCloseTo(3)
  })
})

describe('constantBeatGrid / findBeatIndex', () => {
  it('anchors the grid on the given downbeat and fills back to zero', () => {
    const beats = constantBeatGrid(120, 1.25, 4, 4)
    const downbeats = beats.filter((b) => b.isDownbeat).map((b) => b.time)
    expect(downbeats.some((t) => Math.abs(t - 1.25) < 1e-9)).toBe(true)
    expect(beats[0].time).toBeCloseTo(0.25)
    expect(findBeatIndex(beats, 0.3)).toBe(0)
    expect(findBeatIndex(beats, 0.1)).toBe(-1)
    expect(beats[findBeatIndex(beats, 1.3)].time).toBeCloseTo(1.25)
  })
})
