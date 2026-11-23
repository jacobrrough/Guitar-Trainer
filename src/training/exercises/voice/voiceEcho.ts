import { clamp } from '../../../music/pitch'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../../types'
import { FIRST_NOTE_BEATS, VoiceBuilder, homesFor, judgeOf, sungExercise, takeFor, titleOf, turnBars, turnsThatFit, voiceSetup, writeTurns } from './builder'
import type { Sung, Turn, VoiceSetup } from './builder'

const ID = 'voiceEcho'

/** How long a note is held when it is sung back, and how long the app sings it first, in beats. */
const HOLD_BEATS = 3

/**
 * "Match a note", first steps: four notes around the easy note, in semitones from it, in the order
 * they are asked. The first is the easy note itself; none of the first set is more than two semitones
 * from it, none of the second more than four. Both fit the smallest range (7 semitones).
 */
const CLOSE = [0, 2, -2, 1]
const WIDER = [0, 4, -3, 2]
/**
 * Later steps: the range is cut into six notes from its bottom to its top, asked in this order (from
 * the middle outwards, never two neighbours in a row).
 */
const ACROSS = [2, 4, 1, 5, 0, 3]

/**
 * "Echo a short tune": the tunes of each step, in semitones above the home note, and their rhythm in
 * beats. Every tune lasts three beats, so it fits a bar with a beat of silence before the answer.
 * Three notes move among 1, 2 and 3; four notes always touch the 5; five notes always have a jump of
 * a fourth or more. No note comes twice in a row: sung back, a repeated note would sound like one.
 */
const TUNES: Record<number, { beats: number[]; tunes: number[][]; top: number }> = {
  3: {
    beats: [1, 1, 1],
    top: 4,
    tunes: [[0, 2, 4], [4, 2, 0], [0, 2, 0], [2, 4, 2], [0, 4, 2], [4, 2, 4], [2, 0, 4], [4, 0, 2]],
  },
  4: {
    beats: [0.5, 0.5, 1, 1],
    top: 7,
    tunes: [[0, 2, 4, 7], [7, 4, 2, 0], [0, 4, 7, 4], [4, 7, 4, 0], [0, 2, 7, 4], [7, 4, 0, 2], [2, 4, 7, 4], [4, 2, 0, 7]],
  },
  5: {
    beats: [0.5, 0.5, 0.5, 0.5, 1],
    top: 7,
    tunes: [[0, 7, 4, 2, 0], [0, 2, 4, 0, 7], [4, 2, 0, 7, 4], [7, 0, 2, 4, 5], [0, 5, 4, 2, 0], [2, 7, 5, 4, 2], [0, 2, 7, 5, 4], [7, 5, 0, 2, 4]],
  },
}

/** "Stay in tune on your own": five notes up and back in quarter notes, the last one held for two beats (ten beats, the longest a line may be at 60). */
const SCALE: Sung[] = [[0, 1], [2, 1], [4, 1], [5, 1], [7, 1], [5, 1], [4, 1], [2, 1], [0, 2]]
/** ...and from the second step: the rest of that bar and two whole bars of silence, then the home note again. */
const SILENCE_BEATS = 10

const la = () => 'la'

interface Built {
  turns: Turn[]
  tonic: number
  hideAnswers?: boolean
  lyricOf?: (offset: number) => string
  instructions: string
}

/** One note at a time: listen for a bar, sing it back for a bar. */
function matchTurns(setup: VoiceSetup): Built {
  const { range, content, day } = setup
  const cueBeats = clamp(typeof content.cueBeats === 'number' ? content.cueBeats : HOLD_BEATS, 1, HOLD_BEATS)
  const turn = (midi: number): Turn => ({ home: midi, call: [[0, cueBeats]], answer: [[0, HOLD_BEATS]] })
  const count = turnsThatFit(setup.bars, turnBars(turn(range.easy)))
  let midis: number[]
  let tonic = range.easy
  if (content.pool === 'range') {
    const span = range.high - range.low
    const across = ACROSS.map((i) => range.low + Math.round((i * span) / (ACROSS.length - 1)))
    midis = takeFor(across, count, day)
  } else {
    const pool = content.pool === 'wider' ? WIDER : CLOSE
    // Around the easy note itself on every day (the day changes the order, not the key); moved only as
    // far as it takes to keep all four inside the range.
    tonic = clamp(range.easy, range.low - Math.min(...pool), range.high - Math.max(...pool))
    midis = takeFor(pool, count, day).map((offset) => tonic + offset)
  }
  const short = cueBeats < HOLD_BEATS
  return {
    turns: midis.map(turn),
    tonic,
    lyricOf: la,
    instructions: short
      ? 'The note is short this time. Hear it in your head, then sing it on "la" and hold it.'
      : 'Listen to the note, then sing it back on "la" and hold it. Breathe while the next note is sung to you.',
  }
}

/** A short tune each time: listen for a bar, sing it back for a bar. All tunes of a round are in one key. */
function tuneTurns(setup: VoiceSetup): Built {
  const { range, content, day } = setup
  const set = TUNES[typeof content.notes === 'number' ? content.notes : 3] ?? TUNES[3]
  const home = homesFor([0, set.top], range, day, 1)[0]
  const line = (tune: number[]): Sung[] => tune.map((offset, i) => [offset, set.beats[i]])
  const count = turnsThatFit(setup.bars, turnBars({ call: line(set.tunes[0]), answer: line(set.tunes[0]) }))
  return {
    turns: takeFor(set.tunes, count, day).map((tune) => ({ home, call: line(tune), answer: line(tune) })),
    tonic: home,
    hideAnswers: true,
    lyricOf: la,
    instructions: 'Listen to the little tune, then sing it back on "la". The notes show up once you have sung them.',
  }
}

/** One starting note, then the scale over the click alone; later the home note once more after a long silence. */
function aloneTurns(setup: VoiceSetup): Built {
  const { range, content, day } = setup
  const comeBack = content.comeBack === true
  const answer: Sung[] = comeBack ? [...SCALE, [null, SILENCE_BEATS], [0, HOLD_BEATS]] : SCALE
  const call: Sung[] = [[0, FIRST_NOTE_BEATS]]
  const count = turnsThatFit(setup.bars, turnBars({ call, answer }))
  const homes = homesFor([0, 7], range, day, count)
  return {
    turns: homes.map((home) => ({ home, call, answer })),
    tonic: homes[0],
    instructions: comeBack
      ? 'You hear note 1 once. Sing five notes up and back with only the click, wait through the quiet bars, then sing note 1 again.'
      : 'You hear note 1 once. Then sing five notes up and back down with only the click to help.',
  }
}

/**
 * The app sings, the singer sings it back: one note ("Match a note"), a short tune that stays hidden
 * until it is sung ("Echo a short tune"), or a scale from a single starting note ("Stay in tune on
 * your own"). Which of the three, and how hard, is in the params of the skill's step (`form`).
 */
export const voiceEchoGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Sing it back',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 8, step: 0 }
  },
  generate(skill: SkillDef, params: ExerciseParams): GeneratedExercise {
    const setup = voiceSetup(skill, params)
    const { content } = setup
    const built = content.form === 'tune' ? tuneTurns(setup) : content.form === 'alone' ? aloneTurns(setup) : matchTurns(setup)
    const b = new VoiceBuilder({ bpm: params.tempo, title: titleOf(skill, setup) })
    writeTurns(b, built.turns, built.lyricOf)
    const chart = b.build(judgeOf(content, { band: 80, minShare: 0.5 }), setup.range, { tonic: built.tonic, hideAnswers: built.hideAnswers })
    return sungExercise(ID, skill, setup, chart, { instructions: built.instructions })
  },
}
