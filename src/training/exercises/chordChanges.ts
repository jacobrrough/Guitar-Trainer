import { CHORD_SHAPES } from '../../music/chords'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, hashParams } from './builder'

const ID = 'chordChanges'

function defaultChords(skill: SkillDef): string[] {
  if (skill.id.includes('barre')) return ['F', 'C']
  if (skill.id.includes('sevenths')) return ['E7', 'A7', 'D7']
  return ['Em', 'Am', 'D']
}

export const chordChangesGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Chord changes',
  defaults(skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 8, noteValue: 'quarter', chords: defaultChords(skill), beatsPerChord: 2 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const chords = (params.chords as string[] | undefined) ?? defaultChords(skill)
    const beatsPerChord = (params.beatsPerChord as number | undefined) ?? 2
    const bars = params.bars || 8
    if (chords.length === 0) throw new Error('chordChanges needs at least one chord')
    if (!(beatsPerChord > 0)) throw new Error('beatsPerChord must be positive')
    const defs = chords.map((name) => {
      const def = CHORD_SHAPES[name]
      if (!def) throw new Error(`Unknown chord "${name}" in chordChanges`)
      return def
    })
    const title = `Chord changes: ${chords.join(' - ')}`
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const totalBeats = bars * b.beatsPerBar
    for (let i = 0; i * beatsPerChord < totalBeats - 1e-9; i++) {
      const def = defs[i % defs.length]
      b.chord(i * beatsPerChord, beatsPerChord, def.shape, def.name)
    }
    let bonus = 0
    if (defs.some((d) => d.difficulty === 4)) bonus += 10
    if (defs.some((d) => d.difficulty === 3)) bonus += 4
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue: 'quarter', bonus }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions: `Strum each chord once and change on the beat: ${chords.join(', ')}. ` + 'Prepare the next shape early.',
    }
  },
}
