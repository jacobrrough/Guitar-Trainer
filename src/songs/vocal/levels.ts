/**
 * The six levels of a song to sing, and the form each one gives the tune: where the starting note, the
 * guide's turns and the singer's lines lie, counted in beats. Nothing here is a pitch or a second of
 * sound yet; `arrange.ts` turns a form into a chart.
 *
 * The speed never changes. Slowing a song down makes its phrases outlast the breath, so help is
 * withdrawn and strictness rises instead: first the guide sings every line and the singer answers it,
 * then the tune straight through, then tighter tuning, then long notes held to their end.
 */
import type { VoiceJudge } from '../../chart/types'
import type { VocalSong } from './types'

export interface VoiceLevel {
  /** Short name on the level buttons. */
  name: string
  /** One plain sentence under it. */
  about: string
  /** How many lines the guide sings before the singer answers them; 0 = the tune straight through, starting note only. */
  echo: 0 | 1 | 2
  /** What is written on the notes: "la", or the words of the song. */
  shown: 'la' | 'words'
  judge: VoiceJudge
  /** The guide track sings the singer's own line as well (headphones and "Listen first" only). */
  doubled: boolean
}

/** By index 0 to 5, which is the level a song item stores. */
export const VOICE_LEVELS: readonly VoiceLevel[] = [
  { name: 'Echo each line', about: 'Listen to one line, then sing it back on "la".', echo: 1, shown: 'la', judge: { band: 80, minShare: 0.5 }, doubled: true },
  { name: 'Echo two lines', about: 'Listen to two lines, then sing them back on "la".', echo: 2, shown: 'la', judge: { band: 80, minShare: 0.5 }, doubled: true },
  { name: 'Whole tune', about: 'One note to start you off, then the whole song with its words.', echo: 0, shown: 'words', judge: { band: 65, minShare: 0.5 }, doubled: true },
  { name: 'In tune', about: 'The whole song again, a little closer to each note.', echo: 0, shown: 'words', judge: { band: 50, minShare: 0.5 }, doubled: true },
  { name: 'Hold the long notes', about: 'Stay on each long note right to its end.', echo: 0, shown: 'words', judge: { band: 50, minShare: 0.6, sustain: true }, doubled: false },
  { name: 'Performance', about: 'On your own, close to every note, from start to finish.', echo: 0, shown: 'words', judge: { band: 35, minShare: 0.6, sustain: true }, doubled: false },
]

/**
 * A level as a whole number from 0 to 5. Levels are read back from stored song items and from page
 * addresses: one that is out of range or not a number is the nearest level, never an error in the
 * middle of a page.
 */
export function levelIndex(level: number): number {
  return Number.isFinite(level) ? Math.min(VOICE_LEVELS.length - 1, Math.max(0, Math.round(level))) : 0
}

/** The rest that has to follow every line, in seconds: time for one quick breath. */
export const BREATH_SEC = 0.4
/** Seconds of the chart after its last bar, for the last note to be judged before the sound ends. */
export const TAIL_SEC = 1

/** One sung note of a line. */
export interface LineNote {
  /** Beats from the start of its line. */
  at: number
  /** Beats as written. */
  beats: number
  /** Seconds it is held: its written length, less the breath when it ends a line. */
  seconds: number
  /** Semitones above the home note. */
  offset: number
  /** As written: a trailing hyphen when the word goes on, '' when the syllable before is carried to this note. */
  syllable: string
}

/** One line of a tune: what is sung on one breath, and where it lies in the tune. */
export interface TuneLine {
  index: number
  /** Beats of the tune before the line. */
  start: number
  /** Beats it lasts, a rest written at its end included. */
  beats: number
  /** Beats into its bar at which it starts; 0 = on the bar line. Not every line starts where the tune does. */
  inBar: number
  notes: LineNote[]
}

/**
 * The lines of a tune with the lengths its notes are really sung at. These are the notes every level
 * scores and every call repeats, so they are worked out once, here.
 *
 * A line is placed by the beats before it, never by counting bars: four tunes have a line that starts
 * with a pickup of its own ("its fleece", "when the saints"), and such a line is not a whole number of bars.
 *
 * The last note of a line ends early enough to leave `BREATH_SEC` before the next line. A rest written
 * there counts towards it, so a line that already ends in a rest that long keeps its last note whole;
 * so does the last line, which nothing follows.
 */
export function tuneLines(song: VocalSong): TuneLine[] {
  const beatSec = 60 / song.bpm
  let start = 0
  return song.lines.map((steps, index) => {
    const notes: LineNote[] = []
    let at = 0
    for (const [offset, beats, syllable] of steps) {
      if (offset !== null) notes.push({ at, beats, seconds: beats * beatSec, offset, syllable: syllable ?? '' })
      at += beats
    }
    const last = notes[notes.length - 1]
    if (last && index < song.lines.length - 1) {
      const rest = (at - last.at - last.beats) * beatSec
      // Never to nothing: a note too short to give the whole breath gives what it can and keeps a sliver.
      if (rest < BREATH_SEC) last.seconds = Math.max(Math.min(last.seconds, 0.1), last.seconds - (BREATH_SEC - rest))
    }
    const line: TuneLine = { index, start, beats: at, inBar: mod(start - song.pickupBeats, song.beatsPerBar), notes }
    start += at
    return line
  })
}

const mod = (value: number, by: number): number => ((value % by) + by) % by

/** A line index as stored or typed into an address: the nearest line that exists. */
export function lineIndex(song: VocalSong, line: number): number {
  return Number.isFinite(line) ? Math.min(song.lines.length - 1, Math.max(0, Math.round(line))) : 0
}

/** One turn of a level: the lines sung in one go, and, on an echo level, the guide's call before them. */
export interface Turn {
  lines: TuneLine[]
  /** Beat of the chart on which the guide starts singing these lines; null when the singer is not called. */
  call: number | null
  /** Beat by which the last note of the call has ended: at least one beat before the answer. */
  callEnd: number
  /** Beat of the chart on which the singer's first line starts. */
  answer: number
}

/** A level of a song laid out in beats from the start of the chart. */
export interface LevelForm {
  level: number
  /** Set when the form holds one line only ("Practise one line"). */
  onlyLine?: number
  beatsPerBar: number
  beatSeconds: number
  /** Beats of the bars before the tune. The first line's pickup lies at their end. */
  introBeats: number
  /** Beats the starting note sounds, from beat 0. */
  cueBeats: number
  turns: Turn[]
  /** Whole bars, the bars before the tune included. */
  bars: number
  /** Length of the chart: the bars and `TAIL_SEC`. */
  seconds: number
}

/**
 * Where everything lies at a level, for the whole song or for one line of it.
 *
 * The bars before the tune: the starting note from beat 0 for up to two beats, then at least one silent
 * beat, then the tune, whose pickup (if it has one) is the end of those bars. One bar is enough unless
 * the pickup leaves less than two beats of it free ("Oh when the saints" starts on beat 2): then there
 * are two.
 *
 * On an echo level the guide sings a turn (its call) and the singer answers a whole number of bars
 * later, so the answer sits in the bar exactly as the call did. Nothing the app sounds may end less than
 * a beat before a scored note, because the tracker stops listening around a cue. So where a call runs
 * right up to the bar line its last note gives up one beat (never more, and it keeps at least a beat)
 * and the answer follows at once; a call that ends on a short note is left as it is and the answer
 * waits for the next bar. The next call starts where the answer's line ends: the singer breathes while
 * the guide sings.
 */
export function levelForm(song: VocalSong, level: number, onlyLine?: number): LevelForm {
  const index = levelIndex(level)
  const perBar = song.beatsPerBar
  const beatSeconds = 60 / song.bpm
  const all = tuneLines(song)
  const only = onlyLine === undefined ? undefined : lineIndex(song, onlyLine)
  const lines = only === undefined ? all : [all[only]]
  const echo = VOICE_LEVELS[index].echo
  const groups: TuneLine[][] = []
  if (echo === 0) groups.push(lines)
  else for (let i = 0; i < lines.length; i += echo) groups.push(lines.slice(i, i + echo))

  const pickup = mod(perBar - lines[0].inBar, perBar)
  const introBeats = perBar - pickup >= 2 ? perBar : 2 * perBar
  const cueBeats = Math.min(2, introBeats - pickup - 1)

  const turns: Turn[] = []
  let beat = introBeats - pickup
  for (const group of groups) {
    const length = group.reduce((sum, line) => sum + line.beats, 0)
    if (echo === 0) {
      turns.push({ lines: group, call: null, callEnd: beat, answer: beat })
      beat += length
      continue
    }
    const lastLine = group[group.length - 1]
    const last = lastLine.notes[lastLine.notes.length - 1]
    const lastStart = beat + length - lastLine.beats + last.at
    const sungEnd = lastStart + last.seconds / beatSeconds
    // What the last note of the call can be cut back to: a beat off its written length, a beat of it left.
    const cutEnd = Math.max(lastStart + Math.min(1, last.beats), lastStart + last.beats - 1)
    const earliest = Math.min(sungEnd, cutEnd) + 1
    const barsLater = Math.max(1, Math.ceil((earliest - beat) / perBar - 1e-9))
    const answer = beat + barsLater * perBar
    turns.push({ lines: group, call: beat, callEnd: Math.min(sungEnd, answer - 1), answer })
    beat = answer + length
  }
  const bars = Math.max(1, Math.ceil(beat / perBar - 1e-9))
  return {
    level: index,
    ...(only === undefined ? {} : { onlyLine: only }),
    beatsPerBar: perBar,
    beatSeconds,
    introBeats,
    cueBeats,
    turns,
    bars,
    seconds: bars * perBar * beatSeconds + TAIL_SEC,
  }
}

/**
 * Seconds one pass of each level lasts, by level index, for `SongSummary.levelDurations`: the Coach
 * fits the number of passes of a song block to the level about to be sung, and an echo level lasts
 * about twice as long as the tune.
 */
export function levelDurations(song: VocalSong): number[] {
  return VOICE_LEVELS.map((_, level) => levelForm(song, level).seconds)
}
