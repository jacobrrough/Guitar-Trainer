import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { chordChangesGenerator } from './chordChanges'
import { chromaticGenerator } from './chromatic'
import { melodyGenerator } from './melody'
import { metronomeSteadyGenerator } from './metronomeSteady'
import { powerChordRiffGenerator } from './powerChordRiff'
import { scaleRunGenerator } from './scaleRun'
import { stringSkippingGenerator } from './stringSkipping'
import { strumPatternGenerator } from './strumPattern'
import { subdivisionSwitchGenerator } from './subdivisionSwitch'

export const GENERATORS: Record<string, ExerciseGenerator> = {
  chromatic: chromaticGenerator,
  melody: melodyGenerator,
  scaleRun: scaleRunGenerator,
  stringSkipping: stringSkippingGenerator,
  chordChanges: chordChangesGenerator,
  strumPattern: strumPatternGenerator,
  powerChordRiff: powerChordRiffGenerator,
  subdivisionSwitch: subdivisionSwitchGenerator,
  metronomeSteady: metronomeSteadyGenerator,
}

/**
 * Generator ids the skill taxonomy refers to that have no dedicated generator
 * yet (Phase 3 in docs/ADAPTIVE_TRAINING.md). They fall back to the closest
 * implemented generator so every skill is always practisable.
 */
export const GENERATOR_ALIASES: Record<string, string> = {
  legatoLick: 'scaleRun',
  slideLick: 'melody',
  bendTargets: 'melody',
  tuneByEar: 'metronomeSteady',
}

export function resolveGeneratorId(id: string): string {
  return GENERATORS[id] ? id : (GENERATOR_ALIASES[id] ?? 'melody')
}

export function getGenerator(id: string): ExerciseGenerator {
  return GENERATORS[resolveGeneratorId(id)]
}

/** Default params for a skill's generator at a tempo, with overrides applied on top. */
export function exerciseParams(skill: SkillDef, generatorId: string, tempo: number, overrides: Partial<ExerciseParams> = {}): ExerciseParams {
  const generator = getGenerator(generatorId)
  return { ...generator.defaults(skill, tempo), ...overrides, tempo }
}

export function generateExercise(skill: SkillDef, generatorId: string, params: ExerciseParams, tuning: number[]): GeneratedExercise {
  return getGenerator(generatorId).generate(skill, params, tuning)
}
