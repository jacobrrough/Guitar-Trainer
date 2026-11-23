import { describe, expect, it } from 'vitest'
import type { Chart } from '../../chart/types'
import { COURSE, lessonPlayFor } from '../../lessons/course'
import { lessonDrillExercise } from '../../lessons/material'
import type { Lesson, LessonProgress } from '../../lessons/types'
import { VOICE_COURSE } from '../../lessons/voiceCourse'
import { DEFAULT_RANGES } from '../../music/keys'
import { VOICE_LEVELS, vocalSong } from '../../songs/vocal'
import { DEFAULT_TUNING } from '../../training/exercises/builder'
import { skillById } from '../../training/instruments'
import { NOT_COUNTED, NOT_COUNTED_VOICE } from '../play/runVerdict'
import type { ScoreSummary } from '../play/scoring'
import { VOICE_TIPS } from '../play/voice/voiceCopy'
import type { VoiceFeedback, VoiceScoreSummary } from '../play/voice/voiceTracker'
import {
  COMES_LATER,
  FELT_COPY,
  KEY_LOWERED_LINE,
  STEP_LABEL,
  asksHowItFelt,
  courseCopy,
  courseGate,
  courseSummary,
  doneText,
  feedbackLine,
  feltReply,
  firstOpenStep,
  hitFraction,
  lessonOnScreen,
  lessonSongHint,
  lessonSteps,
  markQueue,
  mistakesHeading,
  ownProfile,
  practiceNote,
  practiceTrouble,
  resumeOffer,
  resumeStep,
  roundCopy,
  songHint,
  songNote,
  songsToSing,
  stepAfter,
  stepAfterCards,
  stepLabel,
  tipFor,
  type StepId,
} from './lessonUtils'

describe('lessonUtils', () => {
  it('builds the steps per lesson', () => {
    expect(lessonSteps(COURSE[0])).toEqual(['learn', 'try', 'play', 'done'])
    expect(lessonSteps(COURSE[1])).toEqual(['learn', 'tune', 'play', 'done'])
  })

  it('words the score plainly', () => {
    expect(feedbackLine({ perfects: 5, goods: 1, total: 8 })).toBe('You hit 6 of 8 notes.')
    expect(hitFraction({ perfects: 5, goods: 1, total: 8 })).toBeCloseTo(0.75)
    expect(feedbackLine({ perfects: 0, goods: 0, total: 0 })).toMatch(/did not hear/)
  })

  it('picks a lesson mistake as the tip and rotates it', () => {
    const a = tipFor(COURSE[2], 0.4, 1)
    const b = tipFor(COURSE[2], 0.4, 2)
    expect(a).toMatch(/^If /)
    expect(a).not.toBe(b)
    expect(tipFor(COURSE[2], 0.95, 1)).not.toMatch(/^If /)
  })
})

describe('coming back to a lesson that was left half way', () => {
  const chord = COURSE[4]
  const tune = COURSE[1]
  const row = (patch: Partial<LessonProgress> = {}): LessonProgress => ({ id: chord.id, status: 'available', ...patch })

  it('opens at the first step that is not done yet', () => {
    expect(resumeStep(chord, row())).toBe('learn')
    expect(resumeStep(chord, row({ learnSeen: true }))).toBe('try')
    expect(resumeStep(chord, row({ learnSeen: true, drillDone: true }))).toBe('play')
    expect(resumeStep(chord, row({ learnSeen: true, drillDone: true, playDone: true }))).toBe('done')
    expect(resumeStep(tune, row({ id: tune.id, learnSeen: true }))).toBe('tune')
    expect(resumeStep(tune, row({ id: tune.id, learnSeen: true, drillDone: true }))).toBe('play')
  })

  it('never jumps over something that is still open', () => {
    // The song was played but the practice round never passed (the learner carried on without): back to the practice.
    expect(resumeStep(chord, row({ learnSeen: true, playDone: true }))).toBe('try')
    // A best score alone is not a pass.
    expect(resumeStep(chord, row({ learnSeen: true, drillBestAccuracy: 0.4 }))).toBe('try')
    // Flags without the cards read: the cards first.
    expect(resumeStep(chord, row({ drillDone: true, playDone: true }))).toBe('learn')
    expect(resumeStep(chord, undefined)).toBe('learn')
    expect(resumeStep(chord, null)).toBe('learn')
    for (const lesson of COURSE) {
      const steps = lessonSteps(lesson)
      for (const learnSeen of [false, true]) for (const drillDone of [false, true]) for (const playDone of [false, true]) {
        const at = resumeStep(lesson, { id: lesson.id, status: 'available', learnSeen, drillDone, playDone })
        const done: Record<string, boolean> = { learn: learnSeen, try: drillDone, tune: drillDone, play: playDone }
        expect(steps).toContain(at)
        for (const before of steps.slice(0, steps.indexOf(at))) expect(done[before], `${lesson.id} opens at ${at} over ${before}`).toBe(true)
      }
    }
  })

  it('opens a finished lesson at its first card, to go through it again', () => {
    expect(resumeStep(chord, row({ status: 'done', learnSeen: true, drillDone: true, playDone: true }))).toBe('learn')
    expect(resumeOffer(chord, row({ status: 'done', learnSeen: true, drillDone: true, playDone: true }))).toBeNull()
    expect(stepAfterCards(chord, row({ status: 'done', learnSeen: true, drillDone: true, playDone: true }))).toBe('try')
  })

  it('says where the lesson carries on, and offers the cards again', () => {
    expect(resumeOffer(chord, row())).toBeNull()
    expect(resumeOffer(chord, row({ learnSeen: true }))).toMatchObject({ step: 'try', action: 'Go to the practice' })
    expect(resumeOffer(chord, row({ learnSeen: true, drillDone: true }))).toMatchObject({ step: 'play', action: 'Play the song' })
    expect(resumeOffer(chord, row({ learnSeen: true, drillDone: true }))!.body).toMatch(/practice round/)
    expect(resumeOffer(tune, row({ id: tune.id, learnSeen: true }))).toMatchObject({ step: 'tune', action: 'Tune up' })
    expect(resumeOffer(tune, row({ id: tune.id, learnSeen: true, drillDone: true }))!.body).toMatch(/tuned your guitar/)
    expect(resumeOffer(chord, row({ learnSeen: true, drillDone: true, playDone: true }))).toMatchObject({ step: 'done', action: 'Finish the lesson' })
  })

  it('after the cards: on to the next step the first time, back to where the lesson was left after reading them again', () => {
    expect(stepAfterCards(chord, row())).toBe('try')
    expect(stepAfterCards(tune, row({ id: tune.id }))).toBe('tune')
    expect(stepAfterCards(chord, row({ learnSeen: true }))).toBe('try')
    expect(stepAfterCards(chord, row({ learnSeen: true, drillDone: true }))).toBe('play')
    expect(stepAfterCards(chord, row({ learnSeen: true, drillDone: true, playDone: true }))).toBe('done')
    expect(firstOpenStep(chord, row({ learnSeen: true, drillDone: true }))).toBe('play')
  })
})

describe('the line shown before a lesson song', () => {
  it('says how much of the song is played here', () => {
    expect(lessonSongHint('chords', 'One easy chord, strummed to a steady beat.')).toBe('One easy chord, strummed to a steady beat. Strum the whole chord, every string of it, each time the notes reach the line.')
    expect(lessonSongHint('outline', 'A famous melody.')).toMatch(/main notes/)
    expect(lessonSongHint('whole')).toMatch(/all of it/)
    for (const lesson of COURSE) if (lesson.play) expect(lessonSongHint(lesson.play.view, 'x').length).toBeGreaterThan(10)
  })
})

describe('the closing line of a lesson', () => {
  it('only says what was played when the song was played', () => {
    const chord = COURSE[4]
    expect(doneText(chord, { playDone: true })).toBe(chord.done)
    expect(chord.done).toMatch(/You played a whole chord/)
    for (const progress of [{ playDone: false }, {}, null, undefined]) {
      expect(doneText(chord, progress)).not.toMatch(/You played|chord/)
      expect(doneText(chord, progress)).toMatch(/song has not been played/)
    }
  })

  it('every lesson line names something the learner did in it', () => {
    for (const lesson of COURSE) expect(lesson.done, lesson.id).toMatch(/\bYou(r)? (held|pressed|moved|played|strummed|kept|guitar is in tune)/)
  })
})

// ---------------------------------------------------------------------------------------------
// Two courses. Everything below is about the singing course beside the guitar course: the tool
// step, and the words a singer reads where a guitarist reads about playing.
// ---------------------------------------------------------------------------------------------

const voiceLesson = (id: string): Lesson => {
  const lesson = VOICE_COURSE.find((l) => l.id === id)
  if (!lesson) throw new Error(`No singing lesson ${id}`)
  return lesson
}
const v01 = voiceLesson('v01-voice')
const v02 = voiceLesson('v02-meet')
const v03 = voiceLesson('v03-match')
const v05 = voiceLesson('v05-words')
const v08 = voiceLesson('v08-jumps')
const v09 = voiceLesson('v09-slides')
const v10 = voiceLesson('v10-song')

/** Words of the guitar side that a singer must never be shown. */
const GUITAR_WORDS = /\b(guitar|play|plays|played|playing|tune up|tuned|strum|strummed|pluck|string|strings|fret|chord|chords|pick|hand)\b/i
/** Words the singing copy never uses (docs/SINGING.md, section 10), and numbers a beginner cannot use. */
const UNKIND = /\b(wrong|fail|failed|failure|tone deaf|louder|loud|loudly|push|belt|bad|mistake|error|cents|rating|accuracy|bpm)\b/i
/** Anything that would be a timing line. For the words this file's own functions write. */
const TIMING = /\b(timing|early|late|behind|ahead|rush|rushing|dragging|ms|milliseconds|on the beat|in time)\b/i
/**
 * What a line about the singer's own timing would say. For the tips, which are written elsewhere (the
 * cards of a lesson, the tips of a skill) and may speak kindly of coming in a little late: that is
 * advice, not a measurement of this run.
 */
const TIMING_VERDICT = /\b(timing|ms|milliseconds|on the beat|in time|rushing|dragging|ahead of|behind the)\b|\byou (were|are|came in|sang) (a little |a bit |too )?(early|late)\b/i

const summaryOf = (perfects: number, goods: number, misses: number): ScoreSummary => ({
  score: perfects * 100 + goods * 80,
  streak: 0,
  maxStreak: perfects + goods,
  multiplier: 1,
  perfects,
  goods,
  misses,
  total: perfects + goods + misses,
  judged: perfects + goods + misses,
  accuracy: perfects + goods + misses > 0 ? (perfects + goods) / (perfects + goods + misses) : 0,
})

/** A sung run's summary: it carries what the tracker kept about the notes. */
const sungSummary = (hits: number, misses: number, said: Partial<VoiceFeedback['reasons']> = {}, octave = 0): VoiceScoreSummary => ({
  ...summaryOf(0, hits, misses),
  voice: { notes: hits + misses, hits, reasons: { silent: 0, low: 0, high: 0, unsteady: 0, slid: 0, ...said }, octave, medianCents: -20 },
})

describe('a lesson with a tool in the middle', () => {
  it('runs the tool where another lesson has its practice round', () => {
    expect(v01.tool).toBe('range')
    expect(v02.tool).toBe('match')
    expect(lessonSteps(v01)).toEqual(['learn', 'tool', 'done'])
    expect(lessonSteps(v02)).toEqual(['learn', 'tool', 'done'])
    // A tool lesson with a song after it: the tool comes before the song.
    expect(lessonSteps({ ...v01, play: v03.play })).toEqual(['learn', 'tool', 'play', 'done'])
    expect(lessonSteps({ ...v02, play: v03.play })).toEqual(['learn', 'tool', 'play', 'done'])
  })

  it('keeps the tuner as the step it always was, and a practice round where there is one', () => {
    expect(lessonSteps(COURSE[1])).toEqual(['learn', 'tune', 'play', 'done'])
    // A lesson with a practice round runs no tool, whatever it names.
    expect(lessonSteps({ ...v03, tool: 'range' })).toEqual(['learn', 'try', 'play', 'done'])
    expect(lessonSteps(v03)).toEqual(['learn', 'try', 'play', 'done'])
    // No tool, no round, no song: the cards and the finish.
    expect(lessonSteps({ ...v01, tool: undefined })).toEqual(['learn', 'done'])
  })

  it('names the step after what the learner does in it', () => {
    expect(stepLabel(v01, 'tool')).toBe('Find your easy notes')
    expect(stepLabel(v02, 'tool')).toBe('Meet the note')
    expect(stepLabel(v03, 'play')).toBe('Sing')
    expect(stepLabel(COURSE[0], 'play')).toBe('Play')
    expect(stepLabel(COURSE[1], 'tune')).toBe('Tune up')
    // Every step there is has a name of its own, also one a lesson does not say more about.
    const all: StepId[] = ['learn', 'tune', 'tool', 'try', 'play', 'done']
    for (const step of all) expect(STEP_LABEL[step].length, step).toBeGreaterThan(2)
    expect(new Set(all.map((s) => STEP_LABEL[s])).size).toBe(all.length)
  })

  it('leaves every guitar step with the name it had, and gives no singing step a guitar name', () => {
    for (const lesson of COURSE) for (const step of lessonSteps(lesson)) expect(stepLabel(lesson, step), `${lesson.id} ${step}`).toBe(STEP_LABEL[step])
    for (const lesson of VOICE_COURSE) {
      for (const step of lessonSteps(lesson)) {
        expect(stepLabel(lesson, step), `${lesson.id} ${step}`).not.toMatch(GUITAR_WORDS)
        expect(stepLabel(lesson, step).length).toBeGreaterThan(2)
      }
    }
  })

  it('opens at the tool until it has been used, and never jumps over it', () => {
    const row = (lesson: Lesson, patch: Partial<LessonProgress>): LessonProgress => ({ id: lesson.id, status: 'available', ...patch })
    expect(resumeStep(v01, row(v01, { learnSeen: true }))).toBe('tool')
    expect(resumeStep(v01, row(v01, { learnSeen: true, drillDone: true }))).toBe('done')
    expect(resumeStep(v02, row(v02, { learnSeen: true }))).toBe('tool')
    expect(stepAfterCards(v01, row(v01, {}))).toBe('tool')
    expect(firstOpenStep({ ...v01, play: v03.play }, row(v01, { learnSeen: true, playDone: true }))).toBe('tool')
    expect(firstOpenStep({ ...v01, play: v03.play }, row(v01, { learnSeen: true, drillDone: true }))).toBe('play')
    for (const lesson of VOICE_COURSE) {
      const steps = lessonSteps(lesson)
      for (const learnSeen of [false, true]) for (const drillDone of [false, true]) for (const playDone of [false, true]) {
        const at = resumeStep(lesson, { id: lesson.id, status: 'available', learnSeen, drillDone, playDone })
        const done: Record<string, boolean> = { learn: learnSeen, try: drillDone, tune: drillDone, tool: drillDone, play: playDone }
        expect(steps).toContain(at)
        for (const before of steps.slice(0, steps.indexOf(at))) expect(done[before], `${lesson.id} opens at ${at} over ${before}`).toBe(true)
      }
    }
  })
})

describe('the step after a step', () => {
  it('names the next step in order, and the finish after the last', () => {
    expect(stepAfter(v03, 'learn')).toBe('try')
    expect(stepAfter(v03, 'try')).toBe('play')
    expect(stepAfter(v03, 'play')).toBe('done')
    expect(stepAfter(v03, 'done')).toBe('done')
    // The first two singing lessons end on their tool; the tuner lesson has its song in between.
    expect(stepAfter(v01, 'tool')).toBe('done')
    expect(stepAfter(v02, 'tool')).toBe('done')
    expect(stepAfter(COURSE[1], 'tune')).toBe('play')
  })
})

describe('finishing a lesson after its marks', () => {
  // The finish writes the lesson's row from what is stored at that moment. A mark that is still on its
  // way (the cards were read, the tool was used, the song was sung) would be written after it, from
  // the row as it was before, and would put the lesson back to "not done".
  const deferred = () => {
    let resolve!: () => void
    let reject!: (reason: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const watch = (settled: Promise<void>) => {
    const seen = { outcome: 'waiting' as 'waiting' | 'finished' | 'refused' }
    settled.then(
      () => (seen.outcome = 'finished'),
      () => (seen.outcome = 'refused'),
    )
    return seen
  }

  it('lets the finish through at once when no mark is on its way', async () => {
    const finish = watch(markQueue().settled())
    await turn()
    expect(finish.outcome).toBe('finished')
  })

  it('holds the finish back until every mark has been stored, in whatever order they land', async () => {
    const marks = markQueue()
    const cards = deferred()
    const song = deferred()
    marks.add(cards.promise)
    marks.add(song.promise)
    const finish = watch(marks.settled())
    await turn()
    expect(finish.outcome).toBe('waiting')
    song.resolve()
    await turn()
    // The later mark has landed, the earlier one has not.
    expect(finish.outcome).toBe('waiting')
    cards.resolve()
    await turn()
    expect(finish.outcome).toBe('finished')
  })

  it('does not hold the finish for ever, or refuse it, because a mark could not be stored', async () => {
    const marks = markQueue()
    const broken = deferred()
    const fine = deferred()
    marks.add(broken.promise)
    marks.add(fine.promise)
    const finish = watch(marks.settled())
    broken.reject(new Error('The store is full'))
    await turn()
    expect(finish.outcome).toBe('waiting')
    fine.resolve()
    await turn()
    expect(finish.outcome).toBe('finished')
  })

  it('also waits for a mark that is handed over while the finish is waiting', async () => {
    const marks = markQueue()
    const first = deferred()
    const late = deferred()
    marks.add(first.promise)
    const finish = watch(marks.settled())
    marks.add(late.promise)
    first.resolve()
    await turn()
    expect(finish.outcome).toBe('waiting')
    late.resolve()
    await turn()
    expect(finish.outcome).toBe('finished')
  })

  it('keeps the marks of one lesson apart from those of another', async () => {
    const one = markQueue()
    const other = markQueue()
    one.add(deferred().promise)
    const finish = watch(other.settled())
    await turn()
    expect(finish.outcome).toBe('finished')
  })
})

describe('coming back to a singing lesson that was left half way', () => {
  const row = (lesson: Lesson, patch: Partial<LessonProgress> = {}): LessonProgress => ({ id: lesson.id, status: 'available', ...patch })

  it('says what comes next in a singer\'s words', () => {
    expect(resumeOffer(v01, row(v01))).toBeNull()
    expect(resumeOffer(v01, row(v01, { learnSeen: true }))).toMatchObject({ step: 'tool', title: 'Welcome back', action: 'Find my easy notes' })
    expect(resumeOffer(v01, row(v01, { learnSeen: true }))!.body).toMatch(/easy notes/)
    expect(resumeOffer(v02, row(v02, { learnSeen: true }))).toMatchObject({ step: 'tool', action: 'Meet the note' })
    expect(resumeOffer(v02, row(v02, { learnSeen: true }))!.body).toMatch(/hear a note/)
    expect(resumeOffer(v03, row(v03, { learnSeen: true }))).toMatchObject({ step: 'try', action: 'Go to the practice' })
    expect(resumeOffer(v03, row(v03, { learnSeen: true, drillDone: true }))).toMatchObject({ step: 'play', action: 'Sing the song' })
    expect(resumeOffer(v03, row(v03, { learnSeen: true, drillDone: true }))!.body).toBe('You have read the cards and done the practice round. Next you sing the song.')
    expect(resumeOffer(v03, row(v03, { learnSeen: true, drillDone: true, playDone: true }))).toMatchObject({ step: 'done', action: 'Finish the lesson' })
  })

  it('says which tool was used when a song follows it', () => {
    const withSong = (lesson: Lesson): Lesson => ({ ...lesson, play: v03.play })
    expect(resumeOffer(withSong(v01), row(v01, { learnSeen: true, drillDone: true }))!.body).toBe('You have read the cards and found your easy notes. Next you sing the song.')
    expect(resumeOffer(withSong(v02), row(v02, { learnSeen: true, drillDone: true }))!.body).toBe('You have read the cards and met the note. Next you sing the song.')
  })

  it('never speaks to a singer of a guitar, of playing or of tuning', () => {
    const lessons = [...VOICE_COURSE, { ...v01, play: v03.play }, { ...v02, play: v03.play }]
    let offers = 0
    for (const lesson of lessons) {
      for (const drillDone of [false, true]) for (const playDone of [false, true]) {
        const offer = resumeOffer(lesson, row(lesson, { learnSeen: true, drillDone, playDone }))
        expect(offer, lesson.id).not.toBeNull()
        const text = `${offer!.title} ${offer!.body} ${offer!.action}`
        expect(text, lesson.id).not.toMatch(GUITAR_WORDS)
        expect(text, lesson.id).not.toMatch(UNKIND)
        offers++
      }
    }
    expect(offers).toBe(lessons.length * 4)
  })

  it('still tells a guitarist what it always did', () => {
    const tune = COURSE[1]
    const chord = COURSE[4]
    expect(resumeOffer(tune, row(tune, { learnSeen: true }))).toEqual({ step: 'tune', title: 'Welcome back', body: 'You have read the cards of this lesson. Next you tune your guitar.', action: 'Tune up' })
    expect(resumeOffer(tune, row(tune, { learnSeen: true, drillDone: true }))).toEqual({
      step: 'play',
      title: 'Welcome back',
      body: 'You have read the cards and tuned your guitar. Next you play the song.',
      action: 'Play the song',
    })
    expect(resumeOffer(chord, row(chord, { learnSeen: true, drillDone: true }))!.body).toBe('You have read the cards and done the practice round. Next you play the song.')
  })
})

describe('the line shown before a lesson song, by course', () => {
  it('tells a singer about the song and what this level of it asks for', () => {
    const buns = vocalSong('sing-hot-cross-buns')!
    expect(songHint(v03, v03.play!)).toBe(`${buns.description} ${VOICE_LEVELS[0].about}`)
    expect(songHint(v05, v05.play!)).toBe(`${buns.description} ${VOICE_LEVELS[2].about}`)
    // Not the same line for every level: the echo level and the whole tune ask for different things.
    expect(songHint(v03, v03.play!)).not.toBe(songHint(v05, v05.play!))
  })

  it('speaks of the song the singer chose for the last lesson', () => {
    const saints = lessonPlayFor(v10, 'sing-saints')!
    expect(songHint(v10, saints)).toContain(vocalSong('sing-saints')!.description)
    expect(songHint(v10, lessonPlayFor(v10)!)).toContain(vocalSong('sing-ode-to-joy')!.description)
  })

  it('never tells a singer to strum, to play, or that the song is slowed down', () => {
    let seen = 0
    for (const lesson of VOICE_COURSE) {
      if (!lesson.play) continue
      const hint = songHint(lesson, lesson.play, 'A line that belongs to a guitar song.')
      expect(hint, lesson.id).not.toMatch(GUITAR_WORDS)
      expect(hint, lesson.id).not.toMatch(/slow/i)
      expect(hint, lesson.id).not.toMatch(UNKIND)
      expect(hint, lesson.id).not.toContain('belongs to a guitar song')
      seen++
    }
    expect(seen).toBe(8)
  })

  it('gives a guitar lesson the line it always had', () => {
    for (const lesson of COURSE) if (lesson.play) expect(songHint(lesson, lesson.play, 'A famous melody.')).toBe(lessonSongHint(lesson.play.view, 'A famous melody.'))
    expect(songHint(COURSE[4], COURSE[4].play!, 'One easy chord, strummed to a steady beat.')).toBe('One easy chord, strummed to a steady beat. Strum the whole chord, every string of it, each time the notes reach the line.')
  })
})

describe('the closing line of a singing lesson', () => {
  it('only says what was sung when the song was sung', () => {
    expect(doneText(v03, { playDone: true })).toBe(v03.done)
    for (const progress of [{ playDone: false }, {}, null, undefined]) {
      expect(doneText(v03, progress)).toMatch(/song has not been sung/)
      expect(doneText(v03, progress)).not.toMatch(GUITAR_WORDS)
      expect(doneText(v03, progress)).not.toMatch(UNKIND)
    }
    // A lesson without a song has nothing to hold back.
    expect(doneText(v01, undefined)).toBe(v01.done)
  })
})

describe('the result card of a round', () => {
  const run = (summary: ScoreSummary, round = 1) => ({ verdict: 'counted' as const, summary, fraction: hitFraction(summary), round })

  it('shows a guitarist exactly what it showed before', () => {
    const counted = roundCopy(COURSE[2], run(summaryOf(5, 1, 2)))
    expect(counted.title).toBe('You hit 6 of 8 notes.')
    expect(counted.body).toBeNull()
    expect(counted.tip).toBe(tipFor(COURSE[2], 0.75, 1))
    expect(counted.tip).toMatch(/^If /)
    expect(roundCopy(COURSE[2], { ...run(summaryOf(0, 0, 0)), verdict: 'unscored' })).toEqual({
      title: 'We did not hear any notes this time.',
      body: 'Check that the microphone is allowed and that the phone is close to your guitar, then try again. If the guitar may be out of tune, tune it first.',
      tip: null,
    })
    expect(roundCopy(COURSE[2], { ...run(summaryOf(2, 2, 4)), verdict: 'bleed' })).toEqual({ ...NOT_COUNTED.bleed, tip: null })
    expect(roundCopy(COURSE[2], { ...run(summaryOf(2, 2, 4)), verdict: 'partial' })).toEqual({ ...NOT_COUNTED.partial, tip: null })
  })

  it('tells a singer how many notes they were on', () => {
    const copy = roundCopy(v03, run(sungSummary(6, 2)))
    expect(copy.title).toBe('You were on the note for 6 of 8 notes.')
    expect(copy.body).toBeNull()
    expect(roundCopy(v03, run(sungSummary(1, 0))).title).toBe('You were on the note for 1 of 1 note.')
  })

  it('gives a singer the one tip the run itself gave', () => {
    expect(roundCopy(v03, run(sungSummary(5, 3, { low: 3 }))).tip).toBe(VOICE_TIPS.low)
    expect(roundCopy(v03, run(sungSummary(5, 3, { silent: 2, high: 1 }))).tip).toBe(VOICE_TIPS.silent)
    expect(roundCopy(v03, run(sungSummary(8, 0, {}, -1))).tip).toBe(VOICE_TIPS.octaveLower)
  })

  it('never tells a singer not to slide after a round of slides', () => {
    const slid = sungSummary(6, 0, { slid: 6 })
    expect(roundCopy(v03, run(slid)).tip).toBe(VOICE_TIPS.slid)
    expect(roundCopy(v09, run(slid), { voice: { glide: true } }).tip).not.toBe(VOICE_TIPS.slid)
  })

  it('falls back on the tips of the skill being sung, then on the lines of the cards', () => {
    const match = skillById('voice.pitch.match')!
    const weak = sungSummary(3, 5)
    // The last lesson warms up with "Match a note": its first cards are about the song and about headphones.
    expect(roundCopy(v10, run(weak, 1), { skillTips: match.tips }).tip).toBe(match.tips[0])
    expect(roundCopy(v10, run(weak, 2), { skillTips: match.tips }).tip).toBe(match.tips[1])
    expect(roundCopy(v10, run(weak, match.tips.length + 1), { skillTips: match.tips }).tip).toBe(v10.learn.flatMap((c) => c.mistakes ?? [])[0])
    // The song step has no skill: the lines of the cards, as on the guitar side.
    expect(roundCopy(v10, run(weak, 1)).tip).toMatch(/^If /)
    // A guitar round keeps the order it had: the lesson first.
    expect(tipFor(COURSE[2], 0.4, 1, ['A tip of the skill.'])).toMatch(/^If /)
  })

  it('has a kind word for a round that went well, in a singer\'s words', () => {
    const clean = roundCopy(v03, run(sungSummary(8, 0)), { skillTips: skillById('voice.pitch.match')!.tips })
    expect(clean.tip).not.toBeNull()
    expect(clean.tip).not.toMatch(/^If /)
    expect(clean.tip).not.toBe(tipFor(COURSE[2], 0.95, 1))
    expect(clean.tip).not.toMatch(GUITAR_WORDS)
    expect(tipFor(COURSE[2], 0.95, 1)).toBe('Lovely and clean. Keep that relaxed feeling.')
    // A lesson with no lines and a skill with no tips still gets something a singer can do.
    const bare: Lesson = { ...v03, learn: v03.learn.map((c) => ({ ...c, mistakes: undefined })) }
    expect(tipFor(bare, 0.4, 1)).not.toMatch(GUITAR_WORDS)
    expect(tipFor(bare, 0.4, 1)).not.toMatch(/slower/)
    expect(tipFor({ ...COURSE[0], learn: [] }, 0.4, 1)).toBe('Try it a little slower and keep your hand relaxed.')
  })

  it('tells a singer in their own words why a run did not count', () => {
    for (const verdict of ['unscored', 'bleed', 'partial'] as const) {
      const copy = roundCopy(v03, { ...run(sungSummary(0, 8, { silent: 8 })), verdict })
      expect(copy).toEqual({ ...NOT_COUNTED_VOICE[verdict], tip: null })
      expect(`${copy.title} ${copy.body}`).not.toMatch(/guitar/i)
    }
  })

  it('is the count of notes and one tip for a singer, with no line about timing, through every round', () => {
    // Nothing on the card is made from how early or late the notes were. The tip is what the run itself
    // showed, the kind word for a round that went well, or a line written for this lesson or its skill.
    // "Again" turns through all of those lines, so every round is looked at here, not the first three.
    const runs = [sungSummary(8, 0), sungSummary(6, 2, { low: 2 }), sungSummary(2, 6, { silent: 3, unsteady: 3 }), sungSummary(8, 0, { slid: 4 }), sungSummary(8, 0, {}, 1), sungSummary(0, 8, { high: 8 }), sungSummary(3, 5)]
    const fromTheRun: string[] = Object.values(VOICE_TIPS)
    const kind = 'Lovely. You were right on the notes. Keep that easy feeling.'
    expect(kind).not.toMatch(TIMING)
    for (const lesson of VOICE_COURSE) {
      const tips = lesson.drill ? skillById(lesson.drill.skillId)!.tips : []
      const written = [...tips, ...lesson.learn.flatMap((c) => c.mistakes ?? [])]
      const shown = new Set<string>()
      for (const summary of runs) for (let round = 1; round <= written.length + 1; round++) {
        const copy = roundCopy(lesson, run(summary, round), { skillTips: tips })
        const where = `${lesson.id}, round ${round}: ${copy.tip}`
        expect(copy.body, where).toBeNull()
        // The only numbers on the card are the two counts of notes.
        expect(copy.title, where).toMatch(/^You were on the note for \d+ of \d+ notes?\.$/)
        expect(copy.title, where).not.toMatch(TIMING)
        expect([...fromTheRun, kind, ...written], where).toContain(copy.tip)
        expect(copy.tip, where).not.toMatch(TIMING_VERDICT)
        expect(`${copy.title} ${copy.tip}`, where).not.toMatch(UNKIND)
        if (copy.tip !== null && written.includes(copy.tip)) shown.add(copy.tip)
      }
      // A weak round the run has nothing to say about turns through every line there is, and no other.
      expect(shown.size, lesson.id).toBe(new Set(written).size)
    }
  })

  it('still counts the notes of a sung run that carries nothing else about them', () => {
    // A summary that was put together from a stored result has the counts and no word about the notes.
    const copy = roundCopy(v03, run(summaryOf(3, 2, 3), 2))
    expect(copy.title).toBe('You were on the note for 5 of 8 notes.')
    expect(copy.body).toBeNull()
    expect(copy.tip).toBe(tipFor(v03, 5 / 8, 2))
    expect(copy.tip).not.toBe(tipFor(v03, 5 / 8, 1))
  })
})

describe('the line under the result', () => {
  it('speaks of singing after a sung song and of playing after a played one', () => {
    expect(songNote(COURSE[0], true)).toBe('Well played. You can go again, or carry on to finish the lesson.')
    expect(songNote(COURSE[0], false)).toBe('Have another go: watch the notes come down and play each one as it reaches the line. You can also carry on and come back to this song later.')
    for (const passed of [true, false]) {
      expect(songNote(v03, passed)).toMatch(/\b(sing|sung)\b/)
      expect(songNote(v03, passed)).not.toMatch(GUITAR_WORDS)
      expect(songNote(v03, passed)).not.toMatch(UNKIND)
      expect(songNote(v03, passed)).not.toMatch(TIMING)
    }
    expect(songNote(v03, true)).not.toBe(songNote(v03, false))
  })

  it('says whether a practice round is enough to move on', () => {
    expect(practiceNote(false, false)).toBe('Listen first, then go again. It gets easier each time you try.')
    expect(practiceNote(true, true)).toBe('That is enough to move on. You can go again if you want more practice.')
    expect(practiceNote(true, false)).toBe('Not quite there yet, and that is fine. You can move on and come back to this later, or go again now.')
    for (const text of [practiceNote(false, false), practiceNote(true, true), practiceNote(true, false)]) {
      expect(text).not.toMatch(GUITAR_WORDS)
      expect(text).not.toMatch(UNKIND)
    }
  })

  it('says so when a song was moved down for the singer', () => {
    expect(KEY_LOWERED_LINE).toBe('That one sat high for you, so we moved the song down a little.')
  })
})

describe('a practice round that could not be set up', () => {
  it('tells a guitarist what it always did, with the reason in brackets', () => {
    expect(practiceTrouble(COURSE[0], 'Unknown skill picking.open')).toBe('We could not set up this practice. (Unknown skill picking.open)')
    expect(practiceTrouble(COURSE[0], null)).toBe('We could not set up this practice.')
  })

  it('keeps the reason from a singer: it is written in note numbers', () => {
    // What a round says when it cannot be placed: "The range 55 to 48 is too small to sing an exercise in".
    let reason = ''
    try {
      lessonDrillExercise(v03, DEFAULT_TUNING, { low: 55, high: 48, easy: 52 })
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err)
    }
    expect(reason).toMatch(/\d/)
    for (const said of [practiceTrouble(v03, reason), practiceTrouble(v03, null)]) {
      expect(said).toMatch(/^We could not set up this practice\./)
      expect(said).not.toMatch(/\d/)
      expect(said).not.toContain(reason)
      expect(said).not.toMatch(UNKIND)
      expect(said).not.toMatch(GUITAR_WORDS)
      // It says what the singer can do: go on with the lesson.
      expect(said).toMatch(/carry on/)
    }
  })
})

describe('the box of common slips on a card', () => {
  it('has a heading without the word the singing copy never uses', () => {
    expect(mistakesHeading(COURSE[0])).toBe('If something goes wrong')
    for (const lesson of VOICE_COURSE) {
      expect(mistakesHeading(lesson)).not.toMatch(UNKIND)
      expect(mistakesHeading(lesson)).toMatch(/^If /)
    }
  })
})

describe('which lesson a typed address opens', () => {
  it('does not find a singing lesson while the singing side is switched off', () => {
    expect(lessonOnScreen('v03-match', false)).toBeUndefined()
    expect(lessonOnScreen('v03-match', true)).toBe(v03)
    for (const lesson of VOICE_COURSE) expect(lessonOnScreen(lesson.id, false), lesson.id).toBeUndefined()
  })

  it('finds a guitar lesson either way, and no lesson for an unknown id', () => {
    for (const on of [false, true]) {
      for (const lesson of COURSE) expect(lessonOnScreen(lesson.id, on)).toBe(lesson)
      expect(lessonOnScreen('l99-nothing', on)).toBeUndefined()
      expect(lessonOnScreen('', on)).toBeUndefined()
      expect(lessonOnScreen(undefined, on)).toBeUndefined()
    }
  })
})

describe('whether a course may be shown and started', () => {
  // What the profile hooks answer: a guitarist and a singer who have each been through their set-up,
  // and the rows of two who have not (a row that is not stored yet is answered with its defaults).
  const guitarist = { id: 1 as const, experience: 'new' as const, placementDoneAt: 1700000000000 }
  const singer = { id: 2 as const, experience: 'some' as const, placementDoneAt: 1700000000000 }
  const newGuitarist = { id: 1 as const }
  const newSinger = { id: 2 as const }

  it('shows the guitar course at once, as it always did', () => {
    // The guitar course is made the first time it is looked at, whatever the profile says and before it is read.
    for (const profile of [undefined, newGuitarist, guitarist, newSinger, singer]) expect(courseGate('guitar', profile)).toBe('open')
  })

  it('waits for the singing profile, and sends a singer who has not been through the set-up there', () => {
    expect(courseGate('voice', undefined)).toBe('waiting')
    expect(courseGate('voice', newSinger)).toBe('set-up')
    // Both answers of the set-up are needed: half a set-up is no set-up.
    expect(courseGate('voice', { id: 2, experience: 'new' })).toBe('set-up')
    expect(courseGate('voice', { id: 2, placementDoneAt: 1700000000000 })).toBe('set-up')
    expect(courseGate('voice', singer)).toBe('open')
  })

  it('never takes the guitar profile for the singer\'s', () => {
    // Right after the switch from guitar to singing a live query still answers with the row it had, the
    // guitarist's. That guitarist is set up; the singer may not be. Opening on it would start the
    // singing course (write its ten rows) before the singing set-up has run.
    expect(courseGate('voice', guitarist)).toBe('waiting')
    expect(courseGate('voice', newGuitarist)).toBe('waiting')
  })

  it('hands a page the profile of its own instrument and no other', () => {
    expect(ownProfile('guitar', guitarist)).toBe(guitarist)
    expect(ownProfile('voice', singer)).toBe(singer)
    expect(ownProfile('voice', guitarist)).toBeUndefined()
    expect(ownProfile('guitar', singer)).toBeUndefined()
    expect(ownProfile('guitar', undefined)).toBeUndefined()
    expect(ownProfile('voice', undefined)).toBeUndefined()
  })
})

describe('the course page', () => {
  const rows = (course: Lesson[], done: number): LessonProgress[] =>
    course.map((l, i): LessonProgress => ({ id: l.id, status: i < done ? 'done' : i === done ? 'available' : 'locked' }))

  it('names the lesson that is open, also when lessons were done out of order or rows are missing', () => {
    // Someone who left the course may do any lesson: the first two and the fifth are done, the third is open.
    const outOfOrder: LessonProgress[] = VOICE_COURSE.map((l, i): LessonProgress => ({ id: l.id, status: [0, 1, 4].includes(i) ? 'done' : i === 2 ? 'available' : 'locked' }))
    expect(courseSummary(VOICE_COURSE, outOfOrder)).toMatchObject({ done: 3, label: 'Lesson 3 of 10' })
    expect(courseSummary(VOICE_COURSE, outOfOrder).next).toBe(VOICE_COURSE[2])
    // No lesson is open (the rows are still on their way): the one after those that are done.
    expect(courseSummary(VOICE_COURSE, [{ id: 'v01-voice', status: 'done' }])).toMatchObject({ done: 1, next: undefined, label: 'Lesson 2 of 10' })
    // A row of a lesson the course no longer has is not one of its lessons.
    expect(courseSummary(COURSE, [...rows(COURSE, 2), { id: 'l99-retired', status: 'done' }])).toMatchObject({ done: 2, label: 'Lesson 3 of 10' })
  })

  it('counts the lessons of one course only', () => {
    // The lesson table holds both courses: three guitar lessons done, one singing lesson done.
    const table = [...rows(COURSE, 3), ...rows(VOICE_COURSE, 1)]
    expect(courseSummary(COURSE, table)).toMatchObject({ done: 3, label: 'Lesson 4 of 10' })
    expect(courseSummary(COURSE, table).next).toBe(COURSE[3])
    expect(courseSummary(VOICE_COURSE, table)).toMatchObject({ done: 1, label: 'Lesson 2 of 10' })
    expect(courseSummary(VOICE_COURSE, table).next).toBe(VOICE_COURSE[1])
  })

  it('does not call a course finished because the other one is', () => {
    const table = [...rows(COURSE, 10), ...rows(VOICE_COURSE, 0)]
    expect(courseSummary(COURSE, table)).toMatchObject({ done: 10, label: 'All 10 lessons done' })
    expect(courseSummary(COURSE, table).next).toBeUndefined()
    expect(courseSummary(VOICE_COURSE, table)).toMatchObject({ done: 0, label: 'Lesson 1 of 10' })
    // Nothing stored yet (or still loading): the first lesson, nothing done.
    expect(courseSummary(VOICE_COURSE, undefined)).toMatchObject({ done: 0, label: 'Lesson 1 of 10' })
    expect(courseSummary(VOICE_COURSE, rows(COURSE, 10))).toMatchObject({ done: 0, label: 'Lesson 1 of 10' })
  })

  it('is worded for the course it shows', () => {
    expect(courseCopy('guitar', COURSE)).toMatchObject({
      subtitle: 'Ten short lessons, from holding the guitar to playing your first songs.',
      songsTitle: 'Songs you can play now',
      noSongs: 'Finish a lesson and your first songs will appear here.',
      songAction: 'Play',
    })
    const voice = courseCopy('voice', VOICE_COURSE)
    expect(voice.songAction).toBe('Sing')
    expect(voice.songsTitle).toMatch(/sing/)
    for (const text of Object.values(voice)) {
      expect(text).not.toMatch(GUITAR_WORDS)
      expect(text).not.toMatch(UNKIND)
    }
    // The first lessons of the singing course open no song, so "finish a lesson" would promise too much.
    const firstWithSong = VOICE_COURSE.find((l) => l.unlocks.length > 0)!
    expect(firstWithSong.number).toBeGreaterThan(1)
    expect(voice.noSongs).toContain(`lesson ${firstWithSong.number}`)
  })
})

describe('the songs a singing lesson opens', () => {
  const titles = (songs: { title: string }[]) => songs.map((s) => s.title)

  it('lists a song as new only when it fits the singer\'s easy notes', () => {
    // Lesson 8 opens When the Saints (eight notes wide at most) and London Bridge (wider).
    expect(v08.unlocks).toEqual(['sing-saints', 'sing-london-bridge'])
    const small = songsToSing(v08.unlocks, DEFAULT_RANGES.lower)
    expect(titles(small.ready)).toEqual(['When the Saints Go Marching In'])
    expect(titles(small.later)).toEqual(['London Bridge'])
    const wide = songsToSing(v08.unlocks, { low: 48, high: 62 })
    expect(titles(wide.ready)).toEqual(['When the Saints Go Marching In', 'London Bridge'])
    expect(wide.later).toEqual([])
  })

  it('keeps every song of the course in one list or the other, in the order the lessons open them', () => {
    const ids = VOICE_COURSE.flatMap((l) => l.unlocks)
    for (const range of [DEFAULT_RANGES.lower, DEFAULT_RANGES.higher, { low: 45, high: 59 }]) {
      const { ready, later } = songsToSing(ids, range)
      expect([...ready, ...later].map((s) => s.id).sort()).toEqual([...ids].sort())
      expect(ready.map((s) => s.id)).toEqual(ids.filter((id) => ready.some((s) => s.id === id)))
    }
    // In the smallest range only the two wide songs wait.
    expect(songsToSing(ids, DEFAULT_RANGES.higher).later.map((s) => s.id)).toEqual(['sing-london-bridge', 'sing-twinkle'])
  })

  it('says kindly why a song waits, for one song and for several', () => {
    expect(COMES_LATER.why(1)).toMatch(/^This one needs /)
    expect(COMES_LATER.why(2)).toMatch(/^These need /)
    for (const text of [COMES_LATER.title, COMES_LATER.why(1), COMES_LATER.why(3), COMES_LATER.thisSong]) {
      expect(text).not.toMatch(UNKIND)
      expect(text).not.toMatch(GUITAR_WORDS)
      expect(text).not.toMatch(/too (high|low|hard|wide)|cannot|can't/i)
    }
  })

  it('leaves out an id that is not a song to sing', () => {
    // In neither list: a guitar song is not one that "comes later" for a singer.
    const mixed = songsToSing(['open-string-groove', 'sing-saints', 'nothing'], DEFAULT_RANGES.lower)
    expect(mixed.ready.map((s) => s.id)).toEqual(['sing-saints'])
    expect(mixed.later).toEqual([])
    expect(songsToSing(['ode-to-joy', 'nothing'], DEFAULT_RANGES.lower)).toEqual({ ready: [], later: [] })
    expect(songsToSing([], DEFAULT_RANGES.lower)).toEqual({ ready: [], later: [] })
  })
})

describe('after a round of slides', () => {
  const chartOf = (lesson: Lesson): Chart => lessonDrillExercise(lesson, DEFAULT_TUNING, DEFAULT_RANGES.lower).chart

  it('asks how it felt after slides, and after nothing else', () => {
    expect(asksHowItFelt(chartOf(v09))).toBe(true)
    for (const lesson of VOICE_COURSE) if (lesson.drill && lesson !== v09) expect(asksHowItFelt(chartOf(lesson)), lesson.id).toBe(false)
    expect(asksHowItFelt(lessonDrillExercise(COURSE[0], DEFAULT_TUNING).chart)).toBe(false)
  })

  it('offers the three answers the lesson card promises', () => {
    // "After the slides the app asks how they felt: easy, OK or tight."
    expect(v09.learn.flatMap((c) => c.paragraphs).join(' ')).toMatch(/easy, OK or tight/)
    expect([FELT_COPY.easy, FELT_COPY.ok, FELT_COPY.tight]).toEqual(['Easy', 'OK', 'Tight'])
    expect(FELT_COPY.question).toMatch(/feel\?$/)
  })

  it('only says the app stays lower when it does', () => {
    expect(feltReply('tight', true)).toMatch(/lower/)
    expect(feltReply('tight', false)).not.toMatch(/stays a little lower|moved/)
    expect(feltReply('easy', false)).not.toMatch(/lower/)
    expect(feltReply('ok', false)).not.toMatch(/lower/)
    const replies = [feltReply('easy', false), feltReply('ok', false), feltReply('tight', true), feltReply('tight', false)]
    expect(new Set(replies).size).toBe(4)
    for (const text of [...replies, ...Object.values(FELT_COPY)]) {
      expect(text).not.toMatch(UNKIND)
      expect(text).not.toMatch(GUITAR_WORDS)
    }
  })
})
