import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'openStrings'

/** Letter names of the open strings in standard tuning, lowest first (used for titles only). */
const STRING_LETTERS = ['E', 'A', 'D', 'G', 'B', 'E']

/** Index into the selected strings for slot `i`: 'alternate' cycles through them, 'down' walks up and back. */
function stringIndex(order: string, count: number, i: number): number {
  if (count <= 1) return 0
  if (order === 'down') {
    const period = 2 * (count - 1)
    const p = i % period
    return p < count ? p : period - p
  }
  return i % count
}

function joinLetters(letters: string[]): string {
  if (letters.length <= 1) return letters[0] ?? ''
  return `${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`
}

/**
 * Tier 0 picking exercise: open strings only, one per slot. 'alternate' cycles
 * the selected strings from the lowest (low E, A, low E, A for two strings);
 * 'down' walks from the lowest selected string up and back again.
 */
export const openStringsGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Open strings',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: 8, noteValue: 'half', strings: 2, order: 'alternate' }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'half'
    const count = Math.max(1, Math.min(6, Math.round((params.strings as number | undefined) ?? 2)))
    const order = (params.order as string | undefined) ?? 'alternate'
    const bars = params.bars || 8
    const title = `Open strings · ${joinLetters(STRING_LETTERS.slice(0, count))}`
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const len = NOTE_VALUE_BEATS[noteValue]
    const slots = Math.floor((bars * b.beatsPerBar) / len + 1e-9)
    for (let i = 0; i < slots; i++) b.note(i * len, len, stringIndex(order, count, i), 0, { velocity: 0.9 })
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions: 'Pick each open string on the beat and let it ring until the next one. Only the picking hand works here; keep the movement small.',
    }
  },
}
