import { completeFirstSteps } from '../training/coach'
import { COURSE, nextLessonAfter } from './course'
import { allLessonsDone, completeLesson, courseProgress } from './store'

/**
 * Completes a lesson, unlocks the next, and marks First steps finished once
 * every lesson is done. Returns whether the course is now complete.
 */
export async function finishLesson(id: string, now = Date.now()): Promise<{ courseComplete: boolean }> {
  const next = nextLessonAfter(id)
  await completeLesson(id, next?.id ?? null, now)
  const complete = allLessonsDone(await courseProgress(), COURSE.map((l) => l.id))
  if (complete) await completeFirstSteps(now)
  return { courseComplete: complete }
}
