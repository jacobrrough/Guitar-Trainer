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
  // The singing course. None of these depends on which hand strums.
  | 'voice-posture'
  | 'voice-breath'
  | 'voice-phone'
  | 'voice-mouth'
  | 'pitch-ladder'
  | 'voice-lanes'
  | 'voice-slide'

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
  /**
   * The exercise this drill counts as in the learner's practice history (its difficulty, and what daily
   * practice carries on with). What is shown and played is the lesson's own chart in src/lessons/drills.ts.
   */
  generatorId: string
  params?: Partial<ExerciseParams>
  tempo: number
  /** How many rounds the learner plays (the guide plays first via Listen first). */
  rounds: number
  /** Accuracy (0..1) that counts the drill as done; it also completes after `rounds` tries. */
  passAccuracy: number
  /** What to do, in plain words, shown before the round starts. May use {left} and {right} (see `forHand`). */
  hint: string
}

/**
 * How much of the song the lesson puts on screen:
 * - 'outline': the level as it is (for a melody, the main note of every bar);
 * - 'chords': the strums of that level, each with every string of its chord, as the chord box shows it;
 * - 'whole': every note of the song.
 */
export type LessonSongView = 'outline' | 'chords' | 'whole'

export interface LessonPlay {
  /** Built-in song id (src/songs). */
  songId: string
  /** 0-based difficulty level the play is recorded under, and the level the outline and the strums are taken from. */
  level: number
  speed: number
  view: LessonSongView
  /** Finger to show on a fret where the lesson teaches another one than the song suggests (fret -> finger). */
  fingers?: Record<number, 1 | 2 | 3 | 4>
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
  /**
   * A lesson with no drill may run a tool as its middle step instead: the tuner, the range finder, or
   * "meet the note" (hear a note, slide the voice until it matches). Nothing in a tool is scored.
   */
  tool?: 'tuner' | 'range' | 'match'
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
