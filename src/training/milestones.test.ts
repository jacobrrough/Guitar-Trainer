import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { listMilestones, milestonesSince, recordMilestones } from './milestoneStore'
import { bandMilestone, skillMilestones, songMilestone, streakMilestone, tempoMilestone, testMilestone, unlockMilestones } from './milestones'
import { newSkillState } from './learner'
import { SKILLS } from './skills'
import type { Attempt, SkillDef, SkillState, SongItemState, TestRecord } from './types'

const NOW = new Date(2026, 10, 8, 12).getTime()
const skill: SkillDef = { ...SKILLS[0], id: 'x.skill', name: 'Test skill', startTempo: 60 }

function state(rating: number, tempoCeiling = 0): SkillState {
  return { ...newSkillState('x.skill', rating, NOW), tempoCeiling, lastPracticedAt: NOW }
}

function item(best: number | null): SongItemState {
  return { key: '3:1', songId: 3, level: 1, bestAccuracy: best, lastAt: null, ease: 2.3, intervalDays: 0, weakBars: [] }
}

describe('bandMilestone', () => {
  it('fires when the band rises', () => {
    const m = bandMilestone(skill, state(45), state(52), NOW)
    expect(m?.key).toBe('band:x.skill:2')
    expect(m?.title).toBe('Test skill: Developing')
    expect(m?.type).toBe('band')
  })
  it('fires from null state', () => {
    expect(bandMilestone(skill, null, state(25), NOW)?.key).toBe('band:x.skill:1')
  })
  it('is null when the band is unchanged or falls', () => {
    expect(bandMilestone(skill, state(52), state(60), NOW)).toBeNull()
    expect(bandMilestone(skill, state(52), state(40), NOW)).toBeNull()
  })
})

describe('tempoMilestone', () => {
  it('fires on a new multiple of 10', () => {
    const m = tempoMilestone(skill, state(50, 78), state(50, 82), NOW)
    expect(m?.key).toBe('tempo:x.skill:80')
    expect(m?.title).toBe('Test skill clean at 80 bpm')
  })
  it('ignores multiples below startTempo and unchanged multiples', () => {
    expect(tempoMilestone(skill, state(50, 40), state(50, 55), NOW)).toBeNull()
    expect(tempoMilestone(skill, state(50, 81), state(50, 89), NOW)).toBeNull()
  })
  it('combines with band in skillMilestones', () => {
    expect(skillMilestones(skill, state(45, 58), state(52, 62), NOW).map((m) => m.type)).toEqual(['band', 'tempo'])
    expect(skillMilestones(skill, state(52, 62), state(53, 63), NOW)).toEqual([])
  })
})

describe('unlockMilestones', () => {
  const a: SkillDef = { ...skill, id: 'a', name: 'A', prerequisites: [] }
  const b: SkillDef = { ...skill, id: 'b', name: 'B', prerequisites: ['a'] }
  const c: SkillDef = { ...skill, id: 'c', name: 'C', prerequisites: ['a'] }
  it('returns only newly unlocked skills with prerequisites', () => {
    const out = unlockMilestones([a, b, c], { a: 50 }, { a: 65 }, NOW)
    expect(out.map((m) => m.key)).toEqual(['unlock:b', 'unlock:c'])
  })
  it('ignores already unlocked and still locked skills', () => {
    expect(unlockMilestones([a, b], { a: 65 }, { a: 80 }, NOW)).toEqual([])
    expect(unlockMilestones([a, b], { a: 10 }, { a: 20 }, NOW)).toEqual([])
  })
})

describe('streakMilestone', () => {
  it('fires streak:7 from 6', () => {
    expect(streakMilestone(6, 7, NOW)?.key).toBe('streak:7')
  })
  it('picks the largest crossed value', () => {
    expect(streakMilestone(2, 8, NOW)?.key).toBe('streak:7')
  })
  it('is null without a crossing', () => {
    expect(streakMilestone(7, 8, NOW)).toBeNull()
    expect(streakMilestone(3, 3, NOW)).toBeNull()
  })
})

describe('songMilestone', () => {
  it('fires the first time accuracy reaches 0.9', () => {
    const m = songMilestone('Demo', item(0.8), item(0.92), NOW)
    expect(m?.key).toBe('song:3:1')
    expect(m?.title).toBe('Demo · Level 2 mastered')
    expect(songMilestone('Demo', null, item(0.9), NOW)).not.toBeNull()
  })
  it('is null when already mastered or still below', () => {
    expect(songMilestone('Demo', item(0.9), item(0.95), NOW)).toBeNull()
    expect(songMilestone('Demo', item(0.5), item(0.89), NOW)).toBeNull()
  })
})

describe('testMilestone', () => {
  const attempt = {} as Attempt
  function record(passed: boolean[]): TestRecord {
    return {
      at: NOW,
      type: 'checkpoint',
      tasks: [],
      results: passed.map((p, i) => ({ taskId: `t${i}`, attempt, passed: p })),
      report: { headline: '', lines: [], ratingDeltas: {}, nextFocus: [] },
    }
  }
  it('fires when every task passed', () => {
    const m = testMilestone(record([true, true]), NOW)
    expect(m?.key).toBe('test:checkpoint:2026-11-08')
    expect(m?.title).toBe('Checkpoint test passed')
  })
  it('is null with a failure or no results', () => {
    expect(testMilestone(record([true, false]), NOW)).toBeNull()
    expect(testMilestone(record([]), NOW)).toBeNull()
  })
})

describe('milestoneStore', () => {
  beforeEach(async () => {
    await db.milestones.clear()
  })
  it('dedupes by key across calls', async () => {
    const m = streakMilestone(0, 3, NOW)!
    const first = await recordMilestones([m, m])
    expect(first).toHaveLength(1)
    expect(first[0].id).toBeDefined()
    const second = await recordMilestones([m, { ...m, at: NOW + 1 }, streakMilestone(3, 7, NOW + 2)!])
    expect(second.map((x) => x.key)).toEqual(['streak:7'])
    expect(await db.milestones.count()).toBe(2)
  })
  it('lists newest first and filters since', async () => {
    await recordMilestones([streakMilestone(0, 3, 100)!, streakMilestone(3, 7, 200)!])
    expect((await listMilestones()).map((m) => m.key)).toEqual(['streak:7', 'streak:3'])
    expect((await listMilestones(1)).length).toBe(1)
    expect((await milestonesSince(100)).map((m) => m.key)).toEqual(['streak:7'])
  })
})
