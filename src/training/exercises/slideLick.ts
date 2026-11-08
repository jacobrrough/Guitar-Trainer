import { SCALE_INTERVALS, pitchClassOf } from '../../music/scales'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams } from './builder'

const ID = 'slideLick'

/**
 * Slide licks: each bar sits on one string and moves between two hand positions
 * (`position` and `position + distance + 2`). Slide-in targets carry `slideIn`
 * (the start pitch below is not charted), a held slide-out note carries
 * `slideOut` and is followed by a rest of one note value. Other notes are
 * minor pentatonic in the key.
 */
export const slideLickGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Slide lick',
  defaults(_skill, tempo) {
    return { tempo, bars: 4, noteValue: 'quarter', key: 'A', position: 5, distance: 2, strings: 2 }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'quarter'
    const key = params.key ?? 'A'
    const position = Math.max(0, Math.round(params.position ?? 5))
    const distance = Math.max(1, Math.round(typeof params.distance === 'number' ? params.distance : 2))
    const strings = Math.max(1, Math.min(tuning.length, Math.round(typeof params.strings === 'number' ? params.strings : 2)))
    const hiPosition = position + distance + 2
    const maxFret = Math.min(24, position + distance + 7)
    const title = `Slides · ${key} minor pentatonic, positions ${position} and ${hiPosition}`

    const keyPc = pitchClassOf(key)
    const pcs = new Set(SCALE_INTERVALS['minor-pentatonic'].map((i) => (keyPc + i) % 12))
    /** Pentatonic frets on a string within a four-fret window starting at `start`. */
    const pool = (string: number, start: number): number[] => {
      const frets: number[] = []
      for (let f = start; f <= Math.min(start + 4, maxFret); f++) if (pcs.has((tuning[string] + f) % 12)) frets.push(f)
      return frets
    }

    const beatsPer = NOTE_VALUE_BEATS[noteValue]
    const builder = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const slots = Math.max(4, Math.round(builder.beatsPerBar / beatsPer))
    for (let bar = 0; bar < params.bars; bar++) {
      const string = tuning.length - 1 - (bar % strings)
      const flip = bar % 2 === 1
      const first = pool(string, flip ? hiPosition : position)
      const second = pool(string, flip ? position : hiPosition)
      for (let s = 0; s < slots - 1; s++) {
        const frets = s < slots / 2 ? first : second
        const fret = frets[(s % (slots / 2)) % frets.length]
        const onBeat = s * beatsPer === Math.floor(s * beatsPer)
        const out = s === slots - 2
        const slideIn = !out && onBeat && s % 2 === 0
        const tech = out ? { slideOut: true } : slideIn ? { slideIn: true } : undefined
        builder.note(builder.at(bar, s * beatsPer), beatsPer, string, fret, { tech })
      }
    }

    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: builder.build(params.bars),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue, techniques: 1, bonus: distance > 2 ? 2 : 0 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions:
        'Slide into the marked notes and glide out of the held ones, moving between the two hand positions on each string. ' +
        'Arrive on the beat; start a slide-in two or three frets below the target.',
    }
  },
}
