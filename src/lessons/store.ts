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

export async function getLessonProgress(id: string): Promise<LessonProgress | undefined> {
  return db.lessons.get(id)
}

/** Merges fields into a lesson's progress row (creating it as 'locked' if missing). */
export async function patchLessonProgress(id: string, patch: Partial<Omit<LessonProgress, 'id'>>): Promise<LessonProgress> {
  const existing = (await db.lessons.get(id)) ?? ({ id, status: 'locked' } as LessonProgress)
  const next = { ...existing, ...patch, id }
  await db.lessons.put(next)
  return next
}

/**
 * Marks a lesson done and makes the next one available (if it was locked).
 * `nextId` is null after the last lesson.
 */
export async function completeLesson(id: string, nextId: string | null, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.lessons, async () => {
    const existing = (await db.lessons.get(id)) ?? ({ id, status: 'available' } as LessonProgress)
    await db.lessons.put({ ...existing, status: 'done', completedAt: existing.completedAt ?? now })
    if (nextId) {
      const next = await db.lessons.get(nextId)
      if (!next) await db.lessons.put({ id: nextId, status: 'available' })
      else if (next.status === 'locked') await db.lessons.put({ ...next, status: 'available' })
    }
  })
}

/** True when every given lesson id is marked done. */
export function allLessonsDone(progress: LessonProgress[], lessonIds: string[]): boolean {
  const done = new Set(progress.filter((p) => p.status === 'done').map((p) => p.id))
  return lessonIds.every((id) => done.has(id))
}
