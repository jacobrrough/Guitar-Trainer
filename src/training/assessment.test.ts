import { describe, expect, it, vi } from 'vitest'
import {
  applyPlacement,
  applyTestResults,
  checkpointTasks,
  evaluateTask,
  isTestDue,
  monthlyTasks,
  nextPlacementTask,
  placementLadder,
  shouldStopPlacement,
} from './assessment'
import type { Attempt, AttemptResult, LearnerModel, Profile, SkillDef, SkillState, SongSummary, TestTaskResult } from './types'

const DAY = 86_400_000

function def(id: string, tier: 1 | 2 | 3 | 4, prerequisites: string[] = []): SkillDef {
  return {
    id, name: id, category: 'fretting', tier, prerequisites, refTempo: 80, startTempo: 60, targetTempo: 120,
    description: '', tips: [], generators: ['melody'],
  }
}

const IDS: [string, 1 | 2 | 3 | 4, string[]][] = [
  ['fret.single-string', 1, []],
  ['fret.cross-string', 1, ['fret.single-string']],
  ['chord.open', 1, []],
  ['chord.changes-open', 2, ['chord.open']],
  ['chord.power', 2, ['chord.open']],
  ['pick.downstrokes', 1, []],
  ['lead.pent-box1', 2, ['fret.single-string']],
  ['pick.alternate-8', 2, ['pick.downstrokes']],
  ['pick.alternate-16', 3, ['pick.alternate-8']],
  ['chord.barre', 3, ['chord.changes-open']],
  ['lead.hammer-pull', 3, ['lead.pent-box1']],
  ['lead.bends', 3, ['lead.pent-box1']],
  ['chord.strum-patterns', 2, ['chord.open']],
  ['lead.pent-boxes', 3, ['lead.pent-box1']],
  ['lead.untouched', 4, ['lead.pent-boxes', 'chord.barre']],
  ['lead.root', 4, []],
]
const skills = IDS.map(([id, t, p]) => def(id, t, p))

function profile(over: Partial<Profile> = {}): Profile {
  return { id: 1, goals: ['all-round'], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0, ...over }
}
function model(over: Partial<Profile> = {}, st: SkillState[] = []): LearnerModel {
  return { skills: Object.fromEntries(st.map((s) => [s.skillId, s])), songItems: {}, profile: profile(over) }
}
function state(skillId: string, rating: number, extra: Partial<SkillState> = {}): SkillState {
  return { skillId, rating, confidence: 1, tempoCeiling: 0, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 0, ...extra }
}
function res(over: Partial<AttemptResult> = {}): AttemptResult {
  return {
    perfects: 18, goods: 2, misses: 0, total: 20, timingMedianMs: 5, timingStdevMs: 30, coverage: 1, durationSec: 30,
    playedTempo: 80, targetTempo: 80, speed: 1, ...over,
  }
}
function attempt(over: Partial<Attempt> = {}): Attempt {
  return { ...res(), at: 0, kind: 'test', difficulty: 40, performance: 0.9, accuracy: 0.9, reliable: true, ...over }
}
function taskResult(taskId: string, passed: boolean): TestTaskResult {
  return { taskId, passed, attempt: attempt() }
}

describe('placementLadder', () => {
  const ladder = placementLadder(skills)
  it('has 10 ordered tasks with ids and music-length bars', () => {
    expect(ladder.map((t) => t.id)).toEqual(Array.from({ length: 10 }, (_, i) => `placement-${String(i + 1).padStart(2, '0')}`))
    expect(ladder[0].generatorId).toBe('melody')
    expect(ladder[8].params.pattern).toBe('D-DU-UDU')
    for (const t of ladder) {
      const beats = (t.params.bars * 4 * 60) / t.params.tempo
      expect(beats).toBeGreaterThanOrEqual(25)
      expect(beats).toBeLessThanOrEqual(45)
      expect(t.passCriteria).toEqual({ minAccuracy: 0.85, maxMedianMs: 30, maxStdevMs: 60 })
    }
  })
  it('gets harder overall', () => {
    expect(ladder[9].difficulty).toBeGreaterThan(ladder[0].difficulty)
    expect(ladder[5].difficulty).toBeGreaterThan(ladder[1].difficulty)
  })
  it('falls back to tier 1 / ref 80 for unknown skills', () => {
    const t = placementLadder([])[0]
    expect(t.difficulty).toBeCloseTo(20 + 30 * Math.log2(70 / 80), 0)
  })
})

describe('stop rule', () => {
  const tasks = placementLadder(skills)
  it('stops after two consecutive fails', () => {
    expect(shouldStopPlacement([taskResult('placement-01', false)])).toBe(false)
    expect(shouldStopPlacement([taskResult('a', false), taskResult('b', true), taskResult('c', false)])).toBe(false)
    expect(shouldStopPlacement([taskResult('a', true), taskResult('b', false), taskResult('c', false)])).toBe(true)
  })
  it('walks tasks and returns null when stopped or done', () => {
    expect(nextPlacementTask(tasks, [])?.id).toBe('placement-01')
    expect(nextPlacementTask(tasks, [taskResult('placement-01', true)])?.id).toBe('placement-02')
    expect(nextPlacementTask(tasks, [taskResult('placement-01', false), taskResult('placement-02', false)])).toBeNull()
    expect(nextPlacementTask(tasks, tasks.map((t) => taskResult(t.id, true)))).toBeNull()
  })
})

describe('evaluateTask', () => {
  const task = placementLadder(skills)[0]
  it('accuracy boundary', () => {
    expect(evaluateTask(task, res({ perfects: 17, goods: 0, misses: 3, total: 20 }))).toBe(true) // 0.85
    expect(evaluateTask(task, res({ perfects: 16, goods: 1, misses: 3, total: 20 }))).toBe(false) // 0.8 + ... 0.84
    expect(evaluateTask(task, res({ perfects: 0, goods: 0, misses: 0, total: 0 }))).toBe(false)
  })
  it('timing boundaries', () => {
    expect(evaluateTask(task, res({ timingMedianMs: 30 }))).toBe(true)
    expect(evaluateTask(task, res({ timingMedianMs: -31 }))).toBe(false)
    expect(evaluateTask(task, res({ timingStdevMs: 60 }))).toBe(true)
    expect(evaluateTask(task, res({ timingStdevMs: 61 }))).toBe(false)
  })
  it('null timing passes only with fewer than 8 hits', () => {
    expect(evaluateTask(task, res({ perfects: 4, goods: 0, misses: 0, total: 4, timingMedianMs: null, timingStdevMs: null }))).toBe(true)
    expect(evaluateTask(task, res({ timingMedianMs: null, timingStdevMs: null }))).toBe(false)
  })
})

describe('applyPlacement', () => {
  const tasks = placementLadder(skills)
  const results = [taskResult('placement-01', true), taskResult('placement-02', false), taskResult('placement-03', false)]
  const input = model({}, [state('chord.open', 99)])
  const frozen = JSON.stringify(input)
  const out = applyPlacement(input, tasks, results, skills, 1000)

  it('assigns passed and failed ratings', () => {
    expect(out.model.skills['fret.single-string'].rating).toBeCloseTo(tasks[0].difficulty + 10, 0)
    expect(out.model.skills['fret.cross-string'].rating).toBeCloseTo(tasks[1].difficulty - 10, 0)
    expect(out.model.skills['chord.open'].rating).toBeCloseTo(Math.max(0, tasks[2].difficulty - 10), 0)
    expect(out.model.skills['fret.single-string']).toMatchObject({
      confidence: 1, tempoCeiling: 0, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 0,
    })
  })
  it('inherits for untouched skills', () => {
    const r = out.model.skills
    expect(r['lead.pent-box1'].rating).toBeCloseTo(Math.max(0, r['fret.single-string'].rating - 15), 0)
    expect(r['lead.root'].rating).toBe(0)
    const multi = (r['lead.pent-boxes'].rating + r['chord.barre'].rating) / 2
    expect(r['lead.untouched'].rating).toBeCloseTo(Math.max(0, multi - 15), 0)
  })
  it('does not mutate and sets profile', () => {
    expect(JSON.stringify(input)).toBe(frozen)
    expect(out.model.profile.placementDoneAt).toBe(1000)
    expect(out.model.profile.sessionsSinceTest).toBe(0)
  })
  it('reports', () => {
    expect(out.report.headline).toMatch(/^Placement: 1 of 10 tasks passed — starting at tier \d$/)
    expect(out.report.lines).toHaveLength(10)
    expect(out.report.nextFocus).toHaveLength(3)
    expect(out.report.ratingDeltas['fret.single-string']).toBe(out.model.skills['fret.single-string'].rating)
  })
  it('takes the max of passed values when a skill repeats', () => {
    const all = applyPlacement(model(), tasks, tasks.map((t) => taskResult(t.id, true)), skills, 1)
    const a = Math.max(tasks[4].difficulty, tasks[9].difficulty) + 10
    expect(all.model.skills['pick.alternate-8'].rating).toBeCloseTo(Math.min(100, a), 0)
  })
})

describe('isTestDue', () => {
  const base = 100 * DAY
  it('placement when never placed, even with stale calibration', () => {
    expect(isTestDue(profile(), base, null)).toBe('placement')
    expect(isTestDue(profile(), base, 99)).toBe('placement')
  })
  it('null when calibration is stale', () => {
    const p = profile({ placementDoneAt: base - 40 * DAY, sessionsSinceTest: 9 })
    expect(isTestDue(p, base, null)).toBeNull()
    expect(isTestDue(p, base, 31)).toBeNull()
    expect(isTestDue(p, base, 30)).toBe('monthly')
  })
  it('checkpoint needs both days and sessions', () => {
    const p = profile({ placementDoneAt: base - 7 * DAY, sessionsSinceTest: 2 })
    expect(isTestDue(p, base, 1)).toBeNull()
    expect(isTestDue({ ...p, sessionsSinceTest: 3 }, base, 1)).toBe('checkpoint')
    expect(isTestDue({ ...p, sessionsSinceTest: 3, placementDoneAt: base - 5 * DAY }, base, 1)).toBeNull()
    expect(isTestDue({ ...p, sessionsSinceTest: 3, lastCheckpointAt: base - 2 * DAY }, base, 1)).toBeNull()
  })
  it('monthly after 28 days since placement or last monthly', () => {
    expect(isTestDue(profile({ placementDoneAt: base - 28 * DAY }), base, 1)).toBe('monthly')
    expect(isTestDue(profile({ placementDoneAt: base - 60 * DAY, lastMonthlyAt: base - 10 * DAY }), base, 1)).toBeNull()
    expect(isTestDue(profile({ placementDoneAt: base - 60 * DAY, lastMonthlyAt: base - 29 * DAY }), base, 1)).toBe('monthly')
  })
})

describe('checkpointTasks', () => {
  const library: SongSummary[] = [
    { id: 1, title: 'A', artist: '', duration: 100, bpm: 100, levelNoteCounts: [1, 2, 3, 4, 5, 6] },
    { id: 2, title: 'B', artist: '', duration: 100, bpm: 120, levelNoteCounts: [1, 2, 3, 4, 5, 6] },
  ]
  const m = model({}, [state('fret.single-string', 50, { tempoCeiling: 90 }), state('chord.open', 80, { tempoCeiling: 70 })])
  m.songItems['1:2'] = { key: '1:2', songId: 1, level: 2, bestAccuracy: 0.9, lastAt: 5, ease: 2.3, intervalDays: 0, weakBars: [] }
  m.songItems['2:3'] = { key: '2:3', songId: 2, level: 3, bestAccuracy: 0.88, lastAt: 9, ease: 2.3, intervalDays: 0, weakBars: [] }
  m.songItems['2:4'] = { key: '2:4', songId: 2, level: 4, bestAccuracy: 0.5, lastAt: 10, ease: 2.3, intervalDays: 0, weakBars: [] }
  const tasks = checkpointTasks(m, skills, library, 20 * DAY, 'fret.single-string')
  it('builds focus, retention and stretch tasks', () => {
    expect(tasks).toHaveLength(3)
    expect(tasks[0].skillIds).toEqual(['fret.single-string'])
    expect(tasks[0].params.tempo).toBe(90)
    expect(tasks[1].skillIds).toEqual(['chord.open'])
    expect(tasks[2]).toMatchObject({ generatorId: 'song', difficulty: 30 + 10 * 4 })
    expect(tasks[2].params).toMatchObject({ songId: 2, level: 4, bars: 0, tempo: 120 })
  })
  it('is deterministic and skips missing pieces', () => {
    expect(checkpointTasks(m, skills, library, 20 * DAY, 'fret.single-string')).toEqual(tasks)
    expect(checkpointTasks(model(), skills, [], 0, 'fret.single-string')).toHaveLength(1)
  })
})

describe('monthlyTasks', () => {
  it('starts one tier below the current tier', () => {
    expect(monthlyTasks(model(), skills)).toHaveLength(10)
    const high = model({}, [state('lead.root', 70)])
    const t = monthlyTasks(high, skills)
    expect(t.length).toBeLessThan(10)
    expect(t.every((x) => skills.find((s) => s.id === x.skillIds[0])!.tier >= 3)).toBe(true)
  })
})

describe('applyTestResults', () => {
  const tasks = checkpointTasks(
    model({}, [state('fret.single-string', 50), state('chord.open', 80)]),
    skills,
    [{ id: 2, title: 'B', artist: '', duration: 1, bpm: 120, levelNoteCounts: [1, 2] }],
    0,
    'fret.single-string',
  ).concat([
    {
      id: 'x', title: 'multi', instructions: '', skillIds: ['chord.open', 'chord.changes-open'], generatorId: 'chordChanges',
      params: { tempo: 60, bars: 4 }, difficulty: 40, passCriteria: { minAccuracy: 0.85, maxMedianMs: 30, maxStdevMs: 60 },
    },
  ])
  const input = model({ sessionsSinceTest: 4 }, [state('fret.single-string', 50), state('chord.open', 80)])
  it('calls applyAttempt once per skill per task and builds deltas', () => {
    const apply = vi.fn((s: SkillState) => ({ ...s, rating: s.rating + 3 }))
    const results = tasks.map((t, i) => taskResult(t.id, i !== 0))
    const frozen = JSON.stringify(input)
    const out = applyTestResults(input, 'checkpoint', tasks, results, skills, apply, 5000)
    const expected = tasks.filter((t) => t.generatorId !== 'song').reduce((n, t) => n + t.skillIds.length, 0)
    expect(apply).toHaveBeenCalledTimes(expected)
    expect(JSON.stringify(input)).toBe(frozen)
    expect(out.report.ratingDeltas['fret.single-string']).toBe(3)
    expect(out.report.ratingDeltas['chord.open']).toBe(6)
    expect(out.report.headline).toBe(`Checkpoint: ${results.length - 1} of ${tasks.length} passed`)
    expect(out.report.nextFocus[0]).toBe('fret.single-string')
    expect(out.model.profile).toMatchObject({ lastCheckpointAt: 5000, sessionsSinceTest: 0 })
  })
  it('sets lastMonthlyAt for monthly', () => {
    const out = applyTestResults(input, 'monthly', tasks, [], skills, (s) => s, 7)
    expect(out.model.profile.lastMonthlyAt).toBe(7)
    expect(out.model.profile.lastCheckpointAt).toBeUndefined()
  })
})
