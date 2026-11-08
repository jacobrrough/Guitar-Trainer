import { BACKING_SAMPLE_RATE, EAR_PROMPTS } from '../constants'
import { itemDifficulty } from '../difficulty'
import type { ExerciseGenerator, ExerciseParams, GeneratedExercise, SkillDef } from '../types'
import { ChartBuilder, hashParams } from './builder'

const ID = 'tuneByEar'

type Mode = 'strings' | 'intervals'
interface Candidate {
  string: number
  fret: number
  midi: number
}

/** Tuning-reference frets: 5th fret on strings 0–2 and 4, 4th fret on string 3. */
function stringCandidates(tuning: number[]): Candidate[] {
  const out: Candidate[] = []
  tuning.forEach((open, string) => {
    out.push({ string, fret: 0, midi: open })
    const ref = string === 3 ? 4 : string === 5 ? -1 : 5
    if (ref > 0) out.push({ string, fret: ref, midi: open + ref })
  })
  return out
}

/** A minor pentatonic tones (A C D E G) within frets 0–5 on any string. */
function intervalCandidates(tuning: number[]): Candidate[] {
  const pcs = new Set([9, 0, 2, 4, 7])
  const out: Candidate[] = []
  tuning.forEach((open, string) => {
    for (let fret = 0; fret <= 5; fret++) {
      if (pcs.has((open + fret) % 12)) out.push({ string, fret, midi: open + fret })
    }
  })
  return out
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** "Match the pitch": the app plays a reference note and the player finds it on the guitar. */
export const tuneByEarGenerator: ExerciseGenerator = {
  id: ID,
  name: 'Match the pitch',
  defaults(_skill: SkillDef, tempo: number): ExerciseParams {
    return { tempo, bars: EAR_PROMPTS, noteValue: 'quarter', prompts: EAR_PROMPTS, mode: 'strings' }
  },
  generate(skill: SkillDef, params: ExerciseParams, tuning: number[]): GeneratedExercise {
    const mode: Mode = params.mode === 'intervals' ? 'intervals' : 'strings'
    const prompts = Math.max(1, (params.prompts as number | undefined) ?? EAR_PROMPTS)
    const title = 'Match the pitch'
    const pool = mode === 'intervals' ? intervalCandidates(tuning) : stringCandidates(tuning)
    const rand = mulberry32(seedFrom(hashParams(params)))
    const picks: Candidate[] = []
    let prev: Candidate | null = null
    while (picks.length < prompts) {
      // Shuffled rounds of the whole pool; skip an immediate repeat of the same pitch.
      const round = [...pool]
      for (let i = round.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[round[i], round[j]] = [round[j], round[i]]
      }
      for (const c of round) {
        if (picks.length >= prompts) break
        if (prev && prev.midi === c.midi) continue
        picks.push(c)
        prev = c
      }
    }
    const b = new ChartBuilder({ bpm: params.tempo, tuning, title })
    picks.forEach((c, i) => b.note(b.at(i), 1, c.string, c.fret))
    return {
      id: `${ID}:${hashParams(params)}`,
      generatorId: ID,
      skillId: skill.id,
      title,
      chart: b.build(prompts),
      difficulty: itemDifficulty(skill, { tempo: params.tempo, noteValue: 'quarter', bonus: mode === 'intervals' ? 5 : 0 }),
      params,
      backing: null,
      backingSampleRate: BACKING_SAMPLE_RATE,
      instructions: 'Listen to the reference note, then find and play the same pitch on your guitar. Any string works.',
      interaction: 'ear',
    }
  },
}
