import { describe, expect, it } from 'vitest'
import type { ChartNote } from '../../chart/types'
import { constantBeatGrid } from '../../chart/timing'
import { ScoreTracker, pitchMatches } from './scoring'

function note(id: number, time: number, midi: number, chordId = id): ChartNote {
  return { id, time, duration: 0.25, midi, string: 0, fret: 0, velocity: 1, chordId }
}

describe('pitchMatches', () => {
  it('accepts pitches within tolerance and octave errors only when allowed', () => {
    expect(pitchMatches(64.3, 64, 0.6, false)).toBe(true)
    expect(pitchMatches(65, 64, 0.6, false)).toBe(false)
    expect(pitchMatches(76.2, 64, 0.6, false)).toBe(false)
    expect(pitchMatches(76.2, 64, 0.6, true)).toBe(true)
    expect(pitchMatches(52, 64, 0.6, true)).toBe(true)
  })
})

describe('ScoreTracker', () => {
  const notes = [note(0, 1.0, 40), note(1, 1.5, 43), note(2, 2.0, 45), note(3, 2.5, 45)]

  it('judges a well-timed correct pitch as perfect and a late one as good', () => {
    const t = new ScoreTracker(notes)
    expect(t.onPitch(40.1, 1.02, true)?.judgement).toBe('perfect')
    expect(t.onPitch(43, 1.58, true)?.judgement).toBe('good')
    const s = t.summary()
    expect(s.perfects).toBe(1)
    expect(s.goods).toBe(1)
    expect(s.score).toBe(150)
    expect(s.streak).toBe(2)
  })

  it('ignores wrong pitches and pitches outside the window', () => {
    const t = new ScoreTracker(notes)
    expect(t.onPitch(41, 1.0, true)).toBeNull()
    expect(t.onPitch(40, 0.5, true)).toBeNull()
    expect(t.onPitch(40, 1.3, true)).toBeNull()
  })

  it('marks notes as missed once their window closes and resets the streak', () => {
    const t = new ScoreTracker(notes)
    t.onPitch(40, 1.0, true)
    expect(t.advance(1.2)).toHaveLength(0)
    const missed = t.advance(1.8)
    expect(missed.map((g) => g.group.notes[0].id)).toEqual([1])
    expect(t.summary().misses).toBe(1)
    expect(t.summary().streak).toBe(0)
    expect(t.stateOfNote(1)?.status).toBe('miss')
    expect(t.stateOfNote(0)?.status).toBe('hit')
  })

  it('requires a new attack for a repeated pitch shortly after a hit', () => {
    const t = new ScoreTracker(notes)
    expect(t.onPitch(45, 2.0, true)).not.toBeNull()
    // Sustained ringing of the same note must not clear the repeated note at 2.5
    expect(t.onPitch(45, 2.5, false)).toBeNull()
    expect(t.onPitch(45, 2.5, true)).not.toBeNull()
  })

  it('accepts any chord tone, including octave errors on chords by default', () => {
    const chord = [note(0, 1, 40, 0), note(1, 1, 47, 0), note(2, 1, 52, 0)]
    const t = new ScoreTracker(chord)
    expect(t.onPitch(59, 1.0, true)).not.toBeNull() // B3 for B2
    expect(t.summary().total).toBe(1)
  })

  it('scales the timing windows with playback speed', () => {
    // At half speed the late window shrinks from 170 ms to 85 ms of song time
    const slow = new ScoreTracker(notes)
    slow.setSpeed(0.5)
    expect(slow.onPitch(40, 1.1, true)).toBeNull()
    // …and the perfect window from 45 ms to 22.5 ms
    const slow2 = new ScoreTracker(notes)
    slow2.setSpeed(0.5)
    expect(slow2.onPitch(40, 1.03, true)?.judgement).toBe('good')
    expect(new ScoreTracker(notes).onPitch(40, 1.03, true)?.judgement).toBe('perfect')
    expect(new ScoreTracker(notes).onPitch(40, 1.1, true)?.judgement).toBe('good')
  })

  it('arms again after silence so a re-picked note counts', () => {
    const t = new ScoreTracker(notes)
    expect(t.onPitch(45, 2.0, true)).not.toBeNull()
    t.release()
    expect(t.onPitch(45, 2.5, false)).not.toBeNull()
  })

  it('seek skips earlier notes without counting them', () => {
    const t = new ScoreTracker(notes)
    t.seek(2.0)
    expect(t.summary().total).toBe(2)
    expect(t.stateOfNote(0)?.status).toBe('skipped')
  })
})

describe('ScoreTracker statistics', () => {
  // 10 notes, 0.5 s apart, hit with known deltas (ms): median 10, stdev computed by hand below
  const deltasMs = [-20, -10, 0, 5, 10, 10, 15, 20, 30, 40]
  const tenNotes = deltasMs.map((_, i) => note(i, 1 + i * 0.5, 40))

  function hitAll(t: ScoreTracker, count: number) {
    for (let i = 0; i < count; i++) t.onPitch(40, 1 + i * 0.5 + deltasMs[i] / 1000, true)
  }

  it('returns null timing stats under 8 hits', () => {
    const t = new ScoreTracker(tenNotes)
    hitAll(t, 7)
    expect(t.hitDeltas()).toHaveLength(7)
    expect(t.timingStats()).toEqual({ medianMs: null, stdevMs: null })
  })

  it('computes median and population stdev of hit deltas', () => {
    const t = new ScoreTracker(tenNotes)
    hitAll(t, 10)
    const { medianMs, stdevMs } = t.timingStats()
    // sorted: median = (10 + 10) / 2 = 10; deviations: -30 -20 -10 -5 0 0 5 10 20 30 -> squares sum 2850 -> /10 = 285
    expect(medianMs).toBeCloseTo(10, 6)
    expect(stdevMs).toBeCloseTo(Math.sqrt(285), 6)
    expect(t.hitDeltas()[0]).toBeCloseTo(-0.02, 9)
  })

  it('computes per-bar accuracy and weak bars on a beat grid', () => {
    // 120 bpm 4/4: bars are 2 s long
    const beats = constantBeatGrid(120, 0, 6)
    const ns = [note(0, 0.0, 40), note(1, 1.0, 40), note(2, 2.0, 40), note(3, 3.0, 40)]
    const t = new ScoreTracker(ns, { beats })
    expect(t.perBarAccuracy()).toEqual([-1, -1])
    t.onPitch(40, 0.0, true)
    t.onPitch(40, 1.0, true)
    t.onPitch(40, 2.0, true)
    t.advance(4)
    expect(t.perBarAccuracy()).toEqual([1, 0.5])
    expect(t.weakBars(0.7)).toEqual([1])
    expect(t.weakBars()).toEqual([1])
    const r = t.toAttemptResult({ playedTempo: 120, targetTempo: 120, speed: 1, durationSec: 4 })
    expect(r.perBar).toEqual([1, 0.5])
  })

  it('has no perBar and empty per-bar accuracy without beats', () => {
    const t = new ScoreTracker(tenNotes)
    expect(t.perBarAccuracy()).toEqual([])
    expect(t.toAttemptResult({ playedTempo: 1, targetTempo: 1, speed: 1, durationSec: 1 }).perBar).toBeUndefined()
  })

  it('measures detection coverage only inside expected note windows', () => {
    const t = new ScoreTracker([note(0, 1.0, 40), note(1, 3.0, 40)])
    expect(t.coverage()).toBe(1)
    t.observe(0.2, true) // far from any note
    expect(t.coverage()).toBe(1)
    t.observe(0.9, false) // inside early window (0.13)
    t.observe(1.0, true)
    t.observe(1.1, true)
    t.observe(1.2, false) // 0.25 s duration but late window 0.17 -> note end 1.25
    t.observe(2.0, false) // between notes
    expect(t.coverage()).toBeCloseTo(0.5, 9)
    t.observe(3.0, true)
    t.observe(3.05, true)
    expect(t.coverage()).toBeCloseTo(4 / 6, 9)
    t.reset()
    expect(t.coverage()).toBe(1)
  })

  it('does not count frames of skipped groups after seek', () => {
    const t = new ScoreTracker([note(0, 1.0, 40), note(1, 3.0, 40)])
    t.seek(2.5)
    t.observe(1.0, false)
    expect(t.coverage()).toBe(1)
    t.observe(3.0, true)
    expect(t.coverage()).toBe(1)
  })

  it('toAttemptResult round-trips the numbers', () => {
    const t = new ScoreTracker(tenNotes)
    hitAll(t, 8)
    t.advance(10)
    t.observe(1.0, true)
    const r = t.toAttemptResult({ playedTempo: 90, targetTempo: 100, speed: 0.9, durationSec: 12 })
    expect(r).toMatchObject({
      perfects: t.perfects,
      goods: t.goods,
      misses: 2,
      total: 10,
      coverage: 1,
      durationSec: 12,
      playedTempo: 90,
      targetTempo: 100,
      speed: 0.9,
    })
    expect(r.perfects + r.goods).toBe(8)
    expect(r.timingMedianMs).not.toBeNull()
    expect(r.perBar).toBeUndefined()
  })
})
