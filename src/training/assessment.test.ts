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
import { UNLOCK_RATING } from './constants'
import { DEFAULT_TUNING } from './exercises/builder'
import { exerciseParams, generateExercise } from './exercises'
import { SKILLS, SKILLS_BY_ID } from './skills'
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
    // A pass never rates below the unlock line (60), however easy the task was.
    expect(tasks[0].difficulty + 10).toBeLessThan(65)
    expect(out.model.skills['fret.single-string'].rating).toBe(65)
    expect(out.model.skills['fret.cross-string'].rating).toBeCloseTo(tasks[1].difficulty - 10, 0)
    expect(out.model.skills['chord.open'].rating).toBeCloseTo(Math.max(0, tasks[2].difficulty - 10), 0)
    // The passed task was the skill's own drill at 70 bpm: its exercises start from there, not from the slowest tempo.
    expect(tasks[0].params?.tempo).toBe(70)
    expect(out.model.skills['fret.single-string']).toMatchObject({
      confidence: 1, tempoCeiling: 70, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 0,
    })
    // Nothing shown on the drill of a skill that was not passed, or only vouched for.
    expect(out.model.skills['fret.cross-string'].tempoCeiling).toBe(0)
    expect(out.model.skills['lead.pent-box1'].tempoCeiling).toBe(0)
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

describe('applyPlacement on the real skill list', () => {
  const tasks = placementLadder(SKILLS)
  const pass = (count: number) => tasks.slice(0, count).map((t) => taskResult(t.id, true))
  const ancestorsOf = (id: string, seen = new Set<string>()): Set<string> => {
    for (const p of SKILLS_BY_ID[id].prerequisites) {
      if (!seen.has(p)) {
        seen.add(p)
        ancestorsOf(p, seen)
      }
    }
    return seen
  }

  it('passing every task leaves every tested skill, and everything under it, unlocked', () => {
    const out = applyPlacement(model(), tasks, pass(10), SKILLS, 1).model.skills
    for (const id of new Set(tasks.flatMap((t) => t.skillIds))) {
      expect(out[id].rating, id).toBeGreaterThanOrEqual(65)
      for (const p of ancestorsOf(id)) expect(out[p].rating, `${id} <- ${p}`).toBeGreaterThanOrEqual(65)
    }
    // Skills the ladder has no task for.
    expect(out['basics.open-strings'].rating).toBeGreaterThanOrEqual(UNLOCK_RATING)
    expect(out['basics.first-frets'].rating).toBeGreaterThanOrEqual(UNLOCK_RATING)
    expect(out['fret.chromatic'].rating).toBeGreaterThanOrEqual(UNLOCK_RATING)
    expect(out['time.metronome'].rating).toBeGreaterThanOrEqual(UNLOCK_RATING)
    // Nothing was shown about tuning by ear.
    expect(out['ear.tuning'].rating).toBe(0)
  })

  it('a skill under a hard pass is rated close to that pass, not at the minimum', () => {
    const out = applyPlacement(model(), tasks, pass(10), SKILLS, 1).model.skills
    expect(out['fret.single-string'].rating).toBeGreaterThan(out['chord.sevenths'].rating)
    expect(out['fret.single-string'].rating).toBe(out['lead.pent-boxes'].rating - 15)
  })

  it('a pass on a harder task outweighs a miss on something it builds on', () => {
    const results = [taskResult(tasks[0].id, true), taskResult(tasks[1].id, false), taskResult(tasks[2].id, true)]
    const out = applyPlacement(model(), tasks, results, SKILLS, 1).model.skills
    expect(out['chord.changes-open'].rating).toBeGreaterThanOrEqual(65)
    expect(out['fret.cross-string'].rating).toBeGreaterThanOrEqual(65)
  })

  it('a miss never rates a skill as solid, however hard the task was', () => {
    // The sixteenth-note task is hard enough that "difficulty minus ten" alone would land above the unlock line.
    const hard = tasks.find((t) => t.skillIds.includes('pick.alternate-16'))!
    expect(hard.difficulty - 10).toBeGreaterThanOrEqual(UNLOCK_RATING)
    const results = [...pass(4), taskResult(tasks[4].id, false), taskResult(hard.id, false)]
    const out = applyPlacement(model(), tasks, results, SKILLS, 1)
    expect(out.model.skills['pick.alternate-16'].rating).toBeLessThan(UNLOCK_RATING)
    // The headline tier comes from what was passed, not from how hard the missed task was.
    expect(out.report.headline).toMatch(/starting at tier 2$/)
  })

  it('with no pass at all nothing is lifted', () => {
    const results = [taskResult(tasks[0].id, false), taskResult(tasks[1].id, false)]
    const out = applyPlacement(model(), tasks, results, SKILLS, 1).model.skills
    expect(out['basics.open-strings'].rating).toBe(0)
    expect(out['time.metronome'].rating).toBe(0)
    expect(out['fret.single-string'].rating).toBeLessThan(UNLOCK_RATING)
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
  it('does not count a test task as a practice round', () => {
    // The planner reads `attempts` as "has practised this": a skill met only in a check stays new.
    const apply = (s: SkillState): SkillState => ({ ...s, rating: s.rating + 3, attempts: s.attempts + 1, lastPracticedAt: 5000 })
    const practised = model({}, [state('fret.single-string', 50, { attempts: 7 }), state('chord.open', 80)])
    const out = applyTestResults(practised, 'monthly', tasks, tasks.map((t) => taskResult(t.id, false)), skills, apply, 5000)
    expect(out.model.skills['fret.single-string']).toMatchObject({ attempts: 7, rating: 53, lastTestedAt: 5000 })
    expect(out.model.skills['chord.changes-open']).toMatchObject({ attempts: 0, lastTestedAt: 5000 })
    expect(out.model.skills['chord.changes-open'].rating).toBeGreaterThan(0)
  })

  it('sets lastMonthlyAt for monthly', () => {
    const out = applyTestResults(input, 'monthly', tasks, [], skills, (s) => s, 7)
    expect(out.model.profile.lastMonthlyAt).toBe(7)
    expect(out.model.profile.lastCheckpointAt).toBeUndefined()
  })
})

describe('what the test tasks put on the note lanes', () => {
  // The same call the test screen makes for a task (coach.exerciseForTask).
  const chartOf = (task: { skillIds: string[]; generatorId: string; params: Attempt['params'] }) =>
    generateExercise(SKILLS_BY_ID[task.skillIds[0]], task.generatorId, task.params!, DEFAULT_TUNING).chart
  const focusTask = (skillId: string) => checkpointTasks(model({}, [state(skillId, 50)]), SKILLS, [], 20 * DAY, skillId)[0]

  it('the skill check never asks for a bend, vibrato or slide on an open string', () => {
    for (const id of ['lead.bends', 'lead.vibrato', 'lead.slides']) {
      const task = focusTask(id)
      const marked = chartOf(task).notes.filter((n) => n.tech?.bend || n.tech?.vibrato || n.tech?.slideIn || n.tech?.slideOut)
      expect(marked.length, id).toBeGreaterThan(0)
      for (const n of marked) expect(n.fret, id).toBeGreaterThanOrEqual(5)
    }
  })

  it('the skill check for vibrato tests vibrato, not bends', () => {
    const notes = chartOf(focusTask('lead.vibrato')).notes
    expect(notes.every((n) => n.tech?.vibrato)).toBe(true)
    expect(notes.some((n) => n.tech?.bend)).toBe(false)
  })

  it('the skill check plays a skill in its own note values and is rated for them', () => {
    const sixteenths = focusTask('pick.alternate-16')
    expect(sixteenths.params.noteValue).toBe('sixteenth')
    // 50 bpm against a reference of 60, tier base 60, plus 16 for sixteenth notes.
    expect(sixteenths.difficulty).toBeCloseTo(60 + 30 * Math.log2(50 / 60) + 16, 1)
    const beat = 60 / sixteenths.params.tempo
    const times = chartOf(sixteenths).notes.map((n) => n.time)
    expect(times[1] - times[0]).toBeCloseTo(beat / 4, 5)
    // About 35 seconds, like every other task.
    expect((sixteenths.params.bars * 4 * 60) / sixteenths.params.tempo).toBeGreaterThanOrEqual(25)
  })

  it('the first placement task really is a melody on one string, and easier to read than the second', () => {
    const ladder = placementLadder(SKILLS)
    const one = chartOf(ladder[0]).notes
    const three = chartOf(ladder[1]).notes
    expect(new Set(one.map((n) => n.string)).size).toBe(1)
    expect(new Set(three.map((n) => n.string)).size).toBeGreaterThan(1)
    expect(new Set(three.map((n) => n.string)).size).toBeLessThanOrEqual(3)
    expect(new Set(one.map((n) => n.midi)).size).toBeLessThan(new Set(three.map((n) => n.midi)).size)
    // Both sit in the first frets a returning player still knows.
    for (const n of [...one, ...three]) expect(n.fret).toBeLessThanOrEqual(3)
  })

  it('the placement chord task is still one strum per chord, two beats each', () => {
    const task = placementLadder(SKILLS)[2]
    const notes = chartOf(task).notes
    const strumTimes = [...new Set(notes.map((n) => n.time))]
    expect(strumTimes).toHaveLength(task.params.bars * 2)
    expect(notes.find((n) => n.time === strumTimes[1])?.chordName).toBe('Am')
  })

  it('the placement task for the other pentatonic boxes is not box 1 again', () => {
    const ladder = placementLadder(SKILLS)
    const box1 = chartOf(ladder[4]).notes.map((n) => `${n.string}/${n.fret}`)
    const others = chartOf(ladder[9]).notes.map((n) => `${n.string}/${n.fret}`)
    expect(others.slice(0, 12)).not.toEqual(box1.slice(0, 12))
  })
})

describe('checks and the target tempo (real skill list)', () => {
  const ladder = placementLadder(SKILLS)
  const allPassed = ladder.map((t) => taskResult(t.id, true))
  const placed = applyPlacement(model(), ladder, allPassed, SKILLS, 1000).model

  it('the first check calls nothing mastered that was shown below its target tempo, and still opens everything it proves', () => {
    for (const task of ladder) {
      const tempo = task.params?.tempo as number
      for (const id of task.skillIds) {
        const skill = SKILLS_BY_ID[id]
        const st = placed.skills[id]
        expect(st.rating, `${id} passes`).toBeGreaterThanOrEqual(65)
        if (tempo < skill.targetTempo) expect(st.rating, `${id} shown at ${tempo} of ${skill.targetTempo}`).toBeLessThan(90)
      }
    }
    // One slow task used to rate sixteenth-note picking 93: mastered, so never planned as an exercise.
    expect(placed.skills['pick.alternate-16'].rating).toBeLessThan(90)
    // Whatever a pass vouches for further down is under the pass, so under mastered as well.
    for (const st of Object.values(placed.skills)) if (st.rating >= 90) expect(ladder.some((t) => t.skillIds.includes(st.skillId)), st.skillId).toBe(true)
  })

  it('starts the exercises of a passed skill from the tempo shown on its own drill, never above its target', () => {
    let seeded = 0
    for (const st of Object.values(placed.skills)) {
      const skill = SKILLS_BY_ID[st.skillId]
      expect(st.tempoCeiling, st.skillId).toBeLessThanOrEqual(skill.targetTempo)
      if (st.tempoCeiling === 0) continue
      seeded++
      const task = ladder.find((t) => t.skillIds.includes(st.skillId) && t.generatorId === skill.generators[0] && Math.min(skill.targetTempo, t.params?.tempo as number) === st.tempoCeiling)
      expect(task, `${st.skillId} at ${st.tempoCeiling}`).toBeDefined()
    }
    expect(seeded).toBeGreaterThan(3)
    // A skill that a task only touched with another drill keeps starting at its own start tempo.
    expect(placed.skills['pick.downstrokes'].tempoCeiling).toBe(0)
    // The same drill, but the task changed chords half as often as the skill's exercise does (every four
    // beats, not every two): 60 bpm of the task is not 60 bpm of the exercise.
    const barre = ladder.find((t) => t.skillIds.includes('chord.barre'))!
    expect(barre.params?.beatsPerChord).toBe(4)
    expect(exerciseParams(SKILLS_BY_ID['chord.barre'], 'chordChanges', 60).beatsPerChord).toBe(2)
    expect(placed.skills['chord.barre'].tempoCeiling).toBe(0)
    // Where the task is the exercise itself, the tempo counts.
    expect(placed.skills['chord.changes-open'].tempoCeiling).toBe(60)
    expect(placed.skills['pick.alternate-16'].tempoCeiling).toBe(70)
  })

  it('a weekly check never asks for faster than the skill aims for, whatever tempo is stored', () => {
    const skill = SKILLS_BY_ID['fret.single-string']
    const stored = model({ placementDoneAt: 1 }, [state(skill.id, 80, { tempoCeiling: skill.targetTempo + 32, attempts: 20 })])
    const tasks = checkpointTasks(stored, SKILLS, [], 10 * 86_400_000, skill.id)
    const task = tasks.find((t) => t.skillIds.includes(skill.id))!
    expect(task.params?.tempo).toBe(skill.targetTempo)
    expect(task.instructions).toContain(`${skill.targetTempo} bpm`)
  })
})
