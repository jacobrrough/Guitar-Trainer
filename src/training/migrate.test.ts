import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { BELOW_TARGET_RATING, DRILL_REV, START_TEMPO_RATING } from './constants'
import { newSkillState, tempoProgressRating } from './learner'
import { migrateStoredTempos } from './migrate'
import { SKILLS_BY_ID } from './skills'
import { defaultProfile, exportTrainingData, importTrainingData, loadProfile, resetTrainingData } from './store'
import type { Attempt } from './types'

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

describe('ratings and tempos from before the Coach stopped at the target tempo', () => {
  beforeEach(async () => {
    await resetTrainingData()
    await db.profile.clear()
  })
  const stateOf = (id: string) => db.skillStates.get(id)

  /** A learner of the version before: revision 1 on the profile. */
  async function shipped(states: Array<{ id: string; rating: number; tempoCeiling: number; attempts: number }>) {
    await db.profile.put({ ...defaultProfile(), drillRev: 1 })
    for (const s of states) await db.skillStates.put({ ...newSkillState(s.id), rating: s.rating, tempoCeiling: s.tempoCeiling, attempts: s.attempts })
  }

  it('a hard skill rated mastered after slow rounds comes back to what its tempo shows, so it is planned again', async () => {
    const def = SKILLS_BY_ID['pick.alternate-16']
    await shipped([{ id: def.id, rating: 98, tempoCeiling: 57, attempts: 6 }])
    expect(await migrateStoredTempos()).toBe(1)
    const after = (await stateOf(def.id))!
    expect(after.rating).toBeCloseTo(tempoProgressRating(57, { start: def.startTempo, target: def.targetTempo }), 6)
    expect(after.rating).toBeGreaterThanOrEqual(START_TEMPO_RATING)
    expect(after.rating).toBeLessThanOrEqual(BELOW_TARGET_RATING)
    expect(after.tempoCeiling).toBe(57)
    // Once only.
    expect(await migrateStoredTempos()).toBe(0)
    expect((await stateOf(def.id))!.rating).toBe(after.rating)
  })

  it('a tempo above the target comes down to the target and the rating earned there stays', async () => {
    const def = SKILLS_BY_ID['fret.single-string']
    await shipped([{ id: def.id, rating: 96, tempoCeiling: def.targetTempo + 38, attempts: 40 }])
    expect(await migrateStoredTempos()).toBe(1)
    expect(await stateOf(def.id)).toMatchObject({ rating: 96, tempoCeiling: def.targetTempo })
  })

  it('leaves alone: ratings that are not above their stop and skills at their target; a skill rated by the first check only stops just under mastered', async () => {
    const hard = SKILLS_BY_ID['chord.barre']
    const done = SKILLS_BY_ID['pick.downstrokes']
    const placed = SKILLS_BY_ID['lead.pent-box1']
    await shipped([
      { id: hard.id, rating: 62, tempoCeiling: hard.startTempo, attempts: 12 },
      { id: done.id, rating: 97, tempoCeiling: done.targetTempo, attempts: 30 },
      { id: placed.id, rating: 93, tempoCeiling: 0, attempts: 0 },
      { id: 'fret.cross-string', rating: 80, tempoCeiling: 0, attempts: 0 },
    ])
    expect(await migrateStoredTempos()).toBe(1)
    expect((await stateOf(hard.id))!.rating).toBe(62)
    expect((await stateOf(done.id))!.rating).toBe(97)
    // Never practised, so never planned while it read 93: now it is a main exercise again.
    expect((await stateOf(placed.id))!.rating).toBe(BELOW_TARGET_RATING)
    expect((await stateOf('fret.cross-string'))!.rating).toBe(80)
    expect((await loadProfile()).drillRev).toBe(DRILL_REV)
  })

  /** A stored round of a skill, as the app records it. */
  function round(skillId: string, playedTempo: number, accuracy: number, over: Partial<Attempt> = {}): Attempt {
    return {
      at: Date.now() - 60 * 86_400_000, kind: 'practice', skillId, difficulty: 50, performance: accuracy, accuracy, reliable: true,
      perfects: Math.round(accuracy * 20), goods: 0, misses: 20 - Math.round(accuracy * 20), total: 20, timingMedianMs: 5, timingStdevMs: 20, coverage: 0.9,
      durationSec: 30, playedTempo, targetTempo: playedTempo, speed: 1, ...over,
    }
  }

  it('a skill that was played accurately at its target keeps its rating, also when the stored tempo has fallen since', async () => {
    // The best first-tier skill is the daily warm-up (at 0.9 x the stored tempo), and one rough warm-up round
    // moves the stored tempo down to that; a monthly check sets it to the tempo of the check. Neither takes back
    // what the learner has shown.
    const def = SKILLS_BY_ID['pick.downstrokes']
    await shipped([{ id: def.id, rating: 96, tempoCeiling: 81, attempts: 40 }])
    await db.attempts.bulkAdd([round(def.id, def.targetTempo + 6, 0.93), round(def.id, 90, 0.95, { kind: 'warmup' }), round(def.id, 90, 0.8, { kind: 'warmup' }), round(def.id, 81, 0.9, { kind: 'warmup' })])
    expect(await migrateStoredTempos()).toBe(0)
    expect(await stateOf(def.id)).toMatchObject({ rating: 96, tempoCeiling: 81 })
  })

  it('counts the fastest accurate round on record, and only accurate ones that counted', async () => {
    const def = SKILLS_BY_ID['chord.barre']
    // The stored tempo is 0.8 x a rough recap; the learner has played 70 bpm accurately before.
    await shipped([{ id: def.id, rating: 97, tempoCeiling: 48, attempts: 25 }])
    await db.attempts.bulkAdd([
      round(def.id, 70, 0.9),
      round(def.id, 60, 0.7, { kind: 'review' }),
      // None of these shows the target tempo: a rough round, a slowed-down one, the app hearing itself, half a run.
      round(def.id, def.targetTempo, 0.7),
      round(def.id, def.targetTempo * 0.75, 0.95, { speed: 0.75 }),
      round(def.id, def.targetTempo, 0.95, { bleed: true }),
      round(def.id, def.targetTempo, 0.95, { partial: true }),
      // Another skill's rounds say nothing about this one.
      round('chord.open', def.targetTempo, 0.95),
    ])
    expect(await migrateStoredTempos()).toBe(1)
    const after = (await stateOf(def.id))!
    expect(after.rating).toBeCloseTo(tempoProgressRating(70, { start: def.startTempo, target: def.targetTempo }), 6)
    expect(after.tempoCeiling).toBe(48)
  })

  it('does not read the old rounds of a drill whose tempo has changed its meaning', async () => {
    // 120 bpm of the old eighth-note drill is 60 bpm of today's sixteenths: no proof of the target (110).
    const def = SKILLS_BY_ID['pick.alternate-16']
    await shipped([{ id: def.id, rating: 98, tempoCeiling: 57, attempts: 6 }])
    await db.attempts.add(round(def.id, 120, 0.95))
    expect(await migrateStoredTempos()).toBe(1)
    expect((await stateOf(def.id))!.rating).toBeCloseTo(tempoProgressRating(57, { start: def.startTempo, target: def.targetTempo }), 6)
  })

  it('a learner from before any revision gets both steps, the halved tempo first', async () => {
    const { drillRev: _rev, ...profile } = defaultProfile()
    await db.profile.put(profile)
    const def = SKILLS_BY_ID['pick.alternate-16']
    // Rated 98 at 100 bpm of the old drill (eighth notes): 50 bpm of today's sixteenths, the start tempo.
    await db.skillStates.put({ ...newSkillState(def.id), rating: 98, tempoCeiling: 100, attempts: 8 })
    await migrateStoredTempos()
    expect(await stateOf(def.id)).toMatchObject({ tempoCeiling: 50, rating: START_TEMPO_RATING })
  })
})
