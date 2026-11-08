import { powerChord } from '../../music/chords'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'powerChordRiff'
const BEATS_PER_ROOT = 2
const DEFAULT_ROOTS: Array<{ string: number; fret: number }> = [
  { string: 0, fret: 0 },
  { string: 0, fret: 0 },
  { string: 1, fret: 0 },
  { string: 0, fret: 3 },
]

export const powerChordRiffGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Power chord riff',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 4, noteValue: 'eighth', roots: DEFAULT_ROOTS }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const roots = (params.roots as Array<{ string: number; fret: number }> | undefined) ?? DEFAULT_ROOTS
    const noteValue: NoteValue = params.noteValue ?? 'eighth'
    const bars = params.bars || 4
    if (roots.length === 0) throw new Error('powerChordRiff needs at least one root')
    const step = NOTE_VALUE_BEATS[noteValue]
    const title = 'Palm-muted power chord riff'
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const totalBeats = bars * b.beatsPerBar
    const perRoot = Math.max(1, Math.round(BEATS_PER_ROOT / step))
    for (let r = 0; r * BEATS_PER_ROOT < totalBeats - 1e-9; r++) {
      const root = roots[r % roots.length]
      const shape = powerChord(root.string, root.fret)
      for (let i = 0; i < perRoot; i++) {
        const beat = r * BEATS_PER_ROOT + i * step
        if (beat >= totalBeats - 1e-9) break
        if (i % 4 === 3) b.chord(beat, step, shape, undefined, { velocity: 1 })
        else b.chord(beat, step, shape, undefined, { velocity: 0.8, tech: { palmMute: true } })
      }
    }
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, techniques: 1 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
        'Rest your picking-hand palm on the strings near the bridge and play the muted downstrokes. ' +
        'Let the fourth strum of each group ring out open and accented.',
    }
  },
}
