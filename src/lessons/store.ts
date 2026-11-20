import { db } from '../db/db'
import type { LessonProgress } from './types'

/**
 * Lesson progress (Dexie table `lessons`). The lessons package may extend this
 * file; these three signatures are the contract the coach relies on.
 */

/**
 * Makes sure the course can go on, whatever state the rows are in. Today shows the next open lesson
 * and nothing else while the course is running, so "running with no lesson to start" must never be
 * left behind:
 * - rows that are missing are created (a new course: lesson 1 open, the rest locked);
 * - if lessons remain but none is open, the first one not yet done is opened;
 * - if every lesson is done while the profile still says the course is running, the course is marked finished.
 * A course that is already fine is not written to.
 */
export async function initialiseCourse(lessonIds: string[], now = Date.now()): Promise<void> {
  await db.transaction('rw', db.lessons, db.profile, async () => {
    const stored = new Map((await db.lessons.toArray()).map((r) => [r.id, r]))
    const rows: LessonProgress[] = lessonIds.map((id) => stored.get(id) ?? { id, status: 'locked' })
    const open = rows.some((r) => r.status === 'available')
    const next = open ? undefined : rows.find((r) => r.status !== 'done')
    const writes = rows.filter((r) => !stored.has(r.id) && r !== next)
    if (next) writes.push({ ...next, status: 'available' })
    if (writes.length > 0) await db.lessons.bulkPut(writes)
    if (rows.length > 0 && !open && !next) {
      const profile = await db.profile.get(1)
      if (profile?.firstStepsStartedAt && !profile.firstStepsDoneAt) await db.profile.put({ ...profile, firstStepsDoneAt: now })
    }
  })
}

/** Throws away all lesson progress and starts the course again: lesson 1 open, the rest locked. */
export async function restartCourse(lessonIds: string[]): Promise<void> {
  await db.transaction('rw', db.lessons, async () => {
    await db.lessons.clear()
    await db.lessons.bulkPut(lessonIds.map((id, i): LessonProgress => ({ id, status: i === 0 ? 'available' : 'locked' })))
  })
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
