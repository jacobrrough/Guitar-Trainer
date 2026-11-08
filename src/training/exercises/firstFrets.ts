import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'firstFrets'

/** Frets up to 3: back to the open string between every new fret. */
const PATTERN_3 = [0, 1, 0, 2, 0, 3, 0, 1, 2, 3, 3, 2, 1, 0]
/** Frets up to 4: one finger per fret, up and down, then via the open string. */
const PATTERN_4 = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 0, 2, 0, 3, 0, 4]

const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E']

/**
 * Tier 0/1 fretting exercise on a single string: frets 0 to `maxFret` with one
 * finger per fret, returning to the open string so the fretting hand can reset.
 */
export const firstFretsGenerator: ExerciseGenerator = {
  id: ID,
  name: 'First frets',
  defaults(skill: SkillDef, tempo: number): ExerciseParams {
    if (skill.tier === 0) return { tempo, bars: 8, noteValue: 'half', string: 5, maxFret: 3 }
    return { tempo, bars: 8, noteValue: 'quarter', string: 5, maxFret: 4 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'half'
    const string = Math.max(0, Math.min(5, Math.round((params.string as number | undefined) ?? 5)))
    const maxFret = Math.max(1, Math.round((params.maxFret as number | undefined) ?? 3))
    const bars = params.bars || 8
    const pattern = (maxFret >= 4 ? PATTERN_4 : PATTERN_3).map((f) => Math.max(0, Math.min(maxFret, f)))
    const title = `First frets · ${STRING_NAMES[string]} string, frets 0–${Math.min(maxFret, 4)}`
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const len = NOTE_VALUE_BEATS[noteValue]
    const slots = Math.floor((bars * b.beatsPerBar) / len + 1e-9)
    for (let i = 0; i < slots; i++) b.note(i * len, len, string, pattern[i % pattern.length], { velocity: 0.9, finger: pattern[i % pattern.length] > 0 ? ((pattern[i % pattern.length]) as 1 | 2 | 3 | 4) : undefined })
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, bonus: maxFret >= 4 ? 2 : 0 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
        'One finger per fret: index on 1, middle on 2, ring on 3 (little finger on 4). Press just behind the fret wire with the fingertip and let the open string ring between the fretted notes.',
    }
  },
}
