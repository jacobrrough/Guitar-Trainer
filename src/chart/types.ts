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
  /**
   * Sung charts: the syllable on this note. A trailing hyphen means the word goes on with the next note,
   * '' that the syllable before is still being held.
   */
  lyric?: string
}

/**
 * A note the app sounds itself on a sung chart: the starting note, or the guide's turn in a call and
 * response. Cues play on the scored track, and the tracker gives no credit while one sounds (or it
 * would score the speaker).
 */
export interface VoiceCue {
  /** Seconds, like `ChartNote.time`. */
  time: number
  duration: number
  midi: number
  lyric?: string
}

/** How strictly a sung run is judged. */
export interface VoiceJudge {
  /** Cents either side of the note that still count as in tune, in any octave. */
  band: 80 | 65 | 50 | 35
  /** Share of a note's judged length that has to be in tune for the note to count. */
  minShare: 0.5 | 0.6
  /** Long notes have to be held to their end to be perfect. */
  sustain?: boolean
  /** A hit is perfect when its median error is within this many cents; absent = max(25, 0.6 x band). */
  perfectCents?: number
}

/** What makes a chart a sung one. Its presence is how every screen knows: there is no separate flag to forget. */
export interface VoiceChart {
  judge: VoiceJudge
  cues: VoiceCue[]
  /** Inclusive MIDI bounds that every note and cue of the chart lies within; the pitch lanes and the detector are set from them. */
  low: number
  high: number
  /** MIDI number of the home note of the key; the notes are numbered (1, 2, 3 …) from it. */
  tonic: number
  /** Semitones the piece was moved from where it is written (home note on MIDI 60). */
  shift: number
  /** Start time in seconds of the first sung note of each line, in order; a breath mark is drawn before each. */
  lineStarts: number[]
  /** Echo exercises: the notes to sing stay hidden until each has been judged. */
  hideAnswers?: boolean
  /** Slides: a glide is drawn from note to note. Only the notes themselves are scored. */
  glide?: boolean
  /** Index of the one line this arrangement holds ("Practise one line"); such a run is practice, not a song result. */
  onlyLine?: number
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
  /**
   * The song is strummed with chord shapes its player has been taught: every difficulty level keeps
   * the whole shape and only thins out the strums. (Without it the easy levels cut a chord down to
   * its lowest notes, which is right for an unknown tab and wrong for "Em Groove" after the Em lesson.)
   */
  wholeChords?: boolean
  /** Set on a chart that is sung. The player then listens for a voice and draws pitch lanes; absent = guitar. */
  voice?: VoiceChart
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
