/**
 * What a singing lesson puts on the pitch lanes: its practice round and its song, as src/lessons/material.ts
 * builds them for the lesson screens.
 *
 * The first half holds them to the rules of the course without a sound: every round and every song can
 * be built for every range the app can store, stays inside it, and is the exercise daily practice
 * carries on with. The second half sings them. The virtual singer (a made-up voice that shares nothing
 * with the app's own guide voice) sings each round and each song of each lesson, the app's scored
 * track comes out of the speaker beside it at the same level, both are heard as a phone's microphone
 * on a table hears them, after a count-in of room noise, and the result is read the way the Coach
 * reads it (`attemptPerformance(...).acc`, never the tracker's own percentage).
 *
 * A plain run sings everything in the two starting ranges a beginner is given without the range finder
 * ("Lower voice" and "Higher voice", the smallest ranges there are), one at 44.1 kHz and the other at
 * 48, swapping from lesson to lesson: about a minute and a half. FULL_SIM=1 adds two measured ranges
 * an octave and more wide, and holds every piece in every range to the two takes that must not pass
 * (sung 150 cents flat, and nobody singing at all). A plain run holds only the first things a learner
 * ever sings to those, lesson 3 in the lower range; the sweeps of the exercises and of the songs
 * (voice.sim.test.ts, vocal.sim.test.ts) hold everything else to them. Every run also sings lesson 3 in
 * the higher range an octave under the app's notes, because lesson 2 promises that this counts.
 * LESSON_ONLY=<regexp> sings only the lessons whose name matches ('lesson 9', 'Higher'), and
 * LESSON_ONLY=none sings nothing.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resampleLinear } from '../audio/resample'
import type { Chart, ChartNote } from '../chart/types'
import { runVerdict, type RunVerdict } from '../features/play/runVerdict'
import { mix, phoneMic } from '../features/play/simCases.testutil'
import { hearVoice, scoreVoiceHeard } from '../features/play/voice/simulateVoice'
import { sing, type SingOptions, type SungNote } from '../features/play/voice/virtualSinger.testutil'
import { DEFAULT_RANGES, easyRange, type RangeAroundEasy } from '../music/keys'
import { VOICE_LEVELS, vocalSong } from '../songs/vocal'
import { renderScoredTrack, vocalRunFor } from '../songs/vocal/render'
import { exerciseParams, generateExercise } from '../training/exercises'
import { renderExerciseBacking } from '../training/exercises/backing'
import { DEFAULT_TUNING } from '../training/exercises/builder'
import { skillById } from '../training/instruments'
import { attemptPerformance } from '../training/performance'
import type { VoiceRange } from '../training/types'
import { COURSE, lessonPlayFor } from './course'
import { lessonDrillExercise, lessonSongNotes, lessonVocalSong, lessonVocalSongHint } from './material'
import type { Lesson, LessonPlay } from './types'
import { VOICE_COURSE, VOICE_GOAL_SONG_IDS } from './voiceCourse'

// Asking for a song's run starts its chords rendering on the recorded guitar. Nothing here listens to
// them, so the job answers at once instead of working on behind the tests.
vi.mock('../audio/guitar', async (original) => ({
  ...(await original<typeof import('../audio/guitar')>()),
  renderChartVoiced: async () => ({ samples: new Float32Array(1), voice: null }),
}))

const STARTING: [name: string, range: RangeAroundEasy][] = [
  ['the "Lower voice" starting range', DEFAULT_RANGES.lower],
  ['the "Higher voice" starting range', DEFAULT_RANGES.higher],
]
/** The range the app falls back on around a hummed note, for every note a hum can be: the smallest range it stores. */
const AROUND_A_HUM = Array.from({ length: 40 }, (_, i) => easyRange(40 + i))
/** Ranges as the range finder measures them: wider, and with the easy note anywhere in them, the edges included. */
const MEASURED: RangeAroundEasy[] = [
  { low: 41, high: 55, easy: 46 },
  { low: 45, high: 54, easy: 45 },
  { low: 50, high: 62, easy: 62 },
  { low: 57, high: 71, easy: 64 },
  { low: 62, high: 76, easy: 67 },
]
/**
 * The edges of what the app stores at all (MIDI 36 to 86): the smallest range at the very bottom and at
 * the very top, and the widest one (fourteen notes apart) at each end with the easy note on its outer edge.
 */
const AT_THE_LIMITS: RangeAroundEasy[] = [
  { low: 36, high: 43, easy: 39 },
  { low: 79, high: 86, easy: 82 },
  { low: 36, high: 50, easy: 36 },
  { low: 72, high: 86, easy: 86 },
]
const EVERY_RANGE = [...STARTING.map(([, range]) => range), ...AROUND_A_HUM, ...MEASURED, ...AT_THE_LIMITS]
const say = (range: RangeAroundEasy) => `${range.low} to ${range.high}, easy ${range.easy}`

const WITH_DRILL = VOICE_COURSE.filter((l) => l.drill)
/** Every song a lesson can put on the screen: its own, and for the last lesson each song a singer can have picked as their goal. */
function playsOf(lesson: Lesson): LessonPlay[] {
  if (!lesson.play) return []
  const goals = VOICE_GOAL_SONG_IDS.map((id) => lessonPlayFor(lesson, id)!)
  return goals.some((p) => p.songId !== lesson.play!.songId) ? goals : [lesson.play]
}
const PLAYS = VOICE_COURSE.flatMap((lesson) => playsOf(lesson).map((play) => ({ lesson, play })))

describe('the practice round of a singing lesson', () => {
  it('is there for every lesson from the third on', () => {
    expect(WITH_DRILL.map((l) => l.number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    for (const lesson of VOICE_COURSE.slice(0, 2)) expect(() => lessonDrillExercise(lesson, DEFAULT_TUNING), lesson.id).toThrow(/no practice round/)
  })

  it('can be built in both starting ranges, around every hummed note and in measured ranges, and stays inside each', () => {
    for (const lesson of WITH_DRILL) {
      for (const range of EVERY_RANGE) {
        const where = `${lesson.id} in ${say(range)}`
        const ex = lessonDrillExercise(lesson, DEFAULT_TUNING, range)
        expect(ex.chart.voice, where).toBeDefined()
        expect(ex.chart.notes.length, where).toBeGreaterThanOrEqual(4)
        // Nothing is ever asked for outside the singer's range, and the app sings nothing outside it either.
        for (const n of [...ex.chart.notes, ...ex.chart.voice!.cues]) {
          expect(n.midi, where).toBeGreaterThanOrEqual(range.low)
          expect(n.midi, where).toBeLessThanOrEqual(range.high)
        }
        // A round is eight bars at the most, and a second of quiet after them.
        expect(ex.chart.duration, where).toBeLessThanOrEqual((8 * 4 * 60) / lesson.drill!.tempo + 1 + 1e-6)
      }
    }
  })

  it('is recorded under the lesson, as the exercise and the pace the lesson names, with the lesson\'s own line before it', () => {
    for (const lesson of WITH_DRILL) {
      const drill = lesson.drill!
      const ex = lessonDrillExercise(lesson, DEFAULT_TUNING, DEFAULT_RANGES.higher)
      expect(ex.id).toBe(`lesson:${lesson.id}`)
      expect(ex.skillId).toBe(drill.skillId)
      expect(ex.generatorId).toBe(drill.generatorId)
      expect(ex.params.tempo).toBe(drill.tempo)
      expect(ex.chart.tempos).toEqual([{ time: 0, bpm: drill.tempo }])
      expect(ex.title).toBe(`${lesson.number}. ${lesson.title}`)
      expect(ex.instructions).toBe(drill.hint)
      expect(ex.interaction).toBe('highway')
      // No sound yet: the lesson screen renders the click and the app's notes, as it does for a guitar round.
      expect(ex.backing).toBeNull()
    }
  })

  it('carries the range it was built for, and the step it teaches, in what is stored with a round', () => {
    for (const lesson of WITH_DRILL) {
      const asked = lesson.drill!.params?.step
      for (const range of EVERY_RANGE) {
        const { params } = lessonDrillExercise(lesson, DEFAULT_TUNING, range)
        expect([params.low, params.high, params.easy], `${lesson.id} in ${say(range)}`).toEqual([range.low, range.high, range.easy])
        // The Coach rates a round on `params.step`. A range too small for the lesson's step would be sung
        // (and stored) a step lower: no range the app stores may do that to a lesson.
        expect(params.step, `${lesson.id} in ${say(range)}`).toBe(asked)
      }
    }
  })

  it('is the exercise daily practice carries on with: the same notes, counted as hard', () => {
    for (const lesson of WITH_DRILL) {
      const drill = lesson.drill!
      const skill = skillById(drill.skillId)!
      for (const range of [...STARTING.map(([, r]) => r), ...MEASURED]) {
        const mine = lessonDrillExercise(lesson, DEFAULT_TUNING, range)
        // What the Coach builds for a block of this skill at this pace and step, in this range.
        const planned = generateExercise(skill, skill.generators[0], exerciseParams(skill, skill.generators[0], drill.tempo, { ...(drill.params?.step === undefined ? {} : { step: drill.params.step }), ...range }), DEFAULT_TUNING)
        expect(mine.chart, `${lesson.id} in ${say(range)}`).toEqual(planned.chart)
        expect(mine.difficulty, lesson.id).toBe(planned.difficulty)
        expect(mine.params, lesson.id).toEqual(planned.params)
      }
    }
  })

  it('built again from the params it was stored with, is the same round', () => {
    for (const lesson of WITH_DRILL) {
      const skill = skillById(lesson.drill!.skillId)!
      for (const [, range] of STARTING) {
        const ex = lessonDrillExercise(lesson, DEFAULT_TUNING, range)
        const again = generateExercise(skill, ex.generatorId, ex.params, DEFAULT_TUNING)
        expect(again.chart, lesson.id).toEqual(ex.chart)
        expect(again.params, lesson.id).toEqual(ex.params)
      }
    }
  })

  it('is built for the "Lower voice" starting range when no range is known yet', () => {
    for (const lesson of WITH_DRILL) {
      const bare = lessonDrillExercise(lesson, DEFAULT_TUNING)
      expect(bare.chart, lesson.id).toEqual(lessonDrillExercise(lesson, DEFAULT_TUNING, DEFAULT_RANGES.lower).chart)
      expect([bare.params.low, bare.params.high, bare.params.easy], lesson.id).toEqual([48, 55, 52])
    }
  })

  it('takes the three notes of a stored range and nothing else of it', () => {
    const stored: VoiceRange = { low: 57, high: 69, easy: 62, measuredLow: 55, measuredHigh: 72, source: 'measured', at: 1_700_000_000_000 }
    for (const lesson of WITH_DRILL) {
      const { params } = lessonDrillExercise(lesson, DEFAULT_TUNING, stored)
      expect([params.low, params.high, params.easy], lesson.id).toEqual([57, 69, 62])
      // What is stored with every round is the exercise, not a copy of the profile.
      for (const field of ['source', 'at', 'measuredLow', 'measuredHigh']) expect(params, lesson.id).not.toHaveProperty(field)
    }
  })

  it('refuses a range too small to sing in, and never guesses another', () => {
    for (const lesson of WITH_DRILL) expect(() => lessonDrillExercise(lesson, DEFAULT_TUNING, { low: 60, high: 66, easy: 63 }), lesson.id).toThrow(/too small/)
    // Upside down is too small as well: it must not come out as some range nobody chose.
    for (const lesson of WITH_DRILL) expect(() => lessonDrillExercise(lesson, DEFAULT_TUNING, { low: 60, high: 48, easy: 52 }), lesson.id).toThrow(/too small/)
  })

  it('reads a range that is not in whole notes inwards, and stores the range the round was really built in', () => {
    // As a restored backup could hand it over: edges between two notes, and an easy note far above the top.
    const odd = { low: 47.5, high: 55.2, easy: 70 }
    for (const lesson of WITH_DRILL) {
      const ex = lessonDrillExercise(lesson, DEFAULT_TUNING, odd)
      for (const n of [...ex.chart.notes, ...ex.chart.voice!.cues]) {
        expect(n.midi, lesson.id).toBeGreaterThanOrEqual(48)
        expect(n.midi, lesson.id).toBeLessThanOrEqual(55)
      }
      // What is stored with the round is what was sung, not what was handed in.
      expect([ex.params.low, ex.params.high, ex.params.easy], lesson.id).toEqual([48, 55, 55])
      expect(ex.params.step, lesson.id).toBe(lesson.drill!.params?.step)
    }
  })

  it('says so when a lesson names a skill that does not exist', () => {
    const lesson: Lesson = { ...WITH_DRILL[0], drill: { ...WITH_DRILL[0].drill!, skillId: 'voice.no.such' } }
    expect(() => lessonDrillExercise(lesson, DEFAULT_TUNING)).toThrow('Unknown skill voice.no.such')
  })

  it('of a guitar lesson is what it was, whatever range is handed in', () => {
    for (const lesson of COURSE) {
      if (!lesson.drill) continue
      const plain = lessonDrillExercise(lesson, DEFAULT_TUNING)
      expect(lessonDrillExercise(lesson, DEFAULT_TUNING, DEFAULT_RANGES.higher), lesson.id).toEqual(plain)
      expect(plain.chart.voice, lesson.id).toBeUndefined()
      for (const field of ['low', 'high', 'easy']) expect(plain.params, lesson.id).not.toHaveProperty(field)
    }
  })
})

describe('what a lesson says about its practice round is what is sung', () => {
  const lesson = (number: number) => VOICE_COURSE[number - 1]
  const roundOf = (number: number, range: RangeAroundEasy) => lessonDrillExercise(lesson(number), DEFAULT_TUNING, range).chart
  const beatOf = (chart: Chart) => 60 / chart.tempos[0].bpm
  /** The turns of a round: what is sung between two of the app's own turns. */
  function turnsOf(chart: Chart): ChartNote[][] {
    const starts = chart.voice!.lineStarts
    return starts.map((start, i) => chart.notes.filter((n) => n.time >= start - 1e-6 && (i + 1 === starts.length || n.time < starts[i + 1] - 1e-6)))
  }
  const said = (number: number) => [lesson(number).drill!.hint, ...lesson(number).learn.flatMap((c) => c.paragraphs)].join(' ')
  /** In every range: a sentence about a round has to hold for every singer who reads it. */
  const inEveryRange = (number: number, check: (chart: Chart, range: RangeAroundEasy, where: string) => void) => {
    for (const range of EVERY_RANGE) check(roundOf(number, range), range, `lesson ${number} in ${say(range)}`)
  }

  it('lesson 3: four notes close to the easiest one, each sung by the app first and then held', () => {
    expect(said(3)).toMatch(/four notes, all close to your easiest one/)
    expect(said(3)).toMatch(/First the app sings a note/)
    inEveryRange(3, (chart, range, where) => {
      expect(chart.notes, where).toHaveLength(4)
      chart.notes.forEach((n, i) => {
        const call = chart.voice!.cues[i]
        expect(call.midi, where).toBe(n.midi)
        expect(call.time + call.duration, where).toBeLessThanOrEqual(n.time - beatOf(chart) + 1e-6)
        expect(n.duration / beatOf(chart), where).toBeCloseTo(3)
        expect(n.lyric, where).toBe('la')
        // Close: a couple of notes either side where the easy note has room on both sides, never further than four.
        expect(Math.abs(n.midi - range.easy), where).toBeLessThanOrEqual(4)
      })
    })
    for (const [, range] of STARTING) for (const n of roundOf(3, range).notes) expect(Math.abs(n.midi - range.easy)).toBeLessThanOrEqual(2)
  })

  /** "A little higher where your easy notes have room": the second turn starts one small step up, or where the first did. */
  const secondTurnRises = (number: number) => {
    inEveryRange(number, (chart, range, where) => {
      const [first, second] = turnsOf(chart)
      const top = Math.max(...first.map((n) => n.midi))
      expect(second[0].midi - first[0].midi, where).toBe(top < range.high ? 1 : 0)
    })
    // In both starting ranges there is room, so a beginner who reads the sentence hears it happen.
    for (const [, range] of STARTING) {
      const [first, second] = turnsOf(roundOf(number, range))
      expect(second[0].midi - first[0].midi).toBe(1)
    }
  }

  it('lesson 4: 1, 2, 3, 2, 1 on the bars, sung by the app first, then again a little higher where there is room', () => {
    expect(said(4)).toMatch(/The app sings 1, 2, 3, 2, 1 and you sing it back\. Then the same again, a little higher where your easy notes have room/)
    inEveryRange(4, (chart, _range, where) => {
      const turns = turnsOf(chart)
      expect(turns, where).toHaveLength(2)
      for (const turn of turns) expect(turn.map((n) => n.lyric), where).toEqual(['1', '2', '3', '2', '1'])
      expect(chart.voice!.cues.map((c) => c.midi), where).toEqual(chart.notes.map((n) => n.midi))
    })
    secondTurnRises(4)
  })

  it('lesson 5: little tunes of three notes on "la", hidden until they are sung', () => {
    expect(said(5)).toMatch(/little tune of three notes/)
    expect(said(5)).toMatch(/your notes stay hidden until you have sung them/)
    inEveryRange(5, (chart, _range, where) => {
      expect(chart.voice!.hideAnswers, where).toBe(true)
      for (const turn of turnsOf(chart)) expect(turn.map((n) => n.lyric), where).toEqual(['la', 'la', 'la'])
    })
  })

  it('lesson 6: five notes up and back, two for every click, short enough for one breath', () => {
    expect(said(6)).toMatch(/1 2 3 4 5, and back down to 1/)
    expect(said(6)).toMatch(/two for every click/)
    expect(said(6)).toMatch(/one breath/)
    inEveryRange(6, (chart, _range, where) => {
      for (const turn of turnsOf(chart)) {
        expect(turn.map((n) => n.lyric), where).toEqual(['1', '2', '3', '4', '5', '4', '3', '2', '1'])
        for (const n of turn.slice(0, -1)) expect(n.duration / beatOf(chart), where).toBeCloseTo(0.5)
        const last = turn[turn.length - 1]
        expect(last.time + last.duration - turn[0].time, where).toBeLessThanOrEqual(8)
      }
      // "The app sings five notes up and back down, then it is your turn."
      expect(chart.voice!.cues.map((c) => c.midi), where).toEqual(chart.notes.map((n) => n.midi))
    })
  })

  it('lesson 6: the second turn may start a small step higher, and nothing comes back down before the next round', () => {
    expect(said(6)).toMatch(/In each round you sing the five notes twice\. The second time may start one small step higher/)
    expect(said(6)).toMatch(/only where your easy notes have room/)
    expect(said(6)).toMatch(/The next round starts back where the first one did/)
    // A round has two turns and no third: a card that says the notes "come back down" within it says what never happens.
    expect(said(6)).not.toMatch(/comes? back down/)
    inEveryRange(6, (chart, range, where) => {
      const turns = turnsOf(chart)
      expect(turns, where).toHaveLength(2)
      const [first, second] = turns
      const top = Math.max(...first.map((n) => n.midi))
      expect(second[0].midi - first[0].midi, where).toBe(top < range.high ? 1 : 0)
      // Every round of a lesson is the same round, so the next one starts where this one did.
      expect(turnsOf(roundOf(6, range))[0].map((n) => n.midi), where).toEqual(first.map((n) => n.midi))
    })
    // Five notes fill a starting range from its bottom to its top: there the two turns are one and the same,
    // which is why the card says "may".
    for (const [, range] of STARTING) {
      const [first, second] = turnsOf(roundOf(6, range))
      expect(second.map((n) => n.midi)).toEqual(first.map((n) => n.midi))
    }
    const [first, second] = turnsOf(roundOf(6, MEASURED[0]))
    expect(second[0].midi - first[0].midi).toBe(1)
  })

  it('lesson 7: each note is sung by the app, then held for four clicks', () => {
    expect(said(7)).toMatch(/hold it for four clicks/)
    inEveryRange(7, (chart, _range, where) => {
      expect(chart.voice!.judge.sustain, where).toBe(true)
      chart.notes.forEach((n, i) => {
        expect(n.duration / beatOf(chart), where).toBeCloseTo(4)
        expect(chart.voice!.cues[i].midi, where).toBe(n.midi)
      })
    })
  })

  it('lesson 8: the app gives the first note only, and the bars say 1, 3, 5, 3, 1', () => {
    expect(said(8)).toMatch(/You hear only the first note\. Then sing 1, 3, 5, 3, 1/)
    expect(said(8)).toMatch(/the app sings just the first note/)
    inEveryRange(8, (chart, _range, where) => {
      const turns = turnsOf(chart)
      for (const turn of turns) expect(turn.map((n) => n.lyric), where).toEqual(['1', '3', '5', '3', '1'])
      expect(chart.voice!.cues.map((c) => c.midi), where).toEqual(turns.map((turn) => turn[0].midi))
    })
  })

  it('lesson 9: a slide is three places, start, top and landing, and the second slide starts higher where there is room', () => {
    expect(said(9)).toMatch(/Only three places are checked: where you start, the top, and where you land/)
    expect(said(9)).toMatch(/The second slide starts a little higher than the first where your easy notes have room/)
    inEveryRange(9, (chart, _range, where) => {
      // The way between the three places is drawn and not judged.
      expect(chart.voice!.glide, where).toBe(true)
      const turns = turnsOf(chart)
      expect(turns, where).toHaveLength(2)
      for (const turn of turns) expect(turn, where).toHaveLength(3)
      for (const [start, top, landing] of turns) {
        expect(top.midi, where).toBeGreaterThan(start.midi)
        expect(landing.midi, where).toBe(start.midi)
      }
    })
    secondTurnRises(9)
  })

  it('lesson 10: the notes lie further apart than in lesson 3', () => {
    expect(said(10)).toMatch(/The notes lie a little further apart than in lesson 3/)
    const spread = (chart: Chart) => Math.max(...chart.notes.map((n) => n.midi)) - Math.min(...chart.notes.map((n) => n.midi))
    inEveryRange(10, (chart, range, where) => expect(spread(chart), where).toBeGreaterThan(spread(roundOf(3, range))))
  })
})

describe('the song of a singing lesson', () => {
  it('is there for every lesson from the third on, with three to choose from in the last', () => {
    expect(PLAYS.map(({ lesson, play }) => `${lesson.number} ${play.songId} ${play.level}`)).toEqual([
      '3 sing-hot-cross-buns 0',
      '4 sing-hot-cross-buns 1',
      '5 sing-hot-cross-buns 2',
      '6 sing-mary-lamb 0',
      '7 sing-mary-lamb 2',
      '8 sing-ode-to-joy 1',
      '9 sing-saints 1',
      ...VOICE_GOAL_SONG_IDS.map((id) => `10 ${id} 2`),
    ])
  })

  it('fits both starting ranges, every range around a hummed note and measured ranges, and stays inside each', () => {
    for (const { lesson, play } of PLAYS) {
      for (const range of EVERY_RANGE) {
        const where = `${lesson.id} ${play.songId} in ${say(range)}`
        const sung = lessonVocalSong(play, { range })
        expect(sung.fits, where).toBe(true)
        for (const n of [...sung.notes, ...sung.chart.voice!.cues]) {
          expect(n.midi, where).toBeGreaterThanOrEqual(range.low)
          expect(n.midi, where).toBeLessThanOrEqual(range.high)
        }
      }
    }
  })

  it('is the whole song at the level the lesson names, judged as that level is', () => {
    for (const { lesson, play } of PLAYS) {
      const song = vocalSong(play.songId)!
      const sung = lessonVocalSong(play, { range: DEFAULT_RANGES.lower })
      expect(sung.song, lesson.id).toBe(song)
      expect(sung.level, lesson.id).toBe(play.level)
      expect(sung.chart.voice!.judge, lesson.id).toEqual(VOICE_LEVELS[play.level].judge)
      // Every note of the tune is sung and scored: a sung song is never thinned out to an outline.
      expect(sung.notes, lesson.id).toBe(sung.chart.notes)
      expect(sung.notes.length, lesson.id).toBe(song.lines.flat().filter(([offset]) => offset !== null).length)
      // On the echo levels the app sings each turn first; from "Whole tune" on it gives the starting note only.
      if (VOICE_LEVELS[play.level].echo > 0) expect(sung.chart.voice!.cues.length, lesson.id).toBeGreaterThan(sung.notes.length)
      else expect(sung.chart.voice!.cues, lesson.id).toHaveLength(1)
    }
  })

  it('is the very chart the song screen sings from for the same singer', () => {
    // The screen's run renders its sound as it is asked for, so each song is asked for once, and one of
    // them also for a singer with a "Lower" of their own and for one whose range is not known yet.
    const singers = PLAYS.map(({ lesson, play }, i) => ({ lesson, play, singer: { range: STARTING[i % 2][1] } }))
    const more = [{ range: MEASURED[0], nudge: -2 }, {}].map((singer) => ({ ...PLAYS[0], singer }))
    for (const { lesson, play, singer } of [...singers, ...more]) {
      const mine = lessonVocalSong(play, singer)
      const screen = vocalRunFor(play.songId, singer, play.level)!
      expect(mine.chart, `${lesson.id} ${play.songId}`).toEqual(screen.run.chart)
      expect([mine.shift, mine.fits], lesson.id).toEqual([screen.run.shift, screen.fits])
    }
  })

  it('follows the singer\'s own "Lower" for the song, and stays where it is written until a range is known', () => {
    const play = PLAYS[0].play
    const wide = { low: 50, high: 64 }
    const chosen = lessonVocalSong(play, { range: wide })
    const lowered = lessonVocalSong(play, { range: wide, nudge: -2 })
    expect(lowered.shift).toBe(chosen.shift - 2)
    expect(lowered.notes.map((n) => n.midi)).toEqual(chosen.notes.map((n) => n.midi - 2))
    expect(lessonVocalSong(play).shift).toBe(0)
    expect(lessonVocalSong(play).fits).toBe(true)
  })

  it('says how far it moved the song as the chart has it, whatever the singer\'s "Lower" asks for', () => {
    const play = PLAYS[0].play
    const wide = { low: 48, high: 62 }
    // A "Higher" beyond what there is, one beyond what fits, none, and ones that are not numbers (a profile read back damaged).
    for (const nudge of [9, 3, -3, 0, undefined, NaN, Infinity]) {
      const sung = lessonVocalSong(play, { range: wide, nudge })
      expect(sung.shift, String(nudge)).toBe(sung.chart.voice!.shift)
      expect(sung.notes.map((n) => n.midi), String(nudge)).toEqual(lessonVocalSong(play).notes.map((n) => n.midi + sung.shift))
      for (const n of sung.notes) {
        expect(n.midi, String(nudge)).toBeGreaterThanOrEqual(wide.low)
        expect(n.midi, String(nudge)).toBeLessThanOrEqual(wide.high)
      }
    }
    // A range that is not a number has no key at all. The song then stays where it is written, and the
    // shift says so: it is never a number that is none.
    const lost = lessonVocalSong(play, { range: { low: NaN, high: 60 } })
    expect(lost.shift).toBe(0)
    expect(lost.shift).toBe(lost.chart.voice!.shift)
    expect(lost.chart).toEqual(lessonVocalSong(play).chart)
  })

  it('takes a level that is out of range, or no number at all, for the nearest level there is', () => {
    // Levels are read back from what was stored. One that is off must not stop the lesson with an error.
    const cases: [asked: number, level: number][] = [[9, 5], [-3, 0], [NaN, 0], [1.6, 2], [0.4, 0]]
    for (const [asked, level] of cases) {
      const play: LessonPlay = { ...PLAYS[0].play, level: asked }
      const sung = lessonVocalSong(play, { range: DEFAULT_RANGES.lower })
      expect(sung.level, String(asked)).toBe(level)
      expect(sung.chart.voice!.judge, String(asked)).toEqual(VOICE_LEVELS[level].judge)
      // The level the play is recorded under is the level that was sung.
      expect(lessonSongNotes(play, sung.chart), String(asked)).toEqual({ level, notes: sung.chart.notes })
      expect(lessonVocalSongHint(play), String(asked)).toContain(VOICE_LEVELS[level].about)
    }
  })

  it('says so when a song does not fit, instead of moving it out of the range', () => {
    // Twelve notes wide, in a range of eight: there is no place for it, and the screen must not sing it.
    const sung = lessonVocalSong({ songId: 'sing-amazing-grace', level: 2, speed: 1, view: 'outline' }, { range: DEFAULT_RANGES.lower })
    expect(sung.fits).toBe(false)
  })

  it('refuses a song that is not one to sing', () => {
    expect(() => lessonVocalSong({ songId: 'ode-to-joy', level: 0, speed: 1, view: 'outline' })).toThrow('Unknown song to sing: ode-to-joy')
    expect(() => lessonVocalSong({ songId: 'sing-nothing', level: 0, speed: 1, view: 'outline' })).toThrow('Unknown song to sing: sing-nothing')
  })

  it('is introduced by the song\'s own line and by what its level asks for', () => {
    expect(lessonVocalSongHint(VOICE_COURSE[2].play!)).toBe('Just three notes, each one next door to the last. Listen to one line, then sing it back on "la".')
    for (const { lesson, play } of PLAYS) {
      const hint = lessonVocalSongHint(play)
      expect(hint, lesson.id).toContain(vocalSong(play.songId)!.description)
      expect(hint, lesson.id).toContain(VOICE_LEVELS[play.level].about)
      // Nothing of the guitar's wording, and nothing about a speed: a sung song is never slowed down.
      expect(hint, lesson.id).not.toMatch(/\b(play|guitar|slow\w*|speed)\b/i)
    }
    // A song that is gone still gets the line of its level, never an error in front of the singer.
    expect(lessonVocalSongHint({ songId: 'sing-nothing', level: 2, speed: 1, view: 'outline' })).toBe(VOICE_LEVELS[2].about)
  })

  it('shows every note of a sung chart, whatever the guitar would make of it', () => {
    // The guitar's levels thin a chart out by string and beat. A sung chart has one stand-in string, so
    // those levels would drop most of the tune: a sung chart is shown whole, at the level it was arranged for.
    for (const { lesson, play } of PLAYS) {
      const sung = lessonVocalSong(play, { range: DEFAULT_RANGES.higher })
      expect(lessonSongNotes(play, sung.chart), lesson.id).toEqual({ level: play.level, notes: sung.chart.notes })
    }
  })
})

/** Seconds of room noise before the piece starts: the count-in, from which the tracker takes the level of the room. */
const COUNT_IN = 2
/** What the Coach calls a clean round. */
const CLEAN = 0.85
const RATES = [44100, 48000]
const whole = !!process.env.FULL_SIM

const VOICES: [name: string, range: RangeAroundEasy][] = whole
  ? [...STARTING, ['a low measured range', MEASURED[0]], ['a high measured range', MEASURED[4]]]
  : STARTING

interface Piece {
  what: string
  chart: Chart
  /** The app's scored track (click and its own notes) as the speaker plays it at this microphone's rate. */
  track: Float32Array
  sampleRate: number
  /** Share of the notes that has to be hit for the lesson to call it done; undefined where the lesson names none. */
  pass?: number
}

interface Take {
  /** Accuracy as the Coach reads it: a perfect counts 1, a good 0.8. */
  acc: number
  hits: number
  total: number
  /** Share of the notes during which a voice was heard at all. */
  coverage: number
  /** What the lesson screen would do with the run. */
  verdict: RunVerdict
  reliable: boolean
}

/**
 * The notes as a singer sings them. A slide is sung as one: between the notes it is scored on, the
 * voice glides from one to the next. Everything else is sung note by note.
 */
function asSung(chart: Chart): SungNote[] {
  if (!chart.voice?.glide) return chart.notes
  const beat = 60 / chart.tempos[0].bpm
  const sung: SungNote[] = []
  chart.notes.forEach((n: ChartNote, i) => {
    sung.push(n)
    const next = chart.notes[i + 1]
    const end = n.time + n.duration
    if (next && next.time - end > 0 && next.time - end < 2 * beat) sung.push({ time: end, duration: next.time - end, midi: n.midi, slideTo: next.midi })
  })
  return sung
}

/** What the app makes of a take of a piece: `singing` is how its notes are sung, or null when nobody sings. */
function take(piece: Piece, singing: Partial<SingOptions> | null): Take {
  const { chart, track, sampleRate } = piece
  const seconds = track.length / sampleRate
  // The voice and the app's own track reach the microphone at the same level.
  const room = singing ? mix(sing(asSung(chart), { sampleRate, seconds, ...singing }), track) : track
  const lead = Math.round(COUNT_IN * sampleRate)
  const mic = new Float32Array(lead + room.length)
  mic.set(room, lead)
  const recording = phoneMic(mic, sampleRate)
  const options = { sampleRate, micLead: COUNT_IN }
  const { summary, result } = scoreVoiceHeard(chart, chart.notes, hearVoice(chart, recording, options), recording.length / sampleRate, options)
  const coach = attemptPerformance(result)
  return { acc: coach.acc, hits: summary.perfects + summary.goods, total: summary.total, coverage: result.coverage, verdict: runVerdict(summary, result), reliable: coach.reliable }
}

/** True when an earlier lesson sings this song at this level: in one range that is the same chart, note for note. */
const sungBefore = (lesson: Lesson, play: LessonPlay) => VOICE_COURSE.some((l) => l.number < lesson.number && l.play?.songId === play.songId && l.play.level === play.level)

/**
 * The practice round and the songs of a lesson, as the lesson screen builds them for a singer with this
 * range. A song the singer of an earlier lesson has already sung at the same level is not sung twice.
 */
function piecesOf(lesson: Lesson, range: RangeAroundEasy, sampleRate: number): Piece[] {
  const pieces: Piece[] = []
  if (lesson.drill) {
    const ex = renderExerciseBacking(lessonDrillExercise(lesson, DEFAULT_TUNING, range), { guide: false })
    pieces.push({ what: 'the practice round', chart: ex.chart, track: resampleLinear(ex.backing!, ex.backingSampleRate, sampleRate), sampleRate, pass: lesson.drill.passAccuracy })
  }
  for (const play of playsOf(lesson)) {
    if (sungBefore(lesson, play)) continue
    const sung = lessonVocalSong(play, { range })
    pieces.push({ what: `${sung.song.title} at "${VOICE_LEVELS[sung.level].name}"`, chart: sung.chart, track: renderScoredTrack(sung.chart, sampleRate), sampleRate })
  }
  return pieces
}

const only = process.env.LESSON_ONLY ? new RegExp(process.env.LESSON_ONLY) : null

const SUNG = VOICE_COURSE.filter((l) => l.drill || l.play)
  .flatMap((lesson) =>
    VOICES.map(([voice, range], v) => ({ lesson, voice, range, sampleRate: RATES[(lesson.number + v) % 2], name: `lesson ${lesson.number} (${lesson.title}) in ${voice} at ${RATES[(lesson.number + v) % 2] / 1000} kHz` })),
  )
  .filter((s) => !only || only.test(s.name))

describe.skipIf(!!only)('what the virtual singer sings', () => {
  it('is every practice round and every song of the course, each in a low and a high range, each range at both rates', () => {
    const lessons = new Set(SUNG.map((s) => s.lesson.number))
    expect([...lessons]).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    for (const number of lessons) {
      const ranges = SUNG.filter((s) => s.lesson.number === number).map((s) => s.range)
      expect(ranges.some((r) => r.high < 57), `lesson ${number}`).toBe(true)
      expect(ranges.some((r) => r.low > 57), `lesson ${number}`).toBe(true)
    }
    expect(new Set(SUNG.map((s) => `${s.range.low} ${s.sampleRate}`)).size).toBe(VOICES.length * RATES.length)
  })

  it('is, for each lesson, its practice round and its song, or the songs the last lesson can end on', () => {
    const [nine, ten] = SUNG.filter((s) => s.range === DEFAULT_RANGES.lower && s.lesson.number >= 9)
    expect(piecesOf(nine.lesson, nine.range, nine.sampleRate).map((p) => p.what)).toEqual(['the practice round', 'When the Saints Go Marching In at "Echo two lines"'])
    expect(piecesOf(ten.lesson, ten.range, ten.sampleRate).map((p) => p.what)).toEqual(['the practice round', 'Ode to Joy at "Whole tune"', 'When the Saints Go Marching In at "Whole tune"'])
  })

  it('leaves out only what an earlier lesson has sung already, note for note', () => {
    // The third goal, Mary Had a Little Lamb with its words, is lesson 7's song: one chart, sung there.
    const left = VOICE_COURSE.flatMap((lesson) => playsOf(lesson).filter((play) => sungBefore(lesson, play)).map((play) => ({ lesson, play })))
    expect(left.map(({ lesson, play }) => `${lesson.number} ${play.songId} ${play.level}`)).toEqual(['10 sing-mary-lamb 2'])
    for (const { lesson, play } of left) {
      const earlier = VOICE_COURSE.find((l) => l.number < lesson.number && l.play?.songId === play.songId && l.play.level === play.level)!
      for (const [, range] of VOICES) expect(lessonVocalSong(play, { range }).chart).toEqual(lessonVocalSong(earlier.play!, { range }).chart)
    }
  })
})

describe.each(SUNG)('$name', ({ lesson, range, sampleRate }) => {
  // The first things a learner ever sings are held to the takes that must not pass in every run, in the
  // lower range: that is where the click's low thump comes closest to being taken for a voice.
  const controls = whole || (lesson.number === 3 && range === DEFAULT_RANGES.lower)
  // Lesson 2 has just told the singer that a note sung an octave lower than the app sings it counts just
  // the same. The first round and the first song they sing after that are held to it in every run: a deep
  // voice that was given the "Higher voice" range and sings where it is at home.
  const deep = lesson.number === 3 && range === DEFAULT_RANGES.higher
  let sung: { piece: Piece; inTune: Take; below?: Take; flat?: Take; alone?: Take }[]
  beforeAll(() => {
    sung = piecesOf(lesson, range, sampleRate).map((piece) => ({
      piece,
      inTune: take(piece, {}),
      ...(deep ? { below: take(piece, { octave: -1 }) } : {}),
      ...(controls ? { flat: take(piece, { cents: -150 }), alone: take(piece, null) } : {}),
    }))
  }, 180_000)

  it('sung in tune, the practice round and the song are clean rounds for the Coach, and pass the lesson', () => {
    expect(sung.length).toBeGreaterThan(0)
    for (const { piece, inTune } of sung) {
      const how = `${piece.what}: ${inTune.hits} of ${inTune.total} notes`
      expect(inTune.total, how).toBe(piece.chart.notes.length)
      expect(inTune.verdict, how).toBe('counted')
      expect(inTune.acc, how).toBeGreaterThanOrEqual(CLEAN)
      // Heard well enough to count as evidence for the skill.
      expect(inTune.reliable, how).toBe(true)
      if (piece.pass !== undefined) expect(inTune.hits / inTune.total, how).toBeGreaterThanOrEqual(piece.pass)
    }
  })

  if (deep) {
    it('sung an octave lower than the app sings it, both are clean rounds all the same', () => {
      expect(sung.map(({ piece }) => piece.what)).toEqual(['the practice round', 'Hot Cross Buns at "Echo each line"'])
      for (const { piece, below } of sung) {
        const how = `${piece.what}: ${below!.hits} of ${below!.total} notes`
        expect(below!.verdict, how).toBe('counted')
        expect(below!.acc, how).toBeGreaterThanOrEqual(CLEAN)
        expect(below!.reliable, how).toBe(true)
        if (piece.pass !== undefined) expect(below!.hits / below!.total, how).toBeGreaterThanOrEqual(piece.pass)
      }
    })
  }

  if (!controls) return

  it('sung 150 cents flat, neither passes: the singer is heard, and the notes are not there', () => {
    for (const { piece, flat } of sung) {
      const how = `${piece.what}: ${flat!.hits} of ${flat!.total} notes`
      expect(flat!.coverage, how).toBeGreaterThanOrEqual(0.6)
      expect(flat!.verdict, how).toBe('counted')
      expect(flat!.acc, how).toBeLessThan(0.5)
      if (piece.pass !== undefined) expect(flat!.hits / flat!.total, how).toBeLessThan(piece.pass)
    }
  })

  it('with nobody singing, the app\'s own click and notes score nothing, and nothing is saved', () => {
    for (const { piece, alone } of sung) {
      const how = `${piece.what}: ${alone!.hits} of ${alone!.total} notes`
      expect(alone!.hits, how).toBe(0)
      expect(alone!.verdict, how).toBe('unscored')
    }
  })
})
