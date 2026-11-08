import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { loadProfile } from '../training/store'
import { COURSE } from './course'
import { finishLesson } from './finish'
import { courseProgress, initialiseCourse } from './store'

const ids = COURSE.map((l) => l.id)

describe('lesson progress', () => {
  beforeEach(async () => {
    await db.lessons.clear()
  })

  it('starts with lesson 1 available and the rest locked', async () => {
    await initialiseCourse(ids)
    const rows = await courseProgress()
    expect(rows).toHaveLength(10)
    expect(rows.find((r) => r.id === ids[0])?.status).toBe('available')
    expect(rows.filter((r) => r.status === 'locked')).toHaveLength(9)
  })

  it('unlocks the next lesson when one is completed', async () => {
    await initialiseCourse(ids)
    await finishLesson(ids[0])
    const rows = await courseProgress()
    expect(rows.find((r) => r.id === ids[0])?.status).toBe('done')
    expect(rows.find((r) => r.id === ids[1])?.status).toBe('available')
    expect(rows.find((r) => r.id === ids[2])?.status).toBe('locked')
  })

  it('marks First steps complete after the last lesson', async () => {
    await initialiseCourse(ids)
    for (const id of ids.slice(0, -1)) expect((await finishLesson(id)).courseComplete).toBe(false)
    expect((await loadProfile()).firstStepsDoneAt).toBeUndefined()
    expect((await finishLesson(ids[9])).courseComplete).toBe(true)
    expect((await loadProfile()).firstStepsDoneAt).toBeDefined()
  })
})
