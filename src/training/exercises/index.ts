import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { bendTargetsGenerator } from './bendTargets'
import { chordChangesGenerator } from './chordChanges'
import { chromaticGenerator } from './chromatic'
import { firstFretsGenerator } from './firstFrets'
import { legatoLickGenerator } from './legatoLick'
import { melodyGenerator } from './melody'
import { metronomeSteadyGenerator } from './metronomeSteady'
import { openStringsGenerator } from './openStrings'
import { powerChordRiffGenerator } from './powerChordRiff'
import { scaleRunGenerator } from './scaleRun'
import { slideLickGenerator } from './slideLick'
import { stringSkippingGenerator } from './stringSkipping'
import { strumPatternGenerator } from './strumPattern'
import { subdivisionSwitchGenerator } from './subdivisionSwitch'
import { tuneByEarGenerator } from './tuneByEar'

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
  legatoLick: legatoLickGenerator,
  slideLick: slideLickGenerator,
  bendTargets: bendTargetsGenerator,
  tuneByEar: tuneByEarGenerator,
  openStrings: openStringsGenerator,
  firstFrets: firstFretsGenerator,
}

/**
 * Fallbacks for generator ids without a dedicated generator. Every id in the
 * skill taxonomy has one now; the map stays so a future skill can point at a
 * stand-in until its generator exists.
 */
export const GENERATOR_ALIASES: Record<string, string> = {}

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
