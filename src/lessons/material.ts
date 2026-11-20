/**
 * What a lesson puts on the note lanes: its practice round and its song. The lesson screens and the
 * scoring simulation both build them here, so the virtual player always plays exactly what a learner sees.
 */
import { generateLevels } from '../chart/difficulty'
import { groupNotes } from '../chart/events'
import type { Chart, ChartNote } from '../chart/types'
import { exerciseParams, generateExercise } from '../training/exercises'
import { SKILLS_BY_ID } from '../training/skills'
import type { GeneratedExercise } from '../training/types'
import { lessonDrillChart } from './drills'
import { withChordFingers } from './fingering'
import type { Lesson, LessonPlay } from './types'

/**
 * The lesson's practice round (no audio yet). It is recorded as the exercise named in the lesson, at
 * that exercise's difficulty, but the notes are the lesson's own.
 */
export function lessonDrillExercise(lesson: Lesson, tuning: number[]): GeneratedExercise {
  const drill = lesson.drill
  if (!drill) throw new Error(`Lesson ${lesson.id} has no practice round`)
  const skill = SKILLS_BY_ID[drill.skillId]
  if (!skill) throw new Error(`Unknown skill ${drill.skillId}`)
  const params = exerciseParams(skill, drill.generatorId, drill.tempo, drill.params)
  const counted = generateExercise(skill, drill.generatorId, params, tuning)
  const title = `${lesson.number}. ${lesson.title}`
  return {
    ...counted,
    id: `lesson:${lesson.id}`,
    title,
    chart: lessonDrillChart(lesson.id, drill.tempo, tuning, title),
    instructions: drill.hint,
    interaction: 'highway',
  }
}

export interface LessonSong {
  /** 0-based level index the play is recorded under. */
  level: number
  /** The notes shown and scored. */
  notes: ChartNote[]
}

/** The notes of `chart` (the lesson's song) that the lesson shows, per `play.view`. */
export function lessonSongNotes(play: LessonPlay, chart: Chart): LessonSong {
  const levels = generateLevels(chart)
  let level = Math.max(0, Math.min(levels.length - 1, play.level))
  let notes = levels[level].notes
  if (play.view === 'whole') {
    notes = chart.notes
    // Recorded as what was played: the first level that has every note (the top one), so the song
    // carries on from there in the daily plan and is not handed back as its sparsest version.
    const full = levels.findIndex((l) => l.notes.length >= chart.notes.length)
    level = full >= 0 ? full : levels.length - 1
  } else if (play.view === 'chords') {
    // The level thins a chord down to its lowest note. A lesson that taught the chord asks for all of it,
    // at the moments the level keeps.
    const kept = new Set(notes.map((n) => n.chordId))
    notes = groupNotes(chart.notes)
      .filter((g) => kept.has(g.chordId))
      .flatMap((g) => g.notes)
  }
  notes = withChordFingers(notes)
  const fingers = play.fingers
  if (fingers) notes = notes.map((n) => (n.fret > 0 && fingers[n.fret] ? { ...n, finger: fingers[n.fret] } : n))
  return { level, notes }
}
