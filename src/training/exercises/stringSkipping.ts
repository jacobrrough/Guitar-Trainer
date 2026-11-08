import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'stringSkipping'

function defaultBars(noteValue: NoteValue, tempo: number): number {
  return (noteValue === 'quarter' || noteValue === 'eighth') && tempo <= 100 ? 4 : 8
}

export const stringSkippingGenerator: ExerciseGenerator = {
  id: ID,
  name: 'String skipping',
  defaults(_skill, tempo) {
    const noteValue: NoteValue = 'eighth'
    return { tempo, bars: defaultBars(noteValue, tempo), noteValue, position: 5, pattern: 'skip-one' }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'eighth'
    const patternId = params.pattern === 'skip-two' ? 'skip-two' : 'skip-one'
    const gap = patternId === 'skip-two' ? 3 : 2
    const position = Math.max(1, Math.min(20, Math.round(params.position ?? 5)))
    const title = `String skipping (${patternId}) at ${params.tempo} bpm`

    const pairs: Array<Array<[number, number]>> = []
    for (let s = 0; s + gap < tuning.length; s++) {
      const low = position + (s % 3)
      const high = position + 3 - (s % 3)
      pairs.push([
        [s, low],
        [s + gap, high],
        [s, low],
        [s + gap, high],
      ])
    }
    const pattern = [...pairs, ...[...pairs].reverse()].flat()

    const beatsPer = NOTE_VALUE_BEATS[noteValue]
    const builder = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const slots = Math.round((params.bars * builder.beatsPerBar) / beatsPer)
    for (let i = 0; i < slots; i++) {
      const [string, fret] = pattern[i % pattern.length]
      builder.note(i * beatsPer, beatsPer, string, fret)
    }
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: builder.build(params.bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, techniques: 0 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
        `Alternate between two strings ${gap - 1} string${gap === 2 ? '' : 's'} apart, moving the pair across the neck and back. ` +
        'Use strict alternate picking; accuracy and timing are measured.',
    }
  },
}
