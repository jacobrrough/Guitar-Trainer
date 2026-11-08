import { SCALE_INTERVALS, pitchClassOf } from '../../music/scales'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, hashParams } from './builder'

const ID = 'bendTargets'
const SPAN = 5

interface Candidate {
  string: number
  fret: number
}

function modeOf(params: ExerciseParams): 'bend' | 'vibrato' {
  return params.mode === 'vibrato' ? 'vibrato' : 'bend'
}

function stringsOf(params: ExerciseParams, tuning: number[]): number[] {
  const raw = params.strings
  const list = Array.isArray(raw)
    ? raw.filter((s): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < tuning.length)
    : []
  return list.length ? list : [3, 4].filter((s) => s < tuning.length)
}

/**
 * Frets within the position window on `string` that are minor-pentatonic tones
 * of `key`; with `needTarget` the bent target (fret + semis) must be one too.
 */
function candidatesFor(string: number, key: string, position: number, semis: number, tuning: number[], needTarget: boolean): Candidate[] {
  const rootPc = pitchClassOf(key)
  const pcs = new Set(SCALE_INTERVALS['minor-pentatonic'].map((i) => (rootPc + i) % 12))
  const out: Candidate[] = []
  for (let fret = position; fret <= position + SPAN; fret++) {
    if (fret + semis > 24) continue
    if (!pcs.has((tuning[string] + fret) % 12)) continue
    if (needTarget && !pcs.has((tuning[string] + fret + semis) % 12)) continue
    out.push({ string, fret })
  }
  return out
}

function bendPool(strings: number[], key: string, position: number, semis: number, tuning: number[]): Candidate[] {
  const strict = strings.flatMap((s) => candidatesFor(s, key, position, semis, tuning, true))
  if (strict.length) return strict
  const loose = strings.flatMap((s) => candidatesFor(s, key, position, semis, tuning, false))
  if (loose.length) return loose
  return strings.map((string) => ({ string, fret: Math.min(position, 24 - semis) }))
}

/** Bend targets (play the target, then bend up to it) and vibrato control. */
export const bendTargetsGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Bend targets',
  defaults(skill, tempo) {
    if (skill.id === 'lead.vibrato') {
      return { tempo, bars: 4, noteValue: 'quarter', key: 'A', position: 5, mode: 'vibrato' }
    }
    return { tempo, bars: 4, noteValue: 'quarter', key: 'A', position: 5, mode: 'bend', bendSemis: 2, strings: [3, 4] }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue: NoteValue = params.noteValue ?? 'quarter'
    const key = params.key ?? 'A'
    const position = Math.max(0, Math.min(24 - SPAN, Math.round(params.position ?? 5)))
    const mode = modeOf(params)
    const strings = stringsOf(params, tuning)
    const bendSemis = params.bendSemis === 1 ? 1 : 2
    const bars = Math.max(1, Math.round(params.bars))
    const builder = new ChartBuilder({ bpm: params.tempo, tuning })

    let title: string
    let instructions: string
    let bonus = 0
    if (mode === 'vibrato') {
      title = `Vibrato · ${key} minor pentatonic, position ${position}`
      instructions =
        'Hold each note and add a steady, even vibrato by rocking your wrist; stay centred on the true pitch.'
      const lanes = [strings[0], strings[1] ?? strings[0]]
      const pools = lanes.map((s) => candidatesFor(s, key, position, 0, tuning, false))
      for (let bar = 0; bar < bars; bar++) {
        for (let half = 0; half < 2; half++) {
          const pool = pools[half]
          const c = pool.length ? pool[(bar * 2 + half) % pool.length] : { string: lanes[half], fret: position }
          builder.note(builder.at(bar, half * 2), 2, c.string, c.fret, { tech: { vibrato: true } })
        }
      }
    } else {
      const step = bendSemis === 2 ? 'Whole-step' : 'Half-step'
      title = `${step} bends · ${key} minor pentatonic, position ${position}`
      instructions = 'Play the target fret first, then bend from two frets below until the pitch matches it; hold it steady.'
      if (bendSemis === 1) instructions = instructions.replace('two frets', 'one fret')
      bonus = bendSemis === 2 ? 3 : 0
      const pool = bendPool(strings, key, position, bendSemis, tuning)
      for (let bar = 0; bar < bars; bar++) {
        const c = pool[bar % pool.length]
        builder.note(builder.at(bar, 0), 1, c.string, c.fret + bendSemis)
        builder.note(builder.at(bar, 1), 2, c.string, c.fret, { tech: { bend: true } })
      }
    }
    const chart = builder.build(bars)
    chart.title = title
    if (mode === 'bend') {
      // The scorer judges a bend note on the reached pitch, not the fret's pitch.
      for (const n of chart.notes) if (n.tech?.bend) n.midi += bendSemis
    }
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart,
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, techniques: 1, bonus }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions,
    }
  },
}
