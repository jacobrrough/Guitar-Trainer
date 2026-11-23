import { db } from '../db/db'
import { completeFirstSteps } from '../training/coach'
import { courseFor, instrumentOfLessonId } from '../training/instruments'
import { nextLessonAfter } from './course'
import { allLessonsDone, completeLesson, courseProgress, initialiseCourse } from './store'

/**
 * Completes a lesson, unlocks the next, and marks First steps finished once
 * every lesson is done. Returns whether the course is now complete.
 *
 * The lesson table holds two courses, guitar and singing. Which one this is about is read from the
 * lesson id, and everything below stays inside it: the next lesson, the "all done" count and the
 * profile the course is ended on. The finished lessons of one course never count for the other.
 *
 * One transaction: if the app closes half way, the last lesson must not be stored as done while the
 * course still counts as running, because Today would then have no lesson to offer.
 */
export function finishLesson(id: string, now = Date.now()): Promise<{ courseComplete: boolean }> {
  const instrument = instrumentOfLessonId(id)
  const course = courseFor(instrument)
  const ids = course.map((l) => l.id)
  const next = nextLessonAfter(id, course)
  return db.transaction('rw', db.lessons, db.profile, async () => {
    await completeLesson(id, next?.id ?? null, now)
    const complete = allLessonsDone(await courseProgress(ids), ids)
    // The instrument is handed over every time, never left to the default: left out, a finished singing
    // course would be written onto the guitar profile, and a guitarist still in their lessons would get daily plans.
    if (complete) await completeFirstSteps(now, instrument)
    // The next lesson may have been done already (lessons replayed out of order): open whichever is left.
    else await initialiseCourse(ids, now)
    return { courseComplete: complete }
  })
}
