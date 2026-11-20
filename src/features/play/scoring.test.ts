import { describe, expect, it } from 'vitest'
import type { ChartNote } from '../../chart/types'
import { constantBeatGrid } from '../../chart/timing'
import { midiToFreq } from '../../music/pitch'
import { ScoreTracker, hasChordGroups, pitchMatches } from './scoring'
import { simulateRun } from './simulate'

const SR = 44100

function note(id: number, time: number, midi: number, chordId = id, extra: Partial<ChartNote> = {}): ChartNote {
  return { id, time, duration: 0.4, midi, string: 0, fret: 0, velocity: 1, chordId, ...extra }
}

interface Pluck {
  time: number
  midi: number
  /** Seconds the note rings (exponential decay). */
  ring?: number
  amp?: number
}

/**
 * A crude plucked string for logic tests: six harmonics that decay, with a few milliseconds of
 * noise at the start for the pick. (The simulation tests use the recorded guitar.)
 */
function synth(plucks: Pluck[], seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR))
  let seed = 7
  for (const p of plucks) {
    const f = midiToFreq(p.midi)
    const start = Math.round(p.time * SR)
    const ring = p.ring ?? 1.2
    const amp = p.amp ?? 0.25
    for (let i = 0; start + i < out.length && i < ring * 4 * SR; i++) {
      const t = i / SR
      let v = 0
      for (let h = 1; h <= 6; h++) v += (Math.sin(2 * Math.PI * f * h * t) / h) * Math.exp((-t * h * 0.8) / ring)
      if (i < 200) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        v += (seed / 4294967296 - 0.5) * 0.4 * Math.exp(-i / 60)
      }
      out[start + i] += amp * v * Math.min(1, i / 40)
    }
  }
  return out
}

const run = (notes: ChartNote[], plucks: Pluck[], seconds: number, options: Partial<Parameters<typeof simulateRun>[3]> = {}) =>
  simulateRun(notes, [], synth(plucks, seconds), { sampleRate: SR, ...options })

describe('pitchMatches', () => {
  it('accepts pitches within tolerance and octave errors only when allowed', () => {
    expect(pitchMatches(64.3, 64, 0.6, false)).toBe(true)
    expect(pitchMatches(65, 64, 0.6, false)).toBe(false)
    expect(pitchMatches(76.2, 64, 0.6, false)).toBe(false)
    expect(pitchMatches(76.2, 64, 0.6, true)).toBe(true)
    expect(pitchMatches(52, 64, 0.6, true)).toBe(true)
  })
})

describe('ScoreTracker on audio', () => {
  const notes = [note(0, 1.0, 45), note(1, 1.5, 48), note(2, 2.0, 52), note(3, 2.5, 52)]
  const exact: Pluck[] = notes.map((n) => ({ time: n.time, midi: n.midi }))

  it('hits every note played on time, as perfect, with timing within a few milliseconds', () => {
    const r = run(notes, exact, 4)
    expect(r.statuses).toEqual(['hit', 'hit', 'hit', 'hit'])
    expect(r.summary.perfects).toBe(4)
    expect(r.summary.score).toBe(400)
    expect(r.summary.maxStreak).toBe(4)
    for (const d of r.deltasMs) expect(Math.abs(d)).toBeLessThan(15)
    expect(r.result.coverage).toBe(1)
  })

  it('times a note from its attack: 80 ms late is good, not perfect, and reads about +80 ms', () => {
    const r = run([notes[0]], [{ time: 1.08, midi: 45 }], 3)
    expect(r.summary.goods).toBe(1)
    expect(r.deltasMs[0]).toBeGreaterThan(65)
    expect(r.deltasMs[0]).toBeLessThan(95)
    const early = run([notes[0]], [{ time: 0.93, midi: 45 }], 3)
    expect(early.summary.goods).toBe(1)
    expect(early.deltasMs[0]).toBeLessThan(-55)
  })

  it('misses notes played outside the window, wrong notes, and silence', () => {
    expect(run([notes[0]], [{ time: 1.3, midi: 45 }], 3).statuses).toEqual(['miss'])
    expect(run([notes[0]], [{ time: 0.7, midi: 45 }], 3).statuses).toEqual(['miss'])
    for (const wrong of [44, 46, 47, 50]) expect(run([notes[0]], [{ time: 1.0, midi: wrong }], 3).statuses, `midi ${wrong}`).toEqual(['miss'])
    const silent = run(notes, [], 4)
    expect(silent.summary.misses).toBe(4)
    expect(silent.result.coverage).toBe(0)
  })

  it('rejects the same note an octave up or down unless octave tolerance covers single notes', () => {
    expect(run([note(0, 1, 52)], [{ time: 1, midi: 64 }], 3).statuses).toEqual(['miss'])
    expect(run([note(0, 1, 52)], [{ time: 1, midi: 40 }], 3).statuses).toEqual(['miss'])
    expect(run([note(0, 1, 52)], [{ time: 1, midi: 64 }], 3, { octaveTolerance: 'all' }).statuses).toEqual(['hit'])
    expect(run([note(0, 1, 52)], [{ time: 1, midi: 40 }], 3, { octaveTolerance: 'all' }).statuses).toEqual(['hit'])
  })

  it('does not let a note that is still ringing satisfy the same note again', () => {
    const r = run(notes, [{ time: 2.0, midi: 52, ring: 3 }], 4)
    expect(r.statuses).toEqual(['miss', 'miss', 'hit', 'miss'])
    const replayed = run(notes, [{ time: 2.0, midi: 52, ring: 3 }, { time: 2.5, midi: 52, ring: 3 }], 4)
    expect(replayed.statuses.slice(2)).toEqual(['hit', 'hit'])
  })

  it('hears a note while other strings ring', () => {
    const ringing = [note(0, 1, 40), note(1, 1.6, 45), note(2, 2.2, 50), note(3, 2.8, 55)]
    const r = run(ringing, ringing.map((n) => ({ time: n.time, midi: n.midi, ring: 4 })), 4.5)
    expect(r.statuses).toEqual(['hit', 'hit', 'hit', 'hit'])
  })

  it('one stroke scores one note, even when two of the same pitch are close together', () => {
    const close = [note(0, 1.0, 50), note(1, 1.12, 50)]
    const r = run(close, [{ time: 1.05, midi: 50 }], 3)
    expect(r.summary.perfects + r.summary.goods).toBe(1)
  })

  it('scores a chord from its struck notes and rejects a different chord', () => {
    const em = [40, 47, 52, 55, 59, 64]
    const chord = em.map((m, i) => note(i, 1, m, 0))
    const strum = (midis: number[], at: number): Pluck[] => midis.map((m, i) => ({ time: at + i * 0.012, midi: m, amp: 0.12 }))
    expect(hasChordGroups(chord)).toBe(true)
    const good = run(chord, strum(em, 1), 3)
    expect(good.statuses).toEqual(['hit'])
    expect(Math.abs(good.deltasMs[0])).toBeLessThan(30)
    expect(run(chord, strum([45, 52, 57, 60, 64], 1), 3).statuses).toEqual(['miss'])
    // E major instead of E minor: the third is wrong.
    expect(run(chord, strum([40, 47, 52, 56, 59, 64], 1), 3).statuses).toEqual(['miss'])
    // A beginner who misses the top string still gets the chord.
    expect(run(chord, strum(em.slice(0, 5), 1), 3).statuses).toEqual(['hit'])
  })

  it('judges bends against the bent pitch with a tighter tolerance', () => {
    const bend = [note(0, 1, 66, 0, { tech: { bend: true } })]
    expect(run(bend, [{ time: 1, midi: 66 }], 3).statuses).toEqual(['hit'])
    expect(run(bend, [{ time: 1, midi: 65.6 }], 3).statuses).toEqual(['miss'])
    expect(run([note(0, 1, 66)], [{ time: 1, midi: 65.7 }], 3).statuses).toEqual(['hit'])
  })

  it('scales timing with playback speed and the latency setting', () => {
    // At 75 % speed the chart's second 1.0 is heard at 1.333 s; the microphone path adds 60 ms.
    const slow = simulateRun([notes[0]], [], synth([{ time: 1 / 0.75 + 0.06, midi: 45 }], 4), { sampleRate: SR, speed: 0.75, latencySec: 0.06 })
    expect(slow.statuses).toEqual(['hit'])
    expect(Math.abs(slow.deltasMs[0])).toBeLessThan(15)
  })

  it('hears the first note of the song, even when the clock steps back as playback really starts', () => {
    const first = [note(0, 0, 45), note(1, 0.6, 48), note(2, 1.2, 52)]
    const plucks: Pluck[] = first.map((n) => ({ time: n.time, midi: n.midi }))
    // The count-in predicted the start 40 ms too early: every frame before the song is stamped 40 ms ahead.
    const r = run(first, plucks, 2.5, { startJitter: 0.04 })
    expect(r.statuses).toEqual(['hit', 'hit', 'hit'])
    for (const d of r.deltasMs) expect(Math.abs(d)).toBeLessThan(15)
  })

  it('a first note played on the count-in’s beat is on time, however late the song’s audio really started', () => {
    const first = [note(0, 0, 45), note(1, 0.6, 48), note(2, 1.2, 52)]
    // The audio started later than the count-in said it would. The player trusted the count-in for the
    // first note and the audible song from then on. (At 50 ms the note is confirmed after the clock has
    // stepped back; at 150 ms before.)
    const lead = 0.3
    for (const late of [0.05, 0.15]) {
      const plucks: Pluck[] = [
        { time: lead - late, midi: 45 },
        { time: lead + 0.6, midi: 48 },
        { time: lead + 1.2, midi: 52 },
      ]
      const r = run(first, plucks, lead + 2.5, { micLead: lead, startJitter: late })
      expect(r.statuses, `${late * 1000} ms`).toEqual(['hit', 'hit', 'hit'])
      for (const d of r.deltasMs) expect(Math.abs(d), `${late * 1000} ms`).toBeLessThan(20)
    }
  })

  it('scores every note of every pass of a section loop, including the first after a wrap and the last before it', () => {
    // A two-second loop: the first note on the wrap itself, the last an eighth before it.
    const bar = [note(0, 4.0, 45), note(1, 4.5, 48), note(2, 5.0, 52), note(3, 5.75, 50)]
    const all = [note(10, 1.0, 40), ...bar, note(11, 7.0, 43)]
    const plucks: Pluck[] = []
    for (let pass = 0; pass < 3; pass++) for (const n of bar) plucks.push({ time: pass * 2 + (n.time - 4), midi: n.midi, ring: 0.5 })
    const r = run(all, plucks, 6.2, { loop: { from: 4, to: 6, passes: 3 } })
    expect(r.summary.total).toBe(12)
    expect(r.summary.perfects + r.summary.goods).toBe(12)
    expect(r.summary.misses).toBe(0)
    for (const d of r.deltasMs) expect(Math.abs(d)).toBeLessThan(20)
  })

  it('with a long sound delay (Bluetooth), the last note before a loop wrap still counts', () => {
    // 400 ms from stroke to app. The last note sits a sixteenth before the wrap: its sound arrives well into the next pass.
    const delay = 0.4
    const bar = [note(0, 4.0, 45), note(1, 5.0, 50), note(2, 5.875, 52)]
    const plucks: Pluck[] = []
    for (let pass = 0; pass < 3; pass++) for (const n of bar) plucks.push({ time: delay + pass * 2 + (n.time - 4), midi: n.midi, ring: 0.4 })
    const r = run(bar, plucks, 6.9, { loop: { from: 4, to: 6, passes: 3 }, latencySec: delay })
    expect(r.summary.total).toBe(9)
    // The last two strokes of the last pass arrive after this simulation has ended (the player waits for them); every other one must count.
    expect(r.summary.perfects + r.summary.goods).toBeGreaterThanOrEqual(7)
    for (const d of r.deltasMs) expect(Math.abs(d)).toBeLessThan(25)
  })

  it('a loop pass that is not played is missed, and one stroke before the wrap does not score the note after it', () => {
    const bar = [note(0, 4.0, 45), note(1, 5.9, 45)]
    // Pass 1 played in full; in pass 2 only the last note; pass 3 not at all.
    const plucks: Pluck[] = [
      { time: 0, midi: 45, ring: 0.5 },
      { time: 1.9, midi: 45, ring: 0.5 },
      { time: 3.9, midi: 45, ring: 0.5 },
    ]
    const r = run(bar, plucks, 6.2, { loop: { from: 4, to: 6, passes: 3 } })
    expect(r.summary.total).toBe(6)
    expect(r.summary.perfects + r.summary.goods).toBe(3)
    expect(r.summary.misses).toBe(3)
  })

  it('works at 48 kHz', () => {
    const out = new Float32Array(Math.round(4 * 48000))
    const src = synth(exact, 4)
    for (let i = 0; i < out.length; i++) out[i] = src[Math.min(src.length - 1, Math.round((i * SR) / 48000))]
    const r = simulateRun(notes, [], out, { sampleRate: 48000 })
    expect(r.summary.perfects + r.summary.goods).toBe(4)
  })
})

describe('ScoreTracker bookkeeping', () => {
  const notes = [note(0, 1.0, 45), note(1, 1.5, 48), note(2, 2.0, 52), note(3, 2.5, 52)]

  it('marks notes missed once their window and the confirmation time have passed', () => {
    const t = new ScoreTracker(notes)
    // A note stays open for its late window (170 ms) plus the time a late stroke needs to be confirmed (250 ms).
    expect(t.advance(1.4)).toHaveLength(0)
    const missed = t.advance(2.0)
    expect(missed.map((g) => g.group.notes[0].id)).toEqual([0, 1])
    expect(t.summary().misses).toBe(2)
    expect(t.stateOfNote(0)?.status).toBe('miss')
    expect(t.stateOfNote(2)?.status).toBe('pending')
    expect(t.finished).toBe(false)
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.finished).toBe(true)
  })

  it('scales the timing windows with playback speed', () => {
    const t = new ScoreTracker(notes)
    expect(t.window.late).toBeCloseTo(0.17)
    t.setSpeed(0.5)
    expect(t.window.late).toBeCloseTo(0.085)
    expect(t.window.perfect).toBeCloseTo(0.0225)
  })

  it('seek skips earlier notes without counting them', () => {
    const t = new ScoreTracker(notes)
    t.seek(1.9)
    t.advance(Number.POSITIVE_INFINITY)
    const s = t.summary()
    expect(s.total).toBe(2)
    expect(s.misses).toBe(2)
    expect(t.stateOfNote(0)?.status).toBe('skipped')
  })

  it('a section loop scores only its own notes and adds up its passes', () => {
    const t = new ScoreTracker(notes)
    t.seek(1.4)
    t.setRange(1.4, 2.2)
    expect(t.summary().total).toBe(2)
    t.nextPass()
    t.nextPass()
    const s = t.summary()
    expect(s.misses).toBe(4)
    expect(s.total).toBe(6)
    t.advance(Number.POSITIVE_INFINITY)
    expect(t.summary().misses).toBe(6)
    expect(t.stateOfNote(3)?.status).toBe('skipped')
    expect(t.toAttemptResult({ playedTempo: 60, targetTempo: 60, speed: 1, durationSec: 3 }).total).toBe(6)
  })

  it('an unscored run counts nothing', () => {
    const t = new ScoreTracker(notes)
    t.markUnscored()
    t.advance(Number.POSITIVE_INFINITY)
    const s = t.summary()
    expect(s.total).toBe(0)
    expect(s.misses).toBe(0)
    expect(t.toAttemptResult({ playedTempo: 60, targetTempo: 60, speed: 1, durationSec: 3 }).total).toBe(0)
  })

  it('reset clears everything', () => {
    const t = new ScoreTracker(notes)
    t.seek(2.4)
    t.advance(Number.POSITIVE_INFINITY)
    t.reset()
    expect(t.summary()).toMatchObject({ total: 4, misses: 0, judged: 0, score: 0 })
  })
})

describe('ScoreTracker statistics', () => {
  it('returns null timing stats under 8 hits and the median and spread above', () => {
    const many = Array.from({ length: 10 }, (_, i) => note(i, 1 + i * 0.5, 45 + (i % 3) * 2))
    const few = run(many.slice(0, 4), many.slice(0, 4).map((n) => ({ time: n.time, midi: n.midi })), 4)
    expect(few.result.timingMedianMs).toBeNull()
    const late = run(many, many.map((n) => ({ time: n.time + 0.05, midi: n.midi })), 7)
    expect(late.summary.perfects + late.summary.goods).toBe(10)
    expect(late.result.timingMedianMs).toBeGreaterThan(35)
    expect(late.result.timingMedianMs).toBeLessThan(65)
    expect(late.result.timingStdevMs).toBeLessThan(15)
  })

  it('computes per-bar accuracy and weak bars on a beat grid', () => {
    const beats = constantBeatGrid(120, 0, 6, 4)
    const notes = Array.from({ length: 8 }, (_, i) => note(i, 0.5 + i * 0.5, 45 + (i % 2) * 5))
    // Bar 0 holds notes at 0.5..1.5, bar 1 at 2.0..3.5, bar 2 at 4.0: play only bar 1.
    const mic = synth(notes.filter((n) => n.time >= 2 && n.time < 4).map((n) => ({ time: n.time, midi: n.midi })), 6)
    const t = new ScoreTracker(notes, { beats })
    const r = simulateRun(notes, beats, mic, { sampleRate: SR })
    expect(r.result.perBar).toEqual([0, 1, 0])
    expect(t.perBarAccuracy()).toEqual([-1, -1, -1])
    expect(simulateRun(notes, [], mic, { sampleRate: SR }).result.perBar).toBeUndefined()
  })

  it('reports whether the microphone heard anything during the notes', () => {
    const notes = [note(0, 1, 45), note(1, 2, 45), note(2, 3, 45), note(3, 4, 45)]
    // Wrong notes are still sound: coverage stays high while accuracy is zero.
    const wrong = run(notes, notes.map((n) => ({ time: n.time, midi: 50 })), 6)
    expect(wrong.summary.misses).toBe(4)
    expect(wrong.result.coverage).toBe(1)
    const half = run(notes, [{ time: 1, midi: 45, ring: 0.08 }, { time: 2, midi: 45, ring: 0.08 }], 6)
    expect(half.result.coverage).toBe(0.5)
  })

  it('reports polyphonic verification in the attempt result', () => {
    const t = new ScoreTracker([note(0, 1, 45)])
    expect(t.toAttemptResult({ playedTempo: 90, targetTempo: 100, speed: 0.9, durationSec: 12 })).toMatchObject({ playedTempo: 90, targetTempo: 100, speed: 0.9, durationSec: 12, chordScoring: 'chroma' })
  })
})

describe('per-bar results on a beat grid', () => {
  it('files a note written a hair before its bar line under that bar', () => {
    // Bars of 2 s; the note for bar 2 is written a fraction of a microsecond early, as adding up beat lengths can do.
    const beats = constantBeatGrid(120, 0, 8, 4)
    const tracker = new ScoreTracker([note(0, 0, 45), note(1, 2 - 2e-7, 45), note(2, 4, 45)], { beats })
    tracker.advance(100)
    expect(tracker.perBarAccuracy()).toEqual([0, 0, 0])
  })
})
