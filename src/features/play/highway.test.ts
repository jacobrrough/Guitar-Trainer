import { describe, expect, it } from 'vitest'
import type { ChartNote } from '../../chart/types'
import { isSparse, laneIndex, laneLabel, pillLabel } from './Highway'

const STD = [40, 45, 50, 55, 59, 64]
const note = (time: number, chordId = time): ChartNote =>
  ({ id: time * 100, time, duration: 0.2, string: 0, fret: 0, midi: 40, chordId }) as ChartNote

describe('highway helpers', () => {
  it('maps lanes by handedness', () => {
    expect(laneIndex(0, 6, 'right')).toBe(5)
    expect(laneIndex(5, 6, 'right')).toBe(0)
    expect(laneIndex(0, 6, 'left')).toBe(0)
    expect(laneIndex(5, 6, 'left')).toBe(5)
  })
  it('labels lanes', () => {
    expect(laneLabel(0, STD)).toBe('6 E')
    expect(laneLabel(1, STD)).toBe('5 A')
    expect(laneLabel(5, STD)).toBe('1 E')
  })
  it('labels pills', () => {
    const n = { fret: 3, midi: 43, tech: undefined }
    expect(pillLabel(n, { showNoteNames: false })).toBe('3')
    expect(pillLabel(n, { showNoteNames: true })).toBe('G')
    expect(pillLabel({ ...n, tech: { dead: true } }, { showNoteNames: false })).toBe('X')
  })
  it('detects sparse charts', () => {
    expect(isSparse([note(0), note(0.5), note(1), note(1.5)], 0, 10)).toBe(true)
    expect(isSparse([note(0), note(0.25), note(0.5)], 0, 10)).toBe(false)
    expect(isSparse([note(0, 1), { ...note(0, 1), string: 1 }, note(0.5)], 0, 10)).toBe(true)
  })
})
