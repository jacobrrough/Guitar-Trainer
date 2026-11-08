import { describe, expect, it } from 'vitest'
import { constantBeatGrid } from '../../chart/timing'
import { barCount, clampRange, loopHint, loopOutcome, nextLoopSpeed, weakestRange } from './sectionLoop'

describe('nextLoopSpeed', () => {
  it('speeds up at and above the target, capped at 100%', () => {
    expect(nextLoopSpeed(0.85, 0.7)).toBe(0.8)
    expect(nextLoopSpeed(1, 0.95)).toBe(1)
    expect(nextLoopSpeed(0.9, 1)).toBe(1)
  })
  it('slows down below the slow-down threshold, floored at 50%', () => {
    expect(nextLoopSpeed(0.69, 0.7)).toBe(0.6)
    expect(nextLoopSpeed(0.1, 0.5)).toBe(0.5)
  })
  it('keeps the speed in between and rounds to one decimal', () => {
    expect(nextLoopSpeed(0.7, 0.7)).toBe(0.7)
    expect(nextLoopSpeed(0.84, 0.8)).toBe(0.8)
    expect(nextLoopSpeed(0.9, 0.7000000001)).toBe(0.8)
    expect(nextLoopSpeed(0.9, 0.6 + 0.1)).toBe(0.8)
  })
})

describe('weakestRange', () => {
  it('returns null when nothing is weak', () => {
    expect(weakestRange([0.9, 0.8, 0.7])).toBeNull()
    expect(weakestRange([])).toBeNull()
  })
  it('picks the worst run', () => {
    expect(weakestRange([0.9, 0.3, 0.65, 0.9, 0.6, 0.9])).toEqual([1, 2])
    expect(weakestRange([0.9, 0.6, 0.9, 0.1, 0.9])).toEqual([3, 3])
  })
  it('limits runs to four bars', () => {
    const r = weakestRange([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.1])
    expect(r).not.toBeNull()
    expect(r![1] - r![0]).toBe(3)
    expect(r).toEqual([3, 6])
  })
  it('ignores bars with no notes', () => {
    expect(weakestRange([-1, -1, 0.9])).toBeNull()
    expect(weakestRange([0.5, -1, 0.5])).toEqual([0, 0])
  })
})

describe('clampRange', () => {
  it('clamps and orders', () => {
    expect(clampRange([2, 5], 8)).toEqual([2, 5])
    expect(clampRange([-3, 20], 8)).toEqual([0, 7])
    expect(clampRange([6, 2], 8)).toEqual([2, 6])
    expect(clampRange([4, 4], 0)).toEqual([0, 0])
  })
})

describe('loopHint', () => {
  it('formats bars 1-based', () => {
    expect(loopHint([4, 7], 2, 0.7)).toBe('Loop bars 5–8 · 2 passes · 70% speed')
    expect(loopHint([0, 0], 1, 1)).toBe('Loop bar 1 · 1 pass · 100% speed')
  })
})

describe('barCount', () => {
  it('counts bars of a constant grid', () => {
    const beats = constantBeatGrid(120, 0, 16)
    expect(barCount({ beats })).toBe(8)
    expect(barCount({ beats: [] })).toBe(1)
  })
})

describe('loopOutcome', () => {
  it('describes auto-step results', () => {
    expect(loopOutcome(0.9, 0.7, true)).toEqual({ message: 'Clean! Speeding up to 80%', nextSpeed: 0.8 })
    expect(loopOutcome(0.5, 0.7, true)).toEqual({ message: 'Slowing down to 60%', nextSpeed: 0.6 })
    expect(loopOutcome(0.75, 0.7, true).message).toBe('Again at 70%')
    expect(loopOutcome(0.9, 1, true).message).toBe('Section mastered. Try the whole song.')
    expect(loopOutcome(0.9, 0.7, false)).toEqual({ message: 'Again at 70%', nextSpeed: 0.7 })
  })
})
