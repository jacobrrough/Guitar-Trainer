import { describe, expect, it } from 'vitest'
import {
  MAX_ROUNDS,
  MAX_SONG_PASSES,
  adaptAfterBlock,
  fitRounds,
  focusPriority,
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
  SkillDef,
  SkillState,
  SongItemState,
  SongSummary,
} from './types'
import { BEGINNER_SONG_SPEED, COMEBACK_TEMPO_FACTOR, MAX_SESSION_TEMPO_GAIN, PLACEMENT_MINUTES, UNLOCK_RATING } from './constants'
import { COURSE } from '../lessons/course'
import { applyPlacement, applyTestResults, monthlyTasks, placementLadder } from './assessment'
import { exerciseParams, generateExercise } from './exercises'
import { DEFAULT_TUNING } from './exercises/builder'
import { applyAttempt, effectiveRating, newSkillState } from './learner'
import { attemptPerformance } from './performance'
import { applySongAttempt, newSongItem, nextReview, songItemKey, startReview } from './review'
import { SKILLS as REAL_SKILLS, SKILLS_BY_ID } from './skills'

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
      tempo = nextRepTempo(tempo, accuracy, block.tempo)
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

  it('at 85 to 88 % the learner moves forward too: no tempo is talked down, no rating falls, the first tier 1 skills are solid within four weeks', () => {
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
      // Slower than at 95 %, where the tempo also goes up from round to round.
      expect(solidOn['fret.single-string'], `${accuracy}`).toBeGreaterThan(7)
      expect(plannedOn['chord.power'], `${accuracy}`).toBeUndefined()
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
