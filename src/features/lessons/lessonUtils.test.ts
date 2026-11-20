import { describe, expect, it } from 'vitest'
import { COURSE } from '../../lessons/course'
import type { LessonProgress } from '../../lessons/types'
import { doneText, feedbackLine, firstOpenStep, hitFraction, lessonSongHint, lessonSteps, resumeOffer, resumeStep, stepAfterCards, tipFor } from './lessonUtils'

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

