/**
 * The scoring pipeline end to end, on real guitar audio: a virtual player performs the charts a
 * learner meets on the recorded guitar, and the result goes through the same framing, analysis and
 * tracker as the microphone does in the app. If playing what is written does not score, or not
 * playing does, this fails.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { SampleBank } from '../../audio/instrument/bank'
import { loadRealBank } from '../../audio/instrument/realBank.testutil'
import { renderStrings } from '../../audio/synth'
import { constantBeatGrid } from '../../chart/timing'
import type { Chart, ChartNote } from '../../chart/types'
import { atSpeed, clickTrack, delayed, everyOtherGroup, lessonCases, mix, perform, phoneMic, skillCases, transposed, type SimCase } from './simCases.testutil'
import { simulateRun, type SimulationResult } from './simulate'

let bank: SampleBank
beforeAll(async () => {
  bank = await loadRealBank()
})

const hits = (r: SimulationResult) => r.summary.perfects + r.summary.goods
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]

describe('a learner who plays what is written', () => {
  const cases = lessonCases()

  it('covers the whole First steps course', () => {
    expect(cases.filter((c) => c.kind === 'lesson-drill').length).toBeGreaterThanOrEqual(8)
    expect(cases.filter((c) => c.kind === 'lesson-song').length).toBeGreaterThanOrEqual(9)
  })

  it.each(cases.map((c) => [c.name, c] as const))('%s: every note counts, on time', (_name, c) => {
    const r = simulateRun(c.notes, c.chart.beats, perform(c, bank, 44100), { sampleRate: 44100 })
    expect(hits(r), `${r.summary.misses} missed`).toBe(r.summary.total)
    expect(r.summary.perfects).toBeGreaterThanOrEqual(Math.ceil(0.85 * r.summary.total))
    expect(Math.abs(median(r.deltasMs))).toBeLessThan(15)
    expect(r.result.coverage).toBe(1)
  })

  // Every drill and every third song: the heavier scenario.
  const noisy = cases.filter((c, i) => c.kind === 'lesson-drill' || i % 3 === 0)
  it.each(noisy.map((c) => [c.name, c] as const))('%s: also through a phone microphone in a living room, at 48 kHz, with the click track playing', (_name, c) => {
    const mic = phoneMic(mix(perform(c, bank, 48000), clickTrack(c, 48000), 0.5), 48000)
    const r = simulateRun(c.notes, c.chart.beats, mic, { sampleRate: 48000 })
    expect(hits(r) / r.summary.total).toBeGreaterThanOrEqual(0.9)
  })

  // Each skill's first exercise, at the tempo a learner starts it at.
  const seen = new Set<string>()
  const skills = skillCases().filter((c) => {
    const skill = c.name.split(' ')[1]
    if (seen.has(skill)) return false
    seen.add(skill)
    return true
  })
  it.each(skills.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = simulateRun(c.notes, c.chart.beats, perform(c, bank, 44100), { sampleRate: 44100 })
    expect(hits(r) / r.summary.total, `${hits(r)} of ${r.summary.total}`).toBeGreaterThanOrEqual(0.95)
  })
})

describe('what must not score', () => {
  const cases = lessonCases()
  const drills = cases.filter((c) => c.kind === 'lesson-drill')
  const sample = cases.filter((_, i) => i % 4 === 0)

  it.each(drills.map((c) => [c.name, c] as const))('%s: silence and the click track alone score nothing', (_name, c) => {
    const click = clickTrack(c, 44100)
    const silent = simulateRun(c.notes, c.chart.beats, new Float32Array(click.length), { sampleRate: 44100 })
    expect(hits(silent)).toBe(0)
    expect(silent.result.coverage).toBe(0)
    // The click track loud, as from a phone speaker right next to its microphone.
    expect(hits(simulateRun(c.notes, c.chart.beats, click.map((v) => Math.max(-1, Math.min(1, v * 2.5))), { sampleRate: 44100 }))).toBe(0)
  })

  it.each(sample.map((c) => [c.name, c] as const))('%s: notes that are not played are not hit by the ones still ringing', (_name, c) => {
    const half = everyOtherGroup(c.notes)
    const mic = mix(perform(c, bank, 44100, half.played), clickTrack(c, 44100), 0.5)
    const r = simulateRun(c.notes, c.chart.beats, mic, { sampleRate: 44100 })
    let played = 0
    let unplayed = 0
    half.order.forEach((id, i) => {
      if (r.statuses[i] !== 'hit') return
      if (half.playedIds.has(id)) played++
      else unplayed++
    })
    expect(unplayed).toBe(0)
    expect(played).toBeGreaterThanOrEqual(Math.floor(0.9 * half.playedIds.size))
  })

  it.each(sample.map((c) => [c.name, c] as const))('%s: the wrong fret does not count', (_name, c) => {
    for (const semitones of [1, -1]) {
      const r = simulateRun(c.notes, c.chart.beats, perform(c, bank, 44100, transposed(c.notes, semitones)), { sampleRate: 44100 })
      expect(hits(r) / r.summary.total, `${semitones} semitones: ${hits(r)} of ${r.summary.total}`).toBeLessThanOrEqual(0.15)
    }
  })
})

describe('timing', () => {
  const drill = () => lessonCases().find((c) => c.kind === 'lesson-drill' && /firstFrets/.test(c.name)) as SimCase

  it('reads late and early playing for what it is', () => {
    const c = drill()
    const mic = perform(c, bank, 44100)
    const late = simulateRun(c.notes, c.chart.beats, delayed(mic, 0.07, 44100), { sampleRate: 44100 })
    expect(hits(late)).toBe(late.summary.total)
    expect(late.result.timingMedianMs).toBeGreaterThan(55)
    expect(late.result.timingMedianMs).toBeLessThan(85)
    expect(late.summary.goods).toBeGreaterThan(late.summary.perfects)
    const early = simulateRun(c.notes, c.chart.beats, delayed(mic, -0.06, 44100), { sampleRate: 44100 })
    expect(early.result.timingMedianMs).toBeLessThan(-45)
    const tooLate = simulateRun(c.notes, c.chart.beats, delayed(mic, 0.3, 44100), { sampleRate: 44100 })
    expect(hits(tooLate) / tooLate.summary.total).toBeLessThan(0.2)
  })

  it('the latency setting takes the device delay out, at any playback speed', () => {
    const c = drill()
    const delayedMic = delayed(perform(c, bank, 44100), 0.09, 44100)
    const r = simulateRun(c.notes, c.chart.beats, delayedMic, { sampleRate: 44100, latencySec: 0.09 })
    expect(hits(r)).toBe(r.summary.total)
    expect(Math.abs(r.result.timingMedianMs ?? 99)).toBeLessThan(15)
    const slow = atSpeed(c, 0.75)
    const slowMic = delayed(perform({ ...c, chart: slow.chart, notes: slow.notes }, bank, 44100), 0.09, 44100)
    const s = simulateRun(c.notes, c.chart.beats, slowMic, { sampleRate: 44100, speed: 0.75, latencySec: 0.09 })
    expect(hits(s)).toBe(s.summary.total)
    expect(Math.abs(s.result.timingMedianMs ?? 99)).toBeLessThan(15)
  })
})

describe('chords on the recorded guitar', () => {
  const SHAPES: Record<string, number[]> = {
    E: [40, 47, 52, 56, 59, 64],
    Em: [40, 47, 52, 55, 59, 64],
    A: [45, 52, 57, 61, 64],
    Am: [45, 52, 57, 60, 64],
    D: [50, 57, 62, 66],
    Dm: [50, 57, 62, 65],
    G: [43, 47, 50, 55, 59, 67],
    C: [48, 52, 55, 60, 64],
  }
  const TUNING = [40, 45, 50, 55, 59, 64]
  /** A chart that strums `names` in turn, two beats each at 60 bpm, each string ringing into the next chord. */
  function progression(names: string[]): Chart {
    const notes: ChartNote[] = []
    names.forEach((name, i) => {
      const midis = SHAPES[name]
      midis.forEach((midi, k) => {
        const string = 6 - midis.length + k
        notes.push({ id: notes.length, time: 1 + i * 2, duration: 1.9, midi, string, fret: midi - TUNING[string], velocity: 0.8, chordId: i })
      })
    })
    const duration = 2 + names.length * 2
    return { version: 1, title: 'chords', artist: '', source: 'demo', tuning: TUNING, capo: 0, duration, notes, beats: constantBeatGrid(60, 0, duration, 4), tempos: [{ time: 0, bpm: 60 }], timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] }
  }
  const play = (expected: string[], played: string[], mutate: (notes: ChartNote[]) => ChartNote[] = (n) => n) => {
    const want = progression(expected)
    const mic = renderStrings({ ...want, notes: mutate(progression(played).notes) }, { bank, sampleRate: 44100 })
    return simulateRun(want.notes, want.beats, mic, { sampleRate: 44100 })
  }

  it('hears every open chord of the course, through the changes', () => {
    const names = ['Em', 'Am', 'D', 'G', 'C', 'E', 'A', 'Dm', 'Em']
    const r = play(names, names)
    expect(r.statuses).toEqual(names.map(() => 'hit'))
    expect(Math.abs(median(r.deltasMs))).toBeLessThan(20)
  })

  it('tells major from minor', () => {
    for (const [want, played] of [['Em', 'E'], ['E', 'Em'], ['Am', 'A'], ['A', 'Am'], ['Dm', 'D'], ['D', 'Dm']]) {
      expect(play([want], [played]).statuses, `${played} played for ${want}`).toEqual(['miss'])
    }
  })

  it('does not take one chord for another', () => {
    for (const [want, played] of [['Em', 'Am'], ['Am', 'Em'], ['D', 'G'], ['G', 'D'], ['G', 'C'], ['C', 'G'], ['C', 'Am'], ['Am', 'C'], ['G', 'Em'], ['Em', 'G'], ['A', 'D']]) {
      expect(play([want], [played]).statuses, `${played} played for ${want}`).toEqual(['miss'])
    }
  })

  it('forgives one muted string, as a beginner often has', () => {
    for (const name of ['Em', 'G', 'C', 'Am']) {
      const top = Math.max(...SHAPES[name])
      expect(play([name], [name], (notes) => notes.filter((n) => n.midi !== top)).statuses, `${name} without its top string`).toEqual(['hit'])
    }
  })

  it('forgives one extra open string caught by the strum', () => {
    const extra: Record<string, number> = { D: 45, A: 40, C: 40, Am: 40 }
    for (const [name, midi] of Object.entries(extra)) {
      const r = play([name], [name], (notes) => [{ ...notes[0], id: 99, midi, string: midi === 40 ? 0 : 1, fret: 0 }, ...notes])
      expect(r.statuses, `${name} with an open ${midi === 40 ? 'low E' : 'A'} string`).toEqual(['hit'])
    }
  })

  it('does not count a chord that was strummed once and left ringing', () => {
    const r = play(['Em', 'Em', 'Em'], ['Em'])
    expect(r.statuses).toEqual(['hit', 'miss', 'miss'])
  })
})
