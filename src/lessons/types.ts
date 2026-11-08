import type { ExerciseParams } from '../training/types'

/** Ids the diagram set renders (src/components/diagrams). `chord:<name>` draws a chord box, `spot:<string>:<fret>` a fretboard spot (string 0 = thickest). */
export type IllustrationId =
  | 'sitting'
  | 'pick-grip'
  | 'fretting-hand'
  | 'anatomy'
  | 'string-names'
  | 'tuning-pegs'
  | 'strum-down'
  | 'phone-placement'
  | `chord:${string}`
  | `spot:${number}:${number}`

export interface LessonCard {
  title: string
  illustration?: IllustrationId
  /** Three or four short sentences, plain words. */
  paragraphs: string[]
  /** "If it buzzes…" style common mistakes with the fix. */
  mistakes?: string[]
}

export interface LessonDrill {
  skillId: string
  generatorId: string
  params?: Partial<ExerciseParams>
  tempo: number
  /** How many rounds the learner plays (the guide plays first via Listen first). */
  rounds: number
  /** Accuracy (0..1) that counts the drill as done; it also completes after `rounds` tries. */
  passAccuracy: number
}

export interface LessonPlay {
  /** Built-in song id (src/songs). */
  songId: string
  /** 0-based difficulty level index. */
  level: number
  speed: number
}

export interface Lesson {
  id: string
  number: number
  title: string
  subtitle: string
  minutes: number
  learn: LessonCard[]
  drill: LessonDrill | null
  play: LessonPlay | null
  /** Built-in song ids the learner can play after this lesson. */
  unlocks: string[]
  /** One encouraging sentence shown on completion. */
  done: string
}

export interface LessonProgress {
  id: string
  status: 'locked' | 'available' | 'done'
  startedAt?: number
  completedAt?: number
  learnSeen?: boolean
  drillDone?: boolean
  drillBestAccuracy?: number
  playDone?: boolean
  playBestAccuracy?: number
}
