import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { defaultProfile, loadProfile, saveProfile } from '../training/store'
import { COURSE, nextAvailableLesson } from './course'
import { finishLesson } from './finish'
import { courseProgress, initialiseCourse, restartCourse } from './store'
import type { Profile } from '../training/types'
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

/**
 * The lessons table holds both courses: guitar lessons are "l01-…", singing lessons "v01-…". Starting,
 * mending or restarting one course must leave the rows of the other, and the other profile, as they are.
 */
describe('two courses in one table', () => {
  const voiceIds = ['v01-voice', 'v02-meet', 'v03-match']
  const running = (id: 1 | 2): Profile => ({ ...defaultProfile(1), id, experience: 'new', firstStepsStartedAt: 5, placementDoneAt: 5 })
  const voiceRows = (): LessonProgress[] => [
    { id: voiceIds[0], status: 'done', completedAt: 3, drillBestAccuracy: 0.9 },
    { id: voiceIds[1], status: 'available', learnSeen: true },
    { id: voiceIds[2], status: 'locked' },
  ]
  const guitarDone = (): LessonProgress[] => ids.map((id) => ({ id, status: 'done', completedAt: 1 }))

  beforeEach(async () => {
    await db.lessons.clear()
    await db.profile.clear()
  })

  it('starting the guitar course again keeps every singing lesson as it was', async () => {
    await db.lessons.bulkPut([...guitarDone(), ...voiceRows()])
    await restartCourse(ids)
    expect(await courseProgress(voiceIds)).toEqual(voiceRows())
    expect((await courseProgress(ids)).map((r) => r.status)).toEqual(['available', ...ids.slice(1).map(() => 'locked')])
  })

  it('starting the singing course again keeps every guitar lesson as it was', async () => {
    await db.lessons.bulkPut([...guitarDone(), ...voiceRows()])
    await restartCourse(voiceIds)
    expect(await courseProgress(ids)).toEqual(guitarDone())
    expect(await courseProgress(voiceIds)).toEqual(voiceIds.map((id, i) => ({ id, status: i === 0 ? 'available' : 'locked' })))
  })

  it('starting again throws away every row of that course, also of a lesson it no longer has', async () => {
    await db.lessons.bulkPut([...guitarDone(), { id: 'l99-retired', status: 'done', completedAt: 1 }, ...voiceRows()])
    await restartCourse(ids)
    expect(await db.lessons.get('l99-retired')).toBeUndefined()
    expect(await db.lessons.count()).toBe(ids.length + voiceIds.length)
  })

  it('reads the progress of one course, or of both', async () => {
    await db.lessons.bulkPut([...guitarDone(), ...voiceRows()])
    expect((await courseProgress(voiceIds)).map((r) => r.id)).toEqual(voiceIds)
    expect((await courseProgress(ids)).map((r) => r.id)).toEqual(ids)
    expect(await courseProgress()).toHaveLength(ids.length + voiceIds.length)
    // A lesson with no row yet is simply not there.
    expect((await courseProgress(['v01-voice', 'v09-slides'])).map((r) => r.id)).toEqual(['v01-voice'])
    // The rows come in the order asked for, which is the order of the course, not that of the table.
    expect((await courseProgress([ids[2], 'v02-meet', ids[0]])).map((r) => r.id)).toEqual([ids[2], 'v02-meet', ids[0]])
  })

  it('an open singing lesson does not stand in for an open guitar lesson', async () => {
    await db.lessons.bulkPut([{ id: ids[0], status: 'done' }, { id: ids[1], status: 'locked' }, ...voiceRows()])
    await initialiseCourse(ids)
    expect(nextAvailableLesson(await courseProgress(ids))?.id).toBe(ids[1])
    expect(await courseProgress(voiceIds)).toEqual(voiceRows())
  })

  it('ends a finished singing course on the singing profile only', async () => {
    await saveProfile(running(1))
    await saveProfile(running(2))
    await db.lessons.bulkPut([{ id: ids[0], status: 'available' }, ...voiceIds.map((id): LessonProgress => ({ id, status: 'done' }))])
    await initialiseCourse(voiceIds, 99, 2)
    expect((await db.profile.get(2))?.firstStepsDoneAt).toBe(99)
    expect(await db.profile.get(1)).toEqual(running(1))
  })

  it('ends a finished guitar course on the guitar profile only', async () => {
    await saveProfile(running(1))
    await saveProfile(running(2))
    await db.lessons.bulkPut([...guitarDone(), ...voiceRows()])
    await initialiseCourse(ids, 77)
    expect((await db.profile.get(1))?.firstStepsDoneAt).toBe(77)
    expect(await db.profile.get(2)).toEqual(running(2))
  })

  it('a course that has no lessons yet ends nothing and throws nothing away', async () => {
    // The singing course is empty until its lessons are written. Mending or restarting "all of its
    // lessons" is then a call with an empty list, and it must not reach the other course or any profile.
    await saveProfile(running(1))
    await saveProfile(running(2))
    await db.lessons.bulkPut([...guitarDone(), ...voiceRows()])
    await initialiseCourse([], 99)
    await initialiseCourse([], 99, 2)
    await restartCourse([])
    expect(await db.profile.get(1)).toEqual(running(1))
    expect(await db.profile.get(2)).toEqual(running(2))
    expect(await courseProgress(ids)).toEqual(guitarDone())
    expect(await courseProgress(voiceIds)).toEqual(voiceRows())
    expect(await courseProgress([])).toEqual([])
  })

  it('mending the singing course adds its missing rows and opens its first lesson, beside a finished guitar course', async () => {
    await saveProfile({ ...running(1), firstStepsDoneAt: 9 })
    await saveProfile(running(2))
    await db.lessons.bulkPut(guitarDone())
    await initialiseCourse(voiceIds, 99)
    expect(await courseProgress(voiceIds)).toEqual(voiceIds.map((id, i) => ({ id, status: i === 0 ? 'available' : 'locked' })))
    expect(await courseProgress(ids)).toEqual(guitarDone())
    expect((await db.profile.get(2))?.firstStepsDoneAt).toBeUndefined()
    expect((await db.profile.get(1))?.firstStepsDoneAt).toBe(9)
  })

  it('goes by the lessons when no profile is named: singing lessons never end the guitar course', async () => {
    await saveProfile(running(1))
    await saveProfile(running(2))
    await db.lessons.bulkPut(voiceIds.map((id): LessonProgress => ({ id, status: 'done' })))
    await initialiseCourse(voiceIds, 99)
    expect(await db.profile.get(1)).toEqual(running(1))
    expect((await db.profile.get(2))?.firstStepsDoneAt).toBe(99)
  })
})
