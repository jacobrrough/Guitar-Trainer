/**
 * Assembles sung exercises, in beats, the way `ChartBuilder` assembles guitar ones. Everything the
 * four sung generators share is here, so the rules of voice care are written once:
 *
 * - every note the singer is asked for, and every note the app sings, lies inside the singer's range,
 *   both ends included (docs/SINGING.md §10). `build` refuses anything else;
 * - the app's own voice (a cue) stops at least a beat before the singer comes in and is silent while
 *   the singer sings. The scorer stops listening while a cue sounds, so a cue that ran into the
 *   singer's turn would cost the singer the start of it;
 * - a round is never longer than 8 bars. `build` refuses a ninth, whoever sings in it.
 *
 * Exercises are call and answer: the app sings for a bar or two (the call), the singer sings it back
 * over the click (the answer). While the app sings, the singer rests.
 *
 * The chart keeps the fields a guitar chart has (standard tuning, string 0, fret 0, one `chordId` a
 * note), so everything written for the guitar can still read it; `chart.voice` is what marks it as sung.
 */
import { constantBeatGrid } from '../../../chart/timing'
import type { Chart, ChartNote, VoiceCue, VoiceJudge } from '../../../chart/types'
import { DEFAULT_RANGES, MIN_RANGE_SPAN, WRITTEN_HOME, placePattern } from '../../../music/keys'
import type { RangeAroundEasy, RangeEdges } from '../../../music/keys'
import { clamp } from '../../../music/pitch'
import { BACKING_SAMPLE_RATE } from '../../constants'
import { itemDifficulty } from '../../difficulty'
import { stepWithin } from '../../learner'
import { maxStepFor } from '../../planner'
import type { ExerciseParams, GeneratedExercise, NoteValue, SkillDef, SkillStep } from '../../types'
import { DEFAULT_TUNING, hashParams, variationOf } from '../builder'

/** The longest a sung round is written out, whatever is asked: a voice needs its rests. */
export const VOICE_MAX_BARS = 8
/** A cue ends at least this many beats before the next note the singer sings. */
export const CUE_GAP_BEATS = 1
/** Nothing to sing for this many beats ends a line: the next note starts a new one, with time to breathe before it. */
export const LINE_REST_BEATS = 2
/** How long the app sings a starting note when it gives nothing else. */
export const FIRST_NOTE_BEATS = 2
/** The range an exercise is built in when it is given none: the "Lower voice" starting range. Any octave counts when it is sung. */
export const DEFAULT_VOICE_RANGE: RangeAroundEasy = DEFAULT_RANGES.lower

/** Room for the rounding of a time worked out in two ways. */
const EPS = 1e-9

export interface VoiceBuilderOptions {
  bpm: number
  beatsPerBar?: number
  title?: string
  /** Seconds of silence after the last bar, in which the last note can still be judged. */
  tail?: number
}

/** What a sung chart says about itself beyond its notes. */
export interface VoiceChartExtras {
  /** MIDI number of the home note the notes are numbered from. Default: the first note to sing. */
  tonic?: number
  hideAnswers?: boolean
  glide?: boolean
}

interface Written {
  beat: number
  beats: number
  midi: number
  lyric?: string
}

const endBeat = (w: Written) => w.beat + w.beats

export class VoiceBuilder {
  readonly bpm: number
  readonly beatsPerBar: number
  private readonly title: string
  private readonly tail: number
  private readonly sung: Written[] = []
  private readonly called: Written[] = []

  constructor(options: VoiceBuilderOptions) {
    this.bpm = options.bpm
    this.beatsPerBar = options.beatsPerBar ?? 4
    this.title = options.title ?? 'Exercise'
    this.tail = options.tail ?? 1
  }

  get beatSeconds(): number {
    return 60 / this.bpm
  }

  /** Beat index (from 0) of bar `bar` (from 0), beat `beat` (from 0). */
  at(bar: number, beat = 0): number {
    return bar * this.beatsPerBar + beat
  }

  /** A note for the singer, scored: from `beat`, for `beats`, with the word or number shown on it. */
  note(beat: number, beats: number, midi: number, lyric?: string): this {
    this.sung.push({ beat, beats, midi, lyric })
    return this
  }

  /** A note the app sings itself and does not score: a starting note, or its turn of a call and answer. */
  cue(beat: number, beats: number, midi: number, lyric?: string): this {
    this.called.push({ beat, beats, midi, lyric })
    return this
  }

  /** Number of whole bars needed to contain everything added so far. */
  get barsUsed(): number {
    const last = [...this.sung, ...this.called].reduce((m, w) => Math.max(m, endBeat(w)), 0)
    return Math.ceil(last / this.beatsPerBar - EPS)
  }

  /**
   * Builds the chart. `range` is the singer's range: it is what the pitch lanes show, and nothing may
   * lie outside it. Throws when a rule of the header is broken, so no generator can hand out such a chart.
   */
  build(judge: VoiceJudge, range: RangeEdges, extras: VoiceChartExtras = {}): Chart {
    const sung = [...this.sung].sort((a, b) => a.beat - b.beat || a.midi - b.midi)
    const called = [...this.called].sort((a, b) => a.beat - b.beat || a.midi - b.midi)
    for (const w of [...sung, ...called]) {
      // Written so that a value that is not a number fails each test: NaN is neither inside a range nor after the start.
      if (!(w.midi >= range.low && w.midi <= range.high)) throw new Error(`Note ${w.midi} is outside the range ${range.low} to ${range.high}`)
      if (!(w.beats > 0)) throw new Error('A note needs a length')
      if (!(w.beat >= 0)) throw new Error(`A note cannot start before the round does (beat ${w.beat})`)
    }
    if (!(this.barsUsed <= VOICE_MAX_BARS)) throw new Error(`A round is at most ${VOICE_MAX_BARS} bars, and this one needs ${this.barsUsed}`)
    for (const list of [sung, called]) {
      for (let i = 1; i < list.length; i++) {
        if (list[i].beat < endBeat(list[i - 1]) - EPS) throw new Error(`Two notes at once at beat ${list[i].beat}`)
      }
    }
    for (const cue of called) {
      for (const note of sung) {
        if (note.beat >= cue.beat) {
          if (note.beat - endBeat(cue) < CUE_GAP_BEATS - EPS) throw new Error(`The cue at beat ${cue.beat} ends less than a beat before the note at beat ${note.beat}`)
        } else if (endBeat(note) > cue.beat + EPS) {
          throw new Error(`The cue at beat ${cue.beat} sounds during the note at beat ${note.beat}`)
        }
      }
    }

    const seconds = this.beatSeconds
    const notes: ChartNote[] = sung.map((w, i) => ({
      id: i,
      time: w.beat * seconds,
      duration: w.beats * seconds,
      midi: w.midi,
      // A voice has no strings: a stand-in place, and each note its own group, so nothing reads two notes as a chord.
      string: 0,
      fret: 0,
      velocity: 0.8,
      chordId: i,
      ...(w.lyric === undefined ? {} : { lyric: w.lyric }),
    }))
    const cues: VoiceCue[] = called.map((w) => ({
      time: w.beat * seconds,
      duration: w.beats * seconds,
      midi: w.midi,
      ...(w.lyric === undefined ? {} : { lyric: w.lyric }),
    }))
    const lineStarts: number[] = []
    sung.forEach((w, i) => {
      if (i === 0 || w.beat - endBeat(sung[i - 1]) >= LINE_REST_BEATS - EPS) lineStarts.push(w.beat * seconds)
    })
    const tonic = extras.tonic ?? sung[0]?.midi ?? called[0]?.midi ?? range.low
    const duration = Math.max(1, this.barsUsed) * this.beatsPerBar * seconds + this.tail
    return {
      version: 1,
      title: this.title,
      artist: 'Guitar Trainer',
      source: 'demo',
      tuning: [...DEFAULT_TUNING],
      capo: 0,
      duration,
      notes,
      beats: constantBeatGrid(this.bpm, 0, duration, this.beatsPerBar),
      tempos: [{ time: 0, bpm: this.bpm }],
      timeSignatures: [{ time: 0, numerator: this.beatsPerBar, denominator: 4 }],
      voice: {
        judge: { ...judge },
        cues,
        low: range.low,
        high: range.high,
        tonic,
        shift: tonic - WRITTEN_HOME,
        lineStarts,
        ...(extras.hideAnswers ? { hideAnswers: true } : {}),
        ...(extras.glide ? { glide: true } : {}),
      },
    }
  }
}

/** Something to sing: semitones above the home note (null = a rest) and its length in beats. */
export type Sung = readonly [offset: number | null, beats: number]

/** One call and its answer, in one key. */
export interface Turn {
  /** MIDI number of the home note. */
  home: number
  /** What the app sings first. */
  call: readonly Sung[]
  /** What the singer sings back. */
  answer: readonly Sung[]
}

/** Beats from the start of a line to the end of its last note (a rest at the end takes no room). */
export function beatsOf(line: readonly Sung[]): number {
  let at = 0
  let end = 0
  for (const [offset, beats] of line) {
    at += beats
    if (offset !== null) end = at
  }
  return end
}

/** Whole bars a call takes: its notes and the silent beat a cue needs before the singer comes in. */
function callBars(call: readonly Sung[], beatsPerBar: number): number {
  return Math.ceil((beatsOf(call) + CUE_GAP_BEATS) / beatsPerBar - EPS)
}

/** Whole bars an answer takes. What is left of its last bar is rest for the singer, and so is the call that follows. */
function answerBars(answer: readonly Sung[], beatsPerBar: number): number {
  return Math.ceil(beatsOf(answer) / beatsPerBar - EPS)
}

/**
 * Bars one turn takes: the call from the first beat of its bars, then the answer from the first beat
 * of the next bar. A turn that comes to three bars is given a fourth, a bar of rest after the answer:
 * turns of two and four bars are even phrases, easier to feel against a click than a lopsided three,
 * a round of eight bars holds two such turns either way, and the answers this gives a rest to are the
 * long ones (a note held over two bars, a climb to the octave and back).
 */
export function turnBars(turn: Pick<Turn, 'call' | 'answer'>, beatsPerBar = 4): number {
  const bars = callBars(turn.call, beatsPerBar) + answerBars(turn.answer, beatsPerBar)
  return bars === 3 ? 4 : bars
}

/**
 * How many turns of `bars` each a round of `asked` bars holds. Never more than 8 bars' worth, and
 * always one: a turn is the least an exercise can be, also where it is longer than what was asked.
 */
export function turnsThatFit(asked: number, bars: number): number {
  return Math.max(1, Math.floor(Math.min(asked, VOICE_MAX_BARS) / bars))
}

/** The names of the notes of the scale as the lanes show them: 1 is home, 8 the same note an octave up. */
const NUMBERS: Record<number, string> = { 0: '1', 2: '2', 4: '3', 5: '4', 7: '5', 9: '6', 11: '7', 12: '8' }

/** What is shown on a note `offset` semitones above home: its number in the scale, or "la" for a note between. */
export function numberOf(offset: number): string {
  return NUMBERS[offset] ?? 'la'
}

/** Writes the turns one after the other, each from the first beat of a bar. `lyricOf` names a note by its distance from home. */
export function writeTurns(b: VoiceBuilder, turns: readonly Turn[], lyricOf: (offset: number) => string = numberOf): void {
  let bar = 0
  for (const turn of turns) {
    const write = (line: readonly Sung[], from: number, add: (beat: number, beats: number, midi: number, lyric: string) => void) => {
      let beat = from
      for (const [offset, beats] of line) {
        if (offset !== null) add(beat, beats, turn.home + offset, lyricOf(offset))
        beat += beats
      }
    }
    write(turn.call, b.at(bar), (beat, beats, midi, lyric) => b.cue(beat, beats, midi, lyric))
    write(turn.answer, b.at(bar + callBars(turn.call, b.beatsPerBar)), (beat, beats, midi, lyric) => b.note(beat, beats, midi, lyric))
    bar += turnBars(turn, b.beatsPerBar)
  }
}

/**
 * Home notes for the turns of a round, one key a turn: on the easy note first, a semitone up from turn
 * to turn while the range has room, then back (`placePattern`). `offsets` is the pattern as it is sung
 * here, already in the form the range can hold. A pattern the range cannot hold has no place, and that
 * is an error, never notes: every generator asks `maxStepFor` and `fittingForm` first.
 */
export function homesFor(offsets: readonly number[], range: RangeAroundEasy, day: number, count: number): number[] {
  const homes = placePattern(offsets, range, day, count)
  if (homes.length !== count) throw new Error(`The range ${range.low} to ${range.high} is too small for this exercise`)
  return homes
}

/** `count` items of a list for a day: consecutive days walk on through the list and start again. Nothing from an empty list. */
export function takeFor<T>(items: readonly T[], count: number, day: number): T[] {
  // Without this an empty list would hand back `count` holes, and a hole would become a note that is not a number.
  if (items.length === 0) return []
  const stride = count % items.length || 1
  return Array.from({ length: count }, (_, i) => items[(day * stride + i) % items.length])
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The singer's range from the params of an exercise: whole notes, read inwards, with the easy note
 * inside. Without one it is the "Lower voice" starting range. A range under 7 semitones is refused:
 * the app never stores one, and the first step of every exercise needs that much room.
 */
export function voiceRange(params: Record<string, unknown>): RangeAroundEasy {
  if (!isNumber(params.low) || !isNumber(params.high)) return { ...DEFAULT_VOICE_RANGE }
  const low = Math.ceil(params.low)
  const high = Math.floor(params.high)
  if (high - low < MIN_RANGE_SPAN) throw new Error(`The range ${params.low} to ${params.high} is too small to sing an exercise in`)
  const easy = isNumber(params.easy) ? Math.round(params.easy) : Math.floor((low + high) / 2)
  return { low, high, easy: clamp(easy, low, high) }
}

const BANDS = [80, 65, 50, 35] as const

/** How a round is judged: the band the step or the drill names, the given one otherwise. */
export function judgeOf(content: Record<string, unknown>, fallback: VoiceJudge): VoiceJudge {
  const band = BANDS.find((b) => b === content.band) ?? fallback.band
  return { ...fallback, band }
}

/** What a generator works from, read once from the skill and the params it was given. */
export interface VoiceSetup {
  range: RangeAroundEasy
  /**
   * What to build. On a ladder that is the step's own params and nothing else, so no param passed
   * beside a step can turn it into something easier than the step it is recorded as. Otherwise the
   * params given (the generator's defaults for the skill, with the caller's on top).
   */
  content: Record<string, unknown>
  /** The params as they are stored with a run: the range filled in, and the step that is really sung. */
  params: ExerciseParams
  /** The step sung; undefined for a skill without a ladder. */
  step?: SkillStep
  /** The day's variation (see `variationOf`). */
  day: number
  /** Bars asked for, at most 8. */
  bars: number
}

/**
 * Reads the params of a sung exercise.
 *
 * A step skill is built on the step asked (`params.step`), as far as its ladder goes, as far as the
 * plan allows (`params.maxStep`) and as far as the range has room (`maxStepFor`). The three agree
 * when the plan is fresh. They can disagree after the range was made smaller in the middle of a day:
 * then the exercise is the highest step that fits, and the params returned say so (`step`, and
 * `maxStep` when the ladder stops early for this range), because the rating reads both from the run.
 * Nothing is ever recorded as a harder step than was sung.
 */
export function voiceSetup(skill: SkillDef, given: ExerciseParams): VoiceSetup {
  const range = voiceRange(given)
  const params: ExerciseParams = { ...given, low: range.low, high: range.high, easy: range.easy }
  const steps = skill.steps ?? []
  let step: SkillStep | undefined
  if (steps.length > 0) {
    const last = steps.length - 1
    const reach = Math.min(maxStepFor(skill, range), stepWithin(given.maxStep, last, last))
    const index = Math.min(stepWithin(given.step, last, 0), reach)
    params.step = index
    if (reach < last) params.maxStep = reach
    step = steps[index]
  }
  const asked = isNumber(given.bars) && given.bars >= 1 ? Math.floor(given.bars) : VOICE_MAX_BARS
  return { range, content: step ? { ...step.params } : { ...given }, params, step, day: variationOf(given), bars: Math.min(asked, VOICE_MAX_BARS) }
}

/** The title of a sung exercise: its skill, and the step in the learner's words. */
export function titleOf(skill: SkillDef, setup: Pick<VoiceSetup, 'step'>): string {
  return setup.step ? `${skill.name} · ${setup.step.label}` : skill.name
}

/**
 * How hard the exercise counts. On a ladder the step alone decides, at the skill's one tempo (so a
 * step is the same item in practice and in a check); otherwise the tempo and the note values, as for
 * every guitar exercise.
 */
export function difficultyOf(skill: SkillDef, setup: Pick<VoiceSetup, 'step' | 'params'>, noteValue?: NoteValue): number {
  if (setup.step) return itemDifficulty(skill, { tempo: skill.refTempo, bonus: setup.step.bonus })
  return itemDifficulty(skill, { tempo: setup.params.tempo, noteValue })
}

/**
 * The exercise around a finished chart. No sound yet: `renderExerciseBacking` adds the click and the cues.
 *
 * The id names the skill as well as the params. A guitar drill carries what is played in its params; a
 * sung step carries only its number, and what is sung is in the skill's ladder. Two skills that share
 * a generator and a tempo ("Match a note" and "Stay in tune on your own") would otherwise have one id
 * for two exercises.
 */
export function sungExercise(
  generatorId: string,
  skill: SkillDef,
  setup: VoiceSetup,
  chart: Chart,
  words: { instructions: string; noteValue?: NoteValue },
): GeneratedExercise {
  return {
    id: `${generatorId}:${hashParams({ ...setup.params, skillId: skill.id })}`,
    generatorId,
    skillId: skill.id,
    title: chart.title,
    chart,
    difficulty: difficultyOf(skill, setup, words.noteValue),
    params: setup.params,
    backing: null,
    backingSampleRate: BACKING_SAMPLE_RATE,
    instructions: words.instructions,
    interaction: 'highway',
  }
}
