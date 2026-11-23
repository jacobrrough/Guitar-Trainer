import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { listMilestones, milestonesSince, recordMilestones } from './milestoneStore'
import { bandMilestone, skillMilestones, songMilestone, stepMilestone, streakMilestone, tempoMilestone, testMilestone, unlockMilestones } from './milestones'
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
  it('only says "everything it builds on is solid" when that is true', () => {
    expect(unlockMilestones([a, b], { a: 50 }, { a: 65 }, NOW)[0].detail).toMatch(/builds on is solid/)
    // B opens because a skill check rated it solid, while A under it is still shaky.
    const shown = unlockMilestones([a, b], { a: 30, b: 40 }, { a: 30, b: 66 }, NOW)
    expect(shown.map((m) => m.key)).toEqual(['unlock:b'])
    expect(shown[0].detail).not.toMatch(/solid/)
    expect(shown[0].detail).toMatch(/practice/)
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

describe('guitar: every milestone reads as it did before singing', () => {
  it('the same record, word for word, for each kind', () => {
    expect(bandMilestone(skill, state(45), state(52), NOW)).toEqual({
      at: NOW,
      type: 'band',
      skillId: 'x.skill',
      title: 'Test skill: Developing',
      detail: 'Your Test skill rating reached 52, now developing.',
      value: 2,
      key: 'band:x.skill:2',
    })
    expect(tempoMilestone(skill, state(50, 78), state(50, 82), NOW)).toEqual({
      at: NOW,
      type: 'tempo',
      skillId: 'x.skill',
      title: 'Test skill clean at 80 bpm',
      detail: 'You played Test skill cleanly at 80 bpm.',
      value: 80,
      key: 'tempo:x.skill:80',
    })
    expect(songMilestone('Demo', item(0.8), item(0.92), NOW)).toEqual({
      at: NOW,
      type: 'song',
      songId: 3,
      title: 'Demo · Level 2 mastered',
      detail: 'You reached 92% accuracy on level 2.',
      value: 1,
      key: 'song:3:1',
    })
    expect(streakMilestone(6, 7, NOW)).toEqual({ at: NOW, type: 'streak', title: '7-day streak', detail: 'You have practised 7 days in a row.', value: 7, key: 'streak:7' })
    const b: SkillDef = { ...skill, id: 'b', name: 'B', prerequisites: ['a'] }
    expect(unlockMilestones([{ ...skill, id: 'a', name: 'A' }, b], { a: 50 }, { a: 65 }, NOW)).toEqual([
      { at: NOW, type: 'unlock', skillId: 'b', title: 'B unlocked', detail: 'Everything B builds on is solid now, so it can appear in your practice.', key: 'unlock:b' },
    ])
    // Naming the guitar changes nothing, and no record carries a field it did not carry.
    expect(bandMilestone(skill, state(45), state(52), NOW, 'guitar')).toEqual(bandMilestone(skill, state(45), state(52), NOW))
    expect(tempoMilestone(skill, state(50, 78), state(50, 82), NOW, 'guitar')).toEqual(tempoMilestone(skill, state(50, 78), state(50, 82), NOW))
    expect(songMilestone('Demo', item(0.8), item(0.92), NOW, 'guitar')).toEqual(songMilestone('Demo', item(0.8), item(0.92), NOW))
    expect(skillMilestones(skill, state(45, 58), state(52, 62), NOW, 'guitar')).toEqual(skillMilestones(skill, state(45, 58), state(52, 62), NOW))
  })
})

describe('step milestones (skills that climb a ladder of steps at one tempo)', () => {
  // A stand-in for "Hold a note steady": one tempo, three steps.
  const hold: SkillDef = {
    ...skill,
    id: 'voice.pitch.hold',
    name: 'Hold a note steady',
    refTempo: 60,
    startTempo: 60,
    targetTempo: 60,
    minTempo: 60,
    steps: ['4 beats', '6 beats', '8 beats'].map((label, i) => ({ label, params: {}, bonus: 8 * i })),
  }
  const on = (step: number | undefined, rating = 50, tempoCeiling = 60): SkillState => ({ ...state(rating, tempoCeiling), skillId: hold.id, ...(step === undefined ? {} : { step }) })

  it('a step reached is a milestone named after the step, stored once under a key of its own', () => {
    const m = stepMilestone(hold, on(0), on(1), NOW)
    expect(m).toMatchObject({ at: NOW, type: 'tempo', skillId: 'voice.pitch.hold', title: 'Hold a note steady: 6 beats', value: 1, key: 'step:voice.pitch.hold:1' })
    expect(m?.detail).toContain('6 beats')
    // From a state that has no step yet, and from no state at all.
    expect(stepMilestone(hold, on(undefined), on(2), NOW)?.key).toBe('step:voice.pitch.hold:2')
    expect(stepMilestone(hold, null, on(1), NOW)?.title).toBe('Hold a note steady: 6 beats')
  })

  it('is null when the step stays, falls, or was never set, and for a skill without steps', () => {
    expect(stepMilestone(hold, on(1), on(1), NOW)).toBeNull()
    expect(stepMilestone(hold, on(2), on(1), NOW)).toBeNull()
    expect(stepMilestone(hold, null, on(undefined), NOW)).toBeNull()
    expect(stepMilestone(hold, on(undefined), on(0), NOW)).toBeNull()
    expect(stepMilestone(skill, state(50), { ...state(50), step: 1 }, NOW)).toBeNull()
    // A step stored past the end of the ladder names the last step, not nothing.
    expect(stepMilestone(hold, on(1), on(7), NOW)).toMatchObject({ title: 'Hold a note steady: 8 beats', value: 2, key: 'step:voice.pitch.hold:2' })
  })

  it('a step skill gets no "clean at N bpm" milestone, whatever its tempo ceiling does', () => {
    expect(tempoMilestone(hold, on(0, 50, 0), on(0, 50, 60), NOW)).toBeNull()
    expect(tempoMilestone(hold, on(0, 50, 0), on(0, 50, 60), NOW, 'voice')).toBeNull()
    expect(skillMilestones(hold, on(0, 45, 0), on(1, 52, 60), NOW).map((m) => m.key)).toEqual(['band:voice.pitch.hold:2', 'step:voice.pitch.hold:1'])
    // The same change on a skill with a tempo to gain still says so.
    expect(skillMilestones(skill, state(45, 0), state(52, 60), NOW).map((m) => m.key)).toEqual(['band:x.skill:2', 'tempo:x.skill:60'])
  })
})

describe('milestones in the words of a singer', () => {
  const steps: SkillDef = { ...skill, id: 'voice.pitch.steps', name: 'Step up and down', startTempo: 60, targetTempo: 88, minTempo: 54 }
  const hold: SkillDef = { ...skill, id: 'voice.pitch.hold', name: 'Hold a note steady', startTempo: 60, targetTempo: 60, steps: ['4 beats', '6 beats'].map((label, i) => ({ label, params: {}, bonus: 8 * i })) }
  const sung = [
    bandMilestone(steps, state(45), state(52), NOW, 'voice'),
    bandMilestone(hold, state(70), state(91), NOW, 'voice'),
    tempoMilestone(steps, state(50, 68), state(50, 72), NOW, 'voice'),
    stepMilestone(hold, { ...state(50), step: 0 }, { ...state(50), step: 1 }, NOW),
    songMilestone('Hot Cross Buns', item(0.8), item(0.92), NOW, 'voice'),
    ...skillMilestones(steps, state(45, 58), state(52, 62), NOW, 'voice'),
    ...skillMilestones(hold, { ...state(45), step: 0 }, { ...state(52), step: 1 }, NOW, 'voice'),
  ]

  it('nothing is "played", nothing is a rating or a percentage, and only a skill with a tempo names one', () => {
    expect(sung.every((m) => m !== null)).toBe(true)
    expect(sung).toHaveLength(9)
    for (const m of sung) {
      const text = `${m!.title} ${m!.detail}`
      expect(text).not.toMatch(/\b(play|played|playing|guitar|strings?|rating|accuracy|wrong|failed|louder)\b|%/i)
      if (m!.skillId === hold.id) expect(text).not.toMatch(/bpm/i)
    }
    expect(tempoMilestone(steps, state(50, 68), state(50, 72), NOW, 'voice')).toMatchObject({ title: 'Step up and down clean at 70 bpm', detail: 'You sang Step up and down cleanly at 70 bpm.' })
  })

  it('only the words change: keys, kinds and values are those of the guitar record, and nothing else is added', () => {
    const pairs = [
      [bandMilestone(steps, state(45), state(52), NOW, 'voice'), bandMilestone(steps, state(45), state(52), NOW)],
      [tempoMilestone(steps, state(50, 68), state(50, 72), NOW, 'voice'), tempoMilestone(steps, state(50, 68), state(50, 72), NOW)],
      [songMilestone('Hot Cross Buns', item(0.8), item(0.92), NOW, 'voice'), songMilestone('Hot Cross Buns', item(0.8), item(0.92), NOW)],
    ]
    for (const [voice, guitar] of pairs) {
      expect({ ...voice, title: '', detail: '' }).toEqual({ ...guitar, title: '', detail: '' })
      expect(voice!.detail).not.toBe(guitar!.detail)
    }
  })
})
