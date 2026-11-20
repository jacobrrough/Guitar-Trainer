/**
 * Test helper: the charts a learner actually meets (every lesson drill, every lesson song as the
 * lesson shows it, every skill's first exercise at its start and target tempo) and the ways a
 * performance can reach the microphone. Used by the scoring simulation tests.
 */
import type { SampleBank } from '../../audio/instrument/bank'
import { renderDrums, renderStrings } from '../../audio/synth'
import { generateLevels } from '../../chart/difficulty'
import type { Beat, Chart, ChartNote } from '../../chart/types'
import { COURSE } from '../../lessons/course'
import { lessonDrillExercise, lessonSongNotes } from '../../lessons/material'
import { BUILT_IN_SONGS } from '../../songs'
import { DEFAULT_TUNING } from '../../training/exercises/builder'
import { exerciseParams, generateExercise } from '../../training/exercises/index'
import { SKILLS } from '../../training/skills'

export interface SimCase {
  name: string
  kind: 'lesson-drill' | 'lesson-song' | 'song-full' | 'skill'
  chart: Chart
  /** The notes shown and scored. */
  notes: ChartNote[]
}

/** Every lesson's practice round and song, built by the same functions as the lesson screens (src/lessons/material.ts). */
export function lessonCases(): SimCase[] {
  const cases: SimCase[] = []
  for (const lesson of COURSE) {
    if (lesson.drill) {
      const ex = lessonDrillExercise(lesson, DEFAULT_TUNING)
      cases.push({ name: `lesson ${lesson.number} drill ${lesson.drill.generatorId}@${lesson.drill.tempo}`, kind: 'lesson-drill', chart: ex.chart, notes: ex.chart.notes })
    }
    if (lesson.play) {
      const song = BUILT_IN_SONGS.find((s) => s.id === lesson.play!.songId)!
      const shown = lessonSongNotes(lesson.play, song.chart)
      cases.push({ name: `lesson ${lesson.number} song ${song.id} ${lesson.play.view}`, kind: 'lesson-song', chart: song.chart, notes: shown.notes })
    }
  }
  return cases
}

export function fullSongCases(): SimCase[] {
  return BUILT_IN_SONGS.map((song) => {
    const levels = generateLevels(song.chart)
    return { name: `song ${song.id} full`, kind: 'song-full' as const, chart: song.chart, notes: levels[levels.length - 1].notes }
  })
}

export function skillCases(): SimCase[] {
  const cases: SimCase[] = []
  const seen = new Set<string>()
  for (const skill of SKILLS) {
    const gid = skill.generators[0]
    for (const tempo of [skill.startTempo, skill.targetTempo]) {
      const key = `${gid}@${tempo}|${JSON.stringify(exerciseParams(skill, gid, tempo))}`
      if (seen.has(key)) continue
      seen.add(key)
      const ex = generateExercise(skill, gid, exerciseParams(skill, gid, tempo), DEFAULT_TUNING)
      if (ex.interaction === 'ear') continue
      cases.push({ name: `skill ${skill.id} ${gid}@${tempo}`, kind: 'skill', chart: ex.chart, notes: ex.chart.notes })
    }
  }
  return cases
}

/** The case's notes played exactly as written on the recorded guitar. */
export function perform(c: SimCase, bank: SampleBank, sampleRate: number, notes: ChartNote[] = c.notes): Float32Array {
  return renderStrings({ ...c.chart, notes }, { bank, sampleRate })
}

export function clickTrack(c: SimCase, sampleRate: number): Float32Array {
  return renderDrums(c.chart, { sampleRate })
}

export function mix(a: Float32Array, b: Float32Array, gainB = 1): Float32Array {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] + gainB * (b[i] ?? 0)
  return out
}

export function delayed(x: Float32Array, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(x.length)
  const n = Math.round(seconds * sampleRate)
  if (n >= 0) out.set(x.subarray(0, x.length - n), n)
  else out.set(x.subarray(-n), 0)
  return out
}

/**
 * A phone's built-in microphone on a table in a living room: little below 150 Hz (second-order
 * high-pass), half the level, and steady room noise at about -50 dBFS.
 */
export function phoneMic(x: Float32Array, sampleRate: number): Float32Array {
  const w0 = (2 * Math.PI * 150) / sampleRate
  const alpha = Math.sin(w0) / (2 * 0.707)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = (1 + cos) / 2 / a0
  const b1 = -(1 + cos) / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const out = new Float32Array(x.length)
  let z1 = 0
  let z2 = 0
  let seed = 12345
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const y = b0 * v + z1
    z1 = b1 * v - a1 * y + z2
    z2 = b0 * v - a2 * y
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    out[i] = 0.5 * y + (seed / 4294967296 - 0.5) * 0.011
  }
  return out
}

export function transposed(notes: ChartNote[], semitones: number): ChartNote[] {
  return notes.map((n) => ({ ...n, midi: n.midi + semitones }))
}

/** The same chart played `speed` times as fast in real time (what the player hears at a speed other than 1). */
export function atSpeed(c: SimCase, speed: number): { chart: Chart; notes: ChartNote[] } {
  const t = (n: ChartNote): ChartNote => ({ ...n, time: n.time / speed, duration: n.duration / speed })
  const beats: Beat[] = c.chart.beats.map((b) => ({ ...b, time: b.time / speed }))
  return { chart: { ...c.chart, beats, duration: c.chart.duration / speed, notes: c.chart.notes.map(t) }, notes: c.notes.map(t) }
}

/** Every other group of the case's notes: the rest is left unplayed. */
export function everyOtherGroup(notes: ChartNote[]): { played: ChartNote[]; playedIds: Set<number>; order: number[] } {
  const order = [...new Set([...notes].sort((a, b) => a.time - b.time || a.chordId - b.chordId).map((n) => n.chordId))]
  const playedIds = new Set(order.filter((_, i) => i % 2 === 0))
  return { played: notes.filter((n) => playedIds.has(n.chordId)), playedIds, order }
}
