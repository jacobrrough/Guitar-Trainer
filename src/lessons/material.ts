/**
 * What a lesson puts on the note lanes: its practice round and its song. The lesson screens and the
 * scoring simulation both build them here, so the virtual player always plays exactly what a learner sees
 * (and the virtual singer sings exactly what a singer sees).
 */
import { generateLevels } from '../chart/difficulty'
import { groupNotes } from '../chart/events'
import type { Chart, ChartNote } from '../chart/types'
import type { RangeAroundEasy } from '../music/keys'
import { arrange, levelIndex, songKey, vocalSong, VOICE_LEVELS, type VocalSong } from '../songs/vocal'
import type { SingerKey } from '../songs/vocal/render'
import { exerciseParams, generateExercise } from '../training/exercises'
import { instrumentOfSkillId, skillById } from '../training/instruments'
import type { GeneratedExercise } from '../training/types'
import { lessonDrillChart } from './drills'
import { withChordFingers } from './fingering'
import type { Lesson, LessonPlay } from './types'

/**
 * The lesson's practice round (no audio yet).
 *
 * A guitar round is recorded as the exercise named in the lesson, at that exercise's difficulty, but
 * the notes are the lesson's own (src/lessons/drills.ts).
 *
 * A sung round is the skill's own exercise, notes and all: the one daily practice carries on with,
 * built for the singer's `range` (the "Lower voice" starting range while none is known). The range
 * comes in here, at build time, and is never read from anything stored with the lesson, so a range
 * made smaller is honoured the next time the round is opened. Its `params` are what is stored with a
 * round: they carry the range it was sung in and, for a skill that climbs a ladder, the step, which is
 * what the Coach rates the round on.
 */
export function lessonDrillExercise(lesson: Lesson, tuning: number[], range?: RangeAroundEasy): GeneratedExercise {
  const drill = lesson.drill
  if (!drill) throw new Error(`Lesson ${lesson.id} has no practice round`)
  const skill = skillById(drill.skillId)
  if (!skill) throw new Error(`Unknown skill ${drill.skillId}`)
  const title = `${lesson.number}. ${lesson.title}`
  if (instrumentOfSkillId(skill.id) === 'voice') {
    // The three notes and nothing else: a stored range also says how and when it was found, and that is
    // no part of an exercise. Without a range none is made up here: the exercise has its own starting range.
    const place = range ? { low: range.low, high: range.high, easy: range.easy } : {}
    const sung = generateExercise(skill, drill.generatorId, exerciseParams(skill, drill.generatorId, drill.tempo, { ...drill.params, ...place }), tuning)
    return { ...sung, id: `lesson:${lesson.id}`, title, instructions: drill.hint }
  }
  const params = exerciseParams(skill, drill.generatorId, drill.tempo, drill.params)
  const counted = generateExercise(skill, drill.generatorId, params, tuning)
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

/**
 * The notes of `chart` (the lesson's song) that the lesson shows, per `play.view`.
 *
 * A sung chart is shown whole, at the level it was arranged for. The guitar's levels thin a chart out
 * by string and beat, and a sung chart has one stand-in string: they would drop most of the tune.
 */
export function lessonSongNotes(play: LessonPlay, chart: Chart): LessonSong {
  if (chart.voice) return { level: levelIndex(play.level), notes: chart.notes }
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

export interface LessonVocalSong extends LessonSong {
  song: VocalSong
  /** The arrangement: the lesson's level of the song in the singer's key. Its notes are `notes`, every one of them. */
  chart: Chart
  /** Semitones the song is moved from where it is written. */
  shift: number
  /** False when the song is wider than the singer's range. It must then not be sung; the songs of the course fit every range. */
  fits: boolean
}

/**
 * The song of a singing lesson as this singer sings it: the level the lesson names, in the key that
 * suits their range and their own "Lower" or "Higher" for the song. Before a range is known the song
 * stays where it is written.
 *
 * It is the arrangement the song screen builds for the same singer and level (`vocalRunFor`), without
 * its sound. Throws for an id that is not a song to sing.
 */
export function lessonVocalSong(play: LessonPlay, singer: SingerKey = {}): LessonVocalSong {
  const song = vocalSong(play.songId)
  if (!song) throw new Error(`Unknown song to sing: ${play.songId}`)
  const { shift, fits } = songKey(song, singer.range, singer.nudge)
  const chart = arrange(song, { shift, level: play.level })
  // The shift as the chart has it. A range read back damaged has no key (not a number), and the
  // arrangement then stays where the song is written: what is reported must be where the notes are.
  return { song, level: levelIndex(play.level), notes: chart.notes, chart, shift: chart.voice?.shift ?? 0, fits }
}

/** What a singer is told before the lesson's song starts: the song's own line, and what this level of it asks for. */
export function lessonVocalSongHint(play: LessonPlay): string {
  const song = vocalSong(play.songId)
  return [song?.description ?? '', VOICE_LEVELS[levelIndex(play.level)].about].filter(Boolean).join(' ')
}
