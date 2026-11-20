import { SCALE_INTERVALS, pitchClassOf, scalePositions } from '../../music/scales'
import type { ScaleId, ScaleNote } from '../../music/scales'
import { BACKING_SAMPLE_RATE } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, NoteValue, SkillDef } from '../types'
import { ChartBuilder, NOTE_VALUE_BEATS, hashParams, variationOf } from './builder'

const ID = 'melody'
const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high E']

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

function wholeNumber(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(lo, Math.min(hi, n))
}

/**
 * The scale notes one hand position offers on the `strings` thinnest strings, lowest pitch first.
 * A pitch that can be played in two places is written at the lower fret, so an open string is
 * never shown as a stretch on the string below it.
 */
function notesInReach(key: string, scale: ScaleId, position: number, span: number, strings: number, tuning: number[]): ScaleNote[] {
  const all = scalePositions(key, scale, position, tuning, span)
  const pick = (from: ScaleNote[]): ScaleNote[] => {
    const byPitch = new Map<number, ScaleNote>()
    for (const n of from) {
      const kept = byPitch.get(n.midi)
      if (!kept || n.fret < kept.fret) byPitch.set(n.midi, n)
    }
    return [...byPitch.values()].sort((a, b) => a.midi - b.midi)
  }
  const wanted = pick(all.filter((n) => n.string >= tuning.length - strings))
  // A tuning or scale that leaves fewer than two notes on those strings: use the whole position instead.
  return wanted.length >= 2 ? wanted : pick(all)
}

/** Index of the note closest in pitch to `midi` (the lower one on a tie); -1 when none passes `only`. */
function closest(pool: ScaleNote[], midi: number, only: (n: ScaleNote) => boolean = () => true): number {
  let best = -1
  for (let i = 0; i < pool.length; i++) {
    if (!only(pool[i])) continue
    if (best < 0 || Math.abs(pool[i].midi - midi) < Math.abs(pool[best].midi - midi)) best = i
  }
  return best
}

/** The part of a pool the tune moves in: all of a small one, the middle of a large one. */
function walkRange(pool: ScaleNote[]): [number, number] {
  if (pool.length <= 8) return [0, pool.length - 1]
  return [Math.floor(pool.length * 0.2), Math.ceil(pool.length * 0.8) - 1]
}

export const melodyGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Melody',
  defaults(skill, tempo) {
    const noteValue: NoteValue = 'quarter'
    const base = { tempo, bars: defaultBars(noteValue, tempo), noteValue, position: 0 }
    // The skill is one string: E, F sharp and G on the thin E string, frets 0, 2 and 3.
    if (skill.id === 'fret.single-string') return { ...base, key: 'G', scale: 'major', span: 3, strings: 1 }
    // The hand moves between the open position and the fifth fret, one bar in each.
    if (skill.id === 'fret.shifts') return { ...base, key: 'C', scale: 'major', span: 3, strings: 3, shiftTo: 5 }
    // First melodies: C major has no sharps and sits in frets 0 to 3 on the three thin strings.
    if (skill.tier <= 1) return { ...base, key: 'C', scale: 'major', span: 3, strings: 3 }
    return { ...base, key: 'A', scale: 'major' }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const noteValue = params.noteValue ?? 'quarter'
    const key = params.key ?? 'A'
    const scale: ScaleId = typeof params.scale === 'string' && params.scale in SCALE_INTERVALS ? (params.scale as ScaleId) : 'major'
    const position = wholeNumber(params.position, 0, 0, 20)
    const span = wholeNumber(params.span, 4, 2, 5)
    const strings = wholeNumber(params.strings, tuning.length, 1, tuning.length)
    const shiftTo = typeof params.shiftTo === 'number' ? wholeNumber(params.shiftTo, position, 0, 20) : position
    const scaleName = scale.replace('-', ' ')
    const title = `Melody in ${key} ${scaleName} at ${params.tempo} bpm`

    const places = shiftTo === position ? [position] : [position, shiftTo]
    const pools = places.map((p) => notesInReach(key, scale, p, span, strings, tuning))
    const keyPc = pitchClassOf(key)
    const isRoot = (n: ScaleNote) => n.midi % 12 === keyPc

    // The tune depends on what is played, never on how fast: a round repeated at a new tempo is the same tune.
    const tune = { key, scale, position, span, strings, shiftTo, noteValue, seed: variationOf(params) }
    const rng = makeRng(parseInt(hashParams(tune), 36))
    const beatsPer = NOTE_VALUE_BEATS[noteValue]
    const builder = new ChartBuilder({ bpm: params.tempo, tuning, title })
    const slots = Math.max(2, Math.round((params.bars * builder.beatsPerBar) / beatsPer))
    const slotsPerBar = builder.beatsPerBar / beatsPer
    /** Each bar sits in one place on the neck; with a shift the places take turns. */
    const poolAt = (slot: number) => pools[Math.floor(slot / slotsPerBar + 1e-9) % pools.length]

    let pool = pools[0]
    let [lo, hi] = walkRange(pool)
    const middle = pool[Math.floor((lo + hi) / 2)].midi
    const firstRoot = closest(pool, middle, isRoot)
    let idx = firstRoot >= 0 ? firstRoot : Math.floor((lo + hi) / 2)
    let dir = 1
    const seq: ScaleNote[] = [pool[idx]]
    for (let i = 1; i < slots - 1; i++) {
      const turn = rng() < 0.3
      const leap = rng() < 0.2
      const here = poolAt(i)
      if (here !== pool) {
        // The hand has moved: land on the note closest to the one just played.
        idx = closest(here, pool[idx].midi)
        pool = here
        ;[lo, hi] = walkRange(pool)
      } else {
        if (turn) dir = -dir
        const step = leap ? 2 : 1
        let next = idx + dir * step
        if (next > hi || next < lo) {
          dir = -dir
          next = idx + dir * step
        }
        idx = Math.max(0, Math.min(pool.length - 1, next))
      }
      seq.push(pool[idx])
    }
    const lastPool = poolAt(slots - 1)
    const home = closest(lastPool, pool[idx].midi, isRoot)
    seq.push(lastPool[home >= 0 ? home : closest(lastPool, pool[idx].midi)])
    seq.forEach((n, i) => builder.note(i * beatsPer, beatsPer, n.string, n.fret))

    const usedStrings = new Set(seq.map((n) => n.string))
    const oneString = usedStrings.size === 1 && tuning.length === STRING_NAMES.length ? ` It is all on the ${STRING_NAMES[seq[0].string]} string.` : ''
    const ending = home >= 0 ? ` and ends on ${key}, its home note` : ''
    const moving =
      places.length > 1
        ? ` Each bar sits in one of two places on the neck: frets ${position} to ${position + span}, then frets ${shiftTo} to ${shiftTo + span}. Move your whole hand at the bar line and land on the first note.`
        : ''
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
        `Play this short melody one note at a time. It moves in small steps${ending}.${oneString}${moving} ` +
        'The right notes, played on the beat, are what count.',
    }
  },
}
