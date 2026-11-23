/**
 * Turns a song to sing into charts: the notes to sing in one key at one level, and the chords to strum
 * under them. A song is stored once, as semitones from a home note on middle C; nothing is rendered or
 * kept per key, so a singer whose range changes gets every song in the new key the next time it opens.
 *
 * The tunes are frozen data. Everything here builds new objects and never writes to a song.
 */
import { constantBeatGrid } from '../../chart/timing'
import type { Chart, ChartNote, VoiceCue } from '../../chart/types'
import { CHORD_SHAPES, type Shape } from '../../music/chords'
import { chooseKey, keyFamily, spanOfSteps, WRITTEN_HOME, type RangeEdges, type ShapeFamily, type TuneSpan } from '../../music/keys'
import { levelForm, VOICE_LEVELS, type LevelForm, type LineNote } from './levels'
import type { Degree, VocalSong } from './types'

/** Standard guitar tuning, lowest string first. A sung chart carries it so code written for guitar charts can read it. */
const TUNING = [40, 45, 50, 55, 59, 64]

/** What is written on a note while the singer is not yet asked for the words. */
const LA = 'la'

export interface ArrangeOptions {
  /** Semitones the song is moved from where it is written (home note on middle C); see `songKey`. */
  shift: number
  /** Level index 0 to 5 (`VOICE_LEVELS`). */
  level: number
  /** Only this line (index from 0), with its own starting note, and its call on the echo levels. */
  onlyLine?: number
}

/** The lowest and highest note of a song as written, and where its notes lie on average. */
export function songSpan(song: VocalSong): TuneSpan {
  return spanOfSteps(song.lines.flat())
}

/**
 * The key of a song for a singer: how far to move it, and whether it fits the range at all. `nudge` is
 * the singer's own "Lower" or "Higher" for this song. A song that does not fit must not be sung: it is
 * listed under "Comes later". Before any range is known the song stays where it is written.
 */
export function songKey(song: VocalSong, range?: RangeEdges, nudge = 0): { shift: number; fits: boolean } {
  if (!range) return { shift: 0, fits: true }
  return chooseKey(songSpan(song), range, nudge)
}

/**
 * A shift as a whole number of semitones. Keys are read back from stored profiles: one that is not a
 * number is the written key. (The `+ 0` turns a -0 into a plain 0, which is what a cache key prints.)
 */
export const wholeShift = (shift: number): number => (Number.isFinite(shift) ? Math.round(shift) + 0 : 0)

/** What the lanes write on a note: the syllable, or "la" on the echo levels. A carried syllable ('') stays carried either way. */
const shownAs = (note: LineNote, shown: 'la' | 'words'): string => (shown === 'words' || note.syllable === '' ? note.syllable : LA)

/** A chart on the song's grid: a click on every beat from 0, bar 0 being the first bar before the tune. */
function chartOn(song: VocalSong, form: LevelForm, rest: Pick<Chart, 'notes' | 'capo' | 'voice'>): Chart {
  return {
    version: 1,
    title: song.title,
    artist: song.credit,
    source: 'builtin',
    tuning: [...TUNING],
    duration: form.seconds,
    beats: constantBeatGrid(song.bpm, 0, form.seconds, form.beatsPerBar),
    tempos: [{ time: 0, bpm: song.bpm }],
    timeSignatures: [{ time: 0, numerator: form.beatsPerBar, denominator: 4 }],
    ...rest,
  }
}

/**
 * The song as a chart to sing at one level, in one key.
 *
 * Every level scores the same notes with the same lengths; a level only decides where they lie, what
 * the guide sings before them and how strictly they are judged (`chart.voice.judge`). A note is its
 * pitch and nothing else: string 0, fret 0 and a chord id of its own keep guitar-typed code valid.
 *
 * `chart.voice.cues` is everything the app sounds on the scored track: the starting note, and on the
 * echo levels the guide's calls. A cue never sounds over a scored note and ends at least a beat before
 * the next one (the tracker gives no credit around a cue, or the speaker would score itself).
 *
 * `chart.voice.low` and `.high` are the song's own lowest and highest note in this key, also when only
 * one line is arranged, so the lanes keep their scale between a line and the whole song.
 */
export function arrange(song: VocalSong, options: ArrangeOptions): Chart {
  const form = levelForm(song, options.level, options.onlyLine)
  const shift = wholeShift(options.shift)
  const level = VOICE_LEVELS[form.level]
  const beatSec = form.beatSeconds
  const midiOf = (note: LineNote) => WRITTEN_HOME + note.offset + shift

  const notes: ChartNote[] = []
  const cues: VoiceCue[] = []
  const lineStarts: number[] = []
  const first = form.turns[0].lines[0].notes[0]
  cues.push({ time: 0, duration: form.cueBeats * beatSec, midi: midiOf(first), lyric: shownAs(first, level.shown) })

  for (const turn of form.turns) {
    let lineBeat = 0
    turn.lines.forEach((line, l) => {
      line.notes.forEach((note, n) => {
        const lyric = shownAs(note, level.shown)
        if (turn.call !== null) {
          const time = (turn.call + lineBeat + note.at) * beatSec
          // The very last note of a call may have given up a beat so the answer can follow at once.
          const lastOfCall = l === turn.lines.length - 1 && n === line.notes.length - 1
          cues.push({ time, duration: lastOfCall ? turn.callEnd * beatSec - time : note.seconds, midi: midiOf(note), lyric })
        }
        const time = (turn.answer + lineBeat + note.at) * beatSec
        if (n === 0) lineStarts.push(time)
        notes.push({ id: notes.length, time, duration: note.seconds, midi: midiOf(note), string: 0, fret: 0, velocity: 0.8, chordId: notes.length, lyric })
      })
      lineBeat += line.beats
    })
  }

  const span = songSpan(song)
  return chartOn(song, form, {
    capo: 0,
    notes,
    voice: {
      judge: { ...level.judge },
      cues,
      low: span.low + shift,
      high: span.high + shift,
      tonic: WRITTEN_HOME + shift,
      shift,
      lineStarts,
      ...(form.onlyLine === undefined ? {} : { onlyLine: form.onlyLine }),
    },
  })
}

/** Barre shapes the accompaniment needs and the chord table of the lessons does not hold. */
const B_MAJOR: Shape = [[1, 2], [2, 4], [3, 4], [4, 4], [5, 2]]
const C_SHARP_MINOR: Shape = [[1, 4], [2, 6], [3, 6], [4, 5], [5, 4]]
const F_SHARP_MINOR: Shape = [[0, 2], [1, 4], [2, 4], [3, 2], [4, 2], [5, 2]]

const shapeOf = (name: string): Shape => CHORD_SHAPES[name].shape

/**
 * The chord of each degree in the five keys that are strummed with open shapes. Every other key is one
 * of these with a capo on fret 1 or 2 (`keyFamily`), so the chords sound alike in all twelve.
 */
const FAMILY_CHORDS: Record<ShapeFamily, Record<Degree, { name: string; shape: Shape }>> = {
  C: { I: { name: 'C', shape: shapeOf('C') }, IV: { name: 'F', shape: shapeOf('F') }, V: { name: 'G', shape: shapeOf('G') }, V7: { name: 'G7', shape: shapeOf('G7') }, vi: { name: 'Am', shape: shapeOf('Am') }, ii: { name: 'Dm', shape: shapeOf('Dm') } },
  D: { I: { name: 'D', shape: shapeOf('D') }, IV: { name: 'G', shape: shapeOf('G') }, V: { name: 'A', shape: shapeOf('A') }, V7: { name: 'A7', shape: shapeOf('A7') }, vi: { name: 'Bm', shape: shapeOf('Bm') }, ii: { name: 'Em', shape: shapeOf('Em') } },
  E: { I: { name: 'E', shape: shapeOf('E') }, IV: { name: 'A', shape: shapeOf('A') }, V: { name: 'B', shape: B_MAJOR }, V7: { name: 'B7', shape: shapeOf('B7') }, vi: { name: 'C#m', shape: C_SHARP_MINOR }, ii: { name: 'F#m', shape: F_SHARP_MINOR } },
  G: { I: { name: 'G', shape: shapeOf('G') }, IV: { name: 'C', shape: shapeOf('C') }, V: { name: 'D', shape: shapeOf('D') }, V7: { name: 'D7', shape: shapeOf('D7') }, vi: { name: 'Em', shape: shapeOf('Em') }, ii: { name: 'Am', shape: shapeOf('Am') } },
  A: { I: { name: 'A', shape: shapeOf('A') }, IV: { name: 'D', shape: shapeOf('D') }, V: { name: 'E', shape: shapeOf('E') }, V7: { name: 'E7', shape: shapeOf('E7') }, vi: { name: 'F#m', shape: F_SHARP_MINOR }, ii: { name: 'Bm', shape: shapeOf('Bm') } },
}

/**
 * The chord of every bar of a form; null for a bar that is not strummed. A bar takes the chord the tune
 * has at the bar line, whether the guide or the singer is on that line; a bar in which nobody sings at
 * the bar line (the wait between a call and its answer) holds the chord before it.
 *
 * The bars before the tune have no chord: they belong to the click and the starting note. The trap: on
 * a bare speaker the tracker knows the app's own sound by that note coming back on time and on pitch,
 * and from "Whole tune" on it is the only cue there is. A strum over it hid it (measured with the
 * recorded guitar in a low key), and the guide then sang the song into the microphone and was handed
 * a clean round. So the chords come in on the first bar line of the tune, as an accompanist leaves a
 * pickup to the singer.
 */
function barDegrees(song: VocalSong, form: LevelForm): (Degree | null)[] {
  const perBar = form.beatsPerBar
  const stretches: { from: number; to: number; tuneBeat: number }[] = []
  for (const turn of form.turns) {
    const length = turn.lines.reduce((sum, line) => sum + line.beats, 0)
    const tuneBeat = turn.lines[0].start
    if (turn.call !== null) stretches.push({ from: turn.call, to: turn.call + length, tuneBeat })
    stretches.push({ from: turn.answer, to: turn.answer + length, tuneBeat })
  }
  const degrees: (Degree | null)[] = []
  for (let bar = 0; bar < form.bars; bar++) {
    const beat = bar * perBar
    if (beat < form.introBeats - 1e-9) {
      degrees.push(null)
      continue
    }
    // The later one where two meet: an answer may start while the rest written at the end of its call still runs.
    const here = stretches.findLast((s) => beat >= s.from && beat < s.to)
    if (!here) {
      degrees.push(degrees[bar - 1] ?? 'I')
      continue
    }
    const tuneBar = Math.floor((here.tuneBeat + beat - here.from - song.pickupBeats) / perBar + 1e-9)
    degrees.push(song.chords[Math.min(song.chords.length - 1, Math.max(0, tuneBar))] ?? 'I')
  }
  return degrees
}

/**
 * The chords of the song strummed on a guitar, for the guide track: on the same beats and of the same
 * length as `arrange` gives the tune at that level, one strum on beat 1 and, with four beats in the
 * bar, another on beat 3, from the first bar line of the tune on (see `barDegrees` for the bars before
 * it). The shapes of five keys that need no capo, and a capo on fret 1 or 2 for the others.
 */
export function accompanimentChart(song: VocalSong, shift: number, level: number, onlyLine?: number): Chart {
  const form = levelForm(song, level, onlyLine)
  const { family, capo } = keyFamily(WRITTEN_HOME + wholeShift(shift))
  const beatSec = form.beatSeconds
  const strumBeats = form.beatsPerBar === 4 ? [0, 2] : [0]
  const strumLength = form.beatsPerBar / strumBeats.length
  const notes: ChartNote[] = []
  let strum = 0
  barDegrees(song, form).forEach((degree, bar) => {
    if (!degree) return
    const { name, shape } = FAMILY_CHORDS[family][degree]
    for (const inBar of strumBeats) {
      const time = (bar * form.beatsPerBar + inBar) * beatSec
      // Lifted a little before the next strum, as the guitar songs are.
      const duration = strumLength * beatSec * 0.95
      for (const [string, fret] of shape) {
        notes.push({ id: notes.length, time, duration, midi: TUNING[string] + fret + capo, string, fret, velocity: inBar === 0 ? 0.9 : 0.78, chordId: strum, chordName: name })
      }
      strum++
    }
  })
  return chartOn(song, form, { capo, notes })
}

/**
 * Bumped when the way a song is arranged changes (the bars before the tune, the breath, the form of a
 * level), so a stored row made by the older rules is recognised and made again.
 */
const ARRANGEMENT_VERSION = 1

/** Two 32-bit running hashes mixed together: small, and the same in every browser. */
function fingerprint(text: string): string {
  let a = 0x9e3779b9
  let b = 0x85ebca6b
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (b >>> 0).toString(36).padStart(7, '0') + (a >>> 0).toString(36).padStart(7, '0')
}

/**
 * A short fingerprint of a song to sing: of everything a stored row or a rendered track is made from
 * (name, credit, tempo, bar, every note, rest and syllable line by line, the chords) and of the
 * arrangement rules. The description, the lesson and the skills a song asks for are read from the list
 * each time and are not part of it. It has nothing to do with the revision of the guitar songs.
 */
export function vocalRevision(song: VocalSong): string {
  const parts: (string | number)[] = [ARRANGEMENT_VERSION, song.id, song.title, song.credit, song.bpm, song.beatsPerBar, song.pickupBeats]
  for (const line of song.lines) {
    parts.push('line')
    for (const [offset, beats, syllable] of line) parts.push(offset ?? 'rest', beats, syllable ?? '')
  }
  parts.push('chords', ...song.chords)
  return fingerprint(JSON.stringify(parts))
}
