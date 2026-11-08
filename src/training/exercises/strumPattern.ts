import { CHORD_SHAPES } from '../../music/chords'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, hashParams } from './builder'

const ID = 'strumPattern'
const DEFAULT_PATTERN = 'D-DU-UDU'

export const strumPatternGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Strum pattern',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 4, noteValue: 'eighth', pattern: DEFAULT_PATTERN, chord: 'G' }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const pattern = (params.pattern as string | undefined) ?? DEFAULT_PATTERN
    const chordName = (params.chord as string | undefined) ?? 'G'
    const bars = params.bars || 4
    const def = CHORD_SHAPES[chordName]
    if (!def) throw new Error(`Unknown chord "${chordName}" in strumPattern`)
    if (!/^[DU-]+$/.test(pattern)) throw new Error(`Invalid strum pattern "${pattern}" (use D, U and -)`)
    const title = `Strum pattern ${pattern} on ${chordName}`
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const upShape = [...def.shape].sort((x, y) => x[0] - y[0]).slice(-4)
    const slots = bars * b.beatsPerBar * 2
    for (let i = 0; i < slots; i++) {
      const c = pattern[i % pattern.length]
      if (c === '-') continue
      if (c === 'D') b.chord(i * 0.5, 0.5, def.shape, chordName)
      else b.chord(i * 0.5, 0.5, upShape, chordName, { velocity: 0.6 })
    }
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue: 'eighth' }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
        `Keep your strumming hand moving in steady eighths on ${chordName}: D is a down strum, U an up strum and - a silent swing. ` +
        `Pattern: ${pattern}.`,
    }
  },
}
