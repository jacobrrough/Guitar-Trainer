/**
 * Assembles exercise charts in beats instead of seconds so generators stay
 * tempo-independent. All generators should build charts through this class so
 * ids, chord grouping, beat grids and durations are consistent.
 */
import { constantBeatGrid } from '../../chart/timing'
import type { Chart, ChartNote, NoteTechniques } from '../../chart/types'
import type { Shape } from '../../music/chords'
import type { NoteValue } from '../types'

export const DEFAULT_TUNING = [40, 45, 50, 55, 59, 64]

/** Length of one note value in beats (quarter = 1). */
export const NOTE_VALUE_BEATS: Record<NoteValue, number> = { quarter: 1, eighth: 0.5, triplet: 1 / 3, sixteenth: 0.25 }

export interface BuilderOptions {
  bpm: number
  beatsPerBar?: number
  tuning?: number[]
  title?: string
  capo?: number
  /** Seconds of silence after the last bar. */
  tail?: number
}

export interface NoteOptions {
  velocity?: number
  tech?: NoteTechniques
  chordName?: string
}

export class ChartBuilder {
  readonly bpm: number
  readonly beatsPerBar: number
  readonly tuning: number[]
  private readonly title: string
  private readonly capo: number
  private readonly tail: number
  private readonly notes: ChartNote[] = []
  private chordCounter = 0
  private maxBeat = 0

  constructor(options: BuilderOptions) {
    this.bpm = options.bpm
    this.beatsPerBar = options.beatsPerBar ?? 4
    this.tuning = options.tuning ?? DEFAULT_TUNING
    this.title = options.title ?? 'Exercise'
    this.capo = options.capo ?? 0
    this.tail = options.tail ?? 1
  }

  get beatSeconds(): number {
    return 60 / this.bpm
  }

  /** Beat index (from 0) of bar `bar` (from 0), beat `beat` (from 0). */
  at(bar: number, beat = 0): number {
    return bar * this.beatsPerBar + beat
  }

  /** Adds a single note starting at absolute `beat`, lasting `lengthBeats`. */
  note(beat: number, lengthBeats: number, string: number, fret: number, options: NoteOptions = {}): this {
    const chordId = this.chordCounter++
    this.push(beat, lengthBeats, string, fret, chordId, options)
    return this
  }

  /** Adds all strings of a shape struck together at `beat`. */
  chord(beat: number, lengthBeats: number, shape: Shape, name?: string, options: NoteOptions = {}): this {
    const chordId = this.chordCounter++
    for (const [string, fret] of shape) this.push(beat, lengthBeats, string, fret, chordId, { ...options, chordName: name ?? options.chordName })
    return this
  }

  private push(beat: number, lengthBeats: number, string: number, fret: number, chordId: number, options: NoteOptions): void {
    if (string < 0 || string >= this.tuning.length) throw new Error(`String ${string} out of range`)
    if (fret < 0 || fret > 24) throw new Error(`Fret ${fret} out of range`)
    const time = beat * this.beatSeconds
    const duration = Math.max(0.05, lengthBeats * this.beatSeconds * 0.95)
    this.notes.push({
      id: 0,
      time,
      duration,
      midi: this.tuning[string] + fret + this.capo,
      string,
      fret,
      velocity: options.velocity ?? 0.8,
      chordId,
      chordName: options.chordName,
      tech: options.tech,
    })
    this.maxBeat = Math.max(this.maxBeat, beat + lengthBeats)
  }

  /** Number of whole bars needed to contain every note added so far. */
  get barsUsed(): number {
    return Math.ceil(this.maxBeat / this.beatsPerBar - 1e-9)
  }

  /** Builds the chart; `bars` defaults to the bars used (minimum 1). */
  build(bars?: number): Chart {
    const totalBars = Math.max(1, bars ?? this.barsUsed)
    const duration = totalBars * this.beatsPerBar * this.beatSeconds + this.tail
    const notes = [...this.notes].sort((a, b) => a.time - b.time || a.string - b.string).map((n, i) => ({ ...n, id: i }))
    return {
      version: 1,
      title: this.title,
      artist: 'Guitar Trainer',
      source: 'demo',
      tuning: this.tuning,
      capo: this.capo,
      duration,
      notes,
      beats: constantBeatGrid(this.bpm, 0, duration, this.beatsPerBar),
      tempos: [{ time: 0, bpm: this.bpm }],
      timeSignatures: [{ time: 0, numerator: this.beatsPerBar, denominator: 4 }],
    }
  }
}

/** Stable short hash for exercise ids. */
export function hashParams(value: unknown): string {
  const s = JSON.stringify(value, Object.keys(value as object).sort())
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}
