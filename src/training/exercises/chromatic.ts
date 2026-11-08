import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'chromatic'

function defaultNoteValue(skill: SkillDef): NoteValue {
  return /alternate|pent|chromatic/.test(skill.id) ? 'eighth' : 'quarter'
}

function defaultBars(noteValue: NoteValue, tempo: number): number {
  return (noteValue === 'quarter' || noteValue === 'eighth') && tempo <= 100 ? 4 : 8
}

export const chromaticGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Chromatic 1-2-3-4',
  defaults(skill, tempo) {
    const noteValue = defaultNoteValue(skill)
    return { tempo, bars: defaultBars(noteValue, tempo), noteValue, position: 1, strings: 6 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'quarter'
    const requested = typeof params.strings === 'number' ? Math.round(params.strings) : tuning.length
    const stringCount = Math.max(1, Math.min(tuning.length, requested))
    const position = Math.max(1, Math.min(21, Math.round(params.position ?? 1)))
    const beatsPer = NOTE_VALUE_BEATS[noteValue]
    const builder = new ChartBuilder({ bpm: params.tempo, tuning, title: `Chromatic 1-2-3-4 at ${params.tempo} bpm` })

    const up: Array<[number, number]> = []
    for (let s = 0; s < stringCount; s++) for (let f = 0; f < 4; f++) up.push([s, position + f])
    const pattern = [...up, ...[...up].reverse()]

    const slots = Math.round((params.bars * builder.beatsPerBar) / beatsPer)
    for (let i = 0; i < slots; i++) {
      const [string, fret] = pattern[i % pattern.length]
      builder.note(i * beatsPer, beatsPer, string, fret)
    }
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title: `Chromatic 1-2-3-4 at ${params.tempo} bpm`,
      chart: builder.build(params.bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, techniques: 0 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
        'Play one finger per fret (1-2-3-4) on each string, climbing from the low string to the high string and back down. ' +
        'Your note accuracy and timing against the click are measured.',
    }
  },
}
