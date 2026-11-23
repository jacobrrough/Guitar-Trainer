import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WARMUP_CATEGORIES,
  GUITAR_PLANNER_COPY,
  MAX_ROUNDS,
  MAX_SONG_PASSES,
  VOICE_PLANNER_COPY,
  adaptAfterBlock,
  fitRounds,
  focusPriority,
  inHoldBand,
  maxStepFor,
  nextRepStep,
  nextRepTempo,
  pickSongBlock,
  pickSongs,
  pickWarmupSkill,
  planPlayingMinutes,
  planSession,
  roundSeconds,
  songPassSeconds,
} from './planner'
import type { PlannerInput } from './planner'
import type {
  Attempt,
  Block,
  ExerciseBlock,
  LearnerModel,
  Performance,
  Prefs,
  SessionPlan,
  SkillDef,
  SkillState,
  SkillStep,
  SongBlock,
  SongItemState,
  SongSummary,
} from './types'
import { BEGINNER_SONG_SPEED, COMEBACK_TEMPO_FACTOR, MAX_SESSION_TEMPO_GAIN, PLACEMENT_MINUTES, SESSION_TEMPLATES, SONG_SPEED_STEPS, UNLOCK_RATING } from './constants'
import { COURSE } from '../lessons/course'
import { applyPlacement, applyTestResults, monthlyTasks, placementLadder } from './assessment'
import { itemDifficulty } from './difficulty'
import { exerciseParams, generateExercise } from './exercises'
import { DEFAULT_TUNING } from './exercises/builder'
import { applyAttempt, effectiveRating, newSkillState } from './learner'
import { attemptPerformance } from './performance'
import { applySongAttempt, newSongItem, nextReview, songItemKey, startReview } from './review'
import { SKILLS as REAL_SKILLS, SKILLS_BY_ID } from './skills'
import { openContextOf, skillOpener } from './unlock'

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

function skill(id: string, category: SkillDef['category'], tier: SkillDef['tier'], prerequisites: string[] = []): SkillDef {
  return {
    id,
    name: id,
    category,
    tier,
    prerequisites,
    refTempo: 80,
    startTempo: 60,
    targetTempo: 120,
    description: '',
    tips: [],
    generators: [`${id}-gen`],
  }
}

const SKILLS: SkillDef[] = [
  skill('chromatic', 'fretting', 1),
  skill('alt-picking', 'picking', 1),
  skill('power-chords', 'chords', 2, ['chromatic']),
  skill('string-skip', 'picking', 2, ['alt-picking']),
  skill('vibrato', 'lead', 2, ['chromatic']),
  skill('pent-lick', 'lead', 3, ['string-skip']),
]

function state(skillId: string, rating: number, extra: Partial<SkillState> = {}): SkillState {
  return { skillId, rating, confidence: 5, tempoCeiling: 0, ease: 2.3, intervalDays: 1, plateauStep: 0, attempts: 10, ...extra }
}

function model(states: SkillState[], songItems: Record<string, SongItemState> = {}): LearnerModel {
  return {
    skills: Object.fromEntries(states.map((s) => [s.skillId, s])),
    songItems,
    profile: { id: 1, goals: [], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 },
  }
}

const LIBRARY: SongSummary[] = [
  { id: 1, title: 'Song A', artist: 'X', duration: 120, bpm: 100, levelNoteCounts: [10, 20, 30, 40, 50, 60] },
  { id: 2, title: 'Song B', artist: 'Y', duration: 150, bpm: 90, levelNoteCounts: [10, 20, 30, 40, 50, 60] },
]

const NOW = new Date(2026, 5, 15, 10, 0, 0)
const DAY = 86_400_000

const BASE_STATES = [
  state('chromatic', 80, { tempoCeiling: 100, lastPracticedAt: NOW.getTime() - DAY }),
  state('alt-picking', 70, { tempoCeiling: 90 }),
  state('power-chords', 30),
  state('string-skip', 55),
  state('vibrato', 65),
]

function input(over: Partial<PlannerInput> = {}, prefs: Partial<Prefs> = {}): PlannerInput {
  return deepFreeze({
    model: model(BASE_STATES),
    skills: SKILLS,
    library: LIBRARY,
    prefs: { dailyMinutes: 20, goals: ['songs'], ...prefs } as Prefs,
    now: NOW,
    daysSinceLastSession: 1,
    ...over,
  })
}

const total = (blocks: { minutes: number }[]) => blocks.reduce((s, b) => s + b.minutes, 0)
const kinds = (p: { blocks: { kind: string }[] }) => p.blocks.map((b) => b.kind)

const ATTEMPT = {} as Attempt
function perf(acc: number): Performance {
  return { acc, tim: 1, tmp: 1, p: acc, reliable: true, reasons: [] }
}

describe('daily variety', () => {
  const exercises = (plan: { blocks: Block[] }) => plan.blocks.filter((b): b is ExerciseBlock => b.kind !== 'song' && b.kind !== 'test')

  it('gives every exercise a seed: the number of earlier days its skill was practised', () => {
    const fresh = exercises(planSession(input()))
    expect(fresh.length).toBeGreaterThan(0)
    for (const b of fresh) expect(b.params.seed, b.skillId).toBe(0)
    const focus = fresh.find((b) => b.kind === 'focus')!
    const later = exercises(planSession(input({ practiceDays: { [focus.skillId]: 3 } })))
    for (const b of later) expect(b.params.seed, b.skillId).toBe(b.skillId === focus.skillId ? 3 : 0)
    // Nothing else about the plan moves with the seed.
    const strip = (bs: ExerciseBlock[]) => bs.map((b) => ({ ...b, params: { ...b.params, seed: 0 } }))
    expect(strip(later)).toEqual(strip(fresh))
  })

  it('walks the open chord changes and the pentatonic boxes through their variations day by day', () => {
    const shown = (skillId: string, days: number) => {
      const skill = SKILLS_BY_ID[skillId]
      // Everything else is solid, so the pinned skill is open and becomes the main exercise.
      const states = REAL_SKILLS.map((s) => state(s.id, s.id === skillId ? 50 : 85, { lastPracticedAt: NOW.getTime() - 86_400_000 }))
      const plan = planSession({
        model: model(states),
        skills: REAL_SKILLS,
        library: [],
        prefs: { dailyMinutes: 20, goals: [], pinnedSkillId: skillId },
        now: NOW,
        daysSinceLastSession: 1,
        practiceDays: { [skillId]: days },
        effectiveRating,
      })
      const block = exercises(plan).find((b) => b.skillId === skillId)
      expect(block, `${skillId} is planned`).toBeDefined()
      const params = exerciseParams(skill, block!.generatorId, block!.tempo, block!.params)
      const chart = generateExercise(skill, block!.generatorId, params, DEFAULT_TUNING).chart
      return JSON.stringify(chart.notes.map((n) => [n.string, n.fret]))
    }
    for (const id of ['chord.open', 'lead.pent-boxes']) {
      expect(shown(id, 0), `${id}: the same day twice`).toBe(shown(id, 0))
      expect(new Set([0, 1, 2, 3].map((d) => shown(id, d))).size, `${id}: four days`).toBe(4)
    }
  })
})

describe('planSession', () => {
  it('builds a 20-minute plan: warm-up, focus, song, review', () => {
    const plan = planSession(input())
    expect(kinds(plan)).toEqual(['warmup', 'focus', 'song', 'review'])
    expect(total(plan.blocks)).toBe(20)
    expect(plan.minutes).toBe(20)
    expect(plan.date).toBe('2026-06-15')
    expect(plan.dayFactor).toBe(1)
    expect(plan.blocks[1].id).toBe('2026-06-15-1-focus')
    expect(plan.blocks.every((b) => b.status === 'pending')).toBe(true)
  })

  it('omits the song block with an empty library and gives its minutes to focus', () => {
    const plan = planSession(input({ library: [] }))
    expect(kinds(plan)).toEqual(['warmup', 'focus', 'review'])
    expect(total(plan.blocks)).toBe(20)
  })

  it('picks the lowest-rated unlocked goal skill as focus and never a locked skill', () => {
    const plan = planSession(input())
    const focus = plan.blocks.find((b) => b.kind === 'focus') as ExerciseBlock
    expect(focus.skillId).toBe('power-chords')
    expect(focus.generatorId).toBe('power-chords-gen')
    expect(focus.reason).toMatch(/main exercise/)
    const ids = plan.blocks.filter((b) => 'skillId' in b).map((b) => (b as ExerciseBlock).skillId)
    expect(ids).not.toContain('pent-lick')
  })

  it('does not pick the same focus three sessions in a row', () => {
    const repeated = planSession(input({ recentFocusSkillIds: ['power-chords', 'power-chords'] }))
    expect((repeated.blocks.find((b) => b.kind === 'focus') as ExerciseBlock).skillId).not.toBe('power-chords')
    const once = planSession(input({ recentFocusSkillIds: ['power-chords', 'string-skip'] }))
    expect((once.blocks.find((b) => b.kind === 'focus') as ExerciseBlock).skillId).toBe('power-chords')
  })

  it('lets a pinned skill win', () => {
    const plan = planSession(input({}, { pinnedSkillId: 'alt-picking' }))
    expect((plan.blocks.find((b) => b.kind === 'focus') as ExerciseBlock).skillId).toBe('alt-picking')
  })

  it('ignores a pinned skill that is locked', () => {
    const plan = planSession(input({}, { pinnedSkillId: 'pent-lick' }))
    expect((plan.blocks.find((b) => b.kind === 'focus') as ExerciseBlock).skillId).toBe('power-chords')
  })

  it('computes tempos from ceiling or start tempo', () => {
    const plan = planSession(input({}, { pinnedSkillId: 'chromatic' }))
    const warm = plan.blocks[0] as ExerciseBlock
    expect(warm.tempo).toBe(90)
    const focus = plan.blocks[1] as ExerciseBlock
    expect(focus.tempo).toBe(105)
    const pc = planSession(input()).blocks[1] as ExerciseBlock
    expect(pc.tempo).toBe(60)
    // Seven minutes at 60 bpm: sixteen bars a round (69 s with the count-in), six rounds.
    // It used to be three rounds of four bars whatever the block length: one minute of playing in seven.
    expect(pc.params).toMatchObject({ tempo: 60, bars: 16, startTempo: 60 })
    expect(pc.reps).toBe(6)
  })

  it('adds a checkpoint test and keeps total minutes', () => {
    const plan = planSession(input({ dueTest: 'checkpoint' }))
    const test = plan.blocks.find((b) => b.kind === 'test')
    expect(test).toMatchObject({ test: 'checkpoint', minutes: 5 })
    expect(kinds(plan)).not.toContain('review')
    expect(total(plan.blocks)).toBe(20)
  })

  it('checkpoint replaces the second block in a 30-minute plan', () => {
    const plan = planSession(input({ dueTest: 'checkpoint' }, { dailyMinutes: 30 }))
    expect(kinds(plan)).toEqual(['warmup', 'focus', 'test', 'song', 'review'])
    expect(total(plan.blocks)).toBe(30)
  })

  it('has a second skill from a different category in a 30-minute plan', () => {
    const plan = planSession(input({}, { dailyMinutes: 30 }))
    const focus = plan.blocks.find((b) => b.kind === 'focus') as ExerciseBlock
    const second = plan.blocks.find((b) => b.kind === 'second') as ExerciseBlock
    const cat = (id: string) => SKILLS.find((s) => s.id === id)?.category
    expect(cat(second.skillId)).not.toBe(cat(focus.skillId))
    expect(total(plan.blocks)).toBe(30)
  })

  it('monthly test replaces focus and second', () => {
    const plan = planSession(input({ dueTest: 'monthly' }, { dailyMinutes: 30 }))
    expect(kinds(plan)).toEqual(['warmup', 'test', 'song', 'review'])
    expect(total(plan.blocks)).toBe(30)
  })

  it('placement plan is only the placement block', () => {
    const plan = planSession(input({ dueTest: 'placement', daysSinceLastSession: undefined }))
    expect(plan.blocks).toHaveLength(1)
    expect(plan.blocks[0]).toMatchObject({ kind: 'test', test: 'placement', minutes: PLACEMENT_MINUTES })
  })

  it('quick is one 5-minute focus block', () => {
    const plan = planSession(input({ quick: true }))
    expect(plan.blocks).toHaveLength(1)
    expect(plan.blocks[0]).toMatchObject({ kind: 'focus', minutes: 5 })
    expect(plan.minutes).toBe(5)
  })

  it('comeback has no test, lower tempos and mentions the break', () => {
    const plan = planSession(input({ daysSinceLastSession: 10, dueTest: 'checkpoint' }))
    expect(plan.dayFactor).toBe(COMEBACK_TEMPO_FACTOR)
    expect(kinds(plan)).toEqual(['warmup', 'review', 'review', 'song'])
    expect(kinds(plan)).not.toContain('test')
    expect(total(plan.blocks)).toBe(20)
    const reviews = plan.blocks.filter((b): b is ExerciseBlock => b.kind === 'review')
    expect(reviews.map((r) => r.skillId)).toEqual(['chromatic', 'alt-picking'])
    expect(reviews[0].tempo).toBe(Math.round(100 * COMEBACK_TEMPO_FACTOR))
    expect(reviews[1].tempo).toBe(Math.round(90 * COMEBACK_TEMPO_FACTOR))
    expect(plan.explanation.join(' ')).toMatch(/away|break/i)
    const normal = planSession(input())
    const fNormal = normal.blocks[1] as ExerciseBlock
    expect(fNormal.tempo).toBeGreaterThan(0)
  })

  it('uses the effectiveRating function for unlocking', () => {
    const plan = planSession(input({ effectiveRating: (s) => (s.skillId === 'chromatic' ? 40 : s.rating) }))
    const ids = plan.blocks.filter((b) => 'skillId' in b).map((b) => (b as ExerciseBlock).skillId)
    expect(ids).not.toContain('power-chords')
    expect(ids).not.toContain('vibrato')
  })

  it('picks the review by due date, then rust', () => {
    const due = model([
      ...BASE_STATES.filter((s) => s.skillId !== 'alt-picking'),
      state('alt-picking', 70, { nextReviewAt: NOW.getTime() - DAY }),
    ])
    const plan = planSession(input({ model: due }))
    expect((plan.blocks.find((b) => b.kind === 'review') as ExerciseBlock).skillId).toBe('alt-picking')
    const rusty = model([...BASE_STATES.filter((s) => s.skillId !== 'string-skip'), state('string-skip', 80)])
    const eff = (s: SkillState) => (s.skillId === 'string-skip' ? 70 : s.rating)
    const p2 = planSession(input({ model: rusty, effectiveRating: eff }, { goals: ['lead'] }))
    expect((p2.blocks.find((b) => b.kind === 'review') as ExerciseBlock).skillId).toBe('string-skip')
  })

  it('always has a non-empty explanation of at most six lines', () => {
    for (const over of [{}, { quick: true }, { daysSinceLastSession: 9 }, { dueTest: 'checkpoint' as const }, { library: [] }]) {
      const plan = planSession(input(over))
      expect(plan.explanation.length).toBeGreaterThanOrEqual(1)
      expect(plan.explanation.length).toBeLessThanOrEqual(6)
    }
  })

  it('does not mutate its input (deep-frozen) and is deterministic', () => {
    const inp = input({ dueTest: 'checkpoint', recentFocusSkillIds: ['vibrato', 'vibrato'] })
    const before = JSON.stringify(inp)
    const a = planSession(inp)
    const b = planSession(inp)
    expect(JSON.stringify(inp)).toBe(before)
    expect(a).toEqual(b)
  })
})

describe('focusPriority', () => {
  it('weights goals, recency and readiness', () => {
    const ratings = { chromatic: 80, 'power-chords': 30 }
    const prefs: Prefs = { dailyMinutes: 20, goals: ['songs'] }
    const pc = SKILLS[2]
    const v = focusPriority(pc, state('power-chords', 30), prefs, NOW.getTime(), ratings)
    expect(v).toBeCloseTo(1.5 * 0.7 * 2 * 0.8, 5)
    const lead = focusPriority(SKILLS[4], undefined, prefs, NOW.getTime(), { ...ratings, vibrato: 0 })
    expect(lead).toBeCloseTo(0.6 * 1 * 2 * 0.8, 5)
    const all = focusPriority(pc, state('power-chords', 30), { dailyMinutes: 20, goals: [] }, NOW.getTime(), ratings)
    expect(all).toBeCloseTo(0.7 * 2 * 0.8, 5)
  })
})

describe('adaptAfterBlock', () => {
  it('rescales pending exercise tempos after a 70 % warm-up without mutating', () => {
    const plan = deepFreeze(planSession(input()))
    const before = JSON.stringify(plan)
    const warm = plan.blocks[0]
    const next = adaptAfterBlock(plan, warm.id, ATTEMPT, perf(0.7))
    expect(JSON.stringify(plan)).toBe(before)
    expect(next.dayFactor).toBe(0.9)
    expect(next.blocks[0].status).toBe('done')
    const oldFocus = plan.blocks[1] as ExerciseBlock
    const newFocus = next.blocks[1] as ExerciseBlock
    expect(newFocus.tempo).toBe(Math.round(oldFocus.tempo * 0.9))
    expect(newFocus.params.tempo).toBe(newFocus.tempo)
    const oldReview = plan.blocks[3] as ExerciseBlock
    expect((next.blocks[3] as ExerciseBlock).tempo).toBe(Math.round(oldReview.tempo * 0.9))
    expect(next.blocks[2]).toEqual(plan.blocks[2])
  })

  it('keeps tempos when the warm-up is clean', () => {
    const plan = planSession(input())
    const next = adaptAfterBlock(plan, plan.blocks[0].id, ATTEMPT, perf(0.95))
    expect(next.dayFactor).toBe(1)
    expect((next.blocks[1] as ExerciseBlock).tempo).toBe((plan.blocks[1] as ExerciseBlock).tempo)
  })

  it('adapts later pending blocks of the same skill after a rep block', () => {
    const base = planSession(input({}, { dailyMinutes: 30 }))
    const focus = base.blocks.find((b) => b.kind === 'focus') as ExerciseBlock
    const twin: ExerciseBlock = { ...focus, id: 'twin', kind: 'review', tempo: focus.tempo, params: { ...focus.params } }
    const plan = { ...base, blocks: [...base.blocks, twin] }
    const next = adaptAfterBlock(plan, focus.id, ATTEMPT, perf(0.95))
    const t = next.blocks.find((b) => b.id === 'twin') as ExerciseBlock
    expect(t.tempo).toBe(nextRepTempo(focus.tempo, 0.95, focus.tempo))
    expect(t.params.startTempo).toBe(focus.tempo)
    expect(next.blocks.find((b) => b.id === focus.id)?.status).toBe('done')
  })
})

describe('nextRepTempo', () => {
  it('raises, holds and lowers', () => {
    expect(nextRepTempo(100, 0.95, 100)).toBe(105)
    expect(nextRepTempo(100, 0.8, 100)).toBe(100)
    expect(nextRepTempo(100, 0.5, 100)).toBe(92)
  })
  it('caps at +15 % of the session start tempo', () => {
    expect(nextRepTempo(114, 0.95, 100)).toBe(Math.round(100 * (1 + MAX_SESSION_TEMPO_GAIN)))
    expect(nextRepTempo(115, 0.95, 100)).toBe(115)
  })
  it('never goes below 40 bpm', () => {
    expect(nextRepTempo(41, 0.1, 41)).toBe(40)
  })
  it('a round the Coach calls clean (85 %) is followed by a faster one; just under it the tempo stays', () => {
    expect(nextRepTempo(100, 0.85, 100)).toBe(105)
    expect(nextRepTempo(100, 0.84, 100)).toBe(100)
  })
  it('eases off after two in-between rounds at one tempo, and only then', () => {
    // 80 %: not clean, not rough. Once, the tempo stays; the second time in a row it comes down a little.
    expect(nextRepTempo(100, 0.8, 100, 140)).toBe(100)
    expect(nextRepTempo(100, 0.8, 100, 140, true)).toBe(95)
    // A clean or a rough round is answered as always, whatever came before.
    expect(nextRepTempo(100, 0.9, 100, 140, true)).toBe(105)
    expect(nextRepTempo(100, 0.5, 100, 140, true)).toBe(92)
    expect(inHoldBand(0.8)).toBe(true)
    expect(inHoldBand(0.85)).toBe(false)
    expect(inHoldBand(0.74)).toBe(false)
  })
  it('never goes above the tempo the skill aims for', () => {
    expect(nextRepTempo(118, 0.95, 110, 120)).toBe(120)
    expect(nextRepTempo(120, 0.95, 110, 120)).toBe(120)
    // A block planned by an earlier version above the target comes back to it.
    expect(nextRepTempo(150, 0.95, 150, 120)).toBe(120)
    expect(nextRepTempo(120, 0.5, 120, 120)).toBe(110)
  })
})

describe('the target tempo is where an exercise stops getting faster', () => {
  const pinnedPlan = (skillId: string, tempoCeiling: number, dailyMinutes: Prefs['dailyMinutes'] = 20) => {
    const states = REAL_SKILLS.map((s) => state(s.id, s.id === skillId ? 70 : 85, { lastPracticedAt: NOW.getTime() - 86_400_000, tempoCeiling: s.id === skillId ? tempoCeiling : s.startTempo }))
    return planSession({ model: model(states), skills: REAL_SKILLS, library: [], prefs: { dailyMinutes, goals: [], pinnedSkillId: skillId }, now: NOW, daysSinceLastSession: 1, effectiveRating })
  }

  it('plans no exercise above its skill target, whatever tempo was reached before, and stores the limit with the block', () => {
    for (const skill of REAL_SKILLS.filter((s) => s.tier >= 1 && s.category !== 'ear')) {
      // A ceiling from before the limit existed: twice the target.
      const plan = pinnedPlan(skill.id, skill.targetTempo * 2)
      const block = exercisesOf(plan).find((b) => b.skillId === skill.id)
      expect(block, skill.id).toBeDefined()
      expect(block!.tempo, skill.id).toBeLessThanOrEqual(skill.targetTempo)
      expect(block!.params.tempo, skill.id).toBe(block!.tempo)
      expect(block!.params.maxTempo, skill.id).toBe(skill.targetTempo)
    }
    for (const b of exercisesOf(pinnedPlan('fret.single-string', 500, 45))) expect(b.tempo, b.skillId).toBeLessThanOrEqual(SKILLS_BY_ID[b.skillId].targetTempo)
  })

  it('stays at the target through a session of clean rounds and a clean warm-up', () => {
    const skill = SKILLS_BY_ID['fret.single-string']
    let plan = pinnedPlan(skill.id, skill.targetTempo)
    const warm = plan.blocks.find((b) => b.kind === 'warmup')!
    plan = adaptAfterBlock(plan, warm.id, ATTEMPT, perf(0.97))
    const focus = () => exercisesOf(plan).find((b) => b.skillId === skill.id && b.kind === 'focus')!
    expect(focus().tempo).toBe(skill.targetTempo)
    // Round after round, as the Coach works the next tempo out from the limit stored with the block.
    let tempo = focus().tempo
    for (let round = 0; round < 4; round++) {
      tempo = nextRepTempo(tempo, 0.97, focus().params.startTempo as number, focus().params.maxTempo as number)
      expect(tempo).toBe(skill.targetTempo)
    }
  })

  it('a later exercise of the same skill stays at the target after a clean block at the target', () => {
    const skill = SKILLS_BY_ID['fret.single-string']
    const plan = pinnedPlan(skill.id, skill.targetTempo)
    const focus = exercisesOf(plan).find((b) => b.skillId === skill.id && b.kind === 'focus')!
    expect(focus.tempo).toBe(skill.targetTempo)
    // The same skill once more later in the day (a recap), with the limit stored on the block.
    const again: ExerciseBlock = { ...focus, id: `${focus.id}-again`, kind: 'review' }
    const next = adaptAfterBlock({ ...plan, blocks: [...plan.blocks, again] }, focus.id, ATTEMPT, perf(0.97))
    const later = exercisesOf(next).find((b) => b.id === again.id)!
    expect(later.tempo).toBe(skill.targetTempo)
    expect(later.params.tempo).toBe(skill.targetTempo)
  })

  it('a clean warm-up after a careful start of the day lifts the tempos back, but not over a target', () => {
    const skill = SKILLS_BY_ID['fret.single-string']
    const plan = pinnedPlan(skill.id, skill.targetTempo)
    // The day began slowed down (as after a break, or a shaky warm-up earlier): every exercise at nine tenths.
    const slowed = { ...plan, dayFactor: 0.9 }
    const warm = slowed.blocks.find((b) => b.kind === 'warmup')!
    const next = adaptAfterBlock(slowed, warm.id, ATTEMPT, perf(0.97))
    expect(next.dayFactor).toBe(1)
    const pending = exercisesOf(next).filter((b) => b.status === 'pending')
    expect(pending.length).toBeGreaterThan(0)
    for (const b of pending) {
      expect(b.tempo, b.skillId).toBeLessThanOrEqual(SKILLS_BY_ID[b.skillId].targetTempo)
      expect(b.params.startTempo as number, b.skillId).toBeLessThanOrEqual(SKILLS_BY_ID[b.skillId].targetTempo)
    }
    // The pinned skill was planned at its target: it stays there (it would have gone to 111 % of it).
    expect(pending.find((b) => b.skillId === skill.id)!.tempo).toBe(skill.targetTempo)
  })

  it('the longest session does not plan ear training twice (as its own block and as the recap)', () => {
    // Everything practised and solid, and ear training due for a recap.
    const states = REAL_SKILLS.map((s) => state(s.id, 80, { lastPracticedAt: NOW.getTime() - 86_400_000, attempts: 12, nextReviewAt: s.category === 'ear' ? NOW.getTime() - 5 * 86_400_000 : NOW.getTime() + 30 * 86_400_000 }))
    const plan = planSession({ model: model(states), skills: REAL_SKILLS, library: [], prefs: { dailyMinutes: 45, goals: [] }, now: NOW, daysSinceLastSession: 1, effectiveRating })
    const ear = exercisesOf(plan).filter((b) => SKILLS_BY_ID[b.skillId].category === 'ear')
    expect(ear.map((b) => b.kind)).toEqual(['ear'])
  })

  it('four weeks of clean playing: no round faster than its target, and nothing called mastered that was only played slowly', () => {
    for (const accuracy of [0.95, 0.88]) {
      const sim = courseGraduate(accuracy)
      for (let day = 1; day <= 28; day++) {
        const plan = simDay(sim, 20, accuracy)
        for (const b of exercisesOf(plan)) expect(b.tempo, `day ${day} ${b.skillId}`).toBeLessThanOrEqual(SKILLS_BY_ID[b.skillId].targetTempo)
      }
      for (const st of Object.values(sim.model.skills)) {
        const def = SKILLS_BY_ID[st.skillId]
        expect(st.tempoCeiling, st.skillId).toBeLessThanOrEqual(def.targetTempo)
        // Mastered (90 and up) means played cleanly at the target tempo, in every tier.
        if (st.rating >= 90) expect(st.tempoCeiling, `${st.skillId} rated ${st.rating.toFixed(0)}`).toBe(def.targetTempo)
      }
      // The first thing learned is played up to its target and then counts as done.
      expect(sim.model.skills['fret.single-string'].rating, `${accuracy}`).toBeGreaterThanOrEqual(90)
      expect(sim.model.skills['fret.single-string'].tempoCeiling, `${accuracy}`).toBe(SKILLS_BY_ID['fret.single-string'].targetTempo)
    }
  })
})

describe('pickSongBlock', () => {
  const item = (level: number, bestAccuracy: number | null, lastAt: number | null, weakBars: number[] = []): SongItemState => ({
    key: `1:${level}`,
    songId: 1,
    level,
    bestAccuracy,
    lastAt,
    ease: 2.3,
    intervalDays: 1,
    weakBars,
  })
  it('returns null for an empty library', () => {
    expect(pickSongBlock([], {}, 7)).toBeNull()
  })
  it('defaults to level index 2 at full speed', () => {
    expect(pickSongBlock(LIBRARY, {}, 7)).toMatchObject({ songId: 1, level: 2, speed: 1, minutes: 7 })
  })
  it('prefers the most recently played song', () => {
    const items = { '2:1': { ...item(1, 0.9, 500), key: '2:1', songId: 2 } }
    expect(pickSongBlock(LIBRARY, items, 7)?.songId).toBe(2)
  })
  it('moves up a level at 90 % and loops weak bars', () => {
    const items = { '1:2': item(2, 0.92, 10), '1:3': item(3, 0.6, 5) }
    const b = pickSongBlock(LIBRARY, items, 7)
    expect(b?.level).toBe(3)
    expect(b?.speed).toBe(0.85)
    const w = pickSongBlock(LIBRARY, { '1:2': item(2, 0.87, 10, [5, 6, 8]) }, 7)
    expect(w).toMatchObject({ level: 2, speed: 1, loopBars: [5, 8] })
  })
  it('drops one level for comebacks', () => {
    expect(pickSongBlock(LIBRARY, {}, 7, -1)?.level).toBe(1)
  })
})

describe('beginner mode (first steps)', () => {
  const TIERED: SkillDef[] = [
    { ...skill('basics.open-strings', 'picking', 0), startTempo: 50 },
    { ...skill('basics.first-frets', 'fretting', 0), startTempo: 50 },
    skill('single', 'fretting', 1),
    skill('pick.down', 'picking', 1),
    skill('fret.chromatic', 'fretting', 1, ['single']),
    skill('power-chords', 'chords', 2, ['single']),
    skill('string-skip', 'picking', 2, ['basics.open-strings']),
  ]
  const FIRST_STEPS = 'First steps: open strings and the first frets before anything faster.'
  const tiered = (states: SkillState[] = [], over: Partial<PlannerInput> = {}, prefs: Partial<Prefs> = {}) =>
    input({ model: model(states), skills: TIERED, daysSinceLastSession: undefined, ...over }, prefs)
  const tierOf = (id: string) => TIERED.find((s) => s.id === id)?.tier ?? -1
  const skillIds = (plan: { blocks: { kind: string }[] }) =>
    plan.blocks.filter((b) => 'skillId' in b).map((b) => (b as ExerciseBlock).skillId)

  it('gives a new learner open strings, a tier-0 focus, nothing above tier 1 and a gentle song', () => {
    const plan = planSession(tiered())
    expect((plan.blocks[0] as ExerciseBlock).skillId).toBe('basics.open-strings')
    const focus = plan.blocks.find((b) => b.kind === 'focus') as ExerciseBlock
    expect(tierOf(focus.skillId)).toBe(0)
    expect(skillIds(plan).every((id) => tierOf(id) <= 1)).toBe(true)
    expect(plan.blocks.find((b) => b.kind === 'song')).toMatchObject({ level: 0, speed: BEGINNER_SONG_SPEED })
    expect(plan.explanation).toContain(FIRST_STEPS)
    expect(plan.explanation.length).toBeLessThanOrEqual(6)
  })

  it('never schedules the warm-up skill again as focus or second', () => {
    for (const minutes of [20, 30, 45] as const) {
      const plan = planSession(tiered([], {}, { dailyMinutes: minutes }))
      const ids = skillIds(plan)
      expect(new Set(ids).size, `${minutes} min`).toBe(ids.length)
      expect((plan.blocks[0] as ExerciseBlock).skillId).toBe('basics.open-strings')
      expect((plan.blocks.find((b) => b.kind === 'focus') as ExerciseBlock).skillId).toBe('basics.first-frets')
    }
  })

  it('restricts the second block too and prefers a different category', () => {
    const plan = planSession(tiered([], {}, { dailyMinutes: 30 }))
    const focus = plan.blocks.find((b) => b.kind === 'focus') as ExerciseBlock
    const second = plan.blocks.find((b) => b.kind === 'second') as ExerciseBlock
    expect(tierOf(second.skillId)).toBeLessThanOrEqual(1)
    expect(TIERED.find((s) => s.id === second.skillId)?.category).not.toBe(TIERED.find((s) => s.id === focus.skillId)?.category)
  })

  it('lifts the restriction for a comfortable learner and warms up on the chromatic exercise', () => {
    const plan = planSession(tiered([state('fret.chromatic', 60), state('single', 50)]))
    expect((plan.blocks[0] as ExerciseBlock).skillId).toBe('fret.chromatic')
    expect(plan.explanation).not.toContain(FIRST_STEPS)
    expect(plan.blocks.find((b) => b.kind === 'song')).toMatchObject({ level: 2, speed: 1 })
  })

  it('stays in beginner mode at 24 and leaves it at 25', () => {
    expect(planSession(tiered([state('basics.first-frets', 24)])).explanation).toContain(FIRST_STEPS)
    expect(planSession(tiered([state('basics.first-frets', 25)])).explanation).not.toContain(FIRST_STEPS)
  })

  it('quick session for a new learner is a tier-0 block', () => {
    const plan = planSession(tiered([], { quick: true }))
    expect(plan.blocks).toHaveLength(1)
    expect(tierOf((plan.blocks[0] as ExerciseBlock).skillId)).toBe(0)
  })

  it('comeback for a beginner stays within tier 1 and starts the song gently', () => {
    const plan = planSession(tiered([state('basics.open-strings', 10), state('string-skip', 20)], { daysSinceLastSession: 10 }))
    expect(skillIds(plan).every((id) => tierOf(id) <= 1)).toBe(true)
    expect(plan.blocks.find((b) => b.kind === 'song')).toMatchObject({ level: 0, speed: BEGINNER_SONG_SPEED })
  })

  it('pickWarmupSkill respects ratings and falls back to the gentlest prerequisite-free skill', () => {
    expect(pickWarmupSkill(TIERED, {})?.id).toBe('basics.open-strings')
    expect(pickWarmupSkill(TIERED, { 'basics.first-frets': 45, single: 70 })?.id).toBe('basics.first-frets')
    expect(pickWarmupSkill(TIERED, { single: 70, 'fret.chromatic': 60 })?.id).toBe('single')
  })

  it('pickSongBlock only starts gently for beginners who have played nothing', () => {
    expect(pickSongBlock(LIBRARY, {}, 7, 0, { beginner: true })).toMatchObject({ level: 0, speed: BEGINNER_SONG_SPEED })
    expect(pickSongBlock(LIBRARY, {}, 7, 0, { beginner: true })?.reason).toMatch(/an easy level, played slowly/i)
    expect(pickSongBlock(LIBRARY, {}, 7)).toMatchObject({ level: 2, speed: 1 })
  })
})

/**
 * A small learner simulation over the real skill list: it leaves the state the First steps course
 * leaves behind (every drill round and song play recorded the way the app records them) and then
 * plans and plays consecutive days, so the tests below can look at real plans.
 */
interface Sim {
  model: LearnerModel
  history: Record<string, Attempt[]>
  library: SongSummary[]
  recentFocus: string[]
  now: number
  /** Recap skills of the last sessions, most recent first (what coach.ts reads from the stored plans). */
  recentRecap?: string[]
  goalSongId?: number
  lessonsDone?: number
  lessonSkillIds?: string[]
  /** Seconds of playing simulated so far: every round at the tempo it was played, every song pass, with count-ins. */
  playedSeconds?: number
}

const SIM_START = new Date(2026, 9, 1, 18, 0, 0).getTime()
const KIND_BY_BLOCK = { warmup: 'warmup', focus: 'practice', second: 'practice', review: 'review', ear: 'practice' } as const

function played(accuracy: number, tempo: number, at: number, speed = 1): Omit<Attempt, 'kind' | 'difficulty'> {
  const totalNotes = 40
  const perfects = Math.round(accuracy * totalNotes)
  const result = {
    perfects, goods: 0, misses: totalNotes - perfects, total: totalNotes, timingMedianMs: 8, timingStdevMs: 30, coverage: 0.9,
    durationSec: 30, playedTempo: tempo * speed, targetTempo: tempo, speed,
  }
  const perf = attemptPerformance(result)
  return { ...result, at, performance: perf.p, accuracy: perf.acc, reliable: perf.reliable }
}

/** One recorded round of an exercise; `closing` applies the end-of-block review bookkeeping. */
function simExercise(sim: Sim, skillId: string, generatorId: string, tempo: number, params: Record<string, unknown>, kind: Attempt['kind'], accuracy: number, closing: boolean): void {
  const def = SKILLS_BY_ID[skillId]
  const exercise = generateExercise(def, generatorId, exerciseParams(def, generatorId, tempo, params), DEFAULT_TUNING)
  const attempt: Attempt = { ...played(accuracy, tempo, sim.now), kind, skillId, difficulty: exercise.difficulty }
  const before = sim.model.skills[skillId] ?? newSkillState(skillId, 0, sim.now)
  let next = applyAttempt(before, attempt, def, sim.history[skillId] ?? [], sim.now)
  if (closing) {
    if (kind === 'review' && next.nextReviewAt) next = { ...next, ...nextReview(next, attempt.performance, sim.now) }
    else if (!next.nextReviewAt && next.rating >= 75) next = { ...next, ...startReview(sim.now) }
  }
  sim.history[skillId] = [...(sim.history[skillId] ?? []), attempt].slice(-20)
  sim.model = { ...sim.model, skills: { ...sim.model.skills, [skillId]: next } }
}

function simSong(sim: Sim, songId: number, level: number, speed: number, accuracy: number): void {
  const song = sim.library.find((s) => s.id === songId)!
  const key = songItemKey(songId, level)
  const attempt: Attempt = { ...played(accuracy, song.bpm, sim.now, speed), kind: 'song', songId, level, difficulty: 30 + 10 * level }
  const item = applySongAttempt(sim.model.songItems[key] ?? newSongItem(songId, level), attempt, sim.now)
  sim.model = { ...sim.model, songItems: { ...sim.model.songItems, [key]: item } }
}

/** A learner who has just finished First steps, one lesson a day, at a steady accuracy. */
function courseGraduate(accuracy: number): Sim {
  // Every bundled song the course plays or unlocks, with the lesson that makes it playable.
  const songIds = [...new Set(COURSE.flatMap((l) => [...(l.play ? [l.play.songId] : []), ...l.unlocks]))]
  const lessonLevel = (id: string) => COURSE.find((l) => l.unlocks.includes(id) || l.play?.songId === id)!.number
  const sim: Sim = {
    model: model([]),
    history: {},
    library: songIds.map((title, i) => ({ id: i + 1, title, artist: '', duration: 60, bpm: 80, levelNoteCounts: [10, 20, 30, 40, 50, 60], builtinId: title, lessonLevel: lessonLevel(title) })),
    recentFocus: [],
    now: SIM_START,
    recentRecap: [],
    lessonsDone: COURSE.length,
    lessonSkillIds: [...new Set(COURSE.flatMap((l) => (l.drill ? [l.drill.skillId] : [])))],
  }
  for (const lesson of COURSE) {
    sim.now += DAY
    if (lesson.drill) {
      for (let round = 1; round <= lesson.drill.rounds; round++) {
        sim.now += 60_000
        simExercise(sim, lesson.drill.skillId, lesson.drill.generatorId, lesson.drill.tempo, lesson.drill.params ?? {}, 'practice', accuracy, true)
      }
    }
    if (lesson.play) {
      sim.now += 120_000
      simSong(sim, songIds.indexOf(lesson.play.songId) + 1, lesson.play.level, lesson.play.speed, accuracy)
    }
  }
  sim.model = { ...sim.model, profile: { ...sim.model.profile, experience: 'new', placementDoneAt: SIM_START, firstStepsDoneAt: sim.now } }
  return sim
}

function simPlan(sim: Sim, minutes: Prefs['dailyMinutes']): ReturnType<typeof planSession> {
  return planSession({
    model: sim.model,
    skills: REAL_SKILLS,
    library: sim.library,
    prefs: { dailyMinutes: minutes, goals: [] },
    now: new Date(sim.now),
    recentFocusSkillIds: sim.recentFocus,
    recentRecapSkillIds: sim.recentRecap,
    goalSongId: sim.goalSongId,
    lessonsDone: sim.lessonsDone,
    lessonSkillIds: sim.lessonSkillIds,
    daysSinceLastSession: 1,
    effectiveRating,
  })
}

/** Moves to the next day, plans it and plays every block at the given accuracy. Returns the plan as planned. */
function simDay(sim: Sim, minutes: Prefs['dailyMinutes'], accuracy: number): ReturnType<typeof planSession> {
  sim.now += DAY
  const plan = simPlan(sim, minutes)
  // As in the app, the warm-up sets the tempo of the rest of the day (adaptAfterBlock).
  let live = plan
  for (let index = 0; index < plan.blocks.length; index++) {
    const block = live.blocks[index]
    if (block.kind === 'warmup') live = adaptAfterBlock(live, block.id, ATTEMPT, perf(accuracy))
    if (block.kind === 'test') continue
    if (block.kind === 'song') {
      // The app saves every time through the song as a play of its own, at the level and speed of the block.
      for (let pass = 1; pass <= (block.passes ?? 1); pass++) {
        sim.now += 120_000
        simSong(sim, block.songId, block.level, block.speed, accuracy)
      }
      sim.playedSeconds = (sim.playedSeconds ?? 0) + (block.passes ?? 1) * songPassSeconds(sim.library.find((x) => x.id === block.songId)!, block.speed)
      continue
    }
    let tempo = block.tempo
    for (let rep = 1; rep <= block.reps; rep++) {
      sim.now += 60_000
      // An ear round is its questions, about a minute, also when ear training is the main exercise.
      sim.playedSeconds = (sim.playedSeconds ?? 0) + (SKILLS_BY_ID[block.skillId].category === 'ear' ? 60 : roundSeconds(tempo, block.params.bars))
      simExercise(sim, block.skillId, block.generatorId, tempo, block.params, KIND_BY_BLOCK[block.kind], accuracy, rep === block.reps)
      // As coach.recordExerciseRep does: never faster than the skill aims for.
      tempo = nextRepTempo(tempo, accuracy, block.tempo, SKILLS_BY_ID[block.skillId].targetTempo)
    }
  }
  const focus = plan.blocks.find((b): b is ExerciseBlock => b.kind === 'focus')
  if (focus) sim.recentFocus = [focus.skillId, ...sim.recentFocus].slice(0, 2)
  const recaps = plan.blocks.filter((b): b is ExerciseBlock => b.kind === 'review').map((b) => b.skillId)
  if (sim.recentRecap) sim.recentRecap = [...recaps, ...sim.recentRecap].slice(0, 3)
  sim.now = new Date(sim.now).setHours(18, 0, 0, 0)
  return plan
}

const exercisesOf = (plan: { blocks: { kind: string }[] }) => plan.blocks.filter((b): b is ExerciseBlock => 'skillId' in b)
const blockOf = (plan: { blocks: { kind: string }[] }, kind: string) => plan.blocks.find((b) => b.kind === kind) as ExerciseBlock | undefined
const songOf = (plan: ReturnType<typeof planSession>) => plan.blocks.find((b) => b.kind === 'song') as Extract<ReturnType<typeof planSession>['blocks'][number], { kind: 'song' }> | undefined
const COURSE_SKILLS = new Set(COURSE.flatMap((l) => (l.drill ? [l.drill.skillId] : [])))
const MINUTES = [10, 20, 30, 45] as const

function ancestors(id: string): string[] {
  const out = new Set<string>()
  const walk = (x: string) => {
    for (const p of SKILLS_BY_ID[x].prerequisites) {
      if (!out.has(p)) {
        out.add(p)
        walk(p)
      }
    }
  }
  walk(id)
  return [...out]
}

describe('the days after First steps (simulated on the real skill list)', () => {
  it('leaves the state the audit described: course skills practised, none of them solid yet', () => {
    const sim = courseGraduate(0.85)
    for (const id of COURSE_SKILLS) expect(sim.model.skills[id]?.attempts, id).toBeGreaterThan(0)
    expect(sim.model.skills['chord.open'].rating).toBeLessThan(UNLOCK_RATING)
    expect(sim.model.skills['fret.cross-string'].rating).toBeLessThan(UNLOCK_RATING)
    expect(Object.keys(sim.model.songItems).length).toBeGreaterThan(0)
  })

  it('the day after the course continues with what the course taught, for every session length', () => {
    for (const minutes of MINUTES) {
      const sim = courseGraduate(0.85)
      const plan = simDay(sim, minutes, 0.85)
      const focus = blockOf(plan, 'focus')!
      expect(COURSE_SKILLS.has(focus.skillId), `${minutes} min focus ${focus.skillId}`).toBe(true)
      expect(SKILLS_BY_ID[focus.skillId].tier, `${minutes} min focus tier`).toBeGreaterThanOrEqual(1)
      for (const b of exercisesOf(plan)) {
        expect(b.generatorId, `${minutes} min ${b.kind}`).not.toBe('powerChordRiff')
        if (b.kind !== 'ear') expect(COURSE_SKILLS.has(b.skillId), `${minutes} min ${b.kind} ${b.skillId}`).toBe(true)
      }
      expect(plan.explanation.join(' ')).not.toMatch(/open strings and the first frets/)
    }
  })

  it('brings every skill of the course back within the first week and never schedules the power chord riff', () => {
    for (const accuracy of [0.85, 0.95]) {
      const sim = courseGraduate(accuracy)
      const seen = new Set<string>()
      for (let day = 1; day <= 7; day++) {
        for (const b of exercisesOf(simDay(sim, 20, accuracy))) {
          seen.add(b.skillId)
          expect(b.generatorId).not.toBe('powerChordRiff')
        }
      }
      for (const id of COURSE_SKILLS) if (SKILLS_BY_ID[id].tier >= 1) expect(seen.has(id), `${accuracy}: ${id}`).toBe(true)
    }
  })

  it('a learner who has never played does not get the power chord riff in the first session', () => {
    for (const minutes of MINUTES) {
      const sim: Sim = { model: model([]), history: {}, library: [], recentFocus: [], now: SIM_START }
      const plan = planSession({ model: sim.model, skills: REAL_SKILLS, library: [], prefs: { dailyMinutes: minutes, goals: [] }, now: new Date(SIM_START), effectiveRating })
      for (const b of exercisesOf(plan)) {
        expect(b.generatorId, `${minutes} min ${b.kind}`).not.toBe('powerChordRiff')
        expect(SKILLS_BY_ID[b.skillId].tier).toBeLessThanOrEqual(1)
      }
    }
  })

  it('never makes a skill the main or second exercise before everything under it is solid, unless the learner has practised it', () => {
    for (const accuracy of [0.6, 0.85, 0.95]) {
      const sim = courseGraduate(accuracy)
      for (let day = 1; day <= 14; day++) {
        const before = sim.model
        const rating = (id: string) => (before.skills[id] ? effectiveRating(before.skills[id], sim.now + DAY) : 0)
        const topTier = Math.max(0, ...REAL_SKILLS.filter((s) => rating(s.id) >= 25).map((s) => s.tier))
        const plan = simDay(sim, day % 2 ? 20 : 30, accuracy)
        for (const b of exercisesOf(plan).filter((x) => x.kind === 'focus' || x.kind === 'second')) {
          const label = `${accuracy} day ${day} ${b.kind} ${b.skillId}`
          const practised = (before.skills[b.skillId]?.attempts ?? 0) > 0
          const earned = ancestors(b.skillId).every((p) => rating(p) >= UNLOCK_RATING)
          expect(practised || earned, label).toBe(true)
          expect(SKILLS_BY_ID[b.skillId].tier, label).toBeLessThanOrEqual(topTier + 1)
          if (rating('chord.open') < UNLOCK_RATING) expect(['chord.barre', 'chord.sevenths'], label).not.toContain(b.skillId)
        }
      }
    }
  })

  it('rotates the recap instead of repeating one skill, and a recap that is not due does not push its review away', () => {
    for (const accuracy of [0.6, 0.95]) {
      const sim = courseGraduate(accuracy)
      const recaps: string[] = []
      for (let day = 1; day <= 14; day++) recaps.push(blockOf(simDay(sim, 20, accuracy), 'review')!.skillId)
      const counts = new Map<string, number>()
      for (const id of recaps) counts.set(id, (counts.get(id) ?? 0) + 1)
      expect(new Set(recaps.slice(0, 7)).size, `${accuracy}: ${recaps.join(' ')}`).toBeGreaterThanOrEqual(3)
      expect(Math.max(...counts.values()), `${accuracy}: ${recaps.join(' ')}`).toBeLessThanOrEqual(5)
      for (let i = 1; i < recaps.length; i++) expect(recaps[i], `${accuracy} day ${i + 1}`).not.toBe(recaps[i - 1])
      // Two weeks of daily practice can fit three real reviews at most: 2, 5 and 12 days.
      for (const st of Object.values(sim.model.skills)) expect(st.intervalDays, st.skillId).toBeLessThanOrEqual(12)
    }
  })

  it('keeps tuning by ear in its own block in a 45-minute plan, so it does not take over the main exercise', () => {
    for (const accuracy of [0.85, 0.95]) {
      const sim = courseGraduate(accuracy)
      for (let day = 1; day <= 7; day++) {
        const plan = simDay(sim, 45, accuracy)
        for (const b of exercisesOf(plan).filter((x) => x.kind === 'focus' || x.kind === 'second')) {
          expect(SKILLS_BY_ID[b.skillId].category, `${accuracy} day ${day} ${b.kind} ${b.skillId}`).not.toBe('ear')
        }
        expect(blockOf(plan, 'ear')?.skillId, `${accuracy} day ${day}`).toBe('ear.tuning')
      }
    }
  })

  it('a skill met only in a skill check does not count as practised: no power chord riff the day after', () => {
    const sim = courseGraduate(0.85)
    const tasks = monthlyTasks(sim.model, REAL_SKILLS)
    const riff = tasks.findIndex((t) => t.generatorId === 'powerChordRiff')
    expect(riff).toBeGreaterThan(0)
    // Everything before the riff goes well; the riff and the task after it do not, which ends the check.
    const results = tasks.slice(0, riff + 2).map((t, i) => ({
      taskId: t.id,
      passed: i < riff,
      attempt: { ...played(i < riff ? 0.9 : 0.4, 80, sim.now), kind: 'test' as const, skillId: t.skillIds[0], difficulty: t.difficulty },
    }))
    const tested = tasks.slice(riff, riff + 2).flatMap((t) => t.skillIds).filter((id) => SKILLS_BY_ID[id].prerequisites.length > 0)
    expect(tested).toContain('chord.power')
    sim.model = applyTestResults(sim.model, 'monthly', tasks, results, REAL_SKILLS, (st, a, def) => applyAttempt(st, a, def, [], a.at), sim.now).model
    for (let day = 1; day <= 5; day++) {
      const plan = simDay(sim, 30, 0.85)
      for (const b of exercisesOf(plan)) {
        expect(b.generatorId, `day ${day} ${b.kind}`).not.toBe('powerChordRiff')
        expect(tested, `day ${day} ${b.kind}`).not.toContain(b.skillId)
      }
    }
  })

  it('moves the song one step at a time: first the speed, then the level', () => {
    const sim = courseGraduate(0.92)
    const lastCoursePlay = [...COURSE].reverse().find((l) => l.play)!.play!
    // The songs take turns now, so the steps are followed song by song (this used to assume one song every day).
    const prevOf = new Map<number, { level: number; speed: number }>()
    for (const l of COURSE) if (l.play) prevOf.set(sim.library.find((s) => s.title === l.play!.songId)!.id, { level: l.play.level, speed: l.play.speed })
    const lastCourseSong = sim.library.find((s) => s.title === lastCoursePlay.songId)!.id
    const steps = [0.75, 0.85, 1]
    let checked = 0
    for (let day = 1; day <= 21; day++) {
      for (const song of simDay(sim, 20, 0.92).blocks.filter((b) => b.kind === 'song')) {
        expect(steps, `day ${day}`).toContain(song.speed)
        const prev = prevOf.get(song.songId)
        if (prev) {
          const levelStep = song.level - prev.level
          const speedStep = steps.indexOf(song.speed) - steps.indexOf(prev.speed)
          expect(Math.abs(levelStep) + Math.abs(speedStep), `day ${day} song ${song.songId}: L${prev.level}@${prev.speed} -> L${song.level}@${song.speed}`).toBeLessThanOrEqual(1)
          if (levelStep > 0) expect(prev.speed, `day ${day}`).toBe(1)
          if (song.songId === lastCourseSong && checked++ === 0) expect(song, 'first time back').toMatchObject({ level: 0, speed: 1 })
        }
        prevOf.set(song.songId, { level: song.level, speed: song.speed })
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(Math.max(...[...prevOf.values()].map((p) => p.level))).toBeGreaterThan(0)
  })
})

describe('what may become the main exercise (real skill list)', () => {
  const rated = (ratings: Record<string, number>, extra: Record<string, Partial<SkillState>> = {}) =>
    model(Object.entries(ratings).map(([id, r]) => state(id, r, { attempts: 0, ...extra[id] })))
  const focusOf = (m: LearnerModel, pinnedSkillId?: string) =>
    blockOf(
      planSession({ model: m, skills: REAL_SKILLS, library: [], prefs: { dailyMinutes: 20, goals: [], pinnedSkillId }, now: NOW, daysSinceLastSession: 1, effectiveRating }),
      'focus',
    )?.skillId

  it('keeps barre and seventh chords closed while open chords are not solid, even with strong chord changes', () => {
    const shaky = rated({ 'fret.single-string': 43, 'fret.cross-string': 26, 'chord.open': 29, 'chord.changes-open': 75 })
    expect(focusOf(shaky, 'chord.barre')).not.toBe('chord.barre')
    expect(focusOf(shaky, 'chord.sevenths')).not.toBe('chord.sevenths')
    const solid = rated({ 'fret.single-string': 70, 'fret.cross-string': 65, 'chord.open': 62, 'chord.changes-open': 75 })
    expect(focusOf(solid, 'chord.barre')).toBe('chord.barre')
  })

  it('opens a skill the learner has already practised, but only one tier above something they can do', () => {
    const lesson = { attempts: 3, lastPracticedAt: NOW.getTime() - DAY }
    const met = rated({ 'fret.single-string': 26, 'chord.open': 26, 'chord.changes-open': 53 }, { 'chord.changes-open': lesson, 'chord.open': lesson })
    expect(focusOf(met, 'chord.changes-open')).toBe('chord.changes-open')
    expect(focusOf(met, 'chord.open')).toBe('chord.open')
    // One try at a tier 3 skill does not open it for someone whose best skills are in tier 1.
    const far = rated({ 'fret.single-string': 30, 'chord.barre': 18 }, { 'chord.barre': lesson })
    expect(focusOf(far, 'chord.barre')).not.toBe('chord.barre')
  })

  it('one good rating in a harder skill does not end beginner mode', () => {
    const lesson = { attempts: 3, lastPracticedAt: NOW.getTime() - DAY }
    const early = rated({ 'basics.open-strings': 8, 'fret.single-string': 20, 'chord.changes-open': 45 }, { 'chord.changes-open': lesson })
    const plan = planSession({ model: early, skills: REAL_SKILLS, library: LIBRARY, prefs: { dailyMinutes: 30, goals: [] }, now: NOW, daysSinceLastSession: 1, effectiveRating })
    expect(plan.explanation.join(' ')).toMatch(/First steps/)
    for (const b of exercisesOf(plan).filter((x) => x.kind === 'focus' || x.kind === 'second')) expect(SKILLS_BY_ID[b.skillId].tier).toBeLessThanOrEqual(1)
  })

  it('does not start a brand-new skill while several others are still new to the learner', () => {
    const lesson = { attempts: 3, lastPracticedAt: NOW.getTime() - DAY }
    const fresh = rated({ 'fret.single-string': 30, 'fret.cross-string': 26, 'chord.open': 28 }, { 'fret.single-string': lesson, 'fret.cross-string': lesson, 'chord.open': lesson })
    expect(['fret.single-string', 'fret.cross-string', 'chord.open']).toContain(focusOf(fresh))
    const settled = { attempts: 12, lastPracticedAt: NOW.getTime() - DAY }
    const ready = rated({ 'fret.single-string': 30, 'fret.cross-string': 26, 'chord.open': 28 }, { 'fret.single-string': settled, 'fret.cross-string': settled, 'chord.open': settled })
    expect(['pick.downstrokes', 'time.metronome', 'ear.tuning']).toContain(focusOf(ready))
  })

  it('never plans the same drill twice in one session', () => {
    const plan = planSession({ model: model([]), skills: REAL_SKILLS, library: [], prefs: { dailyMinutes: 45, goals: [] }, now: NOW, effectiveRating })
    const focus = blockOf(plan, 'focus')!
    const second = blockOf(plan, 'second')!
    expect(second.generatorId).not.toBe(focus.generatorId)
  })
})

describe('the day after a placement test where every task was passed', () => {
  const tasks = placementLadder(REAL_SKILLS)
  const passedAll = tasks.map((t) => ({ taskId: t.id, passed: true, attempt: { ...played(0.95, 80, SIM_START), kind: 'test' as const, difficulty: t.difficulty } }))
  const placed = applyPlacement(model([]), tasks, passedAll, REAL_SKILLS, SIM_START).model
  const planFor = (minutes: Prefs['dailyMinutes'], pinnedSkillId?: string) =>
    planSession({
      model: placed,
      skills: REAL_SKILLS,
      library: LIBRARY,
      prefs: { dailyMinutes: minutes, goals: [], pinnedSkillId },
      now: new Date(SIM_START + DAY),
      daysSinceLastSession: 1,
      effectiveRating,
    })

  it('does not send the player back to open strings or other first basics', () => {
    for (const minutes of MINUTES) {
      const plan = planFor(minutes)
      for (const b of exercisesOf(plan).filter((x) => x.kind === 'focus' || x.kind === 'second')) {
        expect(SKILLS_BY_ID[b.skillId].tier, `${minutes} min ${b.kind} ${b.skillId}`).toBeGreaterThanOrEqual(2)
      }
      for (const b of exercisesOf(plan)) if (b.kind !== 'warmup') expect(SKILLS_BY_ID[b.skillId].tier, `${minutes} min ${b.kind}`).toBeGreaterThan(0)
      expect(plan.explanation.join(' ')).not.toMatch(/open strings and the first frets/)
    }
  })

  it('keeps every skill the player passed available, with everything under it solid', () => {
    for (const id of new Set(tasks.flatMap((t) => t.skillIds))) {
      expect(blockOf(planFor(20, id), 'focus')?.skillId, id).toBe(id)
      expect(placed.skills[id].rating, id).toBeGreaterThanOrEqual(UNLOCK_RATING)
      for (const p of ancestors(id)) expect(placed.skills[p].rating, `${id} <- ${p}`).toBeGreaterThanOrEqual(UNLOCK_RATING)
    }
    for (const s of REAL_SKILLS.filter((x) => x.tier === 0)) expect(placed.skills[s.id].rating, s.id).toBeGreaterThanOrEqual(UNLOCK_RATING)
  })
})

describe('the days after a placement test where the first four tasks were passed', () => {
  const tasks = placementLadder(REAL_SKILLS)
  const results = tasks.slice(0, 6).map((t, i) => ({ taskId: t.id, passed: i < 4, attempt: { ...played(i < 4 ? 0.95 : 0.5, 80, SIM_START), kind: 'test' as const, difficulty: t.difficulty } }))
  const passedSkills = [...new Set(tasks.slice(0, 4).flatMap((t) => t.skillIds))]
  const start = (): Sim => ({
    model: applyPlacement(model([]), tasks, results, REAL_SKILLS, SIM_START).model,
    history: {},
    library: LIBRARY,
    recentFocus: [],
    now: SIM_START,
  })
  const focusWhenPinned = (sim: Sim, pinnedSkillId: string) =>
    blockOf(
      planSession({ model: sim.model, skills: REAL_SKILLS, library: LIBRARY, prefs: { dailyMinutes: 20, goals: [], pinnedSkillId }, now: new Date(sim.now + DAY), daysSinceLastSession: 1, effectiveRating }),
      'focus',
    )?.skillId

  it('a task that was not passed never rates its skill as solid', () => {
    const placed = start().model
    for (const t of tasks.slice(4, 6)) {
      for (const id of t.skillIds) if (!passedSkills.includes(id)) expect(placed.skills[id].rating, id).toBeLessThan(UNLOCK_RATING)
    }
    // A recap is something the player knows: never a skill whose task has just gone wrong.
    const recap = blockOf(planSession({ model: placed, skills: REAL_SKILLS, library: LIBRARY, prefs: { dailyMinutes: 20, goals: [] }, now: new Date(SIM_START + DAY), daysSinceLastSession: 1, effectiveRating }), 'review')
    expect(passedSkills).toContain(recap?.skillId)
  })

  it('makes something still to learn the main exercise, not a first skill the player has just passed', () => {
    const placed = start().model
    for (const minutes of MINUTES) {
      const plan = planSession({ model: placed, skills: REAL_SKILLS, library: LIBRARY, prefs: { dailyMinutes: minutes, goals: [] }, now: new Date(SIM_START + DAY), daysSinceLastSession: 1, effectiveRating })
      const focus = blockOf(plan, 'focus')!
      expect(passedSkills, `${minutes} min focus`).not.toContain(focus.skillId)
      expect(placed.skills[focus.skillId].rating, `${minutes} min focus ${focus.skillId}`).toBeLessThan(UNLOCK_RATING)
      expect(placed.skills[focus.skillId].rating, `${minutes} min focus ${focus.skillId}`).toBeGreaterThan(0)
      expect(SKILLS_BY_ID[focus.skillId].tier, `${minutes} min focus ${focus.skillId}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps the passed skills open after an easy first drill has pulled a rating under them below the line', () => {
    const sim = start()
    // A few weak days cost a foundation skill its "solid" rating. (Good days at an easy tempo used to do
    // that too; they no longer lower a rating, so this test now gets there with runs that really are weak.)
    for (let day = 1; day <= 4; day++) simDay(sim, 30, 0.6)
    expect(Math.min(...passedSkills.map((id) => sim.model.skills[id].rating))).toBeLessThan(UNLOCK_RATING)
    // ...but what the player showed in the test is still theirs to practise.
    for (const id of passedSkills) expect(focusWhenPinned(sim, id), id).toBe(id)
  })
})

describe('song level and speed (one step at a time, both ways)', () => {
  const songPlay = (items: Record<string, SongItemState>, level: number, speed: number, accuracy: number, at: number): Record<string, SongItemState> => {
    const key = songItemKey(1, level)
    const attempt: Attempt = { ...played(accuracy, 100, at, speed), kind: 'song', songId: 1, level, difficulty: 30 }
    return { ...items, [key]: applySongAttempt(items[key] ?? newSongItem(1, level), attempt, at) }
  }

  it('a level played well at reduced speed is played faster next, and only moves up after a clear at full speed', () => {
    let items = songPlay({}, 0, 0.75, 0.92, 1000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 0, speed: 0.85 })
    items = songPlay(items, 0, 0.85, 0.92, 2000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 0, speed: 1 })
    items = songPlay(items, 0, 1, 0.92, 3000)
    const up = pickSongBlock(LIBRARY, items, 7)
    expect(up).toMatchObject({ level: 1, speed: 1 })
    expect(up?.reason).toMatch(/level 1.*moving up/i)
  })

  it('one result under 70 % slows the same level down; two in a row go back one level', () => {
    let items = songPlay({}, 2, 1, 0.55, 1000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 2, speed: 0.85 })
    items = songPlay(items, 2, 0.85, 0.5, 2000)
    const down = pickSongBlock(LIBRARY, items, 7)
    expect(down).toMatchObject({ level: 1, speed: 0.85 })
    expect(down?.reason).toMatch(/level 2/i)
    // A good result in between starts the count again.
    let mixed = songPlay({}, 2, 1, 0.55, 1000)
    mixed = songPlay(mixed, 2, 0.85, 0.8, 2000)
    mixed = songPlay(mixed, 2, 0.85, 0.6, 3000)
    expect(pickSongBlock(LIBRARY, mixed, 7)).toMatchObject({ level: 2, speed: 0.75 })
  })

  it('at the easiest level it slows down further instead of dropping', () => {
    let items = songPlay({}, 0, 1, 0.5, 1000)
    items = songPlay(items, 0, 0.85, 0.5, 2000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 0, speed: 0.75 })
  })

  it('a run on an easier level, just for fun, does not pull the plan down', () => {
    let items = songPlay({}, 2, 1, 0.92, 1000)
    items = songPlay(items, 3, 1, 0.75, 2000)
    // Level 3 is cleared and level 4 is in progress; then one go at level 1 from the library.
    items = songPlay(items, 0, 1, 0.96, 3000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 3, speed: 1 })
  })

  it('after going back a level it stays there until that level is played well at full speed', () => {
    let items = songPlay({}, 2, 1, 0.92, 1000)
    items = songPlay(items, 2, 1, 0.5, 2000)
    items = songPlay(items, 2, 0.85, 0.5, 3000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 1, speed: 0.85 })
    // An ordinary result on the easier level is no reason to jump straight back up.
    items = songPlay(items, 1, 0.85, 0.8, 4000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 1, speed: 0.85 })
    items = songPlay(items, 1, 0.85, 0.92, 5000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 1, speed: 1 })
    items = songPlay(items, 1, 1, 0.92, 6000)
    // Back up one level, a step slower than where it went wrong.
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 2, speed: 0.75 })
  })

  it('stays on the hardest level once it is cleared', () => {
    const items = songPlay({}, 5, 1, 0.95, 1000)
    expect(pickSongBlock(LIBRARY, items, 7)).toMatchObject({ level: 5, speed: 1 })
  })
})

describe('how long a plan lasts (the minutes the learner chose mean something)', () => {
  it('measures a round with its count-in and makes the exercise longer before it asks for more rounds', () => {
    // Four bars and the four-beat count-in at 60 bpm, plus the second of silence at the end.
    expect(roundSeconds(60, 4)).toBe(21)
    expect(fitRounds(1, 50)).toEqual({ bars: 4, reps: 2 })
    expect(fitRounds(3, 50)).toEqual({ bars: 8, reps: 4 })
    expect(fitRounds(7, 60)).toEqual({ bars: 16, reps: 6 })
    // Never more rounds than a teacher would ask for, however fast the tempo.
    expect(fitRounds(10, 200).reps).toBe(MAX_ROUNDS)
  })

  it('every exercise can be written out at each length the planner asks for, and lasts what was measured', () => {
    for (const def of REAL_SKILLS.filter((x) => x.category !== 'ear')) {
      for (const bars of [4, 8, 16, 32]) {
        const tempo = def.startTempo
        const exercise = generateExercise(def, def.generators[0], exerciseParams(def, def.generators[0], tempo, { tempo, bars }), DEFAULT_TUNING)
        expect(exercise.chart.notes.length, `${def.id} ${bars} bars`).toBeGreaterThan(0)
        // The chart is the bars and the silence after them; the count-in comes on top.
        expect(exercise.chart.duration + (4 * 60) / tempo, `${def.id} ${bars} bars`).toBeCloseTo(roundSeconds(tempo, bars), 5)
      }
    }
  })

  it('every plan holds about as much playing as it says, for each daily time', () => {
    for (const minutes of MINUTES) {
      const plan = planSession(input({}, { dailyMinutes: minutes }))
      const playing = planPlayingMinutes(plan, LIBRARY)
      expect(playing / plan.minutes, `${minutes} min: ${playing.toFixed(1)} min of playing`).toBeGreaterThan(2 / 3)
      expect(playing / plan.minutes, `${minutes} min: ${playing.toFixed(1)} min of playing`).toBeLessThan(4 / 3)
    }
  })
})

describe('which song (it takes turns, and the goal song from the set-up counts)', () => {
  const song = (id: number, lessonLevel?: number): SongSummary => ({ id, title: `Song ${id}`, artist: '', duration: 60, bpm: 80, levelNoteCounts: [10, 20, 30, 40, 50, 60], lessonLevel })
  const lib = [song(1, 1), song(2, 3), song(3, 4), song(4, 8)]
  const playedAt = (items: Record<string, SongItemState>, songId: number, at: number): Record<string, SongItemState> => ({
    ...items,
    [songItemKey(songId, 0)]: { ...newSongItem(songId, 0), bestAccuracy: 0.8, lastAt: at },
  })

  it('does not offer the song that was played last again while others wait', () => {
    let items: Record<string, SongItemState> = {}
    const seen: number[] = []
    for (let day = 1; day <= 8; day++) {
      const pick = pickSongs(lib, items, 1)[0]
      seen.push(pick.id)
      items = playedAt(items, pick.id, day)
    }
    expect(seen).toEqual([1, 2, 3, 4, 1, 2, 3, 4])
  })

  it('brings the goal song back at least every second day, with the other songs in between', () => {
    let items: Record<string, SongItemState> = {}
    const seen: number[] = []
    for (let day = 1; day <= 6; day++) {
      const pick = pickSongs(lib, items, 1, { goalSongId: 3 })[0]
      seen.push(pick.id)
      items = playedAt(items, pick.id, day)
    }
    expect(seen).toEqual([3, 1, 3, 2, 3, 4])
    // With room for two songs the goal song is there every day and the second one changes.
    expect(pickSongs(lib, playedAt(playedAt({}, 3, 1), 1, 2), 2, { goalSongId: 3 }).map((x) => x.id)).toEqual([3, 2])
  })

  it('gives a beginner only songs the finished lessons prepared, also when the goal song is a harder one', () => {
    expect(pickSongs(lib, {}, 3, { beginner: true, lessonsDone: 0, goalSongId: 4 }).map((x) => x.id)).toEqual([1])
    expect(pickSongs(lib, {}, 3, { beginner: true, lessonsDone: 4, goalSongId: 4 }).map((x) => x.id)).toEqual([1, 2, 3])
    expect(pickSongs(lib, {}, 3, { lessonsDone: 10, goalSongId: 4 }).map((x) => x.id)).toEqual([4, 1, 2])
    // An imported song has no lesson: not for a beginner while a bundled one is there.
    expect(pickSongs([song(9), ...lib], {}, 2, { beginner: true }).map((x) => x.id)).toEqual([1])
  })

  it('plans the song that waited longest, not the one played yesterday', () => {
    const items = playedAt({}, 1, NOW.getTime() - DAY)
    const plan = planSession(input({ model: model(BASE_STATES, items) }))
    expect(songOf(plan)?.songId).toBe(2)
  })
})

describe('recap and graduate follow-ups', () => {
  it('a recap that was offered and skipped is not offered again the next day', () => {
    const first = blockOf(planSession(input()), 'review')!.skillId
    // Nothing was played, so the model is the same: only the list of recent recaps has grown.
    const second = blockOf(planSession(input({ recentRecapSkillIds: [first] })), 'review')!.skillId
    expect(second).not.toBe(first)
    const third = blockOf(planSession(input({ recentRecapSkillIds: [second, first] })), 'review')!.skillId
    expect([first, second]).not.toContain(third)
  })

  it('a graduate with low ratings builds on what the lessons drilled; someone who skipped the course starts with the basics', () => {
    const lessonSkillIds = [...COURSE_SKILLS]
    const lesson = { attempts: 3, lastPracticedAt: NOW.getTime() - DAY, tempoCeiling: 40 }
    const weak = model([...COURSE_SKILLS].map((id) => state(id, SKILLS_BY_ID[id].tier >= 2 ? 20 : 12, lesson)))
    const base = { model: weak, skills: REAL_SKILLS, library: [] as SongSummary[], now: NOW, daysSinceLastSession: 1, effectiveRating }
    for (const minutes of MINUTES) {
      const graduate = planSession({ ...base, prefs: { dailyMinutes: minutes, goals: [] }, lessonsDone: COURSE.length, lessonSkillIds })
      const focus = blockOf(graduate, 'focus')!
      expect(SKILLS_BY_ID[focus.skillId].tier, `${minutes} min focus ${focus.skillId}`).toBeGreaterThanOrEqual(1)
      expect(lessonSkillIds, `${minutes} min focus`).toContain(focus.skillId)
      expect(graduate.explanation.join(' ')).not.toMatch(/open strings and the first frets/)
    }
    // Chords are main exercises for a graduate, not only recaps.
    const pinned = planSession({ ...base, prefs: { dailyMinutes: 20, goals: [], pinnedSkillId: 'chord.changes-open' }, lessonsDone: COURSE.length, lessonSkillIds })
    expect(blockOf(pinned, 'focus')!.skillId).toBe('chord.changes-open')
    const skipped = planSession({ ...base, model: model([]), prefs: { dailyMinutes: 20, goals: [] } })
    expect(SKILLS_BY_ID[blockOf(skipped, 'focus')!.skillId].tier).toBe(0)
    expect(skipped.explanation.join(' ')).toMatch(/First steps/)
  })
})

describe('four weeks after First steps: the rating follows the playing (simulated)', () => {
  /** Plays `days` days of 20 minutes; returns the first day each skill was rated solid and first appeared in a plan. */
  function weeks(accuracy: number, days: number) {
    const sim = courseGraduate(accuracy)
    const start = Object.fromEntries(Object.values(sim.model.skills).map((st) => [st.skillId, st.rating]))
    const solidOn: Record<string, number> = {}
    const plannedOn: Record<string, number> = {}
    const plans: ReturnType<typeof planSession>[] = []
    let neverLowered = true
    for (let day = 1; day <= days; day++) {
      const before = Object.fromEntries(Object.values(sim.model.skills).map((st) => [st.skillId, st.rating]))
      const plan = simDay(sim, 20, accuracy)
      plans.push(plan)
      for (const b of exercisesOf(plan)) plannedOn[b.skillId] ??= day
      for (const st of Object.values(sim.model.skills)) {
        if (st.rating >= UNLOCK_RATING) solidOn[st.skillId] ??= day
        if (st.rating < (before[st.skillId] ?? 0) - 1e-9) neverLowered = false
      }
    }
    return { sim, start, solidOn, plannedOn, plans, neverLowered }
  }

  it('at 95 % nobody stalls: the first tier 1 skills are solid within two weeks and what builds on them opens', () => {
    const { sim, solidOn, plannedOn, neverLowered } = weeks(0.95, 28)
    // Clean runs only: no rating ever went down, whatever tempo the round was played at.
    expect(neverLowered).toBe(true)
    expect(solidOn['fret.single-string'], 'single notes solid').toBeLessThanOrEqual(7)
    expect(solidOn['fret.cross-string'], 'crossing strings solid').toBeLessThanOrEqual(14)
    expect(solidOn['chord.open'], 'open chords solid').toBeLessThanOrEqual(14)
    expect(solidOn['pick.downstrokes'], 'downstrokes solid').toBeLessThanOrEqual(21)
    // The skills behind them used to stay closed for good.
    expect(plannedOn['fret.chromatic'], 'the spider').toBeLessThanOrEqual(14)
    expect(plannedOn['chord.power'], 'power chords').toBeLessThanOrEqual(21)
    expect(plannedOn['pick.alternate-8'], 'alternate picking').toBeLessThanOrEqual(28)
    for (const id of ['fret.single-string', 'fret.cross-string', 'fret.chromatic', 'pick.downstrokes']) {
      expect(sim.model.skills[id].rating, id).toBeGreaterThanOrEqual(UNLOCK_RATING)
    }
  })

  it('at 85 to 88 % the learner moves forward like any clean player: no tempo is talked down, no rating falls, each clean round is followed by a faster one', () => {
    for (const accuracy of [0.85, 0.88]) {
      const before = courseGraduate(accuracy).model.skills
      const { sim, solidOn, plannedOn, neverLowered } = weeks(accuracy, 28)
      // These runs are what the Coach itself calls clean (they raise the tempo), so no rating may fall...
      expect(neverLowered, `${accuracy}`).toBe(true)
      // ...and no skill is asked for at a slower tempo than the learner has already played cleanly.
      // (Days of warm-up rounds at nine tenths of the tempo used to pull it down, 10 % every two days.)
      for (const [id, was] of Object.entries(before)) expect(sim.model.skills[id].tempoCeiling, `${accuracy} ${id}`).toBeGreaterThanOrEqual(was.tempoCeiling)
      for (const id of ['chord.open', 'fret.cross-string', 'fret.single-string']) expect(solidOn[id], `${accuracy} ${id}`).toBeLessThanOrEqual(28)
      for (const id of ['pick.downstrokes', 'time.metronome']) expect(sim.model.skills[id].rating, `${accuracy} ${id}`).toBeGreaterThan(UNLOCK_RATING - 5)
      // A round of 85 % is what the Coach calls clean everywhere else, so the next one is a little faster,
      // as after a round of 95 %. (The line for that used to be 90 %: single notes took until day 28.)
      expect(solidOn['fret.single-string'], `${accuracy}`).toBeLessThanOrEqual(7)
      expect(plannedOn['chord.power'], `${accuracy}`).toBeLessThanOrEqual(28)
    }
  })

  it('at 80 % the ratings hold or rise, but nothing is called solid yet and nothing new opens on top', () => {
    const { sim, start, solidOn, plans } = weeks(0.8, 28)
    expect(Object.keys(solidOn)).toEqual([])
    for (const [id, was] of Object.entries(start)) expect(sim.model.skills[id].rating, id).toBeGreaterThan(was - 2)
    const mean = (r: number[]) => r.reduce((a, b) => a + b, 0) / r.length
    expect(mean(Object.keys(start).map((id) => sim.model.skills[id].rating))).toBeGreaterThan(mean(Object.values(start)) + 3)
    for (const plan of plans) {
      for (const b of exercisesOf(plan)) expect(COURSE_SKILLS.has(b.skillId) || SKILLS_BY_ID[b.skillId].prerequisites.length === 0, b.skillId).toBe(true)
    }
  })

  it('at 60 % the learner is not pushed on: nothing becomes solid, nothing gets faster, nothing new opens on top', () => {
    const { sim, solidOn, plans } = weeks(0.6, 28)
    expect(Object.keys(solidOn)).toEqual([])
    for (const st of Object.values(sim.model.skills)) expect(st.rating, st.skillId).toBeLessThan(UNLOCK_RATING - 10)
    plans.forEach((plan, i) => {
      for (const b of exercisesOf(plan)) {
        const def = SKILLS_BY_ID[b.skillId]
        expect(COURSE_SKILLS.has(b.skillId) || def.prerequisites.length === 0, `day ${i + 1} ${b.skillId}`).toBe(true)
        expect(b.tempo, `day ${i + 1} ${b.skillId}`).toBeLessThanOrEqual(def.startTempo)
      }
    })
    // Still a plan that builds on the lessons: chords are main exercises, not only recaps.
    const focusSkills = new Set(plans.map((p) => blockOf(p, 'focus')!.skillId))
    expect([...focusSkills].some((id) => SKILLS_BY_ID[id].category === 'chords')).toBe(true)
  })
})

describe('fourteen days after First steps: variety and honest minutes (simulated)', () => {
  it('songs and recaps change, the goal song is there, and the plan lasts about as long as it says', () => {
    for (const accuracy of [0.6, 0.8, 0.95]) {
      for (const minutes of MINUTES) {
        const label = `${accuracy} at ${minutes} min`
        const sim = courseGraduate(accuracy)
        const goal = sim.library.find((x) => x.title === 'amazing-grace')!.id
        sim.goalSongId = goal
        const firstSongs: number[] = []
        const allSongs = new Set<number>()
        const recaps: string[] = []
        let goalDays = 0
        for (let day = 1; day <= 14; day++) {
          sim.playedSeconds = 0
          const plan = simDay(sim, minutes, accuracy)
          const songs = plan.blocks.filter((b) => b.kind === 'song')
          expect(songs.length, `${label} day ${day}`).toBeGreaterThanOrEqual(1)
          firstSongs.push(songs[songs.length - 1].songId)
          for (const b of songs) {
            allSongs.add(b.songId)
            expect(b.passes, `${label} day ${day}`).toBeLessThanOrEqual(MAX_SONG_PASSES)
            expect(sim.library.find((x) => x.id === b.songId)!.lessonLevel).toBeLessThanOrEqual(COURSE.length)
          }
          if (songs.some((b) => b.songId === goal)) goalDays++
          for (const b of exercisesOf(plan)) expect(b.reps, `${label} day ${day} ${b.kind}`).toBeLessThanOrEqual(MAX_ROUNDS)
          const recap = blockOf(plan, 'review')
          if (recap) recaps.push(recap.skillId)
          // Planned minutes against the time the simulated learner really played.
          const played = sim.playedSeconds / 60
          expect(played / plan.minutes, `${label} day ${day}: planned ${plan.minutes}, played ${played.toFixed(1)}`).toBeGreaterThan(2 / 3)
          expect(played / plan.minutes, `${label} day ${day}: planned ${plan.minutes}, played ${played.toFixed(1)}`).toBeLessThan(4 / 3)
          expect(plan.minutes).toBe(minutes)
        }
        // The song that changes is never the same two days running, and most of the library gets played.
        for (let i = 1; i < firstSongs.length; i++) expect(firstSongs[i], `${label} day ${i + 1}: ${firstSongs.join(' ')}`).not.toBe(firstSongs[i - 1])
        expect(allSongs.size, `${label}: ${[...allSongs].join(' ')}`).toBeGreaterThanOrEqual(6)
        expect(goalDays, `${label}: goal song days`).toBeGreaterThanOrEqual(5)
        expect(new Set(recaps).size, `${label}: ${recaps.join(' ')}`).toBeGreaterThanOrEqual(3)
        for (let i = 1; i < recaps.length; i++) expect(recaps[i], `${label} recap day ${i + 1}`).not.toBe(recaps[i - 1])
      }
    }
  })
})

describe('review follow-ups: ear training as the main exercise, a clean warm-up, and songs for someone who left the course early', () => {
  it('times an ear exercise by its questions, also when it is the main exercise or a recap', () => {
    // An ear round is a fixed set of questions, about a minute, whatever the bars and the tempo say.
    const ear = state('ear.tuning', 30, { attempts: 12, tempoCeiling: 70, lastPracticedAt: NOW.getTime() - DAY })
    const practised = { attempts: 12, lastPracticedAt: NOW.getTime() - DAY }
    const known = [ear, state('fret.single-string', 45, practised), state('pick.downstrokes', 30, practised)]
    const plan = planSession({ model: model(known), skills: REAL_SKILLS, library: LIBRARY, prefs: { dailyMinutes: 20, goals: [], pinnedSkillId: 'ear.tuning' }, now: NOW, daysSinceLastSession: 1, effectiveRating })
    const focus = blockOf(plan, 'focus')!
    expect(focus.skillId).toBe('ear.tuning')
    expect(focus.minutes).toBe(7)
    // Seven minutes: six rounds (the most a block asks for). It used to be four, sized as 32 bars at 74 bpm.
    expect(focus.reps).toBe(MAX_ROUNDS)
    const others = plan.blocks.filter((b) => b.id !== focus.id)
    expect(planPlayingMinutes(plan, LIBRARY, REAL_SKILLS) - planPlayingMinutes({ blocks: others }, LIBRARY, REAL_SKILLS)).toBeCloseTo(focus.reps, 5)
  })

  it('a warm-up at 87 % is a clean warm-up: the rest of the day keeps its tempo', () => {
    const plan = planSession(input())
    const next = adaptAfterBlock(plan, plan.blocks[0].id, ATTEMPT, perf(0.87))
    expect(next.dayFactor).toBe(1)
    expect((next.blocks[1] as ExerciseBlock).tempo).toBe((plan.blocks[1] as ExerciseBlock).tempo)
    // Under the clean mark the day is still taken a little slower.
    expect(adaptAfterBlock(plan, plan.blocks[0].id, ATTEMPT, perf(0.8)).dayFactor).toBe(0.95)
  })

  it('someone who left the course after lesson 4 gets the songs of those lessons, not a chord song or the riff of lesson 10', () => {
    const songIds = [...new Set(COURSE.flatMap((l) => [...(l.play ? [l.play.songId] : []), ...l.unlocks]))]
    const lessonLevel = (id: string) => COURSE.find((l) => l.unlocks.includes(id) || l.play?.songId === id)!.number
    const library: SongSummary[] = songIds.map((title, i) => ({ id: i + 1, title, artist: '', duration: 60, bpm: 80, levelNoteCounts: [10, 20, 30, 40, 50, 60], builtinId: title, lessonLevel: lessonLevel(title) }))
    const done = COURSE.slice(0, 4)
    const lessonSkillIds = [...new Set(done.flatMap((l) => (l.drill ? [l.drill.skillId] : [])))]
    // Lesson 4 drills a tier 1 skill, so this learner is past the very first basics...
    expect(lessonSkillIds.some((id) => SKILLS_BY_ID[id].tier >= 1)).toBe(true)
    const lesson = { attempts: 3, lastPracticedAt: NOW.getTime() - DAY, tempoCeiling: 50 }
    const learner = model(lessonSkillIds.map((id) => state(id, 18, lesson)))
    const goal = library.find((x) => x.title === 'amazing-grace')!.id
    for (const minutes of MINUTES) {
      const plan = planSession({ model: learner, skills: REAL_SKILLS, library, prefs: { dailyMinutes: minutes, goals: [] }, now: NOW, daysSinceLastSession: 1, effectiveRating, goalSongId: goal, lessonsDone: done.length, lessonSkillIds })
      const songs = plan.blocks.filter((b) => b.kind === 'song')
      expect(songs.length, `${minutes} min`).toBeGreaterThanOrEqual(1)
      // ...but the songs are still the ones the finished lessons prepared.
      for (const b of songs) expect(library.find((x) => x.id === b.songId)!.lessonLevel, `${minutes} min song ${b.songId}`).toBeLessThanOrEqual(done.length)
    }
    // The same in the song picker itself; a player who never took the lessons is not held back by them.
    expect(pickSongs(library, {}, 3, { lessonsDone: 1, goalSongId: goal }).map((x) => x.lessonLevel)).toEqual([1])
    expect(pickSongs(library, {}, 3, { goalSongId: goal })[0].id).toBe(goal)
  })
})

describe('guitar: with none of the new options, every plan is the plan it was before singing', () => {
  /**
   * Recorded from the planner as it stood before it had any option for a second instrument
   * (commit ad9a5de), over the real skill list. A digest says only "something moved": the cases above
   * say what. JSON keeps the order of keys, so a stored block is the same down to the byte.
   * When a guitar rule or sentence is changed on purpose, the failing case prints the new digests:
   * put them here in the same change, and say in it what moved.
   */
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
  const ago = (days: number) => NOW.getTime() - days * DAY
  const songItem = (songId: number, level: number, over: Partial<SongItemState> = {}): SongItemState => ({
    key: songItemKey(songId, level),
    songId,
    level,
    bestAccuracy: null,
    lastAt: null,
    ease: 2.3,
    intervalDays: 1,
    weakBars: [],
    ...over,
  })
  const items = (list: SongItemState[]) => Object.fromEntries(list.map((i) => [i.key, i]))
  const LIB: SongSummary[] = [
    ...LIBRARY,
    { id: 3, title: 'Song C', artist: 'Z', duration: 45, bpm: 80, levelNoteCounts: [8, 16, 24, 32, 40, 48], builtinId: 'c', lessonLevel: 2 },
    { id: 4, title: 'Song D', artist: 'Z', duration: 200, bpm: 120, levelNoteCounts: [8, 16, 24, 32, 40, 48], builtinId: 'd', lessonLevel: 9 },
  ]
  const LEARNERS: Record<string, LearnerModel> = {
    fresh: model([]),
    graduate: model(
      [
        state('basics.open-strings', 58, { tempoCeiling: 70, lastPracticedAt: ago(1), attempts: 14 }),
        state('basics.first-frets', 44, { tempoCeiling: 63, lastPracticedAt: ago(2), attempts: 9 }),
        state('fret.single-string', 38, { tempoCeiling: 60, lastPracticedAt: ago(3), attempts: 6 }),
        state('fret.cross-string', 31, { tempoCeiling: 48, lastPracticedAt: ago(3), attempts: 4 }),
        state('chord.open', 27, { lastPracticedAt: ago(4), attempts: 3 }),
      ],
      items([songItem(3, 0, { bestAccuracy: 0.88, lastAt: ago(1), lastAccuracy: 0.88, lastSpeed: 0.75, fullSpeedBest: 0 })]),
    ),
    player: model(
      [
        state('basics.open-strings', 92, { tempoCeiling: 80, lastPracticedAt: ago(20) }),
        state('basics.first-frets', 90, { tempoCeiling: 80, lastPracticedAt: ago(20) }),
        state('fret.single-string', 84, { tempoCeiling: 96, lastPracticedAt: ago(2), nextReviewAt: ago(1) }),
        state('fret.cross-string', 78, { tempoCeiling: 88, lastPracticedAt: ago(30) }),
        state('fret.chromatic', 71, { tempoCeiling: 104, lastPracticedAt: ago(1) }),
        state('pick.downstrokes', 80, { tempoCeiling: 150, lastPracticedAt: ago(5) }),
        state('time.metronome', 66, { tempoCeiling: 90, lastPracticedAt: ago(6) }),
        state('chord.open', 64, { tempoCeiling: 66, lastPracticedAt: ago(3) }),
        state('chord.changes-open', 48, { tempoCeiling: 58, lastPracticedAt: ago(2), attempts: 7 }),
        state('chord.power', 35, { tempoCeiling: 0, lastPracticedAt: ago(9), attempts: 2 }),
        state('pick.alternate-8', 52, { tempoCeiling: 84, lastPracticedAt: ago(4) }),
        state('ear.tuning', 40, { tempoCeiling: 60, lastPracticedAt: ago(8), attempts: 3 }),
      ],
      items([
        songItem(1, 2, { bestAccuracy: 0.86, lastAt: ago(2), lastAccuracy: 0.74, lastSpeed: 1, fullSpeedBest: 0.86, weakBars: [5, 6, 9] }),
        songItem(2, 1, { bestAccuracy: 0.66, lastAt: ago(4), lastAccuracy: 0.66, lastSpeed: 0.85, fullSpeedBest: 0, lowStreak: 2 }),
        songItem(3, 3, { bestAccuracy: 0.93, lastAt: ago(6), lastAccuracy: 0.93, lastSpeed: 1, fullSpeedBest: 0.93 }),
      ]),
    ),
  }
  const VARIANTS: Record<string, Partial<PlannerInput>> = {
    plain: {},
    first: { daysSinceLastSession: undefined },
    comeback: { daysSinceLastSession: 9 },
    quick: { quick: true },
    'quick comeback': { quick: true, daysSinceLastSession: 12 },
    checkpoint: { dueTest: 'checkpoint' },
    monthly: { dueTest: 'monthly' },
    placement: { dueTest: 'placement' },
    'no songs': { library: [] },
    lessons: { lessonsDone: 6, lessonSkillIds: ['basics.open-strings', 'basics.first-frets', 'fret.single-string', 'chord.open'], goalSongId: 3 },
    recent: {
      recentFocusSkillIds: ['chord.changes-open', 'chord.changes-open'],
      recentRecapSkillIds: ['fret.single-string', 'fret.cross-string'],
      practiceDays: { 'chord.changes-open': 4, 'fret.chromatic': 2 },
    },
    rust: { effectiveRating },
  }
  const PREFS: Partial<Prefs>[] = [{ goals: [] }, { goals: ['songs'] }, { goals: ['lead', 'technique'] }, { goals: [], pinnedSkillId: 'chord.power' }]

  const plansFor = (learner: LearnerModel, extra: Partial<PlannerInput> = {}) => {
    const out: Record<string, unknown> = {}
    for (const [name, variant] of Object.entries(VARIANTS)) {
      for (const dailyMinutes of MINUTES) {
        PREFS.forEach((prefs, p) => {
          const plan = planSession(input({ model: learner, skills: REAL_SKILLS, library: LIB, ...variant, ...extra }, { ...prefs, dailyMinutes }))
          const first = plan.blocks.find((b) => b.kind !== 'song' && b.kind !== 'test')
          // The plan, and what becomes of it after a rough and after a clean first exercise.
          out[`${name} ${dailyMinutes} ${p}`] = [plan, ...(first ? [0.6, 0.8, 0.95].map((acc) => adaptAfterBlock(plan, first.id, ATTEMPT, perf(acc))) : [])]
        })
      }
    }
    return out
  }

  it('plans, and plans adapted after a block, are unchanged for a new learner, a course graduate and a player', () => {
    expect(Object.fromEntries(Object.entries(LEARNERS).map(([name, learner]) => [name, digest(plansFor(learner))]))).toEqual({
      fresh: '8547343ebd0bc123',
      graduate: '274941323c61a668',
      player: '4bc2d033db9c059a',
    })
  })

  it('the helpers the plan is built from give what they gave', () => {
    const rounds = [1, 2, 3, 4, 5, 7, 10, 15].flatMap((minutes) => [40, 50, 60, 72, 90, 120, 160, 200].map((tempo) => fitRounds(minutes, tempo)))
    const tempos = [40, 43, 60, 97, 120].flatMap((tempo) =>
      [0.3, 0.74, 0.75, 0.8, 0.85, 1].flatMap((acc) => [nextRepTempo(tempo, acc, tempo), nextRepTempo(tempo, acc, tempo - 10, 100), nextRepTempo(tempo, acc, tempo, 100, true)]),
    )
    const warmups = Object.values(LEARNERS).map((learner) => pickWarmupSkill(REAL_SKILLS, Object.fromEntries(Object.values(learner.skills).map((s) => [s.skillId, s.rating])))?.id)
    const songs = Object.values(LEARNERS).flatMap((learner) =>
      [0, -1].flatMap((offset) => [
        pickSongBlock(LIB, learner.songItems, 7, offset),
        pickSongBlock(LIB, learner.songItems, 12, offset, { beginner: true }),
        pickSongBlock(LIB, learner.songItems, 4, offset, { song: LIB[1], startLevel: 1 }),
      ]),
    )
    expect({ rounds: digest(rounds), tempos: digest(tempos), warmups, songs: digest(songs) }).toEqual({
      rounds: '212bbabbea88e25c',
      tempos: '7b8d0c6a2a1d7b80',
      warmups: ['basics.open-strings', 'basics.open-strings', 'basics.open-strings'],
      songs: '34eae932d3b742cb',
    })
  })

  it('every sentence a song block can carry reads as it did', () => {
    const at = (level: number, over: Partial<SongItemState>): Record<string, SongItemState> => items([songItem(1, level, { lastAt: 10, lastSpeed: 1, ...over })])
    const reasonOf = (...args: Parameters<typeof pickSongBlock>) => pickSongBlock(...args)?.reason
    expect(reasonOf(LIBRARY, {}, 7)).toBe('Song A: A song at a medium level.')
    expect(reasonOf(LIBRARY, {}, 7, 0, { beginner: true })).toBe('Song A: A song at an easy level, played slowly.')
    expect(reasonOf(LIBRARY, {}, 7, 0, { song: LIBRARY[1], startLevel: 1 })).toBe('Song B: A song you have not played yet, at the level of your other songs.')
    expect(reasonOf(LIBRARY, {}, 7, -1)).toBe('Song A: A song at a medium level (one level easier today).')
    expect(reasonOf(LIBRARY, at(2, { bestAccuracy: 0.93, lastAccuracy: 0.93, fullSpeedBest: 0.93 }), 7)).toBe('Song A: You played level 3 well at full speed, so we are moving up a level.')
    expect(reasonOf(LIBRARY, at(2, { bestAccuracy: 0.87, lastAccuracy: 0.87, fullSpeedBest: 0.87, weakBars: [5, 6, 8] }), 7)).toBe('Song A: You cleared level 3. We practise the tricky bars (5-8) first.')
    expect(reasonOf(LIBRARY, at(2, { bestAccuracy: 0.75, lastAccuracy: 0.75, fullSpeedBest: 0.75 }), 7)).toBe('Song A: Level 3 still needs a bit more practice.')
    // Below full speed, the sentence says so once: by itself, or with the words added after it.
    expect(reasonOf(LIBRARY, at(2, { bestAccuracy: 0.75, lastAccuracy: 0.75, lastSpeed: 0.85, fullSpeedBest: 0 }), 7)).toBe('Song A: Level 3 still needs a bit more practice; played a bit slower.')
    expect(reasonOf(LIBRARY, at(2, { bestAccuracy: 0.75, lastAccuracy: 0.75, lastSpeed: 0.85, fullSpeedBest: 0 }), 7, -1)).toBe('Song A: Level 3 still needs a bit more practice (one level easier today); played a bit slower.')
    expect(reasonOf(LIBRARY, at(2, { bestAccuracy: 0.5, lastAccuracy: 0.5, fullSpeedBest: 0.5, lowStreak: 1 }), 7)).toBe('Song A: Level 3 was hard last time, so we are taking it slower.')
    expect(reasonOf(LIBRARY, at(0, { bestAccuracy: 0.9, lastAccuracy: 0.9, lastSpeed: 0.75, fullSpeedBest: 0 }), 7)).toBe('Song A: You played level 1 well at a slower speed, so today it is a little faster.')
    expect(reasonOf(LIBRARY, at(2, { bestAccuracy: 0.5, lastAccuracy: 0.5, lastSpeed: 0.85, fullSpeedBest: 0, lowStreak: 2 }), 7)).toBe('Song A: Level 3 was too hard twice in a row, so we are going back to level 2; played a bit slower.')
  })

  it('a 20-minute plan, written out: the same blocks, the same words, the same keys in the same order', () => {
    const exercise = (id: string, kind: ExerciseBlock['kind'], minutes: number, skillId: string, tempo: number, reps: number, reason: string): ExerciseBlock => ({
      id,
      kind,
      status: 'pending',
      minutes,
      skillId,
      generatorId: `${skillId}-gen`,
      params: { tempo, bars: 16, startTempo: tempo, maxTempo: 120, seed: 0 },
      tempo,
      reps,
      reason,
    })
    const recorded: SessionPlan = {
      date: '2026-06-15',
      minutes: 20,
      dayFactor: 1,
      blocks: [
        exercise('2026-06-15-0-warmup', 'warmup', 3, 'chromatic', 90, 4, 'An easy first exercise to get your fingers used to the strings'),
        exercise('2026-06-15-1-focus', 'focus', 7, 'power-chords', 60, 6, 'Your main exercise today; it is new for you. It is the best fit for your goals.'),
        { id: '2026-06-15-2-song', kind: 'song', status: 'pending', minutes: 7, songId: 1, level: 2, speed: 1, passes: 3, reason: 'Song A: A song at a medium level.' },
        exercise('2026-06-15-3-review', 'review', 3, 'alt-picking', 90, 4, 'A recap of something you already know.'),
      ],
      explanation: ['Main exercise: power-chords. It is the best fit for your goals.', 'Song A: A song at a medium level.'],
    }
    expect(JSON.stringify(planSession(input()))).toBe(JSON.stringify(recorded))
  })
})

/**
 * Stand-ins for singing skills (the real list arrives with its own part of the app). Two kinds, as in
 * docs/SINGING.md §6: a tempo skill with a floor, and a step skill that keeps one tempo and climbs a ladder.
 */
const ladder = (rungs: [label: string, bonus: number, span?: number][]): SkillStep[] =>
  rungs.map(([label, bonus, span]) => ({ label, params: {}, bonus, ...(span === undefined ? {} : { span }) }))

function sung(
  id: string,
  category: SkillDef['category'],
  tier: SkillDef['tier'],
  prerequisites: string[],
  generator: string,
  pace: { ref: number; start: number; target: number; min: number },
  steps?: SkillStep[],
): SkillDef {
  return {
    id,
    name: id,
    category,
    tier,
    prerequisites,
    refTempo: pace.ref,
    startTempo: pace.start,
    targetTempo: pace.target,
    minTempo: pace.min,
    description: '',
    tips: [],
    generators: [generator],
    ...(steps ? { steps } : {}),
  }
}
const fixed = (tempo: number) => ({ ref: tempo, start: tempo, target: tempo, min: tempo })

const MATCH = sung('voice.pitch.match', 'pitch', 0, [], 'voiceEcho', fixed(60), ladder([['close notes', 0], ['wider notes', 12], ['the whole range', 20], ['a short cue', 28]]))
const STEPS = sung('voice.pitch.steps', 'pitch', 1, ['voice.pitch.match'], 'voicePattern', { ref: 66, start: 60, target: 88, min: 54 })
const FIVE = sung('voice.pitch.five-note', 'pitch', 1, ['voice.pitch.steps'], 'voicePattern', { ref: 66, start: 60, target: 96, min: 54 })
const HOLD = sung('voice.pitch.hold', 'breath', 1, ['voice.pitch.match'], 'voiceHold', fixed(60), ladder([['4 beats', 0], ['6 beats', 8], ['8 beats', 16], ['8 beats, closer', 24]]))
const SLIDES = sung('voice.range.slides', 'range', 1, ['voice.pitch.match'], 'voiceSlide', fixed(60), ladder([['to the third', 0], ['to the fifth', 8, 7], ['to the octave', 16, 12]]))
const ECHO = sung('voice.pitch.echo', 'pitch', 1, ['voice.pitch.match'], 'voiceEcho', fixed(72), ladder([['3 notes', 0], ['4 notes', 8], ['5 notes', 16]]))
const THIRDS = sung('voice.interval.thirds', 'range', 2, ['voice.pitch.five-note'], 'voicePattern', { ref: 66, start: 56, target: 92, min: 50 })
const VOICE: SkillDef[] = [MATCH, STEPS, FIVE, HOLD, SLIDES, ECHO, THIRDS]
const VOICE_BY_ID = new Map(VOICE.map((s) => [s.id, s]))

/** What the Coach hands the planner for a singer (docs/SINGING.md §6, "How each Coach rule applies"). */
const SINGING: Partial<PlannerInput> = {
  idPrefix: 'voice-',
  warmupCategories: ['pitch', 'range'],
  maxBars: 8,
  templates: {
    10: { warmup: 2, focus: 4, second: 0, song: 4, review: 0 },
    20: { warmup: 3, focus: 6, second: 0, song: 7, review: 4 },
    30: { warmup: 3, focus: 7, second: 5, song: 10, review: 5 },
    45: { warmup: 3, focus: 7, second: 5, song: 10, review: 5 },
  },
  songSpeeds: [1],
  copy: VOICE_PLANNER_COPY,
  sameDrillBy: 'skill',
  loopWeakBars: false,
}

const songsOf = (plan: { blocks: Block[] }) => plan.blocks.filter((b): b is SongBlock => b.kind === 'song')
/** The block of a kind the case is about; the case fails by itself when the plan has none. */
const theBlock = (plan: { blocks: Block[] }, kind: ExerciseBlock['kind']) => plan.blocks.find((b): b is ExerciseBlock => b.kind === kind)!
const singer = (states: SkillState[], over: Partial<PlannerInput> = {}, prefs: Partial<Prefs> = {}) =>
  planSession(input({ skills: VOICE, model: model(states), library: [], ...over }, prefs))

describe('singing: a skill where slower is not easier keeps its tempo and climbs a ladder of steps', () => {
  it('a clean round is followed by the next step, at most one above the step the block started on; a rough round by an easier step', () => {
    expect(nextRepStep(1, 0.85, 1)).toBe(2)
    // Already one above the start: a second clean round stays there.
    expect(nextRepStep(2, 0.97, 1)).toBe(2)
    // In between (75 to 84 %): the same step again.
    expect(nextRepStep(1, 0.84, 1)).toBe(1)
    expect(nextRepStep(1, 0.75, 1)).toBe(1)
    expect(nextRepStep(1, 0.74, 1)).toBe(0)
    // Never under the first step, and after an easier round a clean one comes back up.
    expect(nextRepStep(0, 0.2, 0)).toBe(0)
    expect(nextRepStep(0, 0.9, 1)).toBe(1)
    // Never above the highest step the voice can hold.
    expect(nextRepStep(1, 0.95, 1, 1)).toBe(1)
    expect(nextRepStep(2, 0.95, 2, 2)).toBe(2)
  })

  it('two in-between rounds in a row on one step are followed by the step below, when the caller says the round before was one', () => {
    // The step rule for "two rounds that were neither clean nor rough ease the tempo by 5 %".
    expect(nextRepStep(2, 0.8, 2, 3, true)).toBe(1)
    expect(nextRepStep(2, 0.75, 2, 3, true)).toBe(1)
    expect(nextRepStep(0, 0.8, 0, 3, true)).toBe(0)
    // Only for an in-between round: a clean one still goes up, a rough one goes down one step, not two.
    expect(nextRepStep(2, 0.85, 2, 3, true)).toBe(3)
    expect(nextRepStep(2, 0.74, 2, 3, true)).toBe(1)
    // Not said, or said to be false: the same step again, as the first in-between round.
    expect(nextRepStep(2, 0.8, 2, 3)).toBe(2)
    expect(nextRepStep(2, 0.8, 2, 3, false)).toBe(2)
    // From the easier step a clean round comes back up, so a singer who is clean on one step and nearly
    // there on the next gets a clean round in every three: without it a whole block went by with none.
    const rounds: number[] = []
    let step = 2
    let before: { step: number; accuracy: number } | undefined
    for (let i = 0; i < 9; i++) {
      const accuracy = step <= 1 ? 0.92 : 0.8
      rounds.push(step)
      const held = before !== undefined && before.step === step && inHoldBand(before.accuracy)
      before = { step, accuracy }
      step = nextRepStep(step, accuracy, 2, 3, held)
    }
    expect(rounds).toEqual([2, 2, 1, 2, 2, 1, 2, 2, 1])
  })

  it('plans a step skill at its one tempo, whatever was measured, on the step the learner has reached', () => {
    // A ceiling of 48 is what rough rounds at 60 leave behind (eight tenths): a tempo skill would start from it.
    const plan = singer([state('voice.pitch.match', 70, { step: 2 }), state('voice.pitch.hold', 30, { step: 1, tempoCeiling: 48 })], {}, { pinnedSkillId: 'voice.pitch.hold' })
    const focus = theBlock(plan, 'focus')
    expect(focus.skillId).toBe('voice.pitch.hold')
    expect(focus.tempo).toBe(60)
    expect(focus.params).toMatchObject({ tempo: 60, startTempo: 60, maxTempo: 60, minTempo: 60, step: 1, startStep: 1 })
    expect('maxStep' in focus.params).toBe(false)
    // Never practised: the first step.
    const fresh = singer([state('voice.pitch.match', 70)], {}, { pinnedSkillId: 'voice.pitch.hold' })
    expect(theBlock(fresh, 'focus').params).toMatchObject({ tempo: 60, step: 0, startStep: 0 })
    // A step stored past the end of the ladder (a ladder that was shortened) starts on its last step.
    const past = singer([state('voice.pitch.match', 70), state('voice.pitch.hold', 30, { step: 9 })], {}, { pinnedSkillId: 'voice.pitch.hold' })
    expect(theBlock(past, 'focus').params).toMatchObject({ step: 3, startStep: 3 })
  })

  it('keeps that one tempo by being a step skill, not by its floor: a ladder that names no floor is not slowed down either', () => {
    const bare: SkillDef = { ...HOLD, minTempo: undefined }
    const skills = [MATCH, bare]
    const states = [state('voice.pitch.match', 70, { step: 2 }), state('voice.pitch.hold', 62, { step: 2, tempoCeiling: 48 })]
    // From a low ceiling, as a warm-up (nine tenths), and after a break (nine tenths): always 60.
    expect(theBlock(singer(states, { skills }, { pinnedSkillId: 'voice.pitch.hold' }), 'focus')).toMatchObject({ tempo: 60, params: { tempo: 60, startTempo: 60, step: 2 } })
    expect(theBlock(singer(states, { skills, warmupCategories: ['breath'] }), 'warmup')).toMatchObject({ skillId: 'voice.pitch.hold', tempo: 60, params: { step: 1 } })
    const back = exercisesOf(singer(states, { skills, daysSinceLastSession: 9 })).filter((b) => b.kind === 'review')
    expect(back.map((b) => [b.skillId, b.tempo, b.params.step])).toEqual([['voice.pitch.hold', 60, 1]])
    expect('minTempo' in back[0].params).toBe(false)
  })

  it('warms up one step easier, at the same tempo, and never under the first step', () => {
    const warm = theBlock(singer([state('voice.pitch.match', 70, { step: 2, tempoCeiling: 60 })], SINGING, { dailyMinutes: 20 }), 'warmup')
    expect(warm.skillId).toBe('voice.pitch.match')
    // A tempo skill would warm up at nine tenths of 60.
    expect(warm.tempo).toBe(60)
    expect(warm.params).toMatchObject({ step: 1, startStep: 1 })
    const first = theBlock(singer([state('voice.pitch.match', 70, { step: 0 })], SINGING, { dailyMinutes: 20 }), 'warmup')
    expect(first.params).toMatchObject({ tempo: 60, step: 0, startStep: 0 })
  })

  it('after a break everything is one step easier, once, and still at the same tempo', () => {
    const states = [state('voice.pitch.match', 80, { step: 3 }), state('voice.pitch.hold', 62, { step: 2 }), state('voice.range.slides', 55, { step: 2 }), state('voice.pitch.echo', 50, { step: 0 })]
    const back = singer(states, { ...SINGING, daysSinceLastSession: 9 }, { dailyMinutes: 20 })
    expect(back.dayFactor).toBe(COMEBACK_TEMPO_FACTOR)
    // The warm-up is eased as a warm-up, not once more for the break.
    expect(theBlock(back, 'warmup')).toMatchObject({ skillId: 'voice.range.slides', tempo: 60, params: { step: 1, startStep: 1 } })
    const recaps = exercisesOf(back).filter((b) => b.kind === 'review')
    // (Slides is the warm-up, so the recaps are the two skills the singer knows best after it.)
    expect(recaps.map((b) => [b.skillId, b.tempo, b.params.step, b.params.startStep])).toEqual([
      ['voice.pitch.hold', 60, 1, 1],
      ['voice.pitch.echo', 72, 0, 0],
    ])
    // The quick session of a comeback day too.
    const quick = singer(states, { ...SINGING, daysSinceLastSession: 9, quick: true }, { pinnedSkillId: 'voice.pitch.hold' })
    expect(theBlock(quick, 'focus')).toMatchObject({ tempo: 60, params: { step: 1, startStep: 1 } })
    // On an ordinary day the same blocks are on the step the learner has reached.
    const usual = singer(states, { ...SINGING, daysSinceLastSession: 1 }, { dailyMinutes: 20, pinnedSkillId: 'voice.pitch.hold' })
    expect(theBlock(usual, 'focus').params).toMatchObject({ step: 2, startStep: 2 })
  })

  it('never starts above the highest step the voice can hold, and stores that step with the block', () => {
    const states = [state('voice.pitch.match', 70), state('voice.range.slides', 40, { step: 2 })]
    const pinned = { pinnedSkillId: 'voice.range.slides' }
    const free = theBlock(singer(states, {}, pinned), 'focus')
    expect(free.params).toMatchObject({ step: 2, startStep: 2 })
    expect('maxStep' in free.params).toBe(false)
    const small = theBlock(singer(states, { maxSteps: { 'voice.range.slides': 1 } }, pinned), 'focus')
    expect(small.params).toMatchObject({ step: 1, startStep: 1, maxStep: 1 })
    // A limit at the top of the ladder, or above it, is no limit: nothing is stored.
    for (const top of [2, 7]) expect('maxStep' in theBlock(singer(states, { maxSteps: { 'voice.range.slides': top } }, pinned), 'focus').params, `${top}`).toBe(false)
    // A limit for another skill changes nothing here.
    expect(theBlock(singer(states, { maxSteps: { 'voice.pitch.hold': 0 } }, pinned), 'focus').params).toEqual(free.params)
  })

  it('reads a limit or a stored step that is no step as one on the ladder, and an empty ladder as none', () => {
    const states = [state('voice.pitch.match', 70), state('voice.range.slides', 40, { step: 2 })]
    const pinned = { pinnedSkillId: 'voice.range.slides' }
    const stepsWith = (top: number) => theBlock(singer(states, { maxSteps: { 'voice.range.slides': top } }, pinned), 'focus').params
    // Below the ladder is its first step; a fraction is the whole step under it; not a number is no limit.
    expect(stepsWith(-3)).toMatchObject({ step: 0, startStep: 0, maxStep: 0 })
    expect(stepsWith(1.9)).toMatchObject({ step: 1, startStep: 1, maxStep: 1 })
    expect(stepsWith(Number.NaN)).toMatchObject({ step: 2, startStep: 2 })
    expect('maxStep' in stepsWith(Number.NaN)).toBe(false)
    for (const stored of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const params = theBlock(singer([state('voice.pitch.match', 70), state('voice.range.slides', 40, { step: stored })], {}, pinned), 'focus').params
      expect([0, 1, 2], `${stored}`).toContain(params.step)
      expect(params.startStep).toBe(params.step)
    }
    // A skill whose ladder is empty is a tempo skill like any other: no step, and its tempo follows the ceiling.
    const bare: SkillDef = { ...STEPS, steps: [] }
    const plain = theBlock(singer([state('voice.pitch.match', 70), state('voice.pitch.steps', 40, { tempoCeiling: 70, step: 1 })], { skills: [MATCH, bare] }, { pinnedSkillId: 'voice.pitch.steps' }), 'focus')
    expect(plain.tempo).toBe(74)
    expect('step' in plain.params).toBe(false)
    expect(maxStepFor(bare, { low: 48, high: 60 })).toBe(0)
    // A range written the wrong way round holds the first step and no more.
    expect(maxStepFor(SLIDES, { low: 60, high: 48 })).toBe(0)
  })

  it('reads the highest step a range can hold from the room each step says it needs', () => {
    const range = (low: number, high: number) => ({ low, high })
    // Both ends of a range are notes that may be asked for: 48 to 55 holds a fifth, not an octave.
    expect(maxStepFor(SLIDES, range(48, 55))).toBe(1)
    expect(maxStepFor(SLIDES, range(48, 59))).toBe(1)
    expect(maxStepFor(SLIDES, range(48, 60))).toBe(2)
    expect(maxStepFor(SLIDES, range(48, 54))).toBe(0)
    // A step that names no room fits any range; with no range known every step is open.
    expect(maxStepFor(MATCH, range(48, 55))).toBe(3)
    expect(maxStepFor(SLIDES, undefined)).toBe(2)
    // A skill without steps has none to reach.
    expect(maxStepFor(STEPS, range(48, 55))).toBe(0)
    // A ladder is climbed one step at a time: nothing above a step that does not fit can be reached.
    const uneven = { ...SLIDES, steps: ladder([['a', 0], ['b', 8, 12], ['c', 16, 5]]) }
    expect(maxStepFor(uneven, range(48, 55))).toBe(0)
  })

  const stepBlock = (id: string, kind: ExerciseBlock['kind'], def: SkillDef, step: number, extra: Record<string, unknown> = {}): ExerciseBlock => ({
    id,
    kind,
    status: 'pending',
    minutes: 4,
    skillId: def.id,
    generatorId: def.generators[0],
    params: { tempo: def.startTempo, bars: 4, startTempo: def.startTempo, maxTempo: def.targetTempo, minTempo: def.minTempo, step, startStep: step, ...extra },
    tempo: def.startTempo,
    reps: 3,
    reason: '',
  })
  const tempoBlock = (id: string, kind: ExerciseBlock['kind'], def: SkillDef, tempo: number): ExerciseBlock => ({
    id,
    kind,
    status: 'pending',
    minutes: 4,
    skillId: def.id,
    generatorId: def.generators[0],
    params: { tempo, bars: 4, startTempo: tempo, maxTempo: def.targetTempo, minTempo: def.minTempo },
    tempo,
    reps: 3,
    reason: '',
  })
  const day = (blocks: Block[], dayFactor = 1): SessionPlan => deepFreeze({ date: '2026-06-15', minutes: 20, dayFactor, blocks, explanation: [] })
  const stepsOf = (plan: SessionPlan) => Object.fromEntries(exercisesOf(plan).map((b) => [b.id, [b.tempo, b.params.step, b.params.startStep]]))

  it('after a rough warm-up the step exercises still to come start one step easier, never slower and never under the first step', () => {
    const plan = day([stepBlock('warm', 'warmup', MATCH, 1), stepBlock('main', 'focus', HOLD, 2), stepBlock('more', 'second', SLIDES, 0), tempoBlock('recap', 'review', STEPS, 66)])
    const rough = adaptAfterBlock(plan, 'warm', ATTEMPT, perf(0.6))
    expect(rough.dayFactor).toBe(0.9)
    expect(stepsOf(rough)).toMatchObject({ main: [60, 1, 1], more: [60, 0, 0] })
    // The tempo skill beside them slows down as it always did.
    expect(rough.blocks[3]).toMatchObject({ tempo: 59, params: { tempo: 59, startTempo: 59 } })
    // A warm-up that was neither clean nor rough eases tempos a little; a whole step would be too much.
    const between = adaptAfterBlock(plan, 'warm', ATTEMPT, perf(0.8))
    expect(stepsOf(between)).toMatchObject({ main: [60, 2, 2], more: [60, 0, 0], recap: [63, undefined, undefined] })
    // A clean one changes nothing.
    expect(exercisesOf(adaptAfterBlock(plan, 'warm', ATTEMPT, perf(0.9))).slice(1)).toEqual(plan.blocks.slice(1))
  })

  it('a day that was already planned one step easier is not eased again by a rough warm-up, and a done block is left alone', () => {
    const comeback = day([stepBlock('warm', 'warmup', MATCH, 1), stepBlock('main', 'review', HOLD, 1)], COMEBACK_TEMPO_FACTOR)
    expect(stepsOf(adaptAfterBlock(comeback, 'warm', ATTEMPT, perf(0.6)))).toMatchObject({ main: [60, 1, 1] })
    const done = day([stepBlock('warm', 'warmup', MATCH, 1), { ...stepBlock('main', 'focus', HOLD, 2), status: 'done' }, { ...stepBlock('now', 'second', SLIDES, 2), status: 'active' }])
    expect(stepsOf(adaptAfterBlock(done, 'warm', ATTEMPT, perf(0.6)))).toMatchObject({ main: [60, 2, 2], now: [60, 2, 2] })
  })

  it('a step skill keeps its tempo after a rough round and goes one step easier; after a clean one it goes one step up', () => {
    const plan = day([stepBlock('main', 'focus', HOLD, 2), stepBlock('again', 'review', HOLD, 2), stepBlock('other', 'second', SLIDES, 1)])
    const rough = adaptAfterBlock(plan, 'main', ATTEMPT, perf(0.6))
    // The step the block started from stays, as the start tempo does: the next clean round may climb back.
    expect(stepsOf(rough)).toMatchObject({ again: [60, 1, 2], other: [60, 1, 1] })
    expect(rough.dayFactor).toBe(1)
    expect(stepsOf(adaptAfterBlock(plan, 'main', ATTEMPT, perf(0.8), VOICE))).toMatchObject({ again: [60, 2, 2] })
    // Up one step after a clean block, as far as the ladder is known to go: from the skill list...
    expect(stepsOf(adaptAfterBlock(plan, 'main', ATTEMPT, perf(0.9), VOICE))).toMatchObject({ again: [60, 3, 2], other: [60, 1, 1] })
    const onLast = day([stepBlock('main', 'focus', HOLD, 3), stepBlock('again', 'review', HOLD, 3)])
    expect(stepsOf(adaptAfterBlock(onLast, 'main', ATTEMPT, perf(0.95), VOICE))).toMatchObject({ again: [60, 3, 3] })
    // ...or from the limit stored with the block, which is the highest step this voice can hold...
    const capped = day([stepBlock('main', 'focus', HOLD, 1, { maxStep: 2 }), stepBlock('again', 'review', HOLD, 1, { maxStep: 2 })])
    expect(stepsOf(adaptAfterBlock(capped, 'main', ATTEMPT, perf(0.95)))).toMatchObject({ again: [60, 2, 1] })
    const atLimit = day([stepBlock('main', 'focus', HOLD, 2, { maxStep: 2 }), stepBlock('again', 'review', HOLD, 2, { maxStep: 2 })])
    expect(stepsOf(adaptAfterBlock(atLimit, 'main', ATTEMPT, perf(0.95), VOICE))).toMatchObject({ again: [60, 2, 2] })
    // ...and with neither, the step stays: no block is ever asked for a step its ladder may not have.
    expect(stepsOf(adaptAfterBlock(plan, 'main', ATTEMPT, perf(0.9)))).toMatchObject({ again: [60, 2, 2] })
    expect(stepsOf(adaptAfterBlock(plan, 'main', ATTEMPT, perf(0.6)))).toMatchObject({ again: [60, 1, 2] })
    // And the tempo rule itself has nowhere to go for such a block: floor, target and tempo are one number.
    expect(nextRepTempo(60, 0.5, 60, 60, false, 60)).toBe(60)
    expect(nextRepTempo(60, 1, 60, 60, false, 60)).toBe(60)
  })
})

describe('singing: a skill with a tempo floor is never asked for under it', () => {
  // voice.pitch.steps starts at 60, aims for 88 and is never sung under 54.
  const comfortable = state('voice.pitch.match', 80, { step: 3 })
  const slowed = (tempoCeiling: number, rating = 45) => state('voice.pitch.steps', rating, { tempoCeiling, attempts: 8 })
  const floorOf = (b: ExerciseBlock) => VOICE_BY_ID.get(b.skillId)!.minTempo!

  it('at the start of a block: the tempo last sung cleanly, a little faster, but not under the floor', () => {
    // 48 x 1.05 would be 50.
    const focus = theBlock(singer([comfortable, slowed(48)], {}, { pinnedSkillId: 'voice.pitch.steps' }), 'focus')
    expect(focus.tempo).toBe(54)
    expect(focus.params).toMatchObject({ tempo: 54, startTempo: 54, maxTempo: 88, minTempo: 54 })
  })

  it('in the warm-up: nine tenths of the usual tempo, but not under the floor', () => {
    // 0.9 x 56 would be 50. (Holding a note is the main exercise here, so the tempo skill stays the warm-up.)
    const plan = singer([state('voice.pitch.match', 30), slowed(56), state('voice.pitch.hold', 30)], SINGING, { dailyMinutes: 20 })
    expect(theBlock(plan, 'focus').skillId).toBe('voice.pitch.hold')
    expect(theBlock(plan, 'warmup')).toMatchObject({ skillId: 'voice.pitch.steps', tempo: 54, params: { tempo: 54, startTempo: 54, minTempo: 54 } })
  })

  it('on a comeback day and in a recap: nine tenths, or the stored tempo, but not under the floor', () => {
    const states = [comfortable, slowed(58, 70), state('voice.pitch.five-note', 65, { tempoCeiling: 50 })]
    const back = singer(states, { ...SINGING, daysSinceLastSession: 9 }, { dailyMinutes: 20 })
    const recaps = exercisesOf(back).filter((b) => b.kind === 'review')
    // 0.9 x 58 would be 52, 0.9 x 50 would be 45.
    expect(recaps.map((b) => [b.skillId, b.tempo])).toEqual([
      ['voice.pitch.steps', 54],
      ['voice.pitch.five-note', 54],
    ])
    const quick = singer(states, { ...SINGING, daysSinceLastSession: 9, quick: true }, { pinnedSkillId: 'voice.pitch.five-note' })
    expect(theBlock(quick, 'focus').tempo).toBe(54)
    // An ordinary day: the recap is at the stored tempo, 48 after rough rounds, so the floor it is.
    // Slides is the warm-up here, and the tempo skill is due for its recap.
    const usual = singer(
      [comfortable, state('voice.pitch.hold', 30, { attempts: 4 }), state('voice.range.slides', 75, { step: 1 }), { ...slowed(48, 70), nextReviewAt: NOW.getTime() - DAY }],
      { ...SINGING, daysSinceLastSession: 1 },
      { dailyMinutes: 20, pinnedSkillId: 'voice.pitch.hold' },
    )
    expect(exercisesOf(usual).find((b) => b.kind === 'review')).toMatchObject({ skillId: 'voice.pitch.steps', tempo: 54 })
    for (const b of [...exercisesOf(back), ...exercisesOf(quick), ...exercisesOf(usual)]) expect(b.tempo, b.skillId).toBeGreaterThanOrEqual(floorOf(b))
  })

  it('through the day factor: a rough warm-up slows what is still to come, but not under the floor', () => {
    const block = (id: string, kind: ExerciseBlock['kind'], def: SkillDef, tempo: number): ExerciseBlock => ({
      id,
      kind,
      status: 'pending',
      minutes: 4,
      skillId: def.id,
      generatorId: def.generators[0],
      params: { tempo, bars: 4, startTempo: tempo, maxTempo: def.targetTempo, minTempo: def.minTempo },
      tempo,
      reps: 3,
      reason: '',
    })
    const plan: SessionPlan = { date: '2026-06-15', minutes: 20, dayFactor: 1, blocks: [block('warm', 'warmup', STEPS, 54), block('main', 'focus', FIVE, 56), block('recap', 'review', THIRDS, 70)], explanation: [] }
    const rough = adaptAfterBlock(plan, 'warm', ATTEMPT, perf(0.5))
    // 0.9 x 56 would be 50; 0.9 x 70 is 63 and well above the floor of 50.
    expect(rough.blocks[1]).toMatchObject({ tempo: 54, params: { tempo: 54, startTempo: 54 } })
    expect(rough.blocks[2]).toMatchObject({ tempo: 63, params: { tempo: 63, startTempo: 63 } })
    // A later block of the same skill after a rough block: 0.92 x 56 would be 52.
    const twice: SessionPlan = { ...plan, blocks: [block('main', 'focus', FIVE, 56), block('again', 'review', FIVE, 56)] }
    expect(adaptAfterBlock(twice, 'main', ATTEMPT, perf(0.5)).blocks[1]).toMatchObject({ tempo: 54, params: { tempo: 54, startTempo: 56 } })
  })

  it('from round to round: a rough round at the floor is repeated at the floor', () => {
    expect(nextRepTempo(54, 0.5, 54, 88, false, 54)).toBe(54)
    expect(nextRepTempo(56, 0.5, 56, 88, false, 54)).toBe(54)
    // Two in-between rounds ease off by 5 %, which stops at the floor as well.
    expect(nextRepTempo(55, 0.8, 55, 88, true, 54)).toBe(54)
    // Above the floor nothing changes, and without one the general floor of 40 holds as before.
    expect(nextRepTempo(80, 0.5, 80, 88, false, 54)).toBe(nextRepTempo(80, 0.5, 80, 88))
    expect(nextRepTempo(80, 0.9, 80, 88, false, 54)).toBe(nextRepTempo(80, 0.9, 80, 88))
    expect(nextRepTempo(41, 0.5, 41)).toBe(40)
  })

  it('a skill without a floor carries none in its block', () => {
    for (const b of exercisesOf(planSession(input({}, { dailyMinutes: 30 })))) expect('minTempo' in b.params, b.skillId).toBe(false)
  })
})

describe('singing: short rounds, ids of their own, templates of their own', () => {
  it('with a cap of 8 bars a round is 4 or 8 bars long, and there are never more than six rounds', () => {
    for (const minutes of [1, 2, 3, 4, 5, 7, 10, 13]) {
      for (const tempo of [50, 60, 72, 100, 132]) {
        const { bars, reps } = fitRounds(minutes, tempo, 8)
        expect([4, 8], `${minutes} min at ${tempo}`).toContain(bars)
        expect(reps).toBeGreaterThanOrEqual(1)
        expect(reps).toBeLessThanOrEqual(MAX_ROUNDS)
      }
    }
    // Where the exercise would be written out over 16 bars, 8 bars are repeated up to the round limit instead.
    expect(fitRounds(7, 60)).toEqual({ bars: 16, reps: 6 })
    expect(fitRounds(7, 60, 8)).toEqual({ bars: 8, reps: 6 })
    // Short blocks are the same with and without the cap.
    expect(fitRounds(1, 50, 8)).toEqual(fitRounds(1, 50))
    expect(fitRounds(3, 50, 8)).toEqual({ bars: 8, reps: 4 })
    expect(fitRounds(2, 60, 4)).toEqual({ bars: 4, reps: 6 })
    // 32 bars is the limit when none is given.
    expect(fitRounds(15, 200, 32)).toEqual(fitRounds(15, 200))
  })

  it('a plan made with the cap has no exercise over 8 bars; without it the same plan does', () => {
    const states = [state('voice.pitch.match', 80, { step: 2 }), state('voice.pitch.steps', 50, { tempoCeiling: 80 }), state('voice.pitch.hold', 40, { step: 1 })]
    for (const dailyMinutes of MINUTES) {
      const capped = exercisesOf(singer(states, { maxBars: 8 }, { dailyMinutes }))
      expect(capped.length).toBeGreaterThan(0)
      for (const b of capped) {
        expect([4, 8], `${dailyMinutes} min ${b.kind}`).toContain(b.params.bars)
        expect(b.reps).toBeLessThanOrEqual(MAX_ROUNDS)
      }
    }
    expect(Math.max(...exercisesOf(singer(states, {}, { dailyMinutes: 30 })).map((b) => b.params.bars))).toBeGreaterThan(8)
  })

  it('puts the prefix on every block id, in every kind of plan', () => {
    const plans = [
      planSession(input({ idPrefix: 'voice-' }, { dailyMinutes: 30 })),
      planSession(input({ idPrefix: 'voice-', daysSinceLastSession: 9 })),
      planSession(input({ idPrefix: 'voice-', quick: true })),
      planSession(input({ idPrefix: 'voice-', dueTest: 'placement' })),
      planSession(input({ idPrefix: 'voice-', dueTest: 'checkpoint' }, { dailyMinutes: 30 })),
    ]
    for (const plan of plans) {
      expect(plan.blocks.length).toBeGreaterThan(0)
      plan.blocks.forEach((b, i) => expect(b.id).toBe(`voice-2026-06-15-${i}-${b.kind}`))
    }
    expect(planSession(input()).blocks.map((b) => b.id)).toEqual(['2026-06-15-0-warmup', '2026-06-15-1-focus', '2026-06-15-2-song', '2026-06-15-3-review'])
  })

  it('follows the templates it is given: a short day opens with a warm-up, and the day lasts what its template adds up to', () => {
    const short = planSession(input({ skills: VOICE, model: model([]), ...SINGING }, { dailyMinutes: 10 }))
    expect(short.blocks.map((b) => [b.kind, b.minutes])).toEqual([
      ['warmup', 2],
      ['focus', 4],
      ['song', 4],
    ])
    // The same choice on the built-in templates has no warm-up.
    expect(kinds(planSession(input({}, { dailyMinutes: 10 })))).not.toContain('warmup')
    // A length this instrument does not offer is planned from the template it is mapped to, and lasts that long.
    const states = [state('voice.pitch.match', 80, { step: 2 }), state('voice.pitch.steps', 50), state('voice.pitch.hold', 40), state('voice.range.slides', 30), state('voice.pitch.echo', 35)]
    const long = planSession(input({ skills: VOICE, model: model(states), ...SINGING }, { dailyMinutes: 45 }))
    expect(long.minutes).toBe(30)
    expect(total(long.blocks)).toBe(30)
    expect(kinds(long)).not.toContain('ear')
    const back = planSession(input({ skills: VOICE, model: model(states), ...SINGING, daysSinceLastSession: 9 }, { dailyMinutes: 45 }))
    expect(back.minutes).toBe(30)
  })
})

describe('singing: which skills a day may use', () => {
  const past = [
    state('voice.pitch.match', 80, { step: 3 }),
    state('voice.pitch.hold', 78, { step: 2 }),
    state('voice.range.slides', 55, { step: 1 }),
    state('voice.pitch.steps', 50, { tempoCeiling: 70 }),
    state('voice.pitch.five-note', 30, { attempts: 4 }),
    state('voice.interval.thirds', 20, { attempts: 2 }),
  ]
  const categoryOf = (b: ExerciseBlock) => VOICE_BY_ID.get(b.skillId)!.category

  it('warms up on a skill from the areas it is given, for a beginner and for a singer past the basics', () => {
    // Nothing rated yet: the gentlest skill of those areas that builds on nothing. (Listed after a
    // breath skill here: without the areas the first easy skill of the list would be taken.)
    const breathFirst = [HOLD, ...VOICE.filter((s) => s !== HOLD)]
    expect(theBlock(singer([], { skills: breathFirst, warmupCategories: ['pitch', 'range'] }), 'warmup').skillId).toBe('voice.pitch.match')
    expect(theBlock(singer([], { skills: breathFirst }), 'warmup').skillId).toBe('voice.pitch.hold')
    // Past the basics: a comfortable skill one tier up, from those areas only. Holding a note is rated
    // best but belongs to breath, so it is not a warm-up unless breath is asked for.
    expect(theBlock(singer(past, { warmupCategories: ['pitch', 'range'] }), 'warmup').skillId).toBe('voice.range.slides')
    expect(theBlock(singer(past, { warmupCategories: ['pitch'] }), 'warmup').skillId).toBe('voice.pitch.steps')
    expect(theBlock(singer(past, { warmupCategories: ['pitch', 'range', 'breath'] }), 'warmup').skillId).toBe('voice.pitch.hold')
  })

  it('pickWarmupSkill takes the areas as well, in the order given when two skills are otherwise alike', () => {
    expect(pickWarmupSkill([HOLD, MATCH, STEPS], {}, ['pitch', 'range'])?.id).toBe('voice.pitch.match')
    expect(pickWarmupSkill([HOLD, MATCH, STEPS], {})?.id).toBe('voice.pitch.hold')
    expect(pickWarmupSkill(VOICE, { 'voice.range.slides': 55, 'voice.pitch.steps': 50, 'voice.pitch.hold': 78 }, ['pitch', 'range'])?.id).toBe('voice.range.slides')
    const twins = [sung('b.range', 'range', 1, [], 'x', fixed(60)), sung('a.breath', 'breath', 1, [], 'x', fixed(60))]
    expect(pickWarmupSkill(twins, {}, ['range', 'breath'])?.id).toBe('b.range')
    expect(pickWarmupSkill(twins, {}, ['breath', 'range'])?.id).toBe('a.breath')
  })

  it('leaves an area out of the whole day when asked: warm-up, main and second exercise, recap, also when it is pinned', () => {
    const variants: Partial<PlannerInput>[] = [{}, { daysSinceLastSession: 9 }, { quick: true }, { dueTest: 'checkpoint' }]
    let withRange = 0
    for (const variant of variants) {
      for (const dailyMinutes of MINUTES) {
        for (const pinnedSkillId of [undefined, 'voice.range.slides', 'voice.interval.thirds']) {
          const options = { ...SINGING, ...variant }
          const rested = singer(past, { ...options, excludeCategories: ['range'] }, { dailyMinutes, pinnedSkillId })
          expect(exercisesOf(rested).length).toBeGreaterThan(0)
          for (const b of exercisesOf(rested)) expect(categoryOf(b), `${JSON.stringify(variant)} ${dailyMinutes} ${b.kind}`).not.toBe('range')
          withRange += exercisesOf(singer(past, options, { dailyMinutes, pinnedSkillId })).filter((b) => categoryOf(b) === 'range').length
        }
      }
    }
    // Without the option the same days are full of them: it is the option that kept them out.
    expect(withRange).toBeGreaterThan(20)
  })

  it('"not the same drill twice" can compare skills where many skills share one kind of exercise', () => {
    // Five notes is the main exercise. Small jumps (another area) is next in line but is written by the
    // same generator; the echo is in the same area with a generator of its own.
    const states = [
      state('voice.pitch.match', 80, { step: 3 }),
      state('voice.pitch.steps', 50, { tempoCeiling: 70 }),
      state('voice.pitch.five-note', 20),
      state('voice.interval.thirds', 30),
      state('voice.pitch.echo', 40),
    ]
    const options = { skills: [MATCH, STEPS, FIVE, ECHO, THIRDS], warmupCategories: ['pitch', 'range'] as SkillDef['category'][] }
    const byGenerator = singer(states, options, { dailyMinutes: 30 })
    expect(theBlock(byGenerator, 'focus').skillId).toBe('voice.pitch.five-note')
    expect(theBlock(byGenerator, 'second').skillId).toBe('voice.pitch.echo')
    expect(theBlock(singer(states, { ...options, sameDrillBy: 'generator' }, { dailyMinutes: 30 }), 'second').skillId).toBe('voice.pitch.echo')
    const bySkill = singer(states, { ...options, sameDrillBy: 'skill' }, { dailyMinutes: 30 })
    expect(theBlock(bySkill, 'focus').skillId).toBe('voice.pitch.five-note')
    expect(theBlock(bySkill, 'second').skillId).toBe('voice.interval.thirds')
  })

  it('compared by skill, the warm-up is not the skill of the main exercise where another comfortable warm-up will do', () => {
    const ids = (plan: SessionPlan) => [theBlock(plan, 'warmup').skillId, theBlock(plan, 'focus').skillId]
    // "Step up and down" is the comfortable warm-up, and the learner has pinned it as the main exercise.
    const states = [state('voice.pitch.match', 80, { step: 3 }), state('voice.pitch.steps', 55, { tempoCeiling: 70 }), state('voice.pitch.hold', 30, { attempts: 4 })]
    const pinned = { dailyMinutes: 20 as const, pinnedSkillId: 'voice.pitch.steps' }
    // By generator, as the plan has always done: the same skill twice.
    expect(ids(singer(states, { ...SINGING, sameDrillBy: 'generator' }, pinned))).toEqual(['voice.pitch.steps', 'voice.pitch.steps'])
    // By skill: the warm-up moves to the first skill, one step easier as any warm-up, and the main exercise stays.
    const apart = singer(states, SINGING, pinned)
    expect(ids(apart)).toEqual(['voice.pitch.match', 'voice.pitch.steps'])
    expect(theBlock(apart, 'warmup')).toMatchObject({ tempo: 60, params: { step: 2, startStep: 2 } })

    // A day with one area left out: what is being learned is that area and the warm-up skill, so the
    // warm-up skill is the only main exercise in line. It is not sung twice.
    const tired = [state('voice.pitch.match', 80, { step: 3 }), state('voice.pitch.steps', 45, { tempoCeiling: 66, attempts: 5 }), state('voice.range.slides', 30, { attempts: 4 })]
    const rest = { ...SINGING, excludeCategories: ['range'] as SkillDef['category'][] }
    expect(ids(singer(tired, { ...rest, sameDrillBy: 'generator' }, { dailyMinutes: 10 }))).toEqual(['voice.pitch.steps', 'voice.pitch.steps'])
    expect(ids(singer(tired, rest, { dailyMinutes: 10 }))).toEqual(['voice.pitch.match', 'voice.pitch.steps'])

    // A skill one tier up that is comfortable comes before the first skill, as in any warm-up...
    const two = [...states, state('voice.range.slides', 50, { step: 1 })]
    expect(ids(singer(two, SINGING, pinned))).toEqual(['voice.range.slides', 'voice.pitch.steps'])
    // ...and the first skill will do although it is not comfortable yet (rated 30): it builds on nothing,
    // so it is always open. A skill that is neither is never taken: "Echo" (rated 20) is not open here.
    const shaky = [state('voice.pitch.match', 30), state('voice.pitch.steps', 55, { tempoCeiling: 70 }), state('voice.pitch.echo', 20, { attempts: 0 })]
    expect(ids(singer(shaky, SINGING, pinned))).toEqual(['voice.pitch.match', 'voice.pitch.steps'])
    expect(ids(singer(shaky, { ...SINGING, skills: VOICE.filter((s) => s !== MATCH) }, pinned))).toEqual(['voice.pitch.steps', 'voice.pitch.steps'])
    // One skill is all there is: then it cannot be helped.
    expect(ids(singer([state('voice.pitch.match', 50, { step: 1 })], SINGING, { dailyMinutes: 20 }))).toEqual(['voice.pitch.match', 'voice.pitch.match'])
    // And where they differ anyway, nothing moves.
    const usual = { dailyMinutes: 20 as const, pinnedSkillId: 'voice.pitch.hold' }
    expect(singer(states, SINGING, usual)).toEqual(singer(states, { ...SINGING, sameDrillBy: 'generator' }, usual))
  })

  it('compared by skill, the recaps of a comeback day are not the warm-up skill again where the learner knows others', () => {
    const states = [state('voice.pitch.match', 80, { step: 3 }), state('voice.pitch.hold', 62, { step: 2 }), state('voice.range.slides', 70, { step: 2 }), state('voice.pitch.echo', 50, { step: 0 })]
    const back = (options: Partial<PlannerInput>, list = states) => exercisesOf(singer(list, { ...SINGING, ...options, daysSinceLastSession: 9 }, { dailyMinutes: 20 })).map((b) => `${b.kind} ${b.skillId}`)
    expect(back({ sameDrillBy: 'generator' })).toEqual(['warmup voice.range.slides', 'review voice.range.slides', 'review voice.pitch.hold'])
    expect(back({})).toEqual(['warmup voice.range.slides', 'review voice.pitch.hold', 'review voice.pitch.echo'])
    // The warm-up skill is all the learner knows past the basics: it is recapped all the same, so the day is not empty.
    const one = [state('voice.pitch.match', 80, { step: 3 }), state('voice.range.slides', 70, { step: 2 })]
    expect(back({}, one)).toEqual(['warmup voice.range.slides', 'review voice.range.slides'])
  })

  it('a first skill that others build on comes back as the warm-up once it has not been sung for a week', () => {
    const ago = (days: number) => NOW.getTime() - days * DAY
    const states = (matchDays: number | undefined) => [
      state('voice.pitch.match', 70, { step: 2, ...(matchDays === undefined ? {} : { lastPracticedAt: ago(matchDays) }) }),
      state('voice.pitch.steps', 55, { tempoCeiling: 70, lastPracticedAt: ago(1) }),
      state('voice.pitch.hold', 30, { step: 1, attempts: 4, lastPracticedAt: ago(2) }),
    ]
    const warmupOf = (matchDays: number | undefined, over: Partial<PlannerInput> = {}, dailyMinutes: Prefs['dailyMinutes'] = 10) =>
      theBlock(singer(states(matchDays), { ...SINGING, ...over }, { dailyMinutes }), 'warmup')
    // Sung within the week: the comfortable skill one tier up warms the voice up, as on any day.
    for (const days of [0, 3, 7]) expect(warmupOf(days).skillId, `${days} days`).toBe('voice.pitch.steps')
    // More than a week: the first skill, one step easier like any warm-up. Past the basics it is no main
    // exercise, and a short day has no recap: without this nothing would ever bring it back.
    for (const days of [7.5, 8, 20, 90]) expect(warmupOf(days), `${days} days`).toMatchObject({ skillId: 'voice.pitch.match', tempo: 60, params: { step: 1, startStep: 1 } })
    for (const dailyMinutes of MINUTES) expect(warmupOf(8, {}, dailyMinutes).skillId, `${dailyMinutes} min`).toBe('voice.pitch.match')
    expect(warmupOf(8, { daysSinceLastSession: 9 }).skillId).toBe('voice.pitch.match')
    // It is then not the recap of the same day as well.
    expect(exercisesOf(singer(states(8), SINGING, { dailyMinutes: 30 })).filter((b) => b.skillId === 'voice.pitch.match')).toHaveLength(1)
    // A longer day has a recap, but the recap goes to a review that is due first, and a learner with a
    // few of those could wait for ever: the warm-up does not depend on it.
    const due = [...states(8), state('voice.range.slides', 78, { step: 1, lastPracticedAt: ago(2), nextReviewAt: ago(1) }), state('voice.pitch.echo', 76, { step: 1, lastPracticedAt: ago(3), nextReviewAt: ago(2) })]
    const long = singer(due, SINGING, { dailyMinutes: 30 })
    expect(theBlock(long, 'review').skillId).toBe('voice.pitch.echo')
    expect(theBlock(long, 'warmup').skillId).toBe('voice.pitch.match')
    // Rated but never sung (a singer who skipped the course): nothing has had time to fade.
    expect(warmupOf(undefined).skillId).toBe('voice.pitch.steps')
    // Only where a warm-up may come from its area, and not on a day that leaves the area out.
    const breath = [...states(8), state('voice.range.slides', 50, { step: 1, lastPracticedAt: ago(1) })]
    expect(theBlock(singer(breath, { ...SINGING, warmupCategories: ['range', 'breath'] }, { dailyMinutes: 10 }), 'warmup').skillId).toBe('voice.range.slides')
    expect(theBlock(singer(breath, { ...SINGING, excludeCategories: ['pitch'] }, { dailyMinutes: 10 }), 'warmup').skillId).toBe('voice.range.slides')
    expect(theBlock(singer(breath, SINGING, { dailyMinutes: 10 }), 'warmup').skillId).toBe('voice.pitch.match')
    // Only a first-steps skill that something builds on: one that stands alone stays behind the learner.
    const alone = VOICE.map((s) => ({ ...s, prerequisites: s.prerequisites.filter((p) => p !== 'voice.pitch.match') }))
    expect(warmupOf(20, { skills: alone }).skillId).toBe('voice.pitch.steps')
    // And a skill one tier up that others build on is left to the main exercises and recaps, as always.
    const stale = [state('voice.pitch.match', 70, { step: 2, lastPracticedAt: ago(1) }), state('voice.pitch.steps', 55, { tempoCeiling: 70, lastPracticedAt: ago(30) }), state('voice.range.slides', 60, { step: 1, lastPracticedAt: ago(1) })]
    expect(theBlock(singer(stale, SINGING, { dailyMinutes: 10 }), 'warmup').skillId).toBe('voice.range.slides')
  })
})

describe('singing: a song has one speed, no bar loop, and words of its own', () => {
  const sing = { speeds: [1], copy: VOICE_PLANNER_COPY.song, loopWeakBars: false }
  const sungItem = (level: number, over: Partial<SongItemState> = {}): SongItemState => ({
    key: songItemKey(1, level),
    songId: 1,
    level,
    bestAccuracy: null,
    lastAt: null,
    ease: 2.3,
    intervalDays: 1,
    weakBars: [],
    ...over,
  })
  const itemsOf = (...list: SongItemState[]) => Object.fromEntries(list.map((i) => [i.key, i]))
  const SPEED_WORDS = /slow|fast|speed/i

  it('a first song starts on the easiest level at the only speed there is', () => {
    expect(pickSongBlock(LIBRARY, {}, 7, 0, { beginner: true })).toMatchObject({ level: 0, speed: BEGINNER_SONG_SPEED })
    const first = pickSongBlock(LIBRARY, {}, 7, 0, { beginner: true, ...sing })!
    expect(first).toMatchObject({ level: 0, speed: 1 })
    expect(first.reason).not.toMatch(SPEED_WORDS)
  })

  it('a hard run brings the level back as it was, and two in a row the level below: never a slower song', () => {
    const once = itemsOf(sungItem(2, { bestAccuracy: 0.5, lastAt: 10, lastAccuracy: 0.5, lastSpeed: 1, fullSpeedBest: 0.5, lowStreak: 1 }))
    expect(pickSongBlock(LIBRARY, once, 7)).toMatchObject({ level: 2, speed: 0.85 })
    const again = pickSongBlock(LIBRARY, once, 7, 0, sing)!
    expect(again).toMatchObject({ level: 2, speed: 1 })
    expect(again.reason).not.toMatch(SPEED_WORDS)
    const twice = itemsOf(sungItem(2, { bestAccuracy: 0.5, lastAt: 10, lastAccuracy: 0.5, lastSpeed: 1, fullSpeedBest: 0.5, lowStreak: 2 }))
    const back = pickSongBlock(LIBRARY, twice, 7, 0, sing)!
    expect(back).toMatchObject({ level: 1, speed: 1 })
    expect(back.reason).not.toMatch(SPEED_WORDS)
  })

  it('a comeback day is one level easier, still at speed 1, also where that level went badly last time', () => {
    const items = itemsOf(
      sungItem(2, { bestAccuracy: 0.8, lastAt: 20, lastAccuracy: 0.8, lastSpeed: 1, fullSpeedBest: 0.8 }),
      sungItem(1, { bestAccuracy: 0.6, lastAt: 10, lastAccuracy: 0.6, lastSpeed: 1, fullSpeedBest: 0.6, lowStreak: 1 }),
    )
    expect(pickSongBlock(LIBRARY, items, 7, -1)).toMatchObject({ level: 1, speed: 0.85 })
    const back = pickSongBlock(LIBRARY, items, 7, -1, sing)!
    expect(back).toMatchObject({ level: 1, speed: 1 })
    expect(back.reason).not.toMatch(SPEED_WORDS)
  })

  it('carries no bar loop when asked not to, and says nothing about one', () => {
    const items = itemsOf(sungItem(2, { bestAccuracy: 0.87, lastAt: 10, lastAccuracy: 0.87, lastSpeed: 1, fullSpeedBest: 0.87, weakBars: [5, 6, 8] }))
    const looped = pickSongBlock(LIBRARY, items, 7)!
    expect(looped.loopBars).toEqual([5, 8])
    expect(looped.reason).toMatch(/tricky bars/)
    const plain = pickSongBlock(LIBRARY, items, 7, 0, { loopWeakBars: false })!
    expect('loopBars' in plain).toBe(false)
    expect(plain.reason).not.toMatch(/bars/)
    expect({ ...plain, reason: '' }).toEqual({ ...looped, loopBars: undefined, reason: '' })
  })

  it('fits the passes to the level about to be sung: an echo level lasts about twice the tune', () => {
    // 100 s for the tune and 4 s of count-in; the two echo levels take 200 s.
    const tune: SongSummary = { id: 9, title: 'Tune', artist: '', duration: 100, bpm: 60, levelNoteCounts: [9, 9, 9, 9, 9, 9], levelDurations: [200, 200, 100, 100, 100, 100] }
    const flat: SongSummary = { ...tune, levelDurations: undefined }
    expect(pickSongBlock([tune], {}, 4, 0, sing)).toMatchObject({ level: 2, passes: 2 })
    expect(pickSongBlock([tune], {}, 4, 0, { ...sing, beginner: true })).toMatchObject({ level: 0, passes: 1 })
    expect(pickSongBlock([flat], {}, 4, 0, { ...sing, beginner: true })).toMatchObject({ level: 0, passes: 2 })
    // The plan keeps that number when it sets the rounds of the day, and counts the level's own length.
    const plan = planSession(input({ skills: VOICE, model: model([]), library: [tune], ...SINGING }, { dailyMinutes: 10 }))
    const [song] = songsOf(plan)
    expect(song).toMatchObject({ level: 0, speed: 1, passes: 1, minutes: 4 })
    const others = { ...plan, blocks: plan.blocks.filter((b) => b.kind !== 'song') }
    expect(planPlayingMinutes(plan, [tune], VOICE) - planPlayingMinutes(others, [tune], VOICE)).toBeCloseTo(204 / 60, 6)
  })

  it('every song in a day of singing is at speed 1: on a first day, an ordinary day and a comeback day', () => {
    const library: SongSummary[] = [1, 2, 3].map((id) => ({ id, title: `Song ${id}`, artist: '', duration: 30, bpm: 80, levelNoteCounts: [9, 9, 9, 9, 9, 9] }))
    const hard = itemsOf(sungItem(1, { bestAccuracy: 0.5, lastAt: 10, lastAccuracy: 0.5, lastSpeed: 1, fullSpeedBest: 0.5, lowStreak: 1 }))
    const learners: LearnerModel[] = [model([]), model([state('voice.pitch.match', 80, { step: 2 }), state('voice.pitch.steps', 50)], hard)]
    let songs = 0
    let slowedWithout = 0
    for (const learner of learners) {
      for (const days of [undefined, 1, 9]) {
        for (const dailyMinutes of [10, 20, 30] as const) {
          const base = { skills: VOICE, model: learner, library, daysSinceLastSession: days }
          for (const b of songsOf(planSession(input({ ...base, ...SINGING }, { dailyMinutes })))) {
            songs++
            expect(b.speed, `${days} days, ${dailyMinutes} min`).toBe(1)
            expect('loopBars' in b).toBe(false)
          }
          slowedWithout += songsOf(planSession(input(base, { dailyMinutes }))).filter((b) => b.speed < 1).length
        }
      }
    }
    expect(songs).toBeGreaterThan(10)
    // The same days planned without the options do slow songs down: the options are what keeps the speed.
    expect(slowedWithout).toBeGreaterThan(5)
  })
})

describe('singing: the words of a plan', () => {
  /** Words that belong to an instrument that is played with the hands, or to a speed a song does not have. */
  const NOT_FOR_A_SINGER = /\b(slow|slower|slowly|faster|play|played|playing|guitar|strings?|fingers?|hands?|frets?|bpm)\b/i
  const sentencesOf = (plan: SessionPlan) => [...plan.explanation, ...plan.blocks.map((b) => b.reason)]
  const library: SongSummary[] = [1, 2, 3].map((id) => ({ id, title: `Song ${id}`, artist: '', duration: 30, bpm: 80, levelNoteCounts: [9, 9, 9, 9, 9, 9] }))
  const sungBefore = (songId: number, level: number, accuracy: number, lastAt: number, over: Partial<SongItemState> = {}): SongItemState => ({
    key: songItemKey(songId, level),
    songId,
    level,
    bestAccuracy: accuracy,
    lastAt,
    ease: 2.3,
    intervalDays: 1,
    weakBars: [],
    lastAccuracy: accuracy,
    lastSpeed: 1,
    fullSpeedBest: accuracy,
    ...over,
  })
  const songStates: Record<string, SongItemState>[] = [
    {},
    Object.fromEntries([sungBefore(1, 2, 0.95, 30), sungBefore(2, 1, 0.5, 20, { lowStreak: 1 }), sungBefore(3, 3, 0.8, 10, { weakBars: [3, 4] })].map((i) => [i.key, i])),
    Object.fromEntries([sungBefore(1, 5, 0.95, 30), sungBefore(2, 2, 0.5, 20, { lowStreak: 2 }), sungBefore(3, 0, 0.88, 10, { lastSpeed: 0.75, fullSpeedBest: 0 })].map((i) => [i.key, i])),
  ]
  const skillStates: SkillState[][] = [
    [],
    [state('voice.pitch.match', 80, { step: 3 }), state('voice.pitch.steps', 50, { tempoCeiling: 70 }), state('voice.pitch.hold', 40, { step: 1 }), state('voice.range.slides', 35), state('voice.pitch.echo', 30)],
  ]
  const variants: Partial<PlannerInput>[] = [{}, { daysSinceLastSession: undefined }, { daysSinceLastSession: 9 }, { quick: true }, { quick: true, daysSinceLastSession: 9 }, { dueTest: 'checkpoint' }, { library: [] }]
  const everyDay = (options: Partial<PlannerInput>) =>
    skillStates.flatMap((states) =>
      songStates.flatMap((songItems) =>
        variants.flatMap((variant) =>
          MINUTES.map((dailyMinutes) => planSession(input({ skills: VOICE, model: model(states, songItems), library, ...options, ...variant }, { dailyMinutes }))),
        ),
      ),
    )

  it('with the singing words no sentence of any plan speaks of playing, of hands or strings, or of a speed', () => {
    const sentences = everyDay(SINGING).flatMap(sentencesOf)
    expect(sentences.length).toBeGreaterThan(500)
    for (const sentence of new Set(sentences)) expect(sentence).not.toMatch(NOT_FOR_A_SINGER)
    // The same days in the built-in words trip the check many times over: it does look at what matters.
    const guitarWords = everyDay({ ...SINGING, copy: undefined, songSpeeds: undefined }).flatMap(sentencesOf)
    expect(new Set(guitarWords.filter((s) => NOT_FOR_A_SINGER.test(s))).size).toBeGreaterThan(8)
  })

  it('every singing sentence the planner owns passes the same check, also the ones a plan rarely shows', () => {
    const { song, ...day } = VOICE_PLANNER_COPY
    const said = (entry: unknown): string => (typeof entry === 'function' ? (entry as (...args: unknown[]) => string)(3, 2) : String(entry))
    const all = [...Object.values(day), ...Object.values(song)].map(said)
    expect(all.length).toBeGreaterThan(15)
    for (const sentence of all) {
      expect(sentence).not.toMatch(NOT_FOR_A_SINGER)
      expect(sentence).not.toMatch(/\b(wrong|failed|louder|push|belt|tone deaf)\b/i)
    }
    // The table for the guitar has an entry for every one of them, so neither side can gain a sentence the other lacks.
    expect(Object.keys(VOICE_PLANNER_COPY).sort()).toEqual(Object.keys(GUITAR_PLANNER_COPY).sort())
    expect(Object.keys(VOICE_PLANNER_COPY.song).sort()).toEqual(Object.keys(GUITAR_PLANNER_COPY.song).sort())
  })

  it('words can be replaced one at a time: what is not given stays as it is', () => {
    const plan = planSession(input({ copy: { warmup: 'A gentle start' } }))
    expect(theBlock(plan, 'warmup').reason).toBe('A gentle start')
    expect({ ...plan, blocks: plan.blocks.slice(1) }).toEqual({ ...planSession(input()), blocks: planSession(input()).blocks.slice(1) })
  })
})

describe('guitar: naming every new option at its default changes nothing', () => {
  it('the areas of a warm-up have an order, and it is part of the default: picking before fretting', () => {
    // Two skills that are alike in everything else: the order of the areas decides, then the id.
    const twins = [skill('b.fretting', 'fretting', 1), skill('a.timing', 'timing', 1), skill('c.picking', 'picking', 1)]
    expect(DEFAULT_WARMUP_CATEGORIES).toEqual(['picking', 'fretting', 'timing'])
    expect(pickWarmupSkill(twins, {})?.id).toBe('c.picking')
    expect(pickWarmupSkill(twins, {}, DEFAULT_WARMUP_CATEGORIES)?.id).toBe('c.picking')
    expect(pickWarmupSkill(twins, {}, ['fretting', 'picking', 'timing'])?.id).toBe('b.fretting')
  })

  it('gives the same plans as naming none', () => {
    const defaults: Partial<PlannerInput> = {
      idPrefix: '',
      warmupCategories: DEFAULT_WARMUP_CATEGORIES,
      maxBars: 32,
      templates: SESSION_TEMPLATES,
      songSpeeds: SONG_SPEED_STEPS,
      excludeCategories: [],
      copy: GUITAR_PLANNER_COPY,
      maxSteps: {},
      sameDrillBy: 'generator',
      loopWeakBars: true,
    }
    const learners = [model([]), model(BASE_STATES), model(REAL_SKILLS.map((s, i) => state(s.id, 20 + ((i * 37) % 75), { tempoCeiling: s.startTempo + (i % 5) * 6 })))]
    for (const learner of learners) {
      for (const skills of [SKILLS, REAL_SKILLS]) {
        for (const dailyMinutes of MINUTES) {
          for (const variant of [{}, { daysSinceLastSession: 9 }, { quick: true }, { dueTest: 'checkpoint' as const }]) {
            const base = { model: learner, skills, ...variant }
            expect(planSession(input({ ...base, ...defaults }, { dailyMinutes }))).toEqual(planSession(input(base, { dailyMinutes })))
          }
        }
      }
    }
  })
})

describe('singing: ten weeks on the stand-in skills, planner and rating together (simulated)', () => {
  interface Round {
    day: number
    kind: ExerciseBlock['kind']
    skillId: string
    tempo: number
    step?: number
    ratingAfter: number
  }
  interface Singer {
    states: Record<string, SkillState>
    history: Record<string, Attempt[]>
    now: number
    recentFocus: string[]
    recentRecap: string[]
    rounds: Round[]
    focusByDay: string[]
  }
  const start = (): Singer => ({ states: {}, history: {}, now: SIM_START, recentFocus: [], recentRecap: [], rounds: [], focusByDay: [] })
  const lastStepOf = (def: SkillDef) => (def.steps?.length ?? 0) - 1
  const openNow = (s: Singer) => skillOpener(VOICE, openContextOf({ ...model([]), skills: s.states }, s.now))

  /** How well a round is sung: one number for every round, or a function of the step it is on (and of its tempo). */
  type Sung = number | ((step: number | undefined, tempo: number) => number)

  /** One day: the plan for a singer and every exercise of it sung as `sung` says, each round set from the one before as the Coach sets it. */
  const singDay = (s: Singer, day: number, sung: Sung, maxSteps?: Record<string, number>, dailyMinutes: Prefs['dailyMinutes'] = 20): SessionPlan => {
    const accuracyOn = (step: number | undefined, tempo: number) => (typeof sung === 'number' ? sung : sung(step, tempo))
    s.now += DAY
    const plan = planSession({
      model: { ...model([]), skills: s.states },
      skills: VOICE,
      library: [],
      prefs: { dailyMinutes, goals: [] },
      now: new Date(s.now),
      recentFocusSkillIds: s.recentFocus,
      recentRecapSkillIds: s.recentRecap,
      daysSinceLastSession: day === 0 ? undefined : 1,
      effectiveRating,
      ...SINGING,
      maxSteps,
    })
    let live = plan
    for (let index = 0; index < plan.blocks.length; index++) {
      const block = live.blocks[index]
      if (block.kind === 'song' || block.kind === 'test') continue
      const def = VOICE_BY_ID.get(block.skillId)!
      let tempo = block.tempo
      let step = typeof block.params.step === 'number' ? block.params.step : undefined
      // As in the app, the warm-up sets the rest of the day (adaptAfterBlock).
      if (block.kind === 'warmup') live = adaptAfterBlock(live, block.id, ATTEMPT, perf(accuracyOn(step, tempo)), VOICE)
      for (let rep = 1; rep <= block.reps; rep++) {
        s.now += 60_000
        const accuracy = accuracyOn(step, tempo)
        // What the exercise of this round is rated: the bonus of the step at the one tempo, or the tempo asked for.
        const difficulty = itemDifficulty(def, step === undefined ? { tempo } : { tempo, bonus: def.steps![step].bonus })
        const run: Attempt = { ...played(accuracy, tempo, s.now), kind: KIND_BY_BLOCK[block.kind], skillId: def.id, difficulty, params: { ...block.params, tempo, ...(step === undefined ? {} : { step }) } }
        let after = applyAttempt(s.states[def.id] ?? newSkillState(def.id, 0, s.now), run, def, s.history[def.id] ?? [], s.now)
        if (rep === block.reps) {
          // The review dates the Coach keeps at the end of a block.
          if (block.kind === 'review' && after.nextReviewAt) after = { ...after, ...nextReview(after, run.performance, s.now) }
          else if (!after.nextReviewAt && after.rating >= 75) after = { ...after, ...startReview(s.now) }
        }
        s.states = { ...s.states, [def.id]: after }
        s.history[def.id] = [...(s.history[def.id] ?? []), run].slice(-20)
        s.rounds.push({ day, kind: block.kind, skillId: def.id, tempo, step, ratingAfter: after.rating })
        if (step === undefined) tempo = nextRepTempo(tempo, accuracy, block.params.startTempo as number, def.targetTempo, false, def.minTempo)
        else step = nextRepStep(step, accuracy, block.params.startStep as number, typeof block.params.maxStep === 'number' ? block.params.maxStep : lastStepOf(def))
      }
    }
    const focus = plan.blocks.find((b): b is ExerciseBlock => b.kind === 'focus')
    if (focus) {
      s.recentFocus = [focus.skillId, ...s.recentFocus].slice(0, 2)
      s.focusByDay.push(focus.skillId)
    }
    s.recentRecap = [...plan.blocks.filter((b): b is ExerciseBlock => b.kind === 'review').map((b) => b.skillId), ...s.recentRecap].slice(0, 3)
    s.now = new Date(s.now).setHours(18, 0, 0, 0)
    return plan
  }

  /** What holds for every round, however the singer sings. */
  const expectEveryRoundWithinLimits = (s: Singer) => {
    expect(s.rounds.length).toBeGreaterThan(100)
    for (const r of s.rounds) {
      const def = VOICE_BY_ID.get(r.skillId)!
      const where = `day ${r.day} ${r.kind} ${r.skillId}`
      if (def.steps) {
        expect(r.tempo, where).toBe(def.startTempo)
        expect(r.step, where).toBeGreaterThanOrEqual(0)
        expect(r.step, where).toBeLessThanOrEqual(lastStepOf(def))
      } else {
        expect(r.step, where).toBeUndefined()
        expect(r.tempo, where).toBeGreaterThanOrEqual(def.minTempo!)
        expect(r.tempo, where).toBeLessThanOrEqual(def.targetTempo)
      }
    }
  }

  it('clean singing: the first skill opens the others within days, the ladders are climbed, and nothing is called mastered on its easy steps', () => {
    const s = start()
    for (let day = 0; day < 21; day++) singDay(s, day, 0.92)
    expectEveryRoundWithinLimits(s)
    // "Match a note" is all there is at first; two days of it reach the line that opens what builds on it.
    expect(s.focusByDay.slice(0, 2)).toEqual(['voice.pitch.match', 'voice.pitch.match'])
    expect(s.focusByDay[2]).not.toBe('voice.pitch.match')
    expect(new Set(s.focusByDay).size).toBeGreaterThanOrEqual(6)
    // Every ladder that was practised has been climbed to its top, and the tempo skills have got faster.
    for (const def of VOICE.filter((d) => d.steps)) expect(s.states[def.id]?.step, def.id).toBe(lastStepOf(def))
    expect(s.states['voice.pitch.steps'].tempoCeiling).toBe(88)
    // No step skill reads "mastered" before a clean round on its last step.
    for (const def of VOICE.filter((d) => d.steps)) {
      const mastered = s.rounds.findIndex((r) => r.skillId === def.id && r.ratingAfter >= 90)
      const onTop = s.rounds.findIndex((r) => r.skillId === def.id && r.step === lastStepOf(def))
      if (mastered >= 0) expect(onTop, def.id).toBeGreaterThanOrEqual(0)
      if (mastered >= 0) expect(onTop, def.id).toBeLessThanOrEqual(mastered)
    }
    expect(s.rounds.some((r) => r.ratingAfter >= 90)).toBe(true)
  })

  it('the first skill is not left to go rusty: ten weeks on, everything that builds on it is still open', () => {
    const s = start()
    for (let day = 0; day < 70; day++) {
      const plan = singDay(s, day, 0.92)
      if (day < 2) continue
      // It is behind the singer as a main exercise...
      expect(plan.blocks.find((b) => b.kind === 'focus'), `day ${day}`).not.toMatchObject({ skillId: 'voice.pitch.match' })
      // ...but it keeps coming back as a recap, so it stays above the line and nothing above it closes.
      expect(effectiveRating(s.states['voice.pitch.match'], s.now), `day ${day}`).toBeGreaterThanOrEqual(UNLOCK_RATING)
      const open = openNow(s)
      for (const def of VOICE.filter((d) => s.states[d.id])) expect(open(def), `day ${day} ${def.id}`).toBe(true)
    }
    expect(s.rounds.filter((r) => r.skillId === 'voice.pitch.match' && r.kind === 'review' && r.day > 14).length).toBeGreaterThan(0)
    // And recapped on its last step, it is finished like any other skill.
    expect(s.states['voice.pitch.match'].rating).toBe(100)
  })

  it('ten minutes a day, where no day has a recap: the first skill still does not go rusty, and nothing that builds on it closes', () => {
    const s = start()
    for (let day = 0; day < 98; day++) {
      const plan = singDay(s, day, 0.92, undefined, 10)
      expect(kinds(plan)).not.toContain('review')
      if (day < 2) continue
      expect(effectiveRating(s.states['voice.pitch.match'], s.now), `day ${day}`).toBeGreaterThanOrEqual(UNLOCK_RATING)
      const open = openNow(s)
      for (const def of VOICE.filter((d) => s.states[d.id])) expect(open(def), `day ${day} ${def.id}`).toBe(true)
    }
    expectEveryRoundWithinLimits(s)
    // It comes back as the warm-up about once a week, long after a skill one tier up took the warm-up over.
    const late = s.rounds.filter((r) => r.skillId === 'voice.pitch.match' && r.day > 28)
    expect(new Set(late.map((r) => r.kind))).toEqual(new Set(['warmup']))
    expect(new Set(late.map((r) => r.day)).size).toBeGreaterThanOrEqual(7)
    // The other days still warm up on a skill one tier up.
    expect(s.rounds.filter((r) => r.kind === 'warmup' && r.skillId !== 'voice.pitch.match' && r.day > 28).length).toBeGreaterThan(100)
    // And every skill the singer has met stays in the plan to the end: none is left half way up its ladder.
    for (const def of VOICE) expect(s.states[def.id]?.rating, def.id).toBe(100)
  })

  it('a small range: a ladder is climbed as far as the voice can hold it, never further, and the skill is still finished there', () => {
    const s = start()
    for (let day = 0; day < 42; day++) singDay(s, day, 0.92, { 'voice.range.slides': 1 })
    expectEveryRoundWithinLimits(s)
    const slides = s.rounds.filter((r) => r.skillId === 'voice.range.slides')
    expect(slides.length).toBeGreaterThan(10)
    expect(Math.max(...slides.map((r) => r.step!))).toBe(1)
    expect(s.states['voice.range.slides'].step).toBe(1)
    expect(s.states['voice.range.slides'].rating).toBe(100)
  })

  it('clean on the first step only: the easy step carries the rating to its stop and no further, and that opens nothing', () => {
    const s = start()
    for (let day = 0; day < 21; day++) singDay(s, day, (step) => (step === 0 ? 0.92 : 0.7))
    expectEveryRoundWithinLimits(s)
    // 50 is where the first step of "Match a note" stops; what builds on the skill opens at 60.
    expect(Math.max(...s.rounds.map((r) => r.ratingAfter))).toBeLessThanOrEqual(50)
    expect(Math.max(...s.rounds.map((r) => r.ratingAfter))).toBeGreaterThan(40)
    expect(new Set(s.focusByDay)).toEqual(new Set(['voice.pitch.match']))
    // Two clean rounds on the first step do open the second one, and the singer keeps being offered it.
    expect(s.states['voice.pitch.match'].step).toBe(1)
    expect(s.rounds.filter((r) => r.step === 1).length).toBeGreaterThan(20)
    expect(s.rounds.some((r) => (r.step ?? 0) > 1)).toBe(false)
  })

  it('rough singing: nobody is pushed up a ladder or under a floor, and nothing opens on top of a first skill that is not there yet', () => {
    const s = start()
    for (let day = 0; day < 14; day++) singDay(s, day, 0.55)
    expectEveryRoundWithinLimits(s)
    expect(new Set(s.focusByDay)).toEqual(new Set(['voice.pitch.match']))
    expect(new Set(s.rounds.map((r) => r.step))).toEqual(new Set([0]))
    expect(s.states['voice.pitch.match'].step).toBe(0)
    expect(s.states['voice.pitch.match'].rating).toBeLessThan(UNLOCK_RATING)
    // A singer who has the first skill but finds a tempo skill hard is slowed to its floor and kept there.
    const t = start()
    t.states = { 'voice.pitch.match': state('voice.pitch.match', 80, { step: 3, lastPracticedAt: SIM_START }) }
    for (let day = 1; day <= 14; day++) singDay(t, day, t.focusByDay.length % 2 === 0 ? 0.55 : 0.6)
    expectEveryRoundWithinLimits(t)
    const stepwise = t.rounds.filter((r) => r.skillId === 'voice.pitch.steps')
    expect(stepwise.length).toBeGreaterThan(10)
    expect(Math.min(...stepwise.map((r) => r.tempo))).toBe(54)
    expect(stepwise[stepwise.length - 1].tempo).toBe(54)
  })
})
