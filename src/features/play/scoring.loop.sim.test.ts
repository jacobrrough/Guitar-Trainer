/**
 * Section loops on the recorded guitar: a few bars of a bundled song played round and round, the way
 * the player loops them. Every pass has to score in full, including the first note after each wrap
 * (judged against what was ringing before it) and the last note before it.
 */
import { describe, expect, it } from 'vitest'
import { loadRealBank } from '../../audio/instrument/realBank.testutil'
import { constantBeatGrid } from '../../chart/timing'
import type { Chart, ChartNote } from '../../chart/types'
import { barStartTime } from './sectionLoop'
import { delayed, fullSongCases, lessonCases, perform, type SimCase } from './simCases.testutil'
import { simulateRun } from './simulate'

const SR = 44100

/** The loop's notes played `passes` times, sample 0 at the loop's start; every pass after the first begins `stall` seconds later than back to back. */
function loopPerformance(c: SimCase, from: number, to: number, passes: number, stall = 0): { notes: ChartNote[]; inLoop: number } {
  const inLoop = c.notes.filter((n) => n.time >= from - 1e-6 && n.time < to - 1e-6)
  const notes: ChartNote[] = []
  for (let p = 0; p < passes; p++) for (const n of inLoop) notes.push({ ...n, id: notes.length, chordId: n.chordId === undefined ? undefined : n.chordId + p * 100000, time: n.time - from + p * (to - from + stall) })
  return { notes, inLoop: new Set(inLoop.map((n) => n.chordId ?? `n${n.id}`)).size }
}

/** Three bars of eighth notes at 120 bpm on the top three strings: every bar ends with a note an eighth before the bar line. */
function eighthsCase(): SimCase {
  const frets: [string: number, fret: number][] = [[3, 0], [3, 2], [4, 0], [4, 1], [4, 3], [4, 1], [4, 0], [3, 2]]
  const tuning = [40, 45, 50, 55, 59, 64]
  const notes: ChartNote[] = []
  for (let i = 0; i < 24; i++) {
    const [string, fret] = frets[i % 8]
    notes.push({ id: i, time: i * 0.25, duration: 0.25, midi: tuning[string] + fret, string, fret, velocity: 0.8, chordId: i })
  }
  const chart: Chart = { version: 1, title: 'eighths', artist: '', source: 'builtin', tuning, capo: 0, duration: 7, notes, beats: constantBeatGrid(120, 0, 7), tempos: [{ time: 0, bpm: 120 }], timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] }
  return { name: 'eighths at 120', kind: 'skill', chart, notes }
}

describe('section loops on the recorded guitar', () => {
  const picks = [
    { name: 'song ode-to-joy full', bars: [2, 4] as const },
    { name: 'song em-am-groove full', bars: [0, 2] as const },
    { name: 'lesson 3 drill', bars: [1, 3] as const },
  ]
  for (const pick of picks) {
    it(`${pick.name}, bars ${pick.bars[0] + 1} to ${pick.bars[1]}: three passes all score`, async () => {
      const bank = await loadRealBank()
      const c = [...fullSongCases(), ...lessonCases()].find((x) => x.name.startsWith(pick.name))!
      const from = barStartTime(c.chart, pick.bars[0]) ?? 0
      const to = barStartTime(c.chart, pick.bars[1]) ?? c.chart.duration
      const passes = 3
      const { notes, inLoop } = loopPerformance(c, from, to, passes)
      expect(inLoop).toBeGreaterThan(1)
      const mic = perform({ ...c, chart: { ...c.chart, duration: passes * (to - from) + 1 } }, bank, SR, notes)
      const r = simulateRun(c.notes, c.chart.beats, mic, { sampleRate: SR, loop: { from, to, passes } })
      expect(r.summary.total).toBe(inLoop * passes)
      expect(r.summary.misses, `${r.summary.perfects + r.summary.goods} of ${r.summary.total} hit`).toBe(0)
      for (const d of r.deltasMs) expect(Math.abs(d)).toBeLessThan(40)
    }, 60_000)
  }

  // Bluetooth headphones: the sound reaches the tracker a quarter of a second late or more, so the last
  // notes of a pass are heard after the wrap, and the song's sound takes a moment to start again there.
  // The last note of this loop sits an eighth before its end, so its stroke always arrives after the wrap.
  const slow = [
    { latency: 0.25, stall: 0.06 },
    { latency: 0.28, stall: 0.08 },
    { latency: 0.33, stall: 0.14 },
    { latency: 0.35, stall: 0 },
  ]
  for (const { latency, stall } of slow) {
    it(`a ${latency * 1000} ms sound delay and ${stall * 1000} ms to start again after the wrap: the last notes of a pass are still on time`, async () => {
      const bank = await loadRealBank()
      const c = eighthsCase()
      const from = 2
      const to = 4
      const passes = 3
      const { notes, inLoop } = loopPerformance(c, from, to, passes, stall)
      const last = Math.max(...c.notes.filter((n) => n.time < to - 1e-6).map((n) => n.time))
      expect(to - last).toBeCloseTo(0.25)
      const mic = delayed(perform({ ...c, chart: { ...c.chart, duration: passes * (to - from + stall) + 1.5 } }, bank, SR, notes), latency, SR)
      const r = simulateRun(c.notes, c.chart.beats, mic, { sampleRate: SR, latencySec: latency, loop: { from, to, passes, wrapStall: stall } })
      expect(r.summary.total).toBe(inLoop * passes)
      // The run ends with the last pass: its very last notes may still be on their way.
      expect(r.summary.misses, `${r.summary.perfects + r.summary.goods} of ${r.summary.total} hit`).toBeLessThanOrEqual(1)
      for (const d of r.deltasMs) expect(Math.abs(d), r.deltasMs.map((x) => x.toFixed(0)).join(' ')).toBeLessThan(40)
    }, 60_000)
  }
})
