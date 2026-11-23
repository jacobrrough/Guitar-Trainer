import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../../types'
import { VoiceBuilder, homesFor, judgeOf, sungExercise, takeFor, titleOf, turnBars, turnsThatFit, voiceSetup, writeTurns } from './builder'
import type { Turn } from './builder'

const ID = 'voiceHold'

/** How long the app sings the note before it is held: long enough to hear, short enough to leave a silent beat. */
const CALL_BEATS = 3
/** The notes held, in semitones above home: 1, 3 and 5 of one key, there and back. A round takes the next ones each day. */
const HELD = [0, 4, 7, 4]
/** A held note lasts at least this many beats, and never more than 8: at 60 that is 8 seconds, the longest a note is held. */
const SHORTEST = 2
const LONGEST = 8

/**
 * "Hold a note steady": the app sings a note, the singer holds it for 4, 6 or 8 beats on one breath.
 * A note that fills its bars is followed straight away by the next call, which is the singer's rest:
 * a bar to breathe and listen.
 *
 * It is the one exercise where a note has to last to its end to be perfect (`sustain`), and more of it
 * has to be in tune than elsewhere (six tenths), as on the song levels that ask for the long notes.
 */
export const voiceHoldGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Hold a note',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 8, step: 0 }
  },
  generate(skill: SkillDef, params: ExerciseParams): GeneratedExercise {
    const setup = voiceSetup(skill, params)
    const { content, range, day } = setup
    const asked = typeof content.beats === 'number' && Number.isFinite(content.beats) ? Math.round(content.beats) : 4
    const beats = Math.max(SHORTEST, Math.min(LONGEST, asked))
    const turn = (home: number, offset: number): Turn => ({ home, call: [[offset, CALL_BEATS]], answer: [[offset, beats]] })
    const count = turnsThatFit(setup.bars, turnBars(turn(0, 0)))
    // One key for the whole round, so the three notes belong together.
    const home = homesFor(HELD, range, day, 1)[0]
    const b = new VoiceBuilder({ bpm: params.tempo, title: titleOf(skill, setup) })
    writeTurns(b, takeFor(HELD, count, day).map((offset) => turn(home, offset)))
    const chart = b.build(judgeOf(content, { band: 65, minShare: 0.6, sustain: true }), range, { tonic: home })
    return sungExercise(ID, skill, setup, chart, {
      instructions: `Listen to the note, then hold it for ${beats} beats on one calm breath. Use steady air, not more air.`,
    })
  },
}
