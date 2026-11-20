import { db } from '../db/db'
import { completeFirstSteps } from '../training/coach'
import { COURSE, nextLessonAfter } from './course'
import { allLessonsDone, completeLesson, courseProgress, initialiseCourse } from './store'

/**
 * Completes a lesson, unlocks the next, and marks First steps finished once
 * every lesson is done. Returns whether the course is now complete.
 *
 * One transaction: if the app closes half way, the last lesson must not be stored as done while the
 * course still counts as running, because Today would then have no lesson to offer.
 */
export function finishLesson(id: string, now = Date.now()): Promise<{ courseComplete: boolean }> {
  const ids = COURSE.map((l) => l.id)
  const next = nextLessonAfter(id)
  return db.transaction('rw', db.lessons, db.profile, async () => {
    await completeLesson(id, next?.id ?? null, now)
    const complete = allLessonsDone(await courseProgress(), ids)
    if (complete) await completeFirstSteps(now)
    // The next lesson may have been done already (lessons replayed out of order): open whichever is left.
    else await initialiseCourse(ids, now)
    return { courseComplete: complete }
  })
}
