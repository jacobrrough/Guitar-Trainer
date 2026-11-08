import { describe, expect, it } from 'vitest'
import { adaptAfterBlock, focusPriority, nextRepTempo, pickSongBlock, pickWarmupSkill, planSession } from './planner'
import type { PlannerInput } from './planner'
import type {
  Attempt,
  ExerciseBlock,
  LearnerModel,
  Performance,
  Prefs,
  SkillDef,
  SkillState,
  SongItemState,
  SongSummary,
} from './types'
import { BEGINNER_SONG_SPEED, COMEBACK_TEMPO_FACTOR, MAX_SESSION_TEMPO_GAIN, PLACEMENT_MINUTES } from './constants'

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
    expect(pc.params).toMatchObject({ tempo: 60, bars: 4, startTempo: 60 })
    expect(pc.reps).toBe(3)
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

  it('picks the review by due date, then rust, then strongest', () => {
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
