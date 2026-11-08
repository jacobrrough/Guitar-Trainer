import type { Chart } from '../../chart/types'
import { CHORD_SHAPES } from '../../music/chords'
import { ChartBuilder, DEFAULT_TUNING } from '../../training/exercises/builder'
import type { BuiltInSong } from '../index'

/** One melody step: [string, fret, lengthInBeats]; a string of -1 is a rest. */
export type MelodyStep = [string: number, fret: number, beats: number]

export const rest = (beats: number): MelodyStep => [-1, 0, beats]

/** Finger for a first-position fret (fret 5 is reached with the little finger). */
export function fingerFor(fret: number): 1 | 2 | 3 | 4 | undefined {
  if (fret >= 1 && fret <= 4) return fret as 1 | 2 | 3 | 4
  if (fret === 5) return 4
  return undefined
}

export interface MelodySpec {
  title: string
  artist: string
  bpm: number
  bars: number
  beatsPerBar?: number
  steps: MelodyStep[]
}

export function melodyChart(spec: MelodySpec): Chart {
  const b = new ChartBuilder({ bpm: spec.bpm, beatsPerBar: spec.beatsPerBar ?? 4, tuning: DEFAULT_TUNING, title: spec.title })
  let beat = 0
  for (const [string, fret, len] of spec.steps) {
    if (string >= 0) b.note(beat, len, string, fret, { finger: fingerFor(fret), velocity: beat % b.beatsPerBar === 0 ? 0.9 : 0.78 })
    beat += len
  }
  return { ...b.build(spec.bars), artist: spec.artist, source: 'builtin' }
}

export interface StrumSpec {
  title: string
  artist: string
  bpm: number
  beatsPerBar?: number
  /** Chord name for each bar. */
  bars: string[]
  /** Bars (from 0) before this index strum on beats 1 and 3 only; later bars strum every beat. */
  everyBeatFromBar?: number
}

export function strumChart(spec: StrumSpec): Chart {
  const bpb = spec.beatsPerBar ?? 4
  const b = new ChartBuilder({ bpm: spec.bpm, beatsPerBar: bpb, title: spec.title })
  const from = spec.everyBeatFromBar ?? 0
  spec.bars.forEach((name, bar) => {
    const shape = CHORD_SHAPES[name].shape
    if (bar < from && bpb === 4) {
      b.chord(b.at(bar, 0), 2, shape, name, { velocity: 0.9 })
      b.chord(b.at(bar, 2), 2, shape, name, { velocity: 0.78 })
    } else {
      for (let i = 0; i < bpb; i++) b.chord(b.at(bar, i), 1, shape, name, { velocity: i === 0 ? 0.9 : 0.75 })
    }
  })
  return { ...b.build(spec.bars.length), artist: spec.artist, source: 'builtin' }
}

/** Chord names in order of first appearance. */
export function uniqueChords(bars: string[]): string[] {
  return [...new Set(bars)]
}

type SongMeta = Omit<BuiltInSong, 'chart'>

/** A song whose chart is built on first access and then memoised. */
export function lazySong(meta: SongMeta, build: () => Chart): BuiltInSong {
  let cached: Chart | undefined
  return {
    ...meta,
    get chart(): Chart {
      cached ??= build()
      return cached
    },
  }
}

export function repeat<T>(items: T[], times: number): T[] {
  return Array.from({ length: times }, () => items).flat()
}
