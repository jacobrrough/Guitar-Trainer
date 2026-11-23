import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../../types'
import { VoiceBuilder, homesFor, judgeOf, sungExercise, titleOf, turnBars, turnsThatFit, voiceSetup, writeTurns } from './builder'
import type { Sung } from './builder'

const ID = 'voiceSlide'

/** The smallest and the widest slide there is, in semitones: a tone and an octave. */
const NARROWEST = 2
const WIDEST = 12

/**
 * Home, a beat to slide up, the top note, a beat to slide down, home again and held. Only the three
 * notes are scored. What the voice does on the way between them is drawn and not judged: that is where
 * it may crack, and a crack is information, not a miss.
 */
function slide(top: number): Sung[] {
  return [[0, 1], [null, 1], [top, 1], [null, 1], [0, 2]]
}

/**
 * "Slides": the app sings home, top, home; the singer slides up to the top and back down. Each turn
 * starts a semitone higher while the top note stays inside the range, so the voice is led upwards
 * gently and never past its easy notes.
 */
export const voiceSlideGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Slide',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 8, step: 0 }
  },
  generate(skill: SkillDef, params: ExerciseParams): GeneratedExercise {
    const setup = voiceSetup(skill, params)
    const { content, range, day } = setup
    const asked = typeof content.top === 'number' && Number.isFinite(content.top) ? Math.round(content.top) : 4
    // Never wider than the range: a step the range cannot hold was already taken back by `voiceSetup`.
    const top = Math.max(NARROWEST, Math.min(WIDEST, asked, range.high - range.low))
    const line = slide(top)
    const count = turnsThatFit(setup.bars, turnBars({ call: line, answer: line }))
    const homes = homesFor([0, top], range, day, count)
    const b = new VoiceBuilder({ bpm: params.tempo, title: titleOf(skill, setup) })
    writeTurns(b, homes.map((home) => ({ home, call: line, answer: line })))
    const chart = b.build(judgeOf(content, { band: 80, minShare: 0.5 }), range, { tonic: homes[0], glide: true })
    return sungExercise(ID, skill, setup, chart, {
      instructions: 'Listen, then slide up from the first note to the top note and back down, like a small siren. Stop while it feels easy.',
    })
  },
}
