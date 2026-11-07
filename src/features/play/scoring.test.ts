import { describe, expect, it } from 'vitest'
import type { ChartNote } from '../../chart/types'
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
