import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'subdivisionSwitch'
const DEFAULT_SEQUENCE: NoteValue[] = ['quarter', 'eighth', 'sixteenth', 'triplet']

export const subdivisionSwitchGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Subdivision switch',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 8, noteValue: 'sixteenth', string: 2, fret: 2, sequence: DEFAULT_SEQUENCE }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const sequence = (params.sequence as NoteValue[] | undefined) ?? DEFAULT_SEQUENCE
    const string = (params.string as number | undefined) ?? 2
    const fret = (params.fret as number | undefined) ?? 2
    const bars = params.bars || 8
    if (sequence.length === 0) throw new Error('subdivisionSwitch needs a non-empty sequence')
    for (const v of sequence) if (!(v in NOTE_VALUE_BEATS)) throw new Error(`Unknown note value "${v}"`)
    const title = `Subdivision switch: ${sequence.join(' / ')}`
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    for (let bar = 0; bar < bars; bar++) {
      const value = sequence[bar % sequence.length]
      const step = NOTE_VALUE_BEATS[value]
      const count = Math.round(b.beatsPerBar / step)
      const perBeat = Math.round(1 / step)
      for (let i = 0; i < count; i++) b.note(b.at(bar, i * step), step, string, fret, { velocity: i % perBeat === 0 ? 0.9 : 0.75 })
    }
    const densest = sequence.reduce((a, c) => (NOTE_VALUE_BEATS[c] < NOTE_VALUE_BEATS[a] ? c : a))
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
      instructions:
        'Play the same note, changing the subdivision each bar: quarters, eighths, sixteenths, then triplets. ' +
        'Keep the beat steady while the note density changes.',
    }
  },
}
