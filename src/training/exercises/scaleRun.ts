import { NOTE_NAMES } from '../../music/pitch'
import { SCALE_INTERVALS, pentatonicBox, pitchClassOf, scalePositions } from '../../music/scales'
import type { ScaleId } from '../../music/scales'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'scaleRun'

function defaultNoteValue(skill: SkillDef): NoteValue {
  return /alternate|pent|chromatic/.test(skill.id) ? 'eighth' : 'quarter'
}

function defaultBars(noteValue: NoteValue, tempo: number): number {
  return (noteValue === 'quarter' || noteValue === 'eighth') && tempo <= 100 ? 4 : 8
}

function scaleOf(params: ExerciseParams): ScaleId {
  const s = params.scale
  return typeof s === 'string' && s in SCALE_INTERVALS ? (s as ScaleId) : 'minor-pentatonic'
}

export const scaleRunGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Scale run',
  defaults(skill, tempo) {
    const noteValue = defaultNoteValue(skill)
    return { tempo, bars: defaultBars(noteValue, tempo), noteValue, position: 5, key: 'A', scale: 'minor-pentatonic', box: 1 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'quarter'
    const key = params.key ?? 'A'
    const scale = scaleOf(params)
    const box = ([1, 2, 3, 4, 5] as const).find((b) => b === params.box) ?? 1
    const title = `Scale run ${key} ${scale} at ${params.tempo} bpm`

    let source: Array<{ string: number; fret: number; midi: number }>
    if (scale === 'minor-pentatonic' || scale === 'major-pentatonic') {
      const minorRoot = scale === 'minor-pentatonic' ? key : NOTE_NAMES[(pitchClassOf(key) + 9) % 12]
      source = pentatonicBox(minorRoot, box, tuning).notes
    } else {
      source = scalePositions(key, scale, Math.round(params.position ?? 5), tuning)
    }
    const up = source.filter((n, i) => i === 0 || n.midi !== source[i - 1].midi)
    const pattern = [...up, ...[...up].reverse().slice(1, -1)]

    const beatsPer = NOTE_VALUE_BEATS[noteValue]
    const builder = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const slots = Math.round((params.bars * builder.beatsPerBar) / beatsPer)
    for (let i = 0; i < slots; i++) {
      const n = pattern[i % pattern.length]
      builder.note(i * beatsPer, beatsPer, n.string, n.fret)
    }
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
        `Play the ${key} ${scale} scale up and back down in one hand position, keeping to the click. ` +
        'Pitch accuracy and timing are measured.',
    }
  },
}
