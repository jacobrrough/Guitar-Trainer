import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  VOICE_CHECK_OPTIONS,
  applyPlacement,
  applyTestResults,
  checkpointTasks,
  evaluateTask,
  isTestDue,
  meetsCriteria,
  monthlyTasks,
  nextPlacementTask,
  placementLadder,
  shouldStopPlacement,
} from './assessment'
import type { LadderSpec } from './assessment'
import { VOICE_LEVELS } from '../songs/vocal/levels'
import {
  CEILING_MIN_ACCURACY,
  REP_DOWN_ACCURACY,
  REP_FALLBACK_ACCURACY,
  SONG_SLOW_DOWN_ACCURACY,
  SONG_TARGET_ACCURACY,
  TEST_PASS,
  UNLOCK_RATING,
  VOICE_TEST_PASS,
} from './constants'
import { itemDifficulty } from './difficulty'
import { attemptPerformance } from './performance'
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

describe('the pass mark and the last digit of a sum', () => {
  // A note that is hit and not perfect counts four fifths. Added up in floating point and divided by
  // the number of notes, a run that is exactly on a mark can come out one digit under it.
  const COUNTS = 200
  const run = (perfects: number, goods: number, total: number) => res({ perfects, goods, misses: total - perfects - goods, total, timingMedianMs: 0, timingStdevMs: 0 })
  /** The rule in whole numbers, where nothing is rounded: `perfects + 0.8 x goods >= mark x total`, times one hundred. */
  const reaches = (markPercent: number, perfects: number, goods: number, total: number) => 100 * perfects + 80 * goods >= markPercent * total
  /** Every mix of perfect, good and missed notes up to COUNTS notes for which `differs` holds, as "perfects+goods/total" (the first few). */
  function mixesWhere(differs: (perfects: number, goods: number, total: number) => boolean): string[] {
    const found: string[] = []
    for (let total = 1; total <= COUNTS; total++) {
      for (let goods = 0; goods <= total; goods++) {
        for (let perfects = 0; perfects + goods <= total; perfects++) {
          if (differs(perfects, goods, total) && found.length < 5) found.push(`${perfects}+${goods}/${total}`)
        }
      }
    }
    return found
  }

  it('passes a sung task in which every note was only just in tune, whatever the number of notes', () => {
    const notPassed: number[] = []
    for (let notes = 1; notes <= COUNTS; notes++) if (!meetsCriteria(VOICE_TEST_PASS, run(0, notes, notes))) notPassed.push(notes)
    expect(notPassed).toEqual([])
    // The counts this is about: for these, 0.8 x n / n is 0.7999999999999999.
    const aDigitUnder = Array.from({ length: COUNTS }, (_, i) => i + 1).filter((n) => (0.8 * n) / n < 0.8)
    expect(aDigitUnder).toEqual([43, 81, 86, 91, 162, 167, 172, 177, 182, 187])
  })

  it('judges every mix of notes at the sung mark by the rule as it is written', () => {
    expect(VOICE_TEST_PASS.minAccuracy).toBe(0.8)
    expect(mixesWhere((p, g, t) => meetsCriteria(VOICE_TEST_PASS, run(p, g, t)) !== reaches(80, p, g, t))).toEqual([])
    // Four clean notes, one only just in tune and one that did not count, of six: exactly four fifths.
    expect(meetsCriteria(VOICE_TEST_PASS, run(4, 1, 6))).toBe(true)
    // A run that is really under the mark stays under it, however close: one note in two hundred short.
    expect(meetsCriteria(VOICE_TEST_PASS, run(159, 0, 200))).toBe(false)
    expect(meetsCriteria(VOICE_TEST_PASS, run(160, 0, 200))).toBe(true)
  })

  it('changes no verdict at the guitar\'s mark: there the sum was never a digit out', () => {
    expect(TEST_PASS.minAccuracy).toBe(0.85)
    // The comparison as it stood before, written out: the same answer as the rule for every mix...
    expect(mixesWhere((p, g, t) => (p + 0.8 * g) / t >= 0.85 !== reaches(85, p, g, t))).toEqual([])
    // ...and so the same answer as the pass rule now gives.
    expect(mixesWhere((p, g, t) => meetsCriteria(TEST_PASS, run(p, g, t)) !== (p + 0.8 * g) / t >= 0.85)).toEqual([])
  })

  it('leaves room for a digit and never for a note, however long the piece: on the mark is passed, one note short is not', () => {
    // A guitar song has thousands of notes. The fewest clean notes that reach a mark, worked out in whole
    // numbers, once with every other note missed and once with every other note only just counted.
    const off: string[] = []
    const marks = [
      { criteria: VOICE_TEST_PASS, percent: 80 },
      { criteria: TEST_PASS, percent: 85 },
    ]
    for (const { criteria, percent } of marks) {
      for (let total = 1; total <= 5000; total++) {
        const alone = Math.ceil((percent * total) / 100)
        const withTheRest = Math.ceil(((percent - 80) * total) / 20)
        const cases: [perfects: number, goods: number, passes: boolean][] = [
          [alone, 0, true],
          [alone - 1, 0, false],
          [withTheRest, total - withTheRest, true],
          // One of the notes that only just counted is missed instead.
          [withTheRest, total - withTheRest - 1, false],
        ]
        for (const [perfects, goods, passes] of cases) {
          if (perfects < 0 || goods < 0) continue
          expect(reaches(percent, perfects, goods, total)).toBe(passes)
          if (meetsCriteria(criteria, run(perfects, goods, total)) !== passes && off.length < 5) off.push(`${percent}: ${perfects}+${goods}/${total}`)
        }
      }
    }
    expect(off).toEqual([])
  })

  it('reads a result that has no numbers in it as it always did, at either mark', () => {
    // Nothing in the app writes such a result. Should one ever arrive (a row from a broken backup), the
    // room for the last digit must not be what changes how it is read.
    const asItWas = (criteria: typeof TEST_PASS, r: AttemptResult) => {
      const acc = r.total > 0 ? (r.perfects + 0.8 * r.goods) / r.total : 0
      if (acc < criteria.minAccuracy) return false
      return Math.abs(r.timingMedianMs ?? 0) <= criteria.maxMedianMs && (r.timingStdevMs ?? 0) <= criteria.maxStdevMs
    }
    const noNumbers = [run(Number.NaN, 0, 8), run(0, Number.NaN, 8), { ...run(8, 0, 8), total: Number.NaN }, run(0, 0, 0)]
    for (const criteria of [TEST_PASS, VOICE_TEST_PASS]) {
      for (const r of noNumbers) expect(meetsCriteria(criteria, r)).toBe(asItWas(criteria, r))
    }
  })

  it('the marks the Coach reads a run by have no such count either: clean, rough, and the two a song is held to', () => {
    // 0.85, 0.75, 0.6 and 0.7, on the accuracy the Coach stores with a run. Were one of them moved to a
    // number that has the trap (0.8 and 0.9 do), this is where it would show.
    const marks = [CEILING_MIN_ACCURACY, REP_DOWN_ACCURACY, REP_FALLBACK_ACCURACY, SONG_TARGET_ACCURACY, SONG_SLOW_DOWN_ACCURACY]
    expect(marks).toEqual([0.85, 0.75, 0.6, 0.85, 0.7])
    const aDigitOut = mixesWhere((p, g, t) => {
      const acc = attemptPerformance(run(p, g, t)).acc
      return marks.some((mark) => acc >= mark !== reaches(Math.round(mark * 100), p, g, t))
    })
    expect(aDigitOut).toEqual([])
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

describe('guitar: checks built with no options are the checks they were before singing', () => {
  // Recorded from the task builders as they stood before they took any option (commit ad9a5de), on the real skill list.
  // A task changed on purpose (a tempo, a drill, a sentence) changes a digest: the failing case prints the new one.
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
  const library: SongSummary[] = [{ id: 7, title: 'Song', artist: 'X', duration: 100, bpm: 96, levelNoteCounts: [1, 2, 3, 4, 5, 6] }]
  const learner: LearnerModel = {
    ...model({ placementDoneAt: 1 }, [
      state('fret.single-string', 82, { tempoCeiling: 92 }),
      state('fret.chromatic', 76, { tempoCeiling: 200 }),
      state('chord.open', 55, { tempoCeiling: 0 }),
      state('pick.alternate-8', 61, { tempoCeiling: 84 }),
      state('lead.vibrato', 90, { tempoCeiling: 80 }),
    ]),
    songItems: { '7:2': { key: '7:2', songId: 7, level: 2, bestAccuracy: 0.9, lastAt: 5, ease: 2.3, intervalDays: 1, weakBars: [] } },
  }

  it('placement, monthly and weekly tasks are unchanged', () => {
    const weekly = ['chord.open', 'pick.alternate-8', 'lead.vibrato', 'no.such.skill'].flatMap((focus) => [3, 4, 5].map((day) => checkpointTasks(learner, SKILLS, library, day * DAY, focus)))
    expect({
      placement: digest(placementLadder(SKILLS)),
      monthly: digest([monthlyTasks(learner, SKILLS), monthlyTasks(model(), SKILLS)]),
      weekly: digest(weekly),
    }).toEqual({ placement: '949e8577017d38a4', monthly: '55cf307786640c51', weekly: 'a280d5d000bbb265' })
  })
})

describe('checks for another instrument: the options set the pace, the length, the pass mark and the words', () => {
  // Stand-ins for two singing skills: one that climbs a ladder of steps at one tempo, one with a tempo floor.
  const rungs: [string, number][] = [
    ['4 beats', 0],
    ['6 beats', 8],
    ['8 beats', 16],
    ['8 beats, closer', 24],
  ]
  const hold: SkillDef = {
    ...def('voice.pitch.hold', 1),
    name: 'Hold a note steady',
    refTempo: 60,
    startTempo: 60,
    targetTempo: 60,
    minTempo: 60,
    steps: rungs.map(([label, bonus]) => ({ label, params: {}, bonus })),
  }
  const stepwise: SkillDef = { ...def('voice.pitch.steps', 1), name: 'Step up and down', refTempo: 66, startTempo: 60, targetTempo: 88, minTempo: 54 }
  const voice = [hold, stepwise]
  const tune: SongSummary = { id: 4, title: 'Hot Cross Buns', artist: '', duration: 30, bpm: 80, levelNoteCounts: [9, 9, 9, 9, 9, 9] }
  const singer = (states: SkillState[]): LearnerModel => ({
    ...model({}, states),
    songItems: { '4:1': { key: '4:1', songId: 4, level: 1, bestAccuracy: 0.9, lastAt: 5, ease: 2.3, intervalDays: 0, weakBars: [] } },
  })
  const NOW = 20 * DAY
  const focusTask = (states: SkillState[], focus: SkillDef, options?: Parameters<typeof checkpointTasks>[5], list = voice) => checkpointTasks(singer(states), list, [], NOW, focus.id, options)[0]

  it('never asks for a tempo skill under its floor, and still never above its target', () => {
    // A ceiling of 48 is what rough rounds at 60 leave behind (eight tenths).
    const slow = focusTask([state('voice.pitch.steps', 50, { tempoCeiling: 48 })], stepwise)
    expect(slow.params.tempo).toBe(54)
    expect(slow.instructions).toBe('Play Step up and down at 54 bpm.')
    expect(slow.difficulty).toBe(itemDifficulty(stepwise, { tempo: 54, noteValue: slow.params.noteValue }))
    expect(focusTask([state('voice.pitch.steps', 50, { tempoCeiling: 200 })], stepwise).params.tempo).toBe(88)
    // A skill that names no floor keeps the stored tempo, unless the caller knows of one.
    const plain: SkillDef = { ...stepwise, minTempo: undefined }
    expect(focusTask([state('voice.pitch.steps', 50, { tempoCeiling: 48 })], plain, undefined, [plain]).params.tempo).toBe(48)
    expect(focusTask([state('voice.pitch.steps', 50, { tempoCeiling: 48 })], plain, { minTempoOf: () => 58 }, [plain]).params.tempo).toBe(58)
    // And a floor given from outside wins over the skill's own.
    expect(focusTask([state('voice.pitch.steps', 50, { tempoCeiling: 48 })], stepwise, { minTempoOf: () => 50 }).params.tempo).toBe(50)
  })

  it('asks for a step skill at its one tempo, on the step the learner has reached, and rates it for that step', () => {
    const task = focusTask([state('voice.pitch.hold', 50, { step: 2, tempoCeiling: 48 })], hold, VOICE_CHECK_OPTIONS)
    expect(task.params).toMatchObject({ tempo: 60, step: 2 })
    expect('maxStep' in task.params).toBe(false)
    // Tier base 20 and the 16 of the third step: what the same step is rated in practice.
    expect(task.difficulty).toBe(36)
    // The step is named in the learner's words; a tempo they cannot change is not.
    expect(task.instructions).toBe('Sing Hold a note steady: 8 beats.')
    // A ceiling above the one tempo changes nothing either, and a skill never sung starts on the first step.
    expect(focusTask([state('voice.pitch.hold', 50, { step: 2, tempoCeiling: 90 })], hold, VOICE_CHECK_OPTIONS).params.tempo).toBe(60)
    // It is the ladder that fixes the tempo, not the floor: a step skill that names no floor is not slowed down either.
    const bare: SkillDef = { ...hold, minTempo: undefined }
    expect(focusTask([state('voice.pitch.hold', 50, { step: 2, tempoCeiling: 48 })], bare, VOICE_CHECK_OPTIONS, [bare]).params).toMatchObject({ tempo: 60, step: 2 })
    const first = focusTask([], hold, VOICE_CHECK_OPTIONS)
    expect(first.params).toMatchObject({ tempo: 60, step: 0 })
    expect(first.instructions).toBe('Sing Hold a note steady: 4 beats.')
    expect(first.difficulty).toBe(20)
  })

  it('rates a step task by its step alone, whatever note values the drill is written in; a tempo task still counts them', () => {
    // In practice a step is rated `tier base + bonus of the step` (docs/SINGING.md §6). A check of the
    // same step must be the same item, or a pass in a check and a clean round would not mean the same.
    const inWholeNotes = { ...VOICE_CHECK_OPTIONS, paramsFor: () => ({ noteValue: 'whole' as const }) }
    const inSixteenths = { ...VOICE_CHECK_OPTIONS, paramsFor: () => ({ noteValue: 'sixteenth' as const }) }
    const states = [state('voice.pitch.hold', 50, { step: 2 }), state('voice.pitch.steps', 50, { tempoCeiling: 66 })]
    expect(focusTask(states, hold, inWholeNotes).params.noteValue).toBe('whole')
    expect(focusTask(states, hold, inWholeNotes).difficulty).toBe(36)
    expect(focusTask(states, hold, inSixteenths).difficulty).toBe(36)
    // The tempo skill at its reference tempo: 20, less 10 for whole notes, plus 16 for sixteenths.
    expect(focusTask(states, stepwise, inWholeNotes).difficulty).toBe(10)
    expect(focusTask(states, stepwise, inSixteenths).difficulty).toBe(36)
    // Rated at the reference tempo of the skill, as the exercise is, also where a ladder names another start.
    const odd: SkillDef = { ...hold, refTempo: 60, startTempo: 66, targetTempo: 66, minTempo: 66 }
    const task = focusTask([state('voice.pitch.hold', 50, { step: 1 })], odd, VOICE_CHECK_OPTIONS, [odd])
    expect(task.params.tempo).toBe(66)
    expect(task.difficulty).toBe(28)
  })

  it('adds what the caller knows about the learner to a task: the range, and the highest step it can hold', () => {
    const paramsFor = (s: SkillDef) => (s.id === hold.id ? { maxStep: 1, low: 48, high: 55, easy: 52 } : {})
    const capped = focusTask([state('voice.pitch.hold', 50, { step: 2 })], hold, { ...VOICE_CHECK_OPTIONS, paramsFor })
    expect(capped.params).toMatchObject({ tempo: 60, step: 1, maxStep: 1, low: 48, high: 55, easy: 52 })
    expect(capped.instructions).toBe('Sing Hold a note steady: 6 beats.')
    expect(capped.difficulty).toBe(28)
    // Below the limit the learner's own step stands; the limit still travels with the task, for the rating.
    expect(focusTask([state('voice.pitch.hold', 50, { step: 0 })], hold, { ...VOICE_CHECK_OPTIONS, paramsFor }).params).toMatchObject({ step: 0, maxStep: 1 })
    // The function is told whose task it is.
    const seen: [string, number | undefined][] = []
    focusTask([state('voice.pitch.hold', 50, { step: 2 })], hold, { paramsFor: (s, st) => (seen.push([s.id, st?.step]), {}) })
    expect(seen).toEqual([['voice.pitch.hold', 2]])
  })

  it('caps the length of a task in bars', () => {
    const fast = [state('voice.pitch.steps', 50, { tempoCeiling: 88 })]
    expect(focusTask(fast, stepwise).params.bars).toBe(12)
    expect(focusTask(fast, stepwise, { maxBars: 8 }).params.bars).toBe(8)
    // A task that is shorter than the cap keeps its length.
    expect(focusTask(fast, stepwise, { maxBars: 16 }).params.bars).toBe(12)
    expect(focusTask([state('voice.pitch.hold', 50, { step: 1 })], hold, VOICE_CHECK_OPTIONS).params.bars).toBeLessThanOrEqual(8)
  })

  it('puts the pass mark on every task, the song included, and words every task for a singer', () => {
    const states = [state('voice.pitch.hold', 80, { step: 1 }), state('voice.pitch.steps', 50, { tempoCeiling: 70 })]
    const tasks = checkpointTasks(singer(states), voice, [tune], NOW, 'voice.pitch.steps', VOICE_CHECK_OPTIONS)
    expect(tasks.map((t) => t.id)).toEqual(['checkpoint-01', 'checkpoint-02', 'checkpoint-03'])
    for (const t of tasks) expect(t.passCriteria).toEqual({ minAccuracy: 0.8, maxMedianMs: 10000, maxStdevMs: 10000 })
    expect(VOICE_CHECK_OPTIONS.criteria).toEqual(VOICE_TEST_PASS)
    // A tempo skill may name its tempo; a step skill names its step; a song has one speed, so none is named.
    expect(tasks.map((t) => t.instructions)).toEqual(['Sing Step up and down at 70 bpm.', 'Sing Hold a note steady: 6 beats.', 'Sing Hot Cross Buns at Level 3.'])
    for (const t of tasks) expect(`${t.title} ${t.instructions}`).not.toMatch(/\b(play|played|guitar|strings?|speed|wrong|failed)\b/i)
    // The pass marks are copies: changing one task does not change the options or the next task.
    tasks[0].passCriteria.minAccuracy = 0
    expect(VOICE_TEST_PASS.minAccuracy).toBe(0.8)
    expect(tasks[1].passCriteria.minAccuracy).toBe(0.8)
  })

  describe('the words of a singer\'s check', () => {
    const states = [state('voice.pitch.hold', 80, { step: 1 }), state('voice.pitch.steps', 50, { tempoCeiling: 70 })]
    const sungTasks = () => checkpointTasks(singer(states), voice, [tune], NOW, 'voice.pitch.steps', VOICE_CHECK_OPTIONS)
    const guitarTasks = () => checkpointTasks(singer(states), voice, [tune], NOW, 'voice.pitch.steps')
    /** The first task done well, the second not, the third done well. */
    const outcome = (tasks: { id: string }[]) => tasks.map((t, i) => taskResult(t.id, i !== 1))
    /** What the Coach has for its own book-keeping and a singer has no use for, and what is never said to a learner. */
    const NOT_A_SINGERS = /\b(checkpoint|focus|retention|stretch|level \d|passed|play\w*|guitar|wrong|fail\w*)\b/i

    it('names each task by what is sung, and the level of the song by its name', () => {
      // The song was cleared on its second level (index 1), so the check asks for the third: "Whole tune".
      expect(sungTasks().map((t) => t.title)).toEqual(['Step up and down', 'Hold a note steady', 'Hot Cross Buns (Whole tune)'])
      for (const t of sungTasks()) expect(t.title).not.toMatch(NOT_A_SINGERS)
    })

    it('knows every level of a song to sing by the name the song page gives it', () => {
      const song = VOICE_CHECK_OPTIONS.copy?.song
      expect(song).toBeDefined()
      expect(VOICE_LEVELS.map((_, index) => song!('Ode to Joy', index))).toEqual(VOICE_LEVELS.map((level) => `Ode to Joy (${level.name})`))
      // A level that is no level of a song to sing is still a title, never "undefined".
      expect(song!('Ode to Joy', 9)).toBe('Ode to Joy')
      expect(song!('Ode to Joy', -1)).toBe('Ode to Joy')
    })

    it('reports in plain words: "Check: 2 of 3 done well", and a line for each task', () => {
      const tasks = sungTasks()
      const out = applyTestResults(singer(states), 'checkpoint', tasks, outcome(tasks), voice, (s) => s, NOW, VOICE_CHECK_OPTIONS)
      expect(out.report.headline).toBe('Check: 2 of 3 done well')
      expect(out.report.lines).toEqual(['Step up and down: done well', 'Hold a note steady: not yet', 'Hot Cross Buns (Whole tune): done well'])
      for (const text of [out.report.headline, ...out.report.lines]) expect(text).not.toMatch(NOT_A_SINGERS)
      // One task, and none done well: still a sentence that reads.
      const one = applyTestResults(singer(states), 'checkpoint', tasks.slice(0, 1), [taskResult(tasks[0].id, true)], voice, (s) => s, NOW, VOICE_CHECK_OPTIONS)
      expect(one.report.headline).toBe('Check: 1 of 1 done well')
      const none = applyTestResults(singer(states), 'checkpoint', tasks, tasks.map((t) => taskResult(t.id, false)), voice, (s) => s, NOW, VOICE_CHECK_OPTIONS)
      expect(none.report.headline).toBe('Check: 0 of 3 done well')
    })

    it('changes nothing but words: the same tasks, results and ratings as with the guitar\'s words', () => {
      const plainWords = { ...VOICE_CHECK_OPTIONS, copy: undefined }
      const unworded = checkpointTasks(singer(states), voice, [tune], NOW, 'voice.pitch.steps', plainWords)
      const strip = (tasks: { title: string }[]) => tasks.map(({ title: _title, ...rest }) => rest)
      expect(strip(sungTasks())).toEqual(strip(unworded))
      const apply = (s: SkillState): SkillState => ({ ...s, rating: s.rating + 2 })
      const worded = applyTestResults(singer(states), 'checkpoint', sungTasks(), outcome(sungTasks()), voice, apply, NOW, VOICE_CHECK_OPTIONS)
      const bare = applyTestResults(singer(states), 'checkpoint', unworded, outcome(unworded), voice, apply, NOW)
      expect(worded.model).toEqual(bare.model)
      expect(worded.report.ratingDeltas).toEqual(bare.report.ratingDeltas)
      expect(worded.report.nextFocus).toEqual(bare.report.nextFocus)
    })

    it('leaves the guitar\'s words letter for letter where no words are given', () => {
      const tasks = guitarTasks()
      expect(tasks.map((t) => t.title)).toEqual(['Focus: Step up and down', 'Retention: Hold a note steady', 'Stretch: Hot Cross Buns (Level 3)'])
      const weekly = applyTestResults(singer(states), 'checkpoint', tasks, outcome(tasks), voice, (s) => s, NOW)
      expect(weekly.report.headline).toBe('Checkpoint: 2 of 3 passed')
      expect(weekly.report.lines).toEqual(['Focus: Step up and down: passed', 'Retention: Hold a note steady: not yet', 'Stretch: Hot Cross Buns (Level 3): passed'])
      expect(applyTestResults(singer(states), 'monthly', tasks, outcome(tasks), voice, (s) => s, NOW).report.headline).toBe('Monthly check: 2 of 3 passed')
      // Options that say nothing about words, and words given one at a time: what is left out is the guitar's.
      expect(applyTestResults(singer(states), 'checkpoint', tasks, outcome(tasks), voice, (s) => s, NOW, {}).report).toEqual(weekly.report)
      const oneWord = checkpointTasks(singer(states), voice, [tune], NOW, 'voice.pitch.steps', { copy: { focus: (name) => `Now: ${name}` } })
      expect(oneWord.map((t) => t.title)).toEqual(['Now: Step up and down', 'Retention: Hold a note steady', 'Stretch: Hot Cross Buns (Level 3)'])
    })
  })

  it('with no options, or with the built-in ones named, the tasks are the guitar tasks', () => {
    const library = [tune]
    const m = singer([state('fret.single-string', 50, { tempoCeiling: 90 }), state('chord.open', 80, { tempoCeiling: 70 })])
    const plain = checkpointTasks(m, skills, library, NOW, 'fret.single-string')
    expect(plain).toHaveLength(3)
    expect(plain.map((t) => t.instructions)).toEqual(['Play fret.single-string at 90 bpm.', 'Play chord.open at 70 bpm.', 'Play Hot Cross Buns at Level 3, full speed.'])
    for (const t of plain) expect(t.passCriteria).toEqual(TEST_PASS)
    expect(checkpointTasks(m, skills, library, NOW, 'fret.single-string', {})).toEqual(plain)
    expect(checkpointTasks(m, skills, library, NOW, 'fret.single-string', { criteria: TEST_PASS, verb: 'Play', songsHaveSpeeds: true })).toEqual(plain)
  })
})

describe('placement and monthly checks from a list the caller brings', () => {
  const specs: LadderSpec[] = [
    { title: 'One', instructions: 'Do one.', skillIds: ['fret.single-string'], generatorId: 'melody', params: { tempo: 60, noteValue: 'quarter' } },
    { title: 'Two', instructions: 'Do two.', skillIds: ['lead.pent-boxes'], generatorId: 'melody', params: { tempo: 90, noteValue: 'eighth' }, bonus: 10 },
  ]

  it('builds the tasks of that list, numbered and rated like the built-in ones', () => {
    const tasks = placementLadder(skills, specs)
    expect(tasks.map((t) => [t.id, t.title, t.instructions, t.params.tempo, t.skillIds])).toEqual([
      ['placement-01', 'One', 'Do one.', 60, ['fret.single-string']],
      ['placement-02', 'Two', 'Do two.', 90, ['lead.pent-boxes']],
    ])
    expect(tasks[1].difficulty).toBe(itemDifficulty({ tier: 3, refTempo: 80 }, { tempo: 90, noteValue: 'eighth', bonus: 10 }))
    // Without a list it is the ten guitar tasks, as before.
    expect(placementLadder(skills)).toHaveLength(10)
  })

  it('the monthly check takes its tasks from the same list, from one tier below the player upwards', () => {
    expect(monthlyTasks(model(), skills, specs).map((t) => t.title)).toEqual(['One', 'Two'])
    expect(monthlyTasks(model({}, [state('lead.root', 70)]), skills, specs).map((t) => t.title)).toEqual(['Two'])
    expect(monthlyTasks(model(), skills)).toHaveLength(10)
  })
})
