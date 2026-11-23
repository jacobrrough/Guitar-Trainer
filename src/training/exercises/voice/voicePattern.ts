import type { VoiceJudge } from '../../../chart/types'
import { fittingForm } from '../../../music/keys'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../../types'
import { FIRST_NOTE_BEATS, VoiceBuilder, homesFor, judgeOf, sungExercise, titleOf, turnBars, turnsThatFit, voiceSetup, writeTurns } from './builder'
import type { Sung } from './builder'

const ID = 'voicePattern'

/** The scale to the fifth note and back, without its last note: 1 2 3 4 5 4 3 2. */
const UP_AND_BACK = [0, 2, 4, 5, 7, 5, 4, 2]

/** `notes` each `beats` long, then `last` held for `lastBeats`. */
function line(notes: number[], beats: number, last: number, lastBeats: number): Sung[] {
  return [...notes.map((offset): Sung => [offset, beats]), [last, lastBeats]]
}

/** A pattern as it is sung: its notes, and what is said before it. The widest form first where a range may be too small for it. */
interface Pattern {
  forms: Sung[][]
  instructions: string
}

/**
 * The patterns, by name. Each ends on a longer home note, so a turn closes instead of stopping, and
 * each starts on its home note, which is the note the app gives from tier 2 on.
 */
function patternOf(content: Record<string, unknown>, room: number): Pattern {
  const number = (value: unknown, fallback: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback))
  switch (content.pattern) {
    case 'five':
      return { forms: [line(UP_AND_BACK, 0.5, 0, 2)], instructions: 'Listen, then sing five notes up and back down on one breath.' }
    case 'thirds':
      return { forms: [line([0, 4, 7, 4], 0.5, 0, 2)], instructions: 'You hear the first note. Then sing 1, 3, 5, 3, 1 and land right on each note.' }
    case 'triad':
      // Up to the octave where the range holds one; otherwise the same climb to the fifth note.
      return {
        forms: [line([0, 4, 7, 12, 7, 4], 1, 0, 2), line([0, 4, 7, 4], 1, 0, 2)],
        instructions: 'You hear the first note. Then climb the chord notes to the top and come back down.',
      }
    case 'run':
      // Steps and small jumps in one go, the two things quick notes are made of.
      return { forms: [line([...UP_AND_BACK, 0, 4, 7, 4], 0.5, 0, 2)], instructions: 'You hear the first note. Then sing the quick notes lightly, as one shape.' }
    case 'line': {
      // Up and back once or twice without a breath; the last note may be held longer.
      const times = number(content.times, 1, 1, 2)
      const notes = Array.from({ length: times }, () => UP_AND_BACK).flat()
      return {
        forms: [line(notes, 0.5, 0, number(content.lastBeats, 2, 1, 4))],
        instructions: 'You hear the first note. Take a quiet breath, then sing the whole line without breathing in the middle.',
      }
    }
    case 'leap': {
      // Never wider than the range: a step the range cannot hold was already taken back by `voiceSetup`.
      const top = Math.min(number(content.top, 5, 3, 12), room)
      return { forms: [[[0, 1], [top, 1], [0, 2]]], instructions: 'You hear the first note. Then jump up to the top note and land back on note 1.' }
    }
    default:
      return { forms: [line([0, 2, 4, 2], 1, 0, 2)], instructions: 'Listen, then sing the notes back: three steps up and down again.' }
  }
}

/** What each tempo skill practises: its pattern, the note value it is rated for, and how closely it is judged. */
const DRILLS: Record<string, { pattern: string; noteValue: NoteValue; band: VoiceJudge['band'] }> = {
  'voice.pitch.steps': { pattern: 'steps', noteValue: 'quarter', band: 80 },
  'voice.pitch.five-note': { pattern: 'five', noteValue: 'eighth', band: 65 },
  'voice.interval.thirds': { pattern: 'thirds', noteValue: 'eighth', band: 65 },
  'voice.interval.triad': { pattern: 'triad', noteValue: 'quarter', band: 65 },
  'voice.pitch.runs': { pattern: 'run', noteValue: 'eighth', band: 65 },
}

/**
 * A short pattern of notes, sung in one key and then a semitone higher, as far as the range has room.
 * In tiers 0 and 1 the app sings the whole pattern first; from tier 2 on it gives the first note only
 * and the singer reads the rest from the screen.
 *
 * A tempo skill names its pattern in the defaults (so a task that only gives a tempo still gets the
 * skill's own drill); a step skill names it in each step.
 */
export const voicePatternGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Pattern',
  defaults(skill: SkillDef, tempo: number): ExerciseParams {
    if (skill.steps && skill.steps.length > 0) return { tempo, bars: 8, step: 0 }
    return { tempo, bars: 8, ...(DRILLS[skill.id] ?? DRILLS['voice.pitch.steps']) }
  },
  generate(skill: SkillDef, params: ExerciseParams): GeneratedExercise {
    const setup = voiceSetup(skill, params)
    const { content, range, day } = setup
    const pattern = patternOf(content, range.high - range.low)
    // The widest form the range can hold; the forms are listed widest first.
    const notes = pattern.forms.map(offsetsOf)
    const answer = pattern.forms[notes.indexOf(fittingForm(notes, range))]
    const call: Sung[] = skill.tier >= 2 ? [[0, FIRST_NOTE_BEATS]] : answer
    const count = turnsThatFit(setup.bars, turnBars({ call, answer }))
    const homes = homesFor(offsetsOf(answer), range, day, count)
    const b = new VoiceBuilder({ bpm: params.tempo, title: titleOf(skill, setup) })
    writeTurns(b, homes.map((home) => ({ home, call, answer })))
    const chart = b.build(judgeOf(content, { band: 65, minShare: 0.5 }), range, { tonic: homes[0] })
    const noteValue = setup.step ? undefined : (content.noteValue as NoteValue | undefined)
    return sungExercise(ID, skill, setup, chart, { instructions: pattern.instructions, noteValue })
  },
}

/** The notes of a form in semitones above home, without its rests. */
function offsetsOf(form: readonly Sung[]): number[] {
  return form.flatMap(([offset]) => (offset === null ? [] : [offset]))
}
