import { pitchClassOf, SCALE_INTERVALS } from '../../music/scales'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'legatoLick'

/** Legato cell shapes: hammer-on + pull-off, double hammer-on + pull-offs, or a one-beat trill. */
type LegatoPattern = 'hp' | 'hhp' | 'trill'

interface CellNote {
  fret: number
  tech: 'pick' | 'hammerOn' | 'pullOff'
}

function patternOf(params: ExerciseParams): LegatoPattern {
  return params.pattern === 'hhp' || params.pattern === 'trill' ? params.pattern : 'hp'
}

/** Minor pentatonic frets on one string inside the hand position window (position .. position + 5). */
function tonesOnString(openMidi: number, rootPc: number, position: number): number[] {
  const pcs = new Set(SCALE_INTERVALS['minor-pentatonic'].map((i) => (rootPc + i) % 12))
  const frets: number[] = []
  for (let fret = position; fret <= position + 5 && fret <= 24; fret++) {
    if (pcs.has((openMidi + fret) % 12)) frets.push(fret)
  }
  return frets
}

function cellFor(pattern: LegatoPattern, tones: number[], slotsPerBeat: number): CellNote[] {
  const [a, b, c] = tones
  if (pattern === 'hhp' && c !== undefined && c - a <= 5) {
    return [
      { fret: a, tech: 'pick' },
      { fret: b, tech: 'hammerOn' },
      { fret: c, tech: 'hammerOn' },
      { fret: b, tech: 'pullOff' },
      { fret: a, tech: 'pullOff' },
    ]
  }
  if (pattern === 'trill') {
    const cell: CellNote[] = [{ fret: a, tech: 'pick' }]
    const length = Math.max(2, slotsPerBeat)
    for (let i = 1; i < length; i++) cell.push(i % 2 === 1 ? { fret: b, tech: 'hammerOn' } : { fret: a, tech: 'pullOff' })
    return cell
  }
  // 'hp', and 'hhp' on strings without three tones in reach, fall back to the 3-note cell.
  return [
    { fret: a, tech: 'pick' },
    { fret: b, tech: 'hammerOn' },
    { fret: a, tech: 'pullOff' },
  ]
}

/**
 * Legato lick generator: minor pentatonic cells played with one pick attack
 * followed by hammer-ons and pull-offs, walked across the top strings and back.
 */
export const legatoLickGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Legato lick',
  defaults(_skill, tempo) {
    return { tempo, bars: 4, noteValue: 'eighth', key: 'A', position: 5, pattern: 'hp', strings: 2 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'eighth'
    const key = params.key ?? 'A'
    const position = Math.max(0, Math.round(params.position ?? 5))
    const pattern = patternOf(params)
    const requested = typeof params.strings === 'number' ? Math.round(params.strings) : 2
    const stringCount = Math.max(1, Math.min(tuning.length, requested))
    const title = `Legato cell · ${key} minor pentatonic, position ${position}`

    const rootPc = pitchClassOf(key)
    const top = tuning.length - 1
    const used: number[] = []
    for (let s = top - stringCount + 1; s <= top; s++) used.push(s)
    // Walk up the chosen strings and back down without repeating the end strings.
    const walk = [...used, ...[...used].reverse().slice(1, -1)]

    const beatsPer = NOTE_VALUE_BEATS[noteValue]
    const slotsPerBeat = Math.round(1 / beatsPer)
    const builder = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const slots = Math.round((params.bars * builder.beatsPerBar) / beatsPer)

    let slot = 0
    for (let c = 0; slot < slots; c++) {
      const string = walk[c % walk.length]
      const cell = cellFor(pattern, tonesOnString(tuning[string], rootPc, position), slotsPerBeat)
      for (const n of cell) {
        if (slot >= slots) break
        const tech = n.tech === 'pick' ? undefined : { [n.tech]: true }
        builder.note(slot * beatsPer, beatsPer, string, n.fret, { velocity: n.tech === 'pick' ? 0.9 : 0.7, tech })
        slot++
      }
    }

    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: builder.build(params.bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, techniques: pattern === 'hp' ? 1 : 2 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
        'Pick only the first note of each group and sound the rest with hammer-ons and pull-offs from your fretting hand. ' +
        'Keep the legato notes as loud and even as the picked one, and stay on the click.',
    }
  },
}
