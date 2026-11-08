import { SCALE_INTERVALS, pitchClassOf, scalePositions } from '../../music/scales'
import type { ScaleId } from '../../music/scales'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'melody'

function defaultBars(noteValue: NoteValue, tempo: number): number {
  return (noteValue === 'quarter' || noteValue === 'eighth') && tempo <= 100 ? 4 : 8
}

/** Small deterministic LCG returning floats in [0, 1). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export const melodyGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Melody',
  defaults(_skill, tempo) {
    const noteValue: NoteValue = 'quarter'
    return { tempo, bars: defaultBars(noteValue, tempo), noteValue, position: 0, key: 'A', scale: 'major' }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'quarter'
    const key = params.key ?? 'A'
    const scale: ScaleId = typeof params.scale === 'string' && params.scale in SCALE_INTERVALS ? (params.scale as ScaleId) : 'major'
    const position = Math.max(0, Math.round(params.position ?? 0))
    const title = `Melody in ${key} ${scale} at ${params.tempo} bpm`

    // One fingering per pitch, ascending.
    const all = scalePositions(key, scale, position, tuning)
    const pool = all.filter((n, i) => i === 0 || n.midi !== all[i - 1].midi)
    const keyPc = pitchClassOf(key)

    const rng = makeRng(parseInt(hashParams(params), 36))
    const beatsPer = NOTE_VALUE_BEATS[noteValue]
    const builder = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const slots = Math.max(2, Math.round((params.bars * builder.beatsPerBar) / beatsPer))

    const rootIdx = pool.map((n, i) => ({ n, i })).filter(({ n }) => n.midi % 12 === keyPc)
    const lo = Math.floor(pool.length * 0.2)
    const hi = Math.ceil(pool.length * 0.8) - 1
    const mid = Math.floor((lo + hi) / 2)
    let idx = rootIdx.length ? rootIdx.reduce((a, b) => (Math.abs(b.i - mid) < Math.abs(a.i - mid) ? b : a)).i : mid
    let dir = 1
    const seq: number[] = [idx]
    for (let i = 1; i < slots - 1; i++) {
      if (rng() < 0.3) dir = -dir
      const step = rng() < 0.2 ? 2 : 1
      let next = idx + dir * step
      if (next > hi || next < lo) {
        dir = -dir
        next = idx + dir * step
      }
      idx = Math.max(0, Math.min(pool.length - 1, next))
      seq.push(idx)
    }
    const last = rootIdx.length ? rootIdx.reduce((a, b) => (Math.abs(b.i - idx) < Math.abs(a.i - idx) ? b : a)).i : idx
    seq.push(last)
    seq.forEach((pi, i) => builder.note(i * beatsPer, beatsPer, pool[pi].string, pool[pi].fret))
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: builder.build(params.bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, techniques: 0 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
      `Play this short ${key} ${scale} melody; it moves mostly by step and finishes on the root. ` +
      'Pitch accuracy and timing are measured.',
    }
  },
}
