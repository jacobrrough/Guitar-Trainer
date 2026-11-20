import { NOTE_NAMES } from '../../music/pitch'
import { SCALE_INTERVALS, pentatonicBox, pitchClassOf, scalePositions } from '../../music/scales'
import type { ScaleId } from '../../music/scales'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams, pickVariation } from './builder'

const ID = 'scaleRun'

type Box = 1 | 2 | 3 | 4 | 5
const BOXES: readonly Box[] = [1, 2, 3, 4, 5]
/** The boxes the "boxes 2 to 5" skill is about, one per practice day. */
const OTHER_BOXES: readonly Box[] = [2, 3, 4, 5]

function defaultNoteValue(skill: SkillDef): NoteValue {
  return /alternate|pent|chromatic|scale/.test(skill.id) ? 'eighth' : 'quarter'
}

/** The box asked for; the "boxes 2 to 5" skill walks through its four boxes by seed, everything else is box 1. */
function boxOf(skill: SkillDef, params: ExerciseParams): Box {
  const asked = BOXES.find((b) => b === params.box)
  if (asked) return asked
  return skill.id === 'lead.pent-boxes' ? pickVariation(OTHER_BOXES, params) : 1
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
    const base = { tempo, bars: defaultBars(noteValue, tempo), noteValue, key: 'A' }
    // A major with the root where box 1 has it (low E string, fret 5): frets 4 to 7, one finger per fret.
    if (skill.id === 'lead.major-scale') return { ...base, position: 4, span: 3, scale: 'major' }
    // No box here: which of boxes 2 to 5 is shown is picked when the exercise is built, from the seed.
    if (skill.id === 'lead.pent-boxes') return { ...base, position: 5, scale: 'minor-pentatonic' }
    return { ...base, position: 5, scale: 'minor-pentatonic', box: 1 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'quarter'
    const key = params.key ?? 'A'
    const scale = scaleOf(params)
    const box = boxOf(skill, params)
    const pentatonic = scale === 'minor-pentatonic' || scale === 'major-pentatonic'
    const scaleName = scale.replace('-', ' ')
    const title = `Scale run ${key} ${scaleName}${pentatonic ? `, box ${box}` : ''} at ${params.tempo} bpm`

    let up: Array<{ string: number; fret: number; midi: number }>
    if (pentatonic) {
      const minorRoot = scale === 'minor-pentatonic' ? key : NOTE_NAMES[(pitchClassOf(key) + 9) % 12]
      const found = pentatonicBox(minorRoot, box, tuning).notes
      // A box that starts at fret 12 or above is out of reach on most acoustic guitars: play the same
      // shape twelve frets lower, where it is the same notes an octave down.
      const drop = Math.min(...found.map((n) => n.fret)) >= 12 ? 12 : 0
      const source = found.map((n) => ({ string: n.string, fret: n.fret - drop, midi: n.midi - drop }))
      up = source.filter((n, i) => i === 0 || n.midi !== source[i - 1].midi)
    } else {
      const span = Math.max(2, Math.min(5, Math.round(typeof params.span === 'number' ? params.span : 4)))
      const source = scalePositions(key, scale, Math.round(params.position ?? 5), tuning, span)
      // One place per pitch: the lower fret, so the hand never stretches for a note it has under the first finger.
      const byPitch = new Map<number, (typeof source)[number]>()
      for (const n of source) {
        const kept = byPitch.get(n.midi)
        if (!kept || n.fret < kept.fret) byPitch.set(n.midi, n)
      }
      const all = [...byPitch.values()].sort((a, b) => a.midi - b.midi)
      // Start on the root and turn round on the root, so the run sounds finished.
      const rootPc = pitchClassOf(key)
      const roots = all.map((n, i) => (n.midi % 12 === rootPc ? i : -1)).filter((i) => i >= 0)
      up = roots.length >= 2 ? all.slice(roots[0], roots[roots.length - 1] + 1) : all
    }
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
        `Play the ${key} ${scaleName} scale${pentatonic ? ` (box ${box})` : ''} up and back down in one hand position, keeping to the click. ` +
        'The right notes, played on the beat, are what count.',
    }
  },
}
