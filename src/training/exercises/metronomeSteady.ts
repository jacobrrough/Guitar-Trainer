import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, hashParams } from './builder'

const ID = 'metronomeSteady'
const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E']

/** The strings to play, one per bar in turn: `strings` when given, otherwise the single `string`. */
function stringsOf(params: ExerciseParams, tuning: number[]): number[] {
  const valid = (s: unknown): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < tuning.length
  const list = Array.isArray(params.strings) ? params.strings.filter(valid) : []
  if (list.length) return list
  return [valid(params.string) ? params.string : 1]
}

export const metronomeSteadyGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Steady beat',
  defaults(skill: SkillDef, tempo: number): ExerciseParams {
    // Downstrokes are about the picking hand: one bar on each of the four thick strings, so the pick
    // has to find a new string while the beat goes on.
    if (skill.id === 'pick.downstrokes') return { tempo, bars: 8, noteValue: 'quarter', strings: [0, 1, 2, 3], fret: 0 }
    return { tempo, bars: 8, noteValue: 'quarter', string: 1, fret: 0 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const strings = stringsOf(params, tuning)
    const fret = (params.fret as number | undefined) ?? 0
    const bars = params.bars || 8
    const moving = strings.length > 1
    const title = moving ? 'Steady downstrokes, one string per bar' : 'Steady beat'
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    for (let beat = 0; beat < bars * b.beatsPerBar; beat++) {
      const string = strings[Math.floor(beat / b.beatsPerBar) % strings.length]
      b.note(beat, 1, string, fret, { velocity: 0.9 })
    }
    const names = tuning.length === STRING_NAMES.length ? ` (${strings.map((s) => STRING_NAMES[s]).join(', ')})` : ''
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
      instructions: moving
        ? `Play one note on every click, always picking downwards. Each bar is on a new string${names}: move to it without stopping the beat.`
        : 'Play one note exactly on every click. Aim to land right on the beat, neither rushing nor dragging.',
    }
  },
}
