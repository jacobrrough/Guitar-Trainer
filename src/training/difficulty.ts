import { DENSITY_BONUS, TECHNIQUE_BONUS, TEMPO_DIFFICULTY_SLOPE, TIER_BASE } from './constants'
import type { NoteValue, SkillDef } from './types'

export interface DifficultyInput {
  tempo: number
  noteValue?: NoteValue
  /** Number of distinct techniques present (bend, slide, hammer/pull, palm mute). */
  techniques?: number
  /** Extra points, e.g. +10 for barre chord shapes. */
  bonus?: number
}

/**
 * Item difficulty d on the same 0–100 scale as skill ratings (docs §4.2):
 * tier base + 30·log2(tempo / refTempo) + density bonus + 5 per technique.
 */
export function itemDifficulty(skill: Pick<SkillDef, 'tier' | 'refTempo'>, input: DifficultyInput): number {
  const tempo = Math.max(1, input.tempo)
  const d =
    TIER_BASE[skill.tier] +
    TEMPO_DIFFICULTY_SLOPE * Math.log2(tempo / skill.refTempo) +
    DENSITY_BONUS[input.noteValue ?? 'quarter'] +
    TECHNIQUE_BONUS * (input.techniques ?? 0) +
    (input.bonus ?? 0)
  return Math.round(Math.max(0, Math.min(100, d)) * 10) / 10
}
