import { COURSE, nextAvailableLesson } from '../../lessons/course'
import type { LessonProgress } from '../../lessons/types'

export interface CourseEntry {
  title: string
  /** One or two plain sentences: where the learner stands in the course. */
  line: string
  /** Button label. */
  action: string
  to: string
}

/**
 * The card on Today that opens the First steps lessons. There is always one, whatever happened to
 * the course (finished, skipped, never started): the lessons are the only place that shows how to
 * hold the guitar or finger a chord, and the app has no other way to them.
 */
export function courseEntry(progress: LessonProgress[] | undefined): CourseEntry {
  const total = COURSE.length
  const doneIds = new Set((progress ?? []).filter((p) => p.status === 'done').map((p) => p.id))
  const done = COURSE.filter((l) => doneIds.has(l.id)).length
  const base = { title: 'First steps lessons', to: '/lessons' }
  if (done >= total) {
    return { ...base, line: `All ${total} lessons done. Open them any time to look something up, like how to hold a chord.`, action: 'Open the lessons' }
  }
  if (done === 0) {
    return { ...base, line: `${total} short lessons, from holding the guitar to playing your first songs. Open them any time.`, action: 'Open the lessons' }
  }
  const next = nextAvailableLesson(progress ?? []) ?? COURSE.find((l) => !doneIds.has(l.id))
  const nextText = next ? ` Next is lesson ${next.number}: ${next.title}.` : ''
  return { ...base, line: `You have done ${done} of ${total} lessons.${nextText}`, action: 'Carry on with the lessons' }
}

/**
 * A line for the top of the course page when the learner left the course for daily sessions with
 * lessons still to do: they came back, so say plainly that carrying on is fine. Null otherwise.
 */
export function resumeNote(profile: { firstStepsDoneAt?: number } | undefined, progress: LessonProgress[] | undefined): string | null {
  if (!profile?.firstStepsDoneAt || !progress) return null
  const doneIds = new Set(progress.filter((p) => p.status === 'done').map((p) => p.id))
  if (COURSE.every((l) => doneIds.has(l.id))) return null
  return 'You moved on to daily sessions before the end of these lessons. They are all still here: carry on with the next one whenever you like.'
}

/** Skipping the course takes two taps: the link only asks, and nothing is skipped until the answer is yes. */
export type SkipCourseStep = 'idle' | 'asking' | 'skipping'
export type SkipCourseAction = 'ask' | 'keep' | 'confirm' | 'settled'

export function skipCourseStep(step: SkipCourseStep, action: SkipCourseAction): SkipCourseStep {
  if (step === 'idle' && action === 'ask') return 'asking'
  if (step === 'asking' && action === 'keep') return 'idle'
  if (step === 'asking' && action === 'confirm') return 'skipping'
  // The save has ended. On success Today has already moved on; after a failure the question is shown again.
  if (step === 'skipping' && action === 'settled') return 'asking'
  return step
}
