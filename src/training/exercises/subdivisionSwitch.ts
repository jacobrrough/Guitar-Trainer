import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'subdivisionSwitch'

/**
 * What one bar plays: an even note value, or one of two rhythms that leave the beat.
 * 'offbeat' plays only between the beats (the "and" of every beat).
 * 'tied' is "1, 2 and (3) and 4": the note on the "and" of 2 is held over beat 3.
 */
type BarRhythm = NoteValue | 'offbeat' | 'tied'

/** [beat in the bar, length in beats] of every note of the two off-beat bars. */
const OFF_BEAT_BARS: Record<'offbeat' | 'tied', Array<[number, number]>> = {
  offbeat: [[0.5, 0.5], [1.5, 0.5], [2.5, 0.5], [3.5, 0.5]],
  tied: [[0, 1], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
}

const DEFAULT_SEQUENCE: BarRhythm[] = ['quarter', 'eighth', 'sixteenth', 'triplet']
// Even eighths first, so the hand is already swinging down and up when the beats drop out.
const SYNCOPATION_SEQUENCE: BarRhythm[] = ['eighth', 'offbeat', 'eighth', 'tied']
// Triplets come before sixteenth notes in the skill tree: one bar on the beat, one bar in threes.
const TRIPLET_SEQUENCE: BarRhythm[] = ['quarter', 'triplet']

const isOffBeatBar = (v: BarRhythm): v is 'offbeat' | 'tied' => v === 'offbeat' || v === 'tied'

function defaultSequence(skill: SkillDef): BarRhythm[] {
  if (skill.id === 'rhythm.syncopation') return SYNCOPATION_SEQUENCE
  if (skill.id === 'rhythm.triplets') return TRIPLET_SEQUENCE
  return DEFAULT_SEQUENCE
}

/** The note value a bar is as dense as, for the difficulty. */
const densityOf = (v: BarRhythm): NoteValue => (isOffBeatBar(v) ? 'eighth' : v)

const BAR_NAMES: Record<BarRhythm, string> = {
  whole: 'one long note',
  half: 'two notes a bar',
  quarter: 'one note per beat',
  eighth: 'two notes per beat',
  triplet: 'three notes per beat',
  sixteenth: 'four notes per beat',
  offbeat: 'only the notes between the beats',
  tied: 'a note held over beat 3',
}

export const subdivisionSwitchGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Subdivision switch',
  defaults(skill: SkillDef, tempo: number): ExerciseParams {
    const sequence = defaultSequence(skill)
    const densest = sequence.map(densityOf).reduce((a, c) => (NOTE_VALUE_BEATS[c] < NOTE_VALUE_BEATS[a] ? c : a))
    return { tempo, bars: 8, noteValue: densest, string: 2, fret: 2, sequence }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const sequence = (params.sequence as BarRhythm[] | undefined) ?? defaultSequence(skill)
    const string = (params.string as number | undefined) ?? 2
    const fret = (params.fret as number | undefined) ?? 2
    const bars = params.bars || 8
    if (sequence.length === 0) throw new Error('subdivisionSwitch needs a non-empty sequence')
    for (const v of sequence) if (!(v in NOTE_VALUE_BEATS) && !isOffBeatBar(v)) throw new Error(`Unknown note value "${v}"`)
    const offBeat = sequence.some(isOffBeatBar)
    const title = offBeat ? 'Off-beat rhythm' : `Subdivision switch: ${sequence.join(' / ')}`
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    for (let bar = 0; bar < bars; bar++) {
      const value = sequence[bar % sequence.length]
      if (isOffBeatBar(value)) {
        for (const [beat, length] of OFF_BEAT_BARS[value]) b.note(b.at(bar, beat), length, string, fret, { velocity: Number.isInteger(beat) ? 0.9 : 0.8 })
        continue
      }
      const step = NOTE_VALUE_BEATS[value]
      const count = Math.round(b.beatsPerBar / step)
      const perBeat = Math.round(1 / step)
      for (let i = 0; i < count; i++) b.note(b.at(bar, i * step), step, string, fret, { velocity: i % perBeat === 0 ? 0.9 : 0.75 })
    }
    const densest = sequence.map(densityOf).reduce((a, c) => (NOTE_VALUE_BEATS[c] < NOTE_VALUE_BEATS[a] ? c : a))
    const plan = sequence.map((v) => BAR_NAMES[v]).join(', then ')
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue: densest }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions: offBeat
        ? `Play the same note with a new rhythm each bar: ${plan}. ` +
          'Keep your picking hand swinging down and up in even eighths all the time, and simply miss the string where there is no note.'
        : `Play the same note and change how many notes fit in a beat each bar: ${plan}. ` + 'Keep the beat steady while the notes get closer together or further apart.',
    }
  },
}
