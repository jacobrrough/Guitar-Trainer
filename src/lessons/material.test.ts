import { describe, expect, it } from 'vitest'
import { generateLevels } from '../chart/difficulty'
import { groupNotes, type NoteGroup } from '../chart/events'
import type { Chart, ChartNote } from '../chart/types'
import { CHORD_SHAPES } from '../music/chords'
import { BUILT_IN_SONGS } from '../songs'
import { DEFAULT_TUNING } from '../training/exercises/builder'
import { COURSE } from './course'
import { hasLessonDrill, thinStrings } from './drills'
import { CHORD_FINGERS, stringOrdinal, type Finger } from './fingering'
import { lessonDrillExercise, lessonSongNotes } from './material'
import type { Lesson } from './types'

/** A pressed place on one string: [string (0 = thickest), fret, finger]. */
type Place = [string: number, fret: number, finger: Finger]

/**
 * The single notes each lesson's cards teach for the first time. (Chords are read from the chord boxes
 * on the cards; open strings are all named in lesson 1.) `cards say it` below holds this table to the text.
 */
const PLACES: Record<number, Place[]> = {
  3: [[5, 1, 1], [5, 2, 2], [5, 3, 3], [4, 1, 1], [4, 3, 3]],
  4: [[3, 2, 2]],
  10: [[0, 3, 1], [0, 5, 3], [1, 3, 1], [1, 5, 3]],
}
/** The lesson that teaches strumming up between the beats; before it every note falls on a beat. */
const RHYTHM_LESSON = 9

const chordsOn = (lesson: Lesson) => lesson.learn.flatMap((c) => (c.illustration?.startsWith('chord:') ? [c.illustration.slice('chord:'.length)] : []))
const upTo = (n: number) => COURSE.filter((l) => l.number <= n)
const chordsTaughtBy = (n: number) => new Set(upTo(n).flatMap(chordsOn))
/** Pressed places known by lesson n; a later lesson's finger for the same place wins. */
function placesTaughtBy(n: number): Map<string, Finger> {
  const out = new Map<string, Finger>()
  for (let i = 1; i <= n; i++) for (const [s, f, finger] of PLACES[i] ?? []) out.set(`${s}:${f}`, finger)
  return out
}

interface Shown {
  what: string
  notes: ChartNote[]
  chart: Chart
  /** Seconds of real time per second of chart time. */
  stretch: number
}

function drillOf(lesson: Lesson): Shown | null {
  if (!lesson.drill) return null
  const chart = lessonDrillExercise(lesson, DEFAULT_TUNING).chart
  return { what: `lesson ${lesson.number} practice`, notes: chart.notes, chart, stretch: 1 }
}

function songOf(lesson: Lesson): Shown | null {
  if (!lesson.play) return null
  const song = BUILT_IN_SONGS.find((s) => s.id === lesson.play!.songId)!
  return { what: `lesson ${lesson.number} song ${song.id}`, notes: lessonSongNotes(lesson.play, song.chart).notes, chart: song.chart, stretch: 1 / lesson.play.speed }
}

const beatSeconds = (chart: Chart) => 60 / chart.tempos[0].bpm
const beatOf = (chart: Chart, g: NoteGroup) => g.time / beatSeconds(chart)
const isOnBeat = (chart: Chart, g: NoteGroup) => Math.abs(beatOf(chart, g) - Math.round(beatOf(chart, g))) < 1e-6
const shapeKey = (pairs: Array<[number, number]>) => [...pairs].sort((a, b) => a[0] - b[0]).map(([s, f]) => `${s}:${f}`).join(' ')
const groupKey = (g: NoteGroup) => shapeKey(g.notes.map((n): [number, number] => [n.string, n.fret]))
const fullShape = (name: string) => shapeKey(CHORD_SHAPES[name].shape)
/** The thin strings of a chord, as an up strum catches them. */
const thinPart = (name: string) => shapeKey(thinStrings(CHORD_SHAPES[name].shape))
/** Shortest time between two strokes, in seconds as the learner plays them. */
function quickestStep(shown: Shown): number {
  const groups = groupNotes(shown.notes)
  return Math.min(...groups.slice(1).map((g, i) => (g.time - groups[i].time) * shown.stretch))
}

/** Everything in `shown` that the cards up to `lesson` have not taught, as readable complaints. */
function untaught(lesson: Lesson, shown: Shown): string[] {
  const chords = chordsTaughtBy(lesson.number)
  const places = placesTaughtBy(lesson.number)
  const problems: string[] = []
  for (const g of groupNotes(shown.notes)) {
    const at = `${shown.what} at beat ${beatOf(shown.chart, g).toFixed(2)}`
    const onBeat = isOnBeat(shown.chart, g)
    if (!onBeat && lesson.number < RHYTHM_LESSON) problems.push(`${at}: a note between the beats`)
    if (!onBeat && Math.abs(beatOf(shown.chart, g) * 2 - Math.round(beatOf(shown.chart, g) * 2)) > 1e-6) problems.push(`${at}: quicker than "1 and 2 and"`)
    if (g.notes.length === 1) {
      const n = g.notes[0]
      if (n.fret === 0) continue
      const finger = places.get(`${n.string}:${n.fret}`)
      if (finger === undefined) problems.push(`${at}: the ${stringOrdinal(n.string)} string at fret ${n.fret} was never taught`)
      else if (n.finger !== finger) problems.push(`${at}: fret ${n.fret} shows finger ${n.finger}, the cards say finger ${finger}`)
      continue
    }
    const name = g.notes[0].chordName
    if (!name || !chords.has(name)) {
      problems.push(`${at}: chord ${name ?? '(no name)'} was never taught`)
      continue
    }
    const whole = groupKey(g) === fullShape(name)
    const upStrum = !onBeat && lesson.number >= RHYTHM_LESSON && groupKey(g) === thinPart(name)
    if (!whole && !upStrum) problems.push(`${at}: ${name} is not the shape of its chord box (${groupKey(g)})`)
    for (const n of g.notes) if (n.fret > 0 && n.finger !== CHORD_FINGERS[name][n.string]) problems.push(`${at}: ${name} shows finger ${n.finger} on the ${stringOrdinal(n.string)} string`)
  }
  return problems
}

const fullStrums = (shown: Shown, name: string) => groupNotes(shown.notes).filter((g) => g.notes.length > 1 && g.notes[0].chordName === name && groupKey(g) === fullShape(name)).length
const has = (shown: Shown, [string, fret]: Place) => shown.notes.some((n) => n.string === string && n.fret === fret)

describe('what a lesson asks the learner to play', () => {
  it('every lesson with a practice round has one written for it', () => {
    for (const l of COURSE) expect(hasLessonDrill(l.id), l.id).toBe(!!l.drill)
  })

  it('cards say it: every place and chord the lessons count as taught is in the text of that lesson', () => {
    for (const [number, places] of Object.entries(PLACES)) {
      const lesson = COURSE[Number(number) - 1]
      for (const [string, fret, finger] of places) {
        const card = lesson.learn.find((c) => {
          const text = c.paragraphs.join(' ')
          return text.includes(`${stringOrdinal(string)} string`) && new RegExp(`\\bfret ${fret}\\b`, 'i').test(text) && new RegExp(`\\bfinger ${finger}\\b`).test(text)
        })
        expect(card, `lesson ${number}: the ${stringOrdinal(string)} string, fret ${fret}, finger ${finger}`).toBeDefined()
      }
    }
    const rhythm = COURSE[RHYTHM_LESSON - 1].learn.map((c) => c.paragraphs.join(' ')).join(' ')
    expect(rhythm).toMatch(/up in between/)
    expect(rhythm).toMatch(/On the way up the pick only catches the three thinnest strings/)
  })

  for (const lesson of COURSE) {
    describe(`lesson ${lesson.number}: ${lesson.title}`, () => {
      const drill = drillOf(lesson)
      const song = songOf(lesson)

      it('shows nothing the cards have not taught by then: strings, frets, fingers, chords, note lengths', () => {
        for (const shown of [drill, song]) if (shown) expect(untaught(lesson, shown), shown.what).toEqual([])
      })

      it('asks for every chord of its cards, the whole shape, in the practice and in the song', () => {
        for (const name of chordsOn(lesson)) {
          for (const shown of [drill, song]) if (shown) expect(fullStrums(shown, name), `${shown.what}: full ${name} strums`).toBeGreaterThanOrEqual(2)
        }
      })

      it('practises every new place of its cards, and uses the new strings in the song', () => {
        const places = PLACES[lesson.number] ?? []
        for (const place of places) expect(has(drill!, place), `${drill!.what}: ${stringOrdinal(place[0])} string fret ${place[1]}`).toBe(true)
        for (const string of new Set(places.map((p) => p[0]))) {
          expect(places.some((p) => p[0] === string && has(song!, p)), `${song!.what}: a pressed note on the ${stringOrdinal(string)} string`).toBe(true)
        }
      })

      it('keeps a calm pace', () => {
        // Up to the rhythm lesson nothing comes quicker than every two seconds; after it, never quicker than the riff needs.
        const floor = lesson.number < RHYTHM_LESSON ? 2 : lesson.number === RHYTHM_LESSON ? 0.5 : 0.35
        for (const shown of [drill, song]) if (shown) expect(quickestStep(shown), shown.what).toBeGreaterThanOrEqual(floor)
        const before = COURSE.slice(0, lesson.number - 1).reverse().map(drillOf).find((d) => !!d)
        // A practice round is never much quicker than the one before, except where rhythm itself is the subject.
        if (drill && before && lesson.number < RHYTHM_LESSON) expect(quickestStep(drill), drill.what).toBeGreaterThanOrEqual(0.9 * quickestStep(before))
        if (drill && lesson.number > RHYTHM_LESSON) expect(quickestStep(drill), drill.what).toBeGreaterThanOrEqual(quickestStep(drillOf(COURSE[RHYTHM_LESSON - 1])!))
      })
    })
  }

  it('a practice hint that counts the strums counts them as they come', () => {
    /** How many strums each chord gets before the next one comes: [chord, strums]. */
    const strumRuns = (shown: Shown) => {
      const runs: Array<[string, number]> = []
      for (const g of groupNotes(shown.notes)) {
        const name = g.notes[0].chordName ?? ''
        const last = runs[runs.length - 1]
        if (last && last[0] === name) last[1]++
        else runs.push([name, 1])
      }
      return runs
    }
    const word: Record<number, string> = { 2: 'two', 4: 'four' }
    // Lessons 6 and 7: four strums on each chord, then two.
    for (const lesson of [COURSE[5], COURSE[6]]) {
      expect(lesson.drill!.hint, lesson.id).toMatch(/four times, then .* four times\. After that you change after every two strums\./)
      expect(strumRuns(drillOf(lesson)!).map(([, strums]) => strums), lesson.id).toEqual([4, 4, 2, 2, 2, 2])
    }
    // Lesson 8: what the hint says of each chord holds for every chord it does not give a count of its own.
    const hint = COURSE[7].drill!.hint
    for (const [name, strums] of strumRuns(drillOf(COURSE[7])!)) {
      const said = new RegExp(`\\b${name} gets (\\w+)`).exec(hint)?.[1] ?? /Each chord gets (\w+) strums/.exec(hint)?.[1]
      expect(said, `lesson 8: ${name}, ${strums} strums in a row`).toBe(word[strums])
    }
  })

  it('lesson 9 is about rhythm: a strum on every beat, with up strums in between in the practice', () => {
    const lesson = COURSE[RHYTHM_LESSON - 1]
    const drill = drillOf(lesson)!
    const song = songOf(lesson)!
    const groups = groupNotes(drill.notes)
    expect(groups.filter((g) => !isOnBeat(drill.chart, g)).length).toBeGreaterThanOrEqual(8)
    for (const shown of [drill, song]) {
      const beats = new Set(groupNotes(shown.notes).filter((g) => isOnBeat(shown.chart, g)).map((g) => Math.round(beatOf(shown.chart, g))))
      const last = Math.max(...beats)
      for (let beat = 0; beat <= last; beat++) expect(beats.has(beat), `${shown.what}: a strum on beat ${beat}`).toBe(true)
    }
  })

  it('lesson 10 plays the riff itself: open, fret 3 and fret 5 on both thick strings, in its own rhythm', () => {
    const lesson = COURSE[9]
    for (const shown of [drillOf(lesson)!, songOf(lesson)!]) {
      for (const place of PLACES[10]) expect(has(shown, place), `${shown.what}: ${stringOrdinal(place[0])} string fret ${place[1]}`).toBe(true)
      // Two quick open notes and a pressed one: the pattern the cards describe.
      const groups = groupNotes(shown.notes)
      const quick = groups.filter((g, i) => i > 0 && Math.abs((g.time - groups[i - 1].time) / beatSeconds(shown.chart) - 0.5) < 1e-6)
      expect(quick.length, shown.what).toBeGreaterThanOrEqual(8)
    }
    const song = BUILT_IN_SONGS.find((s) => s.id === lesson.play!.songId)!
    expect(songOf(lesson)!.notes.map((n) => n.id)).toEqual(song.chart.notes.map((n) => n.id))
  })

  it('records a song under the level that holds what was shown', () => {
    const key = (notes: ChartNote[]) => notes.map((n) => `${n.time.toFixed(4)}:${n.string}:${n.fret}`).sort().join(' ')
    let whole = 0
    for (const lesson of COURSE) {
      if (!lesson.play) continue
      const song = BUILT_IN_SONGS.find((x) => x.id === lesson.play!.songId)!
      const shown = lessonSongNotes(lesson.play, song.chart)
      const level = generateLevels(song.chart)[shown.level]
      // An outline shows the level itself. Whole chords and whole songs must match their level note for note,
      // or the daily plan would carry the song on from a version the learner never played.
      if (lesson.play.view === 'whole') whole++
      if (lesson.play.view !== 'outline' || !song.chart.wholeChords) {
        expect(key(shown.notes), `lesson ${lesson.number} ${song.id}`).toBe(key(level.notes))
      }
    }
    expect(whole).toBeGreaterThan(0)
  })

  it('records the practice as the exercise the lesson names, with the lesson hint as its instructions', () => {
    for (const lesson of COURSE) {
      if (!lesson.drill) continue
      const ex = lessonDrillExercise(lesson, DEFAULT_TUNING)
      expect(ex.id).toBe(`lesson:${lesson.id}`)
      expect(ex.generatorId).toBe(lesson.drill.generatorId)
      expect(ex.skillId).toBe(lesson.drill.skillId)
      expect(ex.params.tempo).toBe(lesson.drill.tempo)
      expect(ex.chart.tempos[0].bpm).toBe(lesson.drill.tempo)
      expect(ex.instructions).toBe(lesson.drill.hint)
      expect(ex.interaction).toBe('highway')
    }
  })
})
