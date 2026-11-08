/**
 * The chart is the app's own, source-independent description of what to play.
 * Guitar Pro, MIDI and audio transcriptions are all converted into this shape.
 * Times are in seconds of the song audio; strings are 0-based, lowest first.
 */

export interface NoteTechniques {
  hammerOn?: boolean
  pullOff?: boolean
  slideIn?: boolean
  slideOut?: boolean
  bend?: boolean
  palmMute?: boolean
  dead?: boolean
  harmonic?: boolean
  letRing?: boolean
  vibrato?: boolean
}

export interface ChartNote {
  /** Stable id within the chart (index in the full chart). */
  id: number
  time: number
  duration: number
  /** Sounding pitch. */
  midi: number
  /** 0 = lowest string. */
  string: number
  /** Fret relative to the capo (0 = open). */
  fret: number
  /** Suggested fretting finger (1 index … 4 little); absent for open strings or when unknown. */
  finger?: 1 | 2 | 3 | 4
  /** 0..1 */
  velocity: number
  /** Notes struck together share a chordId. */
  chordId: number
  chordName?: string
  tech?: NoteTechniques
}

export interface TempoEvent {
  time: number
  bpm: number
}

export interface TimeSignatureEvent {
  time: number
  numerator: number
  denominator: number
}

export interface Beat {
  time: number
  /** 0-based bar index in playback order (repeats expanded). */
  bar: number
  /** 0-based beat within the bar. */
  beatInBar: number
  isDownbeat: boolean
}

export type ChartSource = 'guitarpro' | 'musicxml' | 'midi' | 'transcription' | 'demo' | 'builtin'

export interface Chart {
  version: 1
  title: string
  artist: string
  source: ChartSource
  sourceTrack?: string
  /** Open-string MIDI numbers, lowest first (without capo). */
  tuning: number[]
  capo: number
  /** Length of the chart in seconds. */
  duration: number
  notes: ChartNote[]
  beats: Beat[]
  tempos: TempoEvent[]
  timeSignatures: TimeSignatureEvent[]
}

export function chartBpm(chart: Chart): number {
  return chart.tempos[0]?.bpm ?? 120
}

export function emptyChart(partial: Partial<Chart> = {}): Chart {
  return {
    version: 1,
    title: '',
    artist: '',
    source: 'midi',
    tuning: [40, 45, 50, 55, 59, 64],
    capo: 0,
    duration: 0,
    notes: [],
    beats: [],
    tempos: [],
    timeSignatures: [],
    ...partial,
  }
}
