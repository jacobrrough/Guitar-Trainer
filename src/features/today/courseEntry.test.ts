import { describe, expect, it } from 'vitest'
import { COURSE } from '../../lessons/course'
import type { LessonProgress } from '../../lessons/types'
import { courseEntry, resumeNote, skipCourseStep, type SkipCourseAction, type SkipCourseStep } from './courseEntry'

/** Course rows with the first `done` lessons finished and the next one open. */
function rows(done: number): LessonProgress[] {
  return COURSE.map((l, i) => ({ id: l.id, status: i < done ? 'done' : i === done ? 'available' : 'locked' }))
}

describe('courseEntry: the way back to the lessons from Today', () => {
  it('is there for a graduate, to look things up', () => {
    const entry = courseEntry(rows(COURSE.length))
    expect(entry.to).toBe('/lessons')
    expect(entry.title).toBe('First steps lessons')
    expect(entry.line).toContain(`All ${COURSE.length} lessons done`)
    expect(entry.action).toBe('Open the lessons')
  })

  it('is there after the course was skipped part way, and says where to carry on', () => {
    const entry = courseEntry(rows(3))
    expect(entry.to).toBe('/lessons')
    expect(entry.line).toBe(`You have done 3 of ${COURSE.length} lessons. Next is lesson 4: ${COURSE[3].title}.`)
    expect(entry.action).toBe('Carry on with the lessons')
  })

  it('is there for someone who never started the course', () => {
    for (const progress of [undefined, [], rows(0)]) {
      const entry = courseEntry(progress)
      expect(entry.to).toBe('/lessons')
      expect(entry.line).toContain(`${COURSE.length} short lessons`)
      expect(entry.action).toBe('Open the lessons')
    }
  })

  it('names the first lesson left when none is marked open', () => {
    const progress: LessonProgress[] = COURSE.map((l, i) => ({ id: l.id, status: i === 0 || i === 2 ? 'done' : 'locked' }))
    expect(courseEntry(progress).line).toContain(`Next is lesson 2: ${COURSE[1].title}.`)
  })

  it('ignores rows of lessons that no longer exist', () => {
    const progress: LessonProgress[] = [...rows(1), { id: 'old-lesson', status: 'done' }]
    expect(courseEntry(progress).line).toContain(`You have done 1 of ${COURSE.length} lessons.`)
  })
})

describe('resumeNote: the course page after the course was skipped', () => {
  it('tells someone who skipped part way that they can carry on', () => {
    expect(resumeNote({ firstStepsDoneAt: 1 }, rows(3))).toMatch(/carry on with the next one/)
    expect(resumeNote({ firstStepsDoneAt: 1 }, rows(0))).not.toBeNull()
  })

  it('says nothing while the course is running, to a graduate, or before the data is there', () => {
    expect(resumeNote({}, rows(3))).toBeNull()
    expect(resumeNote({ firstStepsDoneAt: 1 }, rows(COURSE.length))).toBeNull()
    expect(resumeNote(undefined, rows(3))).toBeNull()
    expect(resumeNote({ firstStepsDoneAt: 1 }, undefined)).toBeNull()
  })
})

describe('skipCourseStep: skipping the course asks first', () => {
  const run = (actions: SkipCourseAction[], from: SkipCourseStep = 'idle') => actions.reduce(skipCourseStep, from)

  it('does not skip on the first tap', () => {
    expect(run(['ask'])).toBe('asking')
    // A second tap on the same link changes nothing either.
    expect(run(['ask', 'ask'])).toBe('asking')
  })

  it('skips only after the answer is yes', () => {
    expect(run(['ask', 'confirm'])).toBe('skipping')
    expect(run(['confirm'])).toBe('idle')
  })

  it('goes back to the course when the answer is no', () => {
    expect(run(['ask', 'keep'])).toBe('idle')
    expect(run(['ask', 'keep', 'confirm'])).toBe('idle')
  })

  it('cannot be confirmed twice, and asks again if saving failed', () => {
    expect(run(['ask', 'confirm', 'confirm'])).toBe('skipping')
    expect(run(['ask', 'confirm', 'keep'])).toBe('skipping')
    expect(run(['ask', 'confirm', 'settled'])).toBe('asking')
  })
})
