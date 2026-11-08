import { db } from '../db/db'
import type { LessonProgress } from './types'

/**
 * Lesson progress (Dexie table `lessons`). The lessons package may extend this
 * file; these three signatures are the contract the coach relies on.
 */

/** Creates progress rows for the course if missing: lesson 1 available, the rest locked. */
export async function initialiseCourse(lessonIds: string[]): Promise<void> {
  const existing = await db.lessons.toArray()
  if (existing.length > 0) return
  await db.lessons.bulkPut(lessonIds.map((id, i) => ({ id, status: i === 0 ? 'available' : 'locked' }) as LessonProgress))
}

export function courseProgress(): Promise<LessonProgress[]> {
  return db.lessons.toArray()
}

export async function saveLessonProgress(progress: LessonProgress): Promise<void> {
  await db.lessons.put(progress)
}
