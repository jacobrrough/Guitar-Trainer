import type { Lesson } from './types'

/** The First steps course, in order (filled in by the lessons package). */
export const COURSE: Lesson[] = []

export function lessonById(id: string): Lesson | undefined {
  return COURSE.find((l) => l.id === id)
}
