import { CHORD_SHAPES } from '../../music/chords'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, hashParams, pickVariation } from './builder'

const ID = 'chordChanges'

/**
 * Two chords a day for the "open chords" skill, easiest first. Together they cover the eight chords
 * the skill names (E, A, D, G, C, Em, Am, Dm), and each pair is one that songs really use.
 */
const OPEN_CHORD_PAIRS: readonly string[][] = [
  ['Em', 'Am'],
  ['A', 'D'],
  ['E', 'A'],
  ['Am', 'Dm'],
  ['G', 'C'],
  ['D', 'G'],
]

function defaultChords(skill: SkillDef, params: Record<string, unknown> = {}): string[] {
  if (skill.id.includes('barre')) return ['F', 'C']
  if (skill.id.includes('sevenths')) return ['E7', 'A7', 'D7']
  if (skill.id === 'chord.open') return pickVariation(OPEN_CHORD_PAIRS, params)
  return ['Em', 'Am', 'D']
}

export const chordChangesGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Chord changes',
  defaults(skill: SkillDef, tempo: number): ExerciseParams {
    // Learning the shapes: a whole bar on each chord, strummed twice so the second strum shows whether
    // it rings. No chord names here: the day's pair is picked when the exercise is built, from the seed.
    if (skill.id === 'chord.open') return { tempo, bars: 8, noteValue: 'quarter', beatsPerChord: 4, strumsPerChord: 2 }
    return { tempo, bars: 8, noteValue: 'quarter', chords: defaultChords(skill), beatsPerChord: 2 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const chords = (params.chords as string[] | undefined) ?? defaultChords(skill, params)
    const beatsPerChord = (params.beatsPerChord as number | undefined) ?? 2
    const strums = Math.max(1, Math.round(typeof params.strumsPerChord === 'number' ? params.strumsPerChord : 1))
    const bars = params.bars || 8
    if (chords.length === 0) throw new Error('chordChanges needs at least one chord')
    if (!(beatsPerChord > 0)) throw new Error('beatsPerChord must be positive')
    const defs = chords.map((name) => {
      const def = CHORD_SHAPES[name]
      if (!def) throw new Error(`Unknown chord "${name}" in chordChanges`)
      return def
    })
    const held = strums > 1
    const title = `${held ? 'Hold and strum' : 'Chord changes'}: ${chords.join(' - ')}`
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const totalBeats = bars * b.beatsPerBar
    for (let i = 0; i * beatsPerChord < totalBeats - 1e-9; i++) {
      const def = defs[i % defs.length]
      const strumBeats = beatsPerChord / strums
      for (let s = 0; s < strums; s++) {
        const beat = i * beatsPerChord + s * strumBeats
        if (beat < totalBeats - 1e-9) b.chord(beat, strumBeats, def.shape, def.name)
      }
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
      instructions: held
        ? `Strum each chord ${strums === 2 ? 'twice' : `${strums} times`} and let it ring: ${chords.join(', then ')}. ` +
          'Listen on the second strum: every string should sound. You have time before each change, so move all the fingers together.'
        : `Strum each chord once and change on the beat: ${chords.join(', ')}. ` + 'Prepare the next shape early.',
    }
  },
}
