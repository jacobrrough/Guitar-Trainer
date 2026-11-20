/**
 * The practice round of each First steps lesson, written by hand. A drill uses only what its lesson and
 * the lessons before it have taught, at a pace close to the lesson before, and leads into the lesson's
 * song. (The exercise generators serve daily practice; they know nothing about what a lesson's cards say.)
 */
import type { Chart } from '../chart/types'
import { CHORD_SHAPES, type Shape } from '../music/chords'
import { ChartBuilder } from '../training/exercises/builder'
import { withChordFingers, type Finger } from './fingering'

/** One note of a tune: [string (0 = thickest), fret, length in beats]. */
type Step = [string: number, fret: number, beats: number]

const HALF = 2
const WHOLE = 4

/** In the first position each fret has its own finger: fret 1 is finger 1, and so on. */
const sameAsFret = (fret: number): Finger | undefined => (fret >= 1 && fret <= 4 ? (fret as Finger) : undefined)

/** Plays the steps one after another from `beat`; returns the beat after the last one. */
function line(b: ChartBuilder, beat: number, steps: Step[], finger: (fret: number) => Finger | undefined = sameAsFret): number {
  for (const [string, fret, beats] of steps) {
    b.note(beat, beats, string, fret, { finger: finger(fret), velocity: beat % b.beatsPerBar === 0 ? 0.9 : 0.8 })
    beat += beats
  }
  return beat
}

function shapeOf(name: string): Shape {
  const def = CHORD_SHAPES[name]
  if (!def) throw new Error(`Unknown chord ${name}`)
  return def.shape
}

/** One chord per bar, strummed on the given beats of the bar and left ringing until the next strum. */
function strumBars(b: ChartBuilder, bars: string[], beatsOf: (bar: number) => number[]): void {
  bars.forEach((name, bar) => {
    const beats = beatsOf(bar)
    beats.forEach((beat, i) => {
      const next = beats[i + 1] ?? b.beatsPerBar
      b.chord(b.at(bar, beat), next - beat, shapeOf(name), name, { velocity: beat === 0 ? 0.9 : 0.8 })
    })
  })
}

/** What an up strum catches: the three thinnest strings of the shape. */
export function thinStrings(shape: Shape): Shape {
  return [...shape].sort((x, y) => x[0] - y[0]).slice(-3)
}

const halves = (string: number, frets: number[]): Step[] => frets.map((fret) => [string, fret, HALF])

/** The two-bar heart of the First Riff song on one string: open, open, fret 3, open, open, fret 5. */
const riffBar = (string: number): Step[] => [
  [string, 0, 0.5],
  [string, 0, 0.5],
  [string, 3, 1],
  [string, 0, 0.5],
  [string, 0, 0.5],
  [string, 5, 1],
]
/** The riff's fingering: the hand sits two frets higher, so the first finger takes fret 3 and the third finger fret 5. */
const riffFinger = (fret: number): Finger | undefined => (fret === 3 ? 1 : fret === 5 ? 3 : undefined)

const DRILLS: Record<string, (b: ChartBuilder) => void> = {
  // The two thickest strings in turn, as the Open Strings Groove uses them.
  'l01-hold': (b) => {
    line(b, 0, Array.from({ length: 16 }, (_, i): Step => [i % 2, 0, HALF]))
  },
  // Frets 1 to 3 on the thinnest string, then the two frets of the 2nd string the Ode to Joy needs.
  'l03-first-frets': (b) => {
    const beat = line(b, 0, [...halves(5, [0, 1, 0, 2, 0, 3, 1, 3]), ...halves(4, [0, 1, 0, 3, 1, 3])])
    line(b, beat, [[5, 0, WHOLE]])
  },
  // Open strings first, so only the pick has to find its way; then the new fret; then the start of Twinkle Twinkle.
  'l04-crossing': (b) => {
    const open: Step[] = [[3, 0, HALF], [4, 0, HALF], [5, 0, HALF], [4, 0, HALF]]
    const frets: Step[] = [[3, 0, HALF], [3, 2, HALF], [4, 0, HALF], [4, 1, HALF]]
    const twinkle: Step[] = [[3, 0, HALF], [3, 0, HALF], [4, 3, HALF], [4, 3, HALF], [5, 0, HALF], [5, 0, HALF], [4, 3, WHOLE]]
    line(b, 0, [...open, ...frets, ...twinkle])
  },
  // One slow strum a bar to check every string, then two a bar.
  'l05-em': (b) => {
    strumBars(b, Array.from({ length: 8 }, () => 'Em'), (bar) => (bar < 4 ? [0] : [0, 2]))
  },
  // Two strums on each chord, so there is always the same time to change; first after two bars, as in the song.
  'l06-am': (b) => {
    strumBars(b, ['Em', 'Em', 'Am', 'Am', 'Em', 'Am', 'Em', 'Am'], () => [0, 2])
  },
  'l07-d-a': (b) => {
    strumBars(b, ['D', 'D', 'A', 'A', 'D', 'A', 'D', 'A'], () => [0, 2])
  },
  // The changes of When the Saints: G to C and back, G to D7 and back.
  'l08-g-c': (b) => {
    strumBars(b, ['G', 'C', 'G', 'D7', 'D7', 'G', 'C', 'G'], () => [0, 2])
  },
  // The easiest chord, so all attention can go to the strumming hand: down on every beat, then an up strum after beats 2 and 4.
  'l09-rhythm': (b) => {
    const down = shapeOf('Em')
    // On the way up the pick only catches the thin strings. Three of them, all open in E minor: the scoring
    // simulation hears that up strum every time, at both sample rates and through a phone microphone.
    const up = thinStrings(down)
    for (let bar = 0; bar < 8; bar++) {
      for (let beat = 0; beat < 4; beat++) {
        const withUp = bar >= 2 && beat % 2 === 1
        b.chord(b.at(bar, beat), withUp ? 0.5 : 1, down, 'Em', { velocity: beat === 0 ? 0.9 : 0.8 })
        if (withUp) b.chord(b.at(bar, beat) + 0.5, 0.5, up, 'Em', { velocity: 0.6 })
      }
    }
  },
  // The three places on each string in even steps, then the riff itself, as the First Riff song plays it.
  'l10-riff': (b) => {
    const steps = (string: number): Step[] => [0, 3, 0, 5].map((fret): Step => [string, fret, 1])
    line(b, 0, [...steps(0), ...steps(1), ...riffBar(0), ...riffBar(0), ...riffBar(1), ...riffBar(1), ...riffBar(0), ...riffBar(1)], riffFinger)
  },
}

export function hasLessonDrill(lessonId: string): boolean {
  return lessonId in DRILLS
}

/** The drill of a lesson as a chart at `tempo` beats a minute. */
export function lessonDrillChart(lessonId: string, tempo: number, tuning: number[], title = 'Lesson practice'): Chart {
  const write = DRILLS[lessonId]
  if (!write) throw new Error(`No practice written for lesson ${lessonId}`)
  const b = new ChartBuilder({ bpm: tempo, tuning, title })
  write(b)
  const chart = b.build()
  return { ...chart, notes: withChordFingers(chart.notes) }
}
