import { describe, expect, it } from 'vitest'
import { COURSE } from '../../lessons/course'
import type { Lesson, LessonProgress } from '../../lessons/types'
import { VOICE_COURSE } from '../../lessons/voiceCourse'
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

/** Rows of one course with the first `done` lessons finished and the next one open. */
function rowsOf(course: Lesson[], done: number): LessonProgress[] {
  return course.map((l, i) => ({ id: l.id, status: i < done ? 'done' : i === done ? 'available' : 'locked' }))
}

/** Words that belong to the guitar course and must never be said about the singing one. */
const GUITAR_WORDS = /\b(guitars?|chords?|strings?|frets?|strum\w*|play\w*|tun(e|ing) (it|up))\b/i
/** Words the singing side never uses, and numbers a beginner cannot use. */
const UNKIND = /\b(wrong|fail\w*|tone.?deaf|loud\w*|push\w*|belt\w*|bpm|ratings?|accuracy|cents?|tiers?|reps?)\b/i

describe('courseEntry: the same card for the singing course', () => {
  const total = VOICE_COURSE.length

  it('answers for the guitar course when no course is named', () => {
    for (const progress of [undefined, [], rows(0), rows(3), rows(COURSE.length)]) {
      expect(courseEntry(progress)).toEqual(courseEntry(progress, COURSE))
    }
  })

  it('opens the lessons page and keeps the title, whichever course it is', () => {
    for (const done of [0, 4, total]) {
      const entry = courseEntry(rowsOf(VOICE_COURSE, done), VOICE_COURSE)
      expect(entry.to).toBe('/lessons')
      expect(entry.title).toBe('First steps lessons')
    }
  })

  it('tells a singer what the lessons lead to, in a singer\'s words', () => {
    for (const progress of [undefined, [], rowsOf(VOICE_COURSE, 0)]) {
      const entry = courseEntry(progress, VOICE_COURSE)
      expect(entry.line).toBe(`${total} short lessons, from finding your easy notes to singing your first whole song. Open them any time.`)
      expect(entry.action).toBe('Open the lessons')
    }
  })

  it('names the next singing lesson to a singer who is part way through', () => {
    const entry = courseEntry(rowsOf(VOICE_COURSE, 3), VOICE_COURSE)
    expect(entry.line).toBe(`You have done 3 of ${total} lessons. Next is lesson 4: ${VOICE_COURSE[3].title}.`)
    expect(entry.action).toBe('Carry on with the lessons')
  })

  it('tells a singer who finished what the lessons are still good for', () => {
    const entry = courseEntry(rowsOf(VOICE_COURSE, total), VOICE_COURSE)
    expect(entry.line).toContain(`All ${total} lessons done`)
    expect(entry.line).toMatch(/look something up/)
    expect(entry.action).toBe('Open the lessons')
  })

  it('counts the lessons of its own course only: the lesson table holds both', () => {
    // Every guitar lesson done, three singing lessons done.
    const both = [...rowsOf(COURSE, COURSE.length), ...rowsOf(VOICE_COURSE, 3)]
    expect(courseEntry(both, VOICE_COURSE).line).toBe(`You have done 3 of ${total} lessons. Next is lesson 4: ${VOICE_COURSE[3].title}.`)
    expect(courseEntry(both, COURSE).line).toContain(`All ${COURSE.length} lessons done`)
    // A singer who has not started is not told they are a graduate because the guitarist is one.
    expect(courseEntry(rowsOf(COURSE, COURSE.length), VOICE_COURSE).line).toContain(`${total} short lessons`)
    // And the open guitar lesson is nobody's next singing lesson.
    const guitarOpen = [...rowsOf(COURSE, 2), ...VOICE_COURSE.map((l, i): LessonProgress => ({ id: l.id, status: i === 0 ? 'done' : 'locked' }))]
    expect(courseEntry(guitarOpen, VOICE_COURSE).line).toBe(`You have done 1 of ${total} lessons. Next is lesson 2: ${VOICE_COURSE[1].title}.`)
  })

  it('says nothing about a guitar to a singer, and nothing unkind', () => {
    for (const done of [0, 1, 5, total]) {
      const entry = courseEntry(rowsOf(VOICE_COURSE, done), VOICE_COURSE)
      for (const text of [entry.title, entry.line, entry.action]) {
        expect(text, text).not.toMatch(GUITAR_WORDS)
        expect(text, text).not.toMatch(UNKIND)
      }
    }
  })
})

describe('resumeNote: for the course it is asked about', () => {
  it('answers for the guitar course when no course is named', () => {
    expect(resumeNote({ firstStepsDoneAt: 1 }, rows(3))).toBe(resumeNote({ firstStepsDoneAt: 1 }, rows(3), COURSE))
    expect(resumeNote({ firstStepsDoneAt: 1 }, rows(COURSE.length), COURSE)).toBeNull()
  })

  it('tells a singer who left the singing course that they can carry on', () => {
    expect(resumeNote({ firstStepsDoneAt: 1 }, rowsOf(VOICE_COURSE, 3), VOICE_COURSE)).toMatch(/carry on with the next one/)
  })

  it('says nothing to a singer who finished the singing course, whatever the guitar course looks like', () => {
    // Counted by the guitar course, a singing graduate would be told for ever that lessons remain.
    expect(resumeNote({ firstStepsDoneAt: 1 }, rowsOf(VOICE_COURSE, VOICE_COURSE.length), VOICE_COURSE)).toBeNull()
    expect(resumeNote({ firstStepsDoneAt: 1 }, [...rowsOf(COURSE, 2), ...rowsOf(VOICE_COURSE, VOICE_COURSE.length)], VOICE_COURSE)).toBeNull()
    // And finished guitar lessons do not finish the singing course.
    expect(resumeNote({ firstStepsDoneAt: 1 }, [...rowsOf(COURSE, COURSE.length), ...rowsOf(VOICE_COURSE, 3)], VOICE_COURSE)).not.toBeNull()
  })
})
