import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { defaultProfile, loadProfile, saveProfile } from '../training/store'
import { COURSE, nextAvailableLesson } from './course'
import { finishLesson } from './finish'
import { courseProgress, initialiseCourse, restartCourse } from './store'
import type { LessonProgress } from './types'

const ids = COURSE.map((l) => l.id)

describe('lesson progress', () => {
  beforeEach(async () => {
    await db.lessons.clear()
    await db.profile.clear()
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

describe('the course always has a lesson to start', () => {
  const rows = (statuses: LessonProgress['status'][]): LessonProgress[] => ids.map((id, i) => ({ id, status: statuses[i] ?? 'locked' }))
  const running = () => ({ ...defaultProfile(1), experience: 'new' as const, firstStepsStartedAt: 5, placementDoneAt: 5 })

  beforeEach(async () => {
    await db.lessons.clear()
    await db.profile.clear()
  })

  it('leaves a healthy course exactly as it is', async () => {
    const healthy = rows(['done', 'done', 'available'])
    healthy[0] = { ...healthy[0], completedAt: 3, drillBestAccuracy: 0.9 }
    await db.lessons.bulkPut(healthy)
    await initialiseCourse(ids)
    expect(await courseProgress()).toEqual(healthy)
  })

  it('opens the first lesson not yet done when lessons remain but none is open', async () => {
    await db.lessons.bulkPut(rows(['done', 'done', 'locked', 'done']))
    await initialiseCourse(ids)
    const after = await courseProgress()
    expect(nextAvailableLesson(after)?.id).toBe(ids[2])
    expect(after.filter((r) => r.status === 'done').map((r) => r.id)).toEqual([ids[0], ids[1], ids[3]])
  })

  it('adds the rows that are missing', async () => {
    await db.lessons.bulkPut([{ id: ids[4], status: 'locked', learnSeen: true }])
    await initialiseCourse(ids)
    const after = await courseProgress()
    expect(after).toHaveLength(ids.length)
    expect(nextAvailableLesson(after)?.id).toBe(ids[0])
    expect(after.find((r) => r.id === ids[4])).toEqual({ id: ids[4], status: 'locked', learnSeen: true })
  })

  it('ends the course when every lesson is done but the profile still says it is running', async () => {
    await saveProfile(running())
    await db.lessons.bulkPut(rows(ids.map(() => 'done')))
    await initialiseCourse(ids, 99)
    expect((await loadProfile()).firstStepsDoneAt).toBe(99)
  })

  it('does not touch a profile that is not in the course', async () => {
    await db.lessons.bulkPut(rows(ids.map(() => 'done')))
    await initialiseCourse(ids)
    expect(await db.profile.count()).toBe(0)
    const graduate = { ...running(), firstStepsDoneAt: 9 }
    await saveProfile(graduate)
    await initialiseCourse(ids)
    expect(await loadProfile()).toEqual(graduate)
  })

  it('finishing a lesson whose next one is already done opens the first lesson still to do', async () => {
    await saveProfile(running())
    await db.lessons.bulkPut(rows(['done', 'available', 'done', 'locked']))
    expect((await finishLesson(ids[1])).courseComplete).toBe(false)
    expect(nextAvailableLesson(await courseProgress())?.id).toBe(ids[3])
    expect((await loadProfile()).firstStepsDoneAt).toBeUndefined()
  })

  it('can start the course again from lesson 1', async () => {
    await db.lessons.bulkPut(rows(ids.map(() => 'done')).map((r) => ({ ...r, completedAt: 1, playBestAccuracy: 1 })))
    await restartCourse(ids)
    expect(await courseProgress()).toEqual(rows(['available']))
  })
})

