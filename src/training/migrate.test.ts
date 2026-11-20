import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { DRILL_REV } from './constants'
import { newSkillState } from './learner'
import { migrateStoredTempos } from './migrate'
import { SKILLS_BY_ID } from './skills'
import { defaultProfile, exportTrainingData, importTrainingData, loadProfile, resetTrainingData } from './store'

const ceiling = async (id: string) => (await db.skillStates.get(id))?.tempoCeiling

describe('tempos stored by an earlier version', () => {
  beforeEach(async () => {
    await resetTrainingData()
    await db.profile.clear()
  })

  async function oldLearner(ceilings: Record<string, number>) {
    const { drillRev: _rev, ...profile } = defaultProfile()
    await db.profile.put(profile)
    for (const [id, tempoCeiling] of Object.entries(ceilings)) await db.skillStates.put({ ...newSkillState(id), tempoCeiling })
  }

  it('halves the tempo of the two drills that now have twice the notes per beat, once', async () => {
    await oldLearner({ 'pick.alternate-16': 120, 'lead.major-scale': 101, 'pick.alternate-8': 120 })
    expect(await migrateStoredTempos()).toBe(2)
    expect(await ceiling('pick.alternate-16')).toBe(60)
    expect(await ceiling('lead.major-scale')).toBe(Math.max(SKILLS_BY_ID['lead.major-scale'].startTempo, 51))
    expect(await ceiling('pick.alternate-8')).toBe(120)
    expect((await loadProfile()).drillRev).toBe(DRILL_REV)
    // A second launch, and a third: nothing more.
    expect(await migrateStoredTempos()).toBe(0)
    expect(await migrateStoredTempos()).toBe(0)
    expect(await ceiling('pick.alternate-16')).toBe(60)
  })

  it('never goes below the tempo the drill starts at, and leaves a skill without a stored tempo alone', async () => {
    const start = SKILLS_BY_ID['pick.alternate-16'].startTempo
    await oldLearner({ 'pick.alternate-16': start + 4, 'lead.major-scale': 0 })
    expect(await migrateStoredTempos()).toBe(1)
    expect(await ceiling('pick.alternate-16')).toBe(start)
    expect(await ceiling('lead.major-scale')).toBe(0)
  })

  it('leaves a new learner alone: what they reach on the new drills is not halved later', async () => {
    expect(await migrateStoredTempos()).toBe(0)
    expect((await loadProfile()).drillRev).toBe(DRILL_REV)
    await db.skillStates.put({ ...newSkillState('pick.alternate-16'), tempoCeiling: 90 })
    expect(await migrateStoredTempos()).toBe(0)
    expect(await ceiling('pick.alternate-16')).toBe(90)
  })

  it('corrects a backup from an earlier version when it is restored, and only that', async () => {
    await oldLearner({ 'pick.alternate-16': 120 })
    const oldBackup = await exportTrainingData()
    await importTrainingData(oldBackup)
    expect(await ceiling('pick.alternate-16')).toBe(60)
    // Backed up again after the correction and restored: it stays.
    await importTrainingData(await exportTrainingData())
    expect(await ceiling('pick.alternate-16')).toBe(60)
  })
})
