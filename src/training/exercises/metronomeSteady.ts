import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, hashParams } from './builder'

const ID = 'metronomeSteady'

export const metronomeSteadyGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Steady beat',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 8, noteValue: 'quarter', string: 1, fret: 0 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const string = (params.string as number | undefined) ?? 1
    const fret = (params.fret as number | undefined) ?? 0
    const bars = params.bars || 8
    const title = 'Steady beat'
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    for (let beat = 0; beat < bars * b.beatsPerBar; beat++) b.note(beat, 1, string, fret, { velocity: 0.9 })
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue: 'quarter' }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions: 'Play one note exactly on every click. Aim to land right on the beat, neither rushing nor dragging.',
    }
  },
}
