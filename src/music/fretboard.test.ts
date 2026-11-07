import { describe, expect, it } from 'vitest'
import { assignFrets, chordVoicings, positionsFor } from './fretboard'

const STD = [40, 45, 50, 55, 59, 64]

describe('positionsFor', () => {
  it('lists every string that can play the pitch', () => {
    const p = positionsFor(64, STD, 22) // E4
    expect(p).toEqual([
      { string: 1, fret: 19 },
      { string: 2, fret: 14 },
      { string: 3, fret: 9 },
      { string: 4, fret: 5 },
      { string: 5, fret: 0 },
    ])
  })
})

describe('chordVoicings', () => {
  it('finds the open E minor shape among voicings for E2 B2 E3 G3 B3 E4', () => {
    const { voicings } = chordVoicings([40, 47, 52, 55, 59, 64], STD, { maxFret: 22, maxSpan: 4, maxVoicings: 16 })
    const open = voicings.find((v) => v.every((p, i) => p && p.string === i))
    expect(open).toBeDefined()
    expect(open!.map((p) => p!.fret)).toEqual([0, 2, 2, 0, 0, 0])
    expect(voicings[0]!.map((p) => p!.fret)).toEqual([0, 2, 2, 0, 0, 0])
  })

  it('drops the highest pitches when a cluster cannot be voiced', () => {
    const { voicings } = chordVoicings([40, 41, 42, 43, 44, 45, 46], STD, { maxFret: 22, maxSpan: 4, maxVoicings: 8 })
    expect(voicings[0]!.length).toBe(7)
    expect(voicings[0]!.filter((p) => p === null).length).toBeGreaterThan(0)
  })
})

describe('assignFrets', () => {
  it('keeps an ascending C major scale in open position instead of climbing one string', () => {
    const scale = [48, 50, 52, 53, 55, 57, 59, 60]
    const events = scale.map((m, i) => ({ time: i * 0.25, midis: [m] }))
    const result = assignFrets(events, STD)
    const frets = result.map((r) => r[0]!.fret)
    expect(Math.max(...frets)).toBeLessThanOrEqual(5)
    const strings = result.map((r) => r[0]!.string)
    expect(new Set(strings).size).toBeGreaterThan(1)
  })

  it('avoids large jumps between fast consecutive notes', () => {
    const events = [
      { time: 0, midis: [64] }, // E4
      { time: 0.1, midis: [67] }, // G4
      { time: 0.2, midis: [71] }, // B4
      { time: 0.3, midis: [67] },
    ]
    const result = assignFrets(events, STD)
    const positions = result.map((r) => r[0]!)
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1]
      const b = positions[i]
      if (a.fret > 0 && b.fret > 0) expect(Math.abs(a.fret - b.fret)).toBeLessThanOrEqual(5)
    }
  })

  it('returns null for pitches below the lowest string', () => {
    const result = assignFrets([{ time: 0, midis: [30, 52] }], STD)
    expect(result[0][0]).toBeNull()
    expect(result[0][1]).not.toBeNull()
  })
})
