/**
 * The daily plan of a singer, made by the planner from the real singing skills with the options the
 * Coach hands it for a voice (docs/SINGING.md §6 and §12). The planner's own rules are tested with
 * stand-in skills in planner.test.ts; here the twelve real skills, their tempos, floors and ladders go
 * through it, and every block it plans is built by the real generators for the singer's range.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_RANGES, MIN_RANGE_SPAN } from '../music/keys'
import { BELOW_TARGET_RATING, UNLOCK_RATING } from './constants'
import { exerciseParams, generateExercise } from './exercises'
import { DEFAULT_TUNING } from './exercises/builder'
import { applyAttempt, applyToModel, effectiveRating, newSkillState } from './learner'
import { attemptPerformance } from './performance'
import { MAX_ROUNDS, VOICE_PLANNER_COPY, adaptAfterBlock, maxStepFor, nextRepStep, nextRepTempo, planSession } from './planner'
import type { PlannerInput } from './planner'
import type { Attempt, Block, ExerciseBlock, GeneratedExercise, LearnerModel, Prefs, SessionPlan, SkillDef, SkillState, SongBlock, SongItemState, SongSummary } from './types'
import { openContextOf, skillOpener } from './unlock'
import { VOICE_SKILLS } from './voiceSkills'

interface Range {
  low: number
  high: number
  easy: number
}

const LOWER: Range = DEFAULT_RANGES.lower
const OCTAVE: Range = { low: 57, high: 69, easy: 62 }
const WIDE: Range = { low: 45, high: 59, easy: 52 }

const NOW = new Date(2026, 5, 15, 10, 0, 0)
const DAY = 86_400_000

const skillOf = (id: string): SkillDef => {
  const skill = VOICE_SKILLS.find((s) => s.id === id)
  if (!skill) throw new Error(`No voice skill ${id}`)
  return skill
}

/** Minutes per block for a singer (docs/SINGING.md §6): 10, 20 and 30 minutes are offered, 45 is the 30-minute day. */
const TEMPLATES: NonNullable<PlannerInput['templates']> = {
  10: { warmup: 2, focus: 4, second: 0, song: 4, review: 0 },
  20: { warmup: 3, focus: 6, second: 0, song: 7, review: 4 },
  30: { warmup: 3, focus: 7, second: 5, song: 10, review: 5 },
  45: { warmup: 3, focus: 7, second: 5, song: 10, review: 5 },
}

/** How far up each ladder a range lets a singer go, as the Coach works it out for the planner. */
const maxStepsFor = (range: Range): Record<string, number> => Object.fromEntries(VOICE_SKILLS.filter((s) => s.steps).map((s) => [s.id, maxStepFor(s, range)]))

function state(skillId: string, rating: number, extra: Partial<SkillState> = {}): SkillState {
  return { skillId, rating, confidence: 5, tempoCeiling: 0, ease: 2.3, intervalDays: 1, plateauStep: 0, attempts: 10, lastPracticedAt: NOW.getTime() - DAY, ...extra }
}

function model(states: SkillState[] = [], songItems: Record<string, SongItemState> = {}): LearnerModel {
  return {
    skills: Object.fromEntries(states.map((s) => [s.skillId, s])),
    songItems,
    profile: { id: 2, instrument: 'voice', goals: [], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 },
  }
}

/** What the Coach passes for a voice: everything that differs from the guitar is an option. */
function voiceInput(range: Range, over: Partial<PlannerInput> = {}, prefs: Partial<Prefs> = {}): PlannerInput {
  return {
    model: model(),
    skills: VOICE_SKILLS,
    library: [],
    prefs: { dailyMinutes: 20, goals: [], ...prefs },
    now: NOW,
    effectiveRating,
    idPrefix: 'voice-',
    warmupCategories: ['pitch', 'range'],
    maxBars: 8,
    templates: TEMPLATES,
    songSpeeds: [1],
    copy: VOICE_PLANNER_COPY,
    sameDrillBy: 'skill',
    loopWeakBars: false,
    maxSteps: maxStepsFor(range),
    ...over,
  }
}

/** Three songs of the course as the Coach lists them: six levels with the same notes, the echo levels about twice as long. */
const SONGS: SongSummary[] = [
  { id: 1, title: 'Hot Cross Buns', artist: 'Traditional', duration: 30, bpm: 72, levelNoteCounts: [17, 17, 17, 17, 17, 17], builtinId: 'sing-hot-cross-buns', lessonLevel: 4, levelDurations: [58, 58, 30, 30, 30, 30], instrument: 'voice' },
  { id: 2, title: 'Mary Had a Little Lamb', artist: 'Traditional', duration: 26, bpm: 84, levelNoteCounts: [26, 26, 26, 26, 26, 26], builtinId: 'sing-mary-lamb', lessonLevel: 5, levelDurations: [50, 50, 26, 26, 26, 26], instrument: 'voice' },
  { id: 3, title: 'Ode to Joy', artist: 'Beethoven', duration: 50, bpm: 80, levelNoteCounts: [30, 30, 30, 30, 30, 30], builtinId: 'sing-ode-to-joy', lessonLevel: 6, levelDurations: [98, 98, 50, 50, 50, 50], instrument: 'voice' },
]

function songItem(songId: number, level: number, extra: Partial<SongItemState> = {}): SongItemState {
  return { key: `${songId}:${level}`, songId, level, bestAccuracy: 0.8, lastAt: NOW.getTime() - DAY, ease: 2.3, intervalDays: 1, weakBars: [], lastAccuracy: 0.8, lastSpeed: 1, instrument: 'voice', ...extra }
}
const items = (...list: SongItemState[]): Record<string, SongItemState> => Object.fromEntries(list.map((i) => [i.key, i]))

const exercisesOf = (plan: { blocks: Block[] }) => plan.blocks.filter((b): b is ExerciseBlock => b.kind !== 'song' && b.kind !== 'test')
const songsOf = (plan: { blocks: Block[] }) => plan.blocks.filter((b): b is SongBlock => b.kind === 'song')
const theBlock = (plan: { blocks: Block[] }, kind: ExerciseBlock['kind']) => plan.blocks.find((b): b is ExerciseBlock => b.kind === kind)!
/** Every sentence a plan shows: why each block is there, and the lines that explain the day. */
const sentencesOf = (plan: SessionPlan) => [...plan.blocks.map((b) => b.reason), ...plan.explanation]

/**
 * Words a singer's plan never uses. Nothing is "played", there are no strings, fingers or hands, and a
 * sung exercise or song is never made slower or faster (an easier day is "easier").
 */
const NOT_FOR_A_SINGER = /\b(slow\w*|fast\w*|play\w*|guitar\w*|strings?|fret\w*|finger\w*|hands?|pick\w*|strum\w*)\b/i
/** A tempo in numbers means something only where the tempo is what is being learned: on a block of a tempo skill. */
const TEMPO_IN_NUMBERS = /\bbpm\b/i

/** The sentences of a plan that may not name a tempo: everything but the reasons of blocks of tempo skills. */
function withoutTempo(plan: SessionPlan): string[] {
  const ofTempoSkill = (b: Block) => b.kind !== 'song' && b.kind !== 'test' && !skillOf(b.skillId).steps
  return [...plan.blocks.filter((b) => !ofTempoSkill(b)).map((b) => b.reason), ...plan.explanation]
}

/** The exercise of a block as the Coach builds it: the block's own params, with the singer's range filled in at that moment. */
function exerciseFor(block: ExerciseBlock, range: Range, over: Record<string, unknown> = {}): GeneratedExercise {
  const skill = skillOf(block.skillId)
  return generateExercise(skill, block.generatorId, exerciseParams(skill, block.generatorId, block.tempo, { ...block.params, ...range, ...over }), DEFAULT_TUNING)
}

/** Everything that holds for any plan of a singer, whatever the day. */
function expectSingable(plan: SessionPlan, range: Range, where: string): void {
  const reach = maxStepsFor(range)
  plan.blocks.forEach((b, i) => expect(b.id, where).toBe(`voice-${plan.date}-${i}-${b.kind}`))
  for (const text of sentencesOf(plan)) expect(text, where).not.toMatch(NOT_FOR_A_SINGER)
  for (const text of withoutTempo(plan)) expect(text, where).not.toMatch(TEMPO_IN_NUMBERS)
  for (const b of songsOf(plan)) {
    expect(b.speed, `${where}: ${b.reason}`).toBe(1)
    expect('loopBars' in b, where).toBe(false)
    expect(b.passes, where).toBeGreaterThanOrEqual(1)
  }
  for (const b of exercisesOf(plan)) {
    const skill = skillOf(b.skillId)
    const what = `${where}: ${b.kind} ${b.skillId}`
    expect(b.params.bars, what).toBeLessThanOrEqual(8)
    expect(b.params.bars, what).toBeGreaterThanOrEqual(1)
    expect(b.reps, what).toBeLessThanOrEqual(MAX_ROUNDS)
    expect(b.reps, what).toBeGreaterThanOrEqual(1)
    expect(b.generatorId, what).toBe(skill.generators[0])
    // Never under the floor of the skill, never above what it aims for.
    expect(b.tempo, what).toBeGreaterThanOrEqual(skill.minTempo!)
    expect(b.tempo, what).toBeLessThanOrEqual(skill.targetTempo)
    expect(b.params.tempo, what).toBe(b.tempo)
    if (skill.steps) {
      const last = skill.steps.length - 1
      expect(b.tempo, what).toBe(skill.startTempo)
      expect(Number.isInteger(b.params.step), what).toBe(true)
      expect(b.params.step as number, what).toBeGreaterThanOrEqual(0)
      // Never a step the range has no room for, and the limit travels with the block where there is one.
      expect(b.params.step as number, what).toBeLessThanOrEqual(reach[skill.id])
      expect(b.params.maxStep, what).toBe(reach[skill.id] < last ? reach[skill.id] : undefined)
    } else {
      expect('step' in b.params, what).toBe(false)
    }
    // The block can be built for this voice, as the step it names, with every note inside the range.
    const ex = exerciseFor(b, range)
    expect(ex.params.step, what).toBe(b.params.step)
    expect(ex.params.maxStep, what).toBe(b.params.maxStep)
    for (const n of [...ex.chart.notes, ...ex.chart.voice!.cues]) expect(n.midi >= range.low && n.midi <= range.high, `${what}: note ${n.midi}`).toBe(true)
    expect((ex.chart.duration - 1) / ((4 * 60) / b.tempo), what).toBeLessThanOrEqual(8 + 1e-6)
  }
}

describe('the first plan of a singer', () => {
  const plan = planSession(voiceInput(LOWER, { library: SONGS }))

  it('warms up on "Match a note" at 60, on its first step', () => {
    expect(plan.blocks[0]).toMatchObject({ kind: 'warmup', skillId: 'voice.pitch.match', generatorId: 'voiceEcho', tempo: 60, params: { tempo: 60, step: 0, startStep: 0 } })
    expect(plan.blocks[0].reason).toBe('An easy first exercise to wake your voice up gently')
    // It is the only skill a first day can have: everything else is built on it.
    expect(new Set(exercisesOf(plan).map((b) => b.skillId))).toEqual(new Set(['voice.pitch.match']))
    expect(plan.explanation).toContain('First steps: easy notes in the middle of your voice before anything else.')
  })

  it('has block ids that say whose plan it is', () => {
    expect(plan.blocks.length).toBeGreaterThanOrEqual(3)
    for (const b of plan.blocks) expect(b.id.startsWith('voice-2026-06-15-')).toBe(true)
    expect(plan.blocks.map((b) => b.id)).toEqual(plan.blocks.map((b, i) => `voice-2026-06-15-${i}-${b.kind}`))
  })

  it('has no round over 8 bars and no block over 6 rounds', () => {
    const blocks = exercisesOf(plan)
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const b of blocks) {
      expect(b.params.bars).toBeLessThanOrEqual(8)
      expect(b.reps).toBeLessThanOrEqual(6)
    }
    // Twenty minutes at 60 would be written out over 16 or 32 bars for a guitar: here the limit is what holds it.
    expect(blocks.map((b) => b.params.bars)).toContain(8)
    expect(blocks.map((b) => b.reps)).toContain(6)
  })

  it('sings its song at the speed it is written, with no bars to loop', () => {
    const songs = songsOf(plan)
    expect(songs.length).toBeGreaterThanOrEqual(1)
    for (const b of songs) {
      expect(b.speed).toBe(1)
      expect(b.loopBars).toBeUndefined()
      expect(b.level).toBe(0)
    }
  })

  it('says nothing about a guitar, strings, fingers or hands, and nothing about slower or faster', () => {
    expect(sentencesOf(plan).length).toBeGreaterThan(5)
    for (const text of sentencesOf(plan)) expect(text).not.toMatch(NOT_FOR_A_SINGER)
    // Every exercise of this day is on a ladder, at one tempo for good: no sentence names a tempo.
    for (const text of sentencesOf(plan)) expect(text).not.toMatch(TEMPO_IN_NUMBERS)
    // The same day planned without the singer's words does say them: the check above can fail.
    const guitarWords = planSession(voiceInput(LOWER, { library: SONGS, copy: undefined }))
    expect(sentencesOf(guitarWords).some((text) => NOT_FOR_A_SINGER.test(text))).toBe(true)
  })

  it('can be sung as it is planned', () => {
    expectSingable(plan, LOWER, 'first plan')
    expect(plan.minutes).toBe(20)
  })
})

/** Singers at different points of the way, each with what the lessons have taught them. */
const SINGERS: { name: string; states: SkillState[]; over?: Partial<PlannerInput> }[] = [
  { name: 'new', states: [] },
  { name: 'after lesson 3', states: [state('voice.pitch.match', 30, { attempts: 3 })], over: { lessonsDone: 3, lessonSkillIds: ['voice.pitch.match'] } },
  {
    name: 'half way through the course',
    states: [state('voice.pitch.match', 55, { step: 1 }), state('voice.pitch.steps', 35, { tempoCeiling: 60, attempts: 6 }), state('voice.pitch.echo', 30, { attempts: 3 }), state('voice.pitch.five-note', 25, { attempts: 3 })],
    over: { lessonsDone: 6, lessonSkillIds: ['voice.pitch.match', 'voice.pitch.steps', 'voice.pitch.echo', 'voice.pitch.five-note'] },
  },
  {
    name: 'after the course',
    states: [
      state('voice.pitch.match', 66, { step: 2 }),
      state('voice.pitch.steps', 58, { tempoCeiling: 66 }),
      state('voice.pitch.echo', 45, { step: 1 }),
      state('voice.pitch.five-note', 48, { tempoCeiling: 63 }),
      state('voice.pitch.hold', 40, { step: 1 }),
      state('voice.interval.thirds', 28, { tempoCeiling: 56, attempts: 3 }),
      state('voice.range.slides', 35, { step: 1, attempts: 3 }),
    ],
    over: { lessonsDone: 10, lessonSkillIds: ['voice.pitch.match', 'voice.pitch.steps', 'voice.pitch.echo', 'voice.pitch.five-note', 'voice.pitch.hold', 'voice.interval.thirds', 'voice.range.slides'] },
  },
  // Has sung before and skipped the course: "Match a note" starts at the unlock line on its second step (§12.18).
  { name: 'skipped the course', states: [state('voice.pitch.match', UNLOCK_RATING, { step: 1, attempts: 0, lastPracticedAt: undefined })] },
  {
    // Everything open; some stored numbers are stale on purpose: a step past the end of a ladder, a tempo above the target, one far under the floor.
    name: 'far along',
    states: VOICE_SKILLS.map((s, i) => state(s.id, 62 + ((i * 7) % 30), { step: s.steps ? (i % 2 === 0 ? 9 : 1) : undefined, tempoCeiling: s.steps ? 0 : i % 2 === 0 ? 240 : 30, lastPracticedAt: NOW.getTime() - (1 + (i % 5)) * DAY })),
  },
]

const DAYS: { name: string; over: Partial<PlannerInput>; minutes?: Prefs['dailyMinutes']; afterPractice?: boolean }[] = [
  { name: 'first day', over: { daysSinceLastSession: undefined } },
  { name: 'a usual day', over: { daysSinceLastSession: 1 } },
  // Only someone who has practised can come back to it.
  { name: 'back after nine days', over: { daysSinceLastSession: 9 }, afterPractice: true },
  { name: 'weekly check', over: { daysSinceLastSession: 1, dueTest: 'checkpoint' } },
  // The day after "My voice is tired": ten minutes, nothing that stretches the range.
  { name: 'after a tired day', over: { daysSinceLastSession: 1, excludeCategories: ['range'] }, minutes: 10 },
]

describe('every plan of a singer', () => {
  const plans: { where: string; plan: SessionPlan; range: Range; singer: string; day: string; minutes: number; songs: boolean }[] = []
  for (const singer of SINGERS) {
    for (const day of DAYS) {
      if (day.afterPractice && singer.states.length === 0) continue
      for (const minutes of day.minutes ? [day.minutes] : ([10, 20, 30, 45] as const)) {
        for (const range of [LOWER, OCTAVE, WIDE]) {
          for (const library of [[], SONGS]) {
            const where = `${singer.name}, ${day.name}, ${minutes} min, ${range.high - range.low} semitones, ${library.length} songs`
            const plan = planSession(voiceInput(range, { model: model(singer.states), library, ...singer.over, ...day.over }, { dailyMinutes: minutes }))
            plans.push({ where, plan, range, singer: singer.name, day: day.name, minutes, songs: library.length > 0 })
          }
        }
      }
    }
  }

  it('can be sung as planned: right ids, right words, rounds of at most 8 bars and 6 rounds, tempos inside each skill, steps the range holds', () => {
    expect(plans.length).toBeGreaterThan(400)
    for (const { where, plan, range } of plans) expectSingable(plan, range, where)
  })

  it('holds because of what the Coach passes: planned without any one of the options, the same day breaks a rule', () => {
    // One singer for whom every rule matters: a first song still to come, a song with bars that went
    // badly, and a stored slide step from a day when the range was wider.
    const states = [state('voice.pitch.match', 70, { step: 2 }), state('voice.range.slides', 45, { step: 2 }), state('voice.pitch.steps', 50, { tempoCeiling: 60 })]
    const songItems = items(songItem(1, 1, { lastAccuracy: 0.5, bestAccuracy: 0.5, lowStreak: 1, weakBars: [2, 3] }))
    const day = (over: Partial<PlannerInput>) => () =>
      expectSingable(planSession(voiceInput(LOWER, { model: model(states, songItems), library: SONGS, daysSinceLastSession: 1, ...over }, { dailyMinutes: 30, pinnedSkillId: 'voice.range.slides' })), LOWER, 'a day')
    expect(day({})).not.toThrow()
    expect(day({ idPrefix: undefined })).toThrow()
    expect(day({ maxBars: undefined })).toThrow()
    expect(day({ songSpeeds: undefined })).toThrow()
    expect(day({ copy: undefined })).toThrow()
    expect(day({ loopWeakBars: undefined })).toThrow()
    expect(day({ maxSteps: undefined })).toThrow()
  })

  it('opens with a warm-up from the skills that wake a voice up, and lasts 10, 20 or 30 minutes', () => {
    let whole = 0
    for (const { where, plan, minutes } of plans) {
      const first = plan.blocks[0]
      expect(first.kind, where).toBe('warmup')
      expect(['pitch', 'range'], where).toContain(skillOf((first as ExerciseBlock).skillId).category)
      // Every day lasts its whole time, a day back after a break included: a singer who so far knows
      // only the very first skill recaps that one.
      expect(plan.minutes, where).toBe(Math.min(minutes, 30))
      whole++
    }
    expect(whole).toBe(plans.length)
  })

  it('leaves the range skills out on the day after a tired voice', () => {
    const tired = plans.filter((p) => p.day === 'after a tired day')
    expect(tired.length).toBeGreaterThan(20)
    for (const { where, plan } of tired) for (const b of exercisesOf(plan)) expect(skillOf(b.skillId).category, `${where}: ${b.skillId}`).not.toBe('range')
    // On a usual day the same singers do get them.
    expect(plans.filter((p) => p.day === 'a usual day').some((p) => exercisesOf(p.plan).some((b) => skillOf(b.skillId).category === 'range'))).toBe(true)
  })

  it('never warms up on the skill of the main exercise once two skills are open', () => {
    let apart = 0
    for (const { where, plan, singer } of plans) {
      const who = SINGERS.find((s) => s.name === singer)!
      const open = skillOpener(VOICE_SKILLS, openContextOf(model(who.states), NOW.getTime(), who.over?.lessonSkillIds))
      const focus = theBlock(plan, 'focus')
      if (!focus) continue
      const warm = theBlock(plan, 'warmup')
      if (VOICE_SKILLS.filter(open).length >= 2) {
        expect(warm.skillId, where).not.toBe(focus.skillId)
        apart++
      } else {
        // One skill open: there is nothing else to warm up on.
        expect([warm.skillId, focus.skillId], where).toEqual(['voice.pitch.match', 'voice.pitch.match'])
      }
    }
    expect(apart).toBeGreaterThan(200)
  })

  it('warms a step skill up one step easier than it is practised, and a tempo skill a little under its tempo but never under its floor', () => {
    // "Match a note" is on its third step: the warm-up is the second.
    const plan = planSession(voiceInput(WIDE, { model: model([state('voice.pitch.match', 66, { step: 2 })]), daysSinceLastSession: 1 }))
    expect(theBlock(plan, 'warmup')).toMatchObject({ skillId: 'voice.pitch.match', tempo: 60, params: { step: 1, startStep: 1 } })
    expect(theBlock(plan, 'focus').skillId).not.toBe('voice.pitch.match')
    // A singer whose "Step up and down" has slipped to 56, with another skill as the main exercise.
    const slowed = [state('voice.pitch.match', 70, { step: 2 }), state('voice.pitch.steps', 50, { tempoCeiling: 56 }), state('voice.pitch.hold', 30, { attempts: 4 })]
    const warm = theBlock(planSession(voiceInput(WIDE, { model: model(slowed), daysSinceLastSession: 1 }, { pinnedSkillId: 'voice.pitch.hold' })), 'warmup')
    // Nine tenths of 56 would be 50: "Step up and down" is never sung under 54.
    expect(warm).toMatchObject({ skillId: 'voice.pitch.steps', tempo: 54, params: { tempo: 54, minTempo: 54 } })
  })
})

describe('songs for a singer', () => {
  const songPlans = (songItems: Record<string, SongItemState>, over: Partial<PlannerInput> = {}, minutes: Prefs['dailyMinutes'] = 20) =>
    songsOf(planSession(voiceInput(LOWER, { model: model([state('voice.pitch.match', 30, { attempts: 3 })], songItems), library: SONGS, lessonsDone: 6, lessonSkillIds: ['voice.pitch.match'], ...over }, { dailyMinutes: minutes })))

  it('are at speed 1 for someone who has never sung, on the first day and on a day back after a break', () => {
    for (const daysSinceLastSession of [undefined, 1, 9, 40]) {
      for (const minutes of [10, 20, 30] as const) {
        const plan = planSession(voiceInput(LOWER, { library: SONGS, daysSinceLastSession }, { dailyMinutes: minutes }))
        const songs = songsOf(plan)
        expect(songs.length, `${daysSinceLastSession} days, ${minutes} min`).toBeGreaterThanOrEqual(1)
        for (const b of songs) expect(b.speed, `${daysSinceLastSession} days, ${minutes} min`).toBe(1)
      }
    }
  })

  it('stay at speed 1 whatever the last runs were like: after a hard run, after two, after a good one, on an easier day', () => {
    const histories: Record<string, SongItemState>[] = [
      items(songItem(1, 2, { lastAccuracy: 0.5, bestAccuracy: 0.5, lowStreak: 1 })),
      items(songItem(1, 2, { lastAccuracy: 0.4, bestAccuracy: 0.6, lowStreak: 2 })),
      items(songItem(1, 0, { lastAccuracy: 0.95, bestAccuracy: 0.95, fullSpeedBest: 0.95 })),
      items(songItem(1, 1, { lastAccuracy: 0.8, bestAccuracy: 0.8 }), songItem(2, 0, { lastAccuracy: 0.3, bestAccuracy: 0.3, lowStreak: 1, weakBars: [2, 3] })),
      // A stored speed from somewhere else never comes back as a speed to sing at.
      items(songItem(1, 2, { lastAccuracy: 0.9, bestAccuracy: 0.9, lastSpeed: 0.75 })),
    ]
    let planned = 0
    for (const history of histories) {
      for (const daysSinceLastSession of [1, 9]) {
        for (const minutes of [10, 20, 30] as const) {
          for (const b of songPlans(history, { daysSinceLastSession }, minutes)) {
            expect(b.speed, b.reason).toBe(1)
            expect(b.loopBars, b.reason).toBeUndefined()
            expect(b.reason, b.reason).not.toMatch(NOT_FOR_A_SINGER)
            planned++
          }
        }
      }
    }
    expect(planned).toBeGreaterThanOrEqual(30)
  })

  it('move by level instead: up after a good run, back after two hard ones', () => {
    const one = { daysSinceLastSession: 1, library: [SONGS[0]] }
    const up = songPlans(items(songItem(1, 0, { lastAccuracy: 0.95, bestAccuracy: 0.95, fullSpeedBest: 0.95 })), one, 10)
    expect(up).toHaveLength(1)
    expect(up[0]).toMatchObject({ songId: 1, level: 1, speed: 1 })
    const back = songPlans(items(songItem(1, 2, { lastAccuracy: 0.4, bestAccuracy: 0.6, lowStreak: 2 })), one, 10)
    expect(back[0]).toMatchObject({ songId: 1, level: 1, speed: 1 })
    // One hard run: the same level once more, at the same speed.
    const again = songPlans(items(songItem(1, 2, { lastAccuracy: 0.5, bestAccuracy: 0.5, lowStreak: 1 })), one, 10)
    expect(again[0]).toMatchObject({ songId: 1, level: 2, speed: 1 })
  })
})

/** A run of an exercise as the Coach records it: the params of the exercise travel with it. */
function runOf(ex: GeneratedExercise, hits: { perfects: number; goods?: number; misses?: number }, at: number, kind: Attempt['kind'] = 'practice'): Attempt {
  const goods = hits.goods ?? 0
  const misses = hits.misses ?? 0
  const result = { perfects: hits.perfects, goods, misses, total: hits.perfects + goods + misses, timingMedianMs: null, timingStdevMs: null, coverage: 1, durationSec: ex.chart.duration, playedTempo: ex.params.tempo, targetTempo: ex.params.tempo, speed: 1 }
  const performance = attemptPerformance(result)
  return { ...result, at, kind, skillId: ex.skillId, exerciseId: ex.id, params: ex.params, difficulty: ex.difficulty, performance: performance.p, accuracy: performance.acc, reliable: performance.reliable, instrument: 'voice' }
}
const cleanRun = (ex: GeneratedExercise, at: number, kind: Attempt['kind'] = 'practice') => runOf(ex, { perfects: ex.chart.notes.length }, at, kind)

describe('clean rounds on one step of a ladder', () => {
  /** Where the rating comes to rest when every round on one step is clean and the singer never moves on from it. */
  function restsAt(skill: SkillDef, step: number): number {
    const generatorId = skill.generators[0]
    const ex = generateExercise(skill, generatorId, exerciseParams(skill, generatorId, skill.startTempo, { ...WIDE, step, startStep: step }), DEFAULT_TUNING)
    expect(ex.params.step, `${skill.id} step ${step}`).toBe(step)
    let current: SkillState = { ...newSkillState(skill.id, 0), step }
    const history: Attempt[] = []
    for (let round = 0; round < 400; round++) {
      const run = cleanRun(ex, NOW.getTime() + round * 60_000)
      current = { ...applyAttempt(current, run, skill, history.slice(-10)), step }
      history.push(run)
    }
    return Math.round(current.rating * 10) / 10
  }
  const stops = (id: string) => skillOf(id).steps!.map((_, step) => restsAt(skillOf(id), step))

  it('carry the rating as far as the design works out, through the real exercises and the real rating', () => {
    // docs/SINGING.md §6, "Worked caps". The run carries its step and its difficulty from the generator;
    // were either missing, every step would stop where the first one does.
    expect(stops('voice.pitch.match')).toEqual([50, 62, 70, 100])
    expect(stops('voice.pitch.hold')).toEqual([60, 68, 76, 100])
    expect(stops('voice.breath.phrases')).toEqual([75, 82, 100])
  })

  it('carry it further on every step, and to the top only on the last', () => {
    for (const skill of VOICE_SKILLS.filter((s) => s.steps)) {
      const all = stops(skill.id)
      for (let i = 1; i < all.length; i++) expect(all[i], `${skill.id} step ${i}`).toBeGreaterThan(all[i - 1])
      expect(all[all.length - 1], skill.id).toBe(100)
      for (const stop of all.slice(0, -1)) expect(stop, skill.id).toBeLessThanOrEqual(BELOW_TARGET_RATING)
    }
  })

  it('on the first step of "Match a note" stop short of what opens the next skills, and on its second step get there', () => {
    // The one way on from the first skill is its second step: wider notes, judged a little more closely.
    const [first, second] = stops('voice.pitch.match')
    expect(first).toBeLessThan(UNLOCK_RATING)
    expect(second).toBeGreaterThanOrEqual(UNLOCK_RATING)
  })
})

describe('a voice with a small range', () => {
  const span = LOWER.high - LOWER.low

  it('stops below the last step of the slides and of the bigger jumps', () => {
    expect(span).toBe(MIN_RANGE_SPAN)
    const reach = maxStepsFor(LOWER)
    for (const id of ['voice.range.slides', 'voice.interval.leaps']) {
      expect(reach[id], id).toBe(1)
      expect(reach[id], id).toBeLessThan(skillOf(id).steps!.length - 1)
    }
    // No other ladder is cut short.
    for (const s of VOICE_SKILLS.filter((x) => x.steps && !['voice.range.slides', 'voice.interval.leaps'].includes(x.id))) expect(reach[s.id], s.id).toBe(s.steps!.length - 1)
  })

  it.each(['voice.range.slides', 'voice.interval.leaps'])('plans %s no higher than that step, and clean rounds there still carry the rating to 100', (id) => {
    const skill = skillOf(id)
    // Everything under the skill is solid; the stored step is from a day when the range was wider.
    const states = VOICE_SKILLS.map((s) => state(s.id, s.id === id ? 60 : 85, { step: s.steps ? s.steps.length - 1 : undefined, tempoCeiling: s.steps ? 0 : s.targetTempo }))
    const plan = planSession(voiceInput(LOWER, { model: model(states), daysSinceLastSession: 1 }, { pinnedSkillId: id }))
    const block = theBlock(plan, 'focus')
    expect(block.skillId).toBe(id)
    expect(block.params).toMatchObject({ step: 1, startStep: 1, maxStep: 1 })
    const ex = exerciseFor(block, LOWER)
    expect(ex.params).toMatchObject({ step: 1, maxStep: 1 })

    let current: SkillState = { ...newSkillState(id, 60), step: 1 }
    const history: Attempt[] = []
    let rounds = 0
    while (current.rating < 100 && rounds < 200) {
      const run = cleanRun(ex, NOW.getTime() + rounds * 60_000)
      current = applyAttempt(current, run, skill, history.slice(-10))
      history.push(run)
      rounds++
    }
    expect(current.rating).toBe(100)
    // The step never passes what the range holds.
    expect(current.step).toBe(1)

    // The same clean rounds on the same step in a range that holds the whole ladder stop short of
    // "mastered": there the step is not the top, and the limit on the run is what tells the two apart.
    const wideBlock = theBlock(planSession(voiceInput(WIDE, { model: model(states.map((s) => (s.skillId === id ? { ...s, step: 1 } : s))), daysSinceLastSession: 1 }, { pinnedSkillId: id })), 'focus')
    expect(wideBlock.params.step).toBe(1)
    expect('maxStep' in wideBlock.params).toBe(false)
    const wideEx = exerciseFor(wideBlock, WIDE)
    let held: SkillState = { ...newSkillState(id, 60), step: 1 }
    for (let i = 0; i < 200; i++) held = { ...applyAttempt(held, cleanRun(wideEx, NOW.getTime() + i * 60_000), skill, []), step: 1 }
    expect(held.rating).toBeLessThanOrEqual(BELOW_TARGET_RATING)
    expect(held.rating).toBeGreaterThan(60)
  })

  it('honours a range made smaller since the plan was made: the round is built on the step that still fits and is rated as that step', () => {
    const skill = skillOf('voice.range.slides')
    const states = VOICE_SKILLS.map((s) => state(s.id, s.id === skill.id ? 70 : 85, { step: s.steps ? s.steps.length - 1 : undefined, tempoCeiling: s.steps ? 0 : s.targetTempo }))
    // Planned for a range with an octave of room...
    const block = theBlock(planSession(voiceInput(OCTAVE, { model: model(states), daysSinceLastSession: 1 }, { pinnedSkillId: skill.id })), 'focus')
    expect(block.params.step).toBe(2)
    expect('maxStep' in block.params).toBe(false)
    // ...and sung after "a bit lower" took a semitone off the top.
    const smaller = { ...OCTAVE, high: OCTAVE.high - 1 }
    const ex = exerciseFor(block, smaller)
    expect(ex.params).toMatchObject({ step: 1, maxStep: 1, high: smaller.high })
    for (const n of ex.chart.notes) expect(n.midi).toBeLessThanOrEqual(smaller.high)
    const after = applyAttempt({ ...newSkillState(skill.id, 99.5), step: 2 }, cleanRun(ex, NOW.getTime()), skill, [])
    expect(after.rating).toBe(100)
  })
})

describe('a singer who sings every round cleanly', () => {
  /** Practises day after day the way the block runner does: every round built for the range, rated, and followed by the next step or tempo. */
  function practise(range: Range, days: number, minutes: Prefs['dailyMinutes']) {
    let learner = model()
    const history: Record<string, Attempt[]> = {}
    const practiceDays: Record<string, number> = {}
    let recentFocus: string[] = []
    const firstDay: Record<string, number> = {}
    for (let day = 0; day < days; day++) {
      const now = new Date(NOW.getTime() + day * DAY)
      const where = `day ${day}, ${range.high - range.low} semitones`
      let plan = planSession(voiceInput(range, { model: learner, now, daysSinceLastSession: day === 0 ? undefined : 1, practiceDays, recentFocusSkillIds: recentFocus }, { dailyMinutes: minutes }))
      expectSingable(plan, range, where)
      const open = VOICE_SKILLS.filter(skillOpener(VOICE_SKILLS, openContextOf(learner, now.getTime())))
      const focus = theBlock(plan, 'focus')
      if (open.length >= 2) expect(theBlock(plan, 'warmup').skillId, where).not.toBe(focus.skillId)
      const sung = new Set<string>()
      for (const planned of exercisesOf(plan)) {
        const block = exercisesOf(plan).find((b) => b.id === planned.id)!
        const skill = skillOf(block.skillId)
        let tempo = block.tempo
        let step = block.params.step as number | undefined
        let last: Attempt | undefined
        for (let rep = 0; rep < block.reps; rep++) {
          const ex = exerciseFor({ ...block, tempo }, range, step === undefined ? {} : { step })
          for (const n of ex.chart.notes) expect(n.midi >= range.low && n.midi <= range.high, `${where}: ${skill.id}`).toBe(true)
          const run = cleanRun(ex, now.getTime() + rep * 60_000, block.kind === 'warmup' ? 'warmup' : block.kind === 'review' ? 'review' : 'practice')
          learner = applyToModel(learner, run, skill, history[skill.id] ?? [])
          history[skill.id] = [...(history[skill.id] ?? []), run].slice(-10)
          last = run
          if (skill.steps) step = nextRepStep(step ?? 0, run.accuracy, block.params.startStep as number, typeof block.params.maxStep === 'number' ? block.params.maxStep : skill.steps.length - 1)
          else tempo = nextRepTempo(tempo, run.accuracy, block.params.startTempo as number, skill.targetTempo, false, skill.minTempo)
        }
        sung.add(skill.id)
        firstDay[skill.id] ??= day
        if (last) plan = adaptAfterBlock(plan, block.id, last, attemptPerformance(last), VOICE_SKILLS)
      }
      for (const id of sung) practiceDays[id] = (practiceDays[id] ?? 0) + 1
      recentFocus = [focus.skillId, ...recentFocus].slice(0, 3)
    }
    return { learner, firstDay }
  }

  it.each([
    ['the smallest range', LOWER],
    ['the widest range', WIDE],
  ])('meets all twelve skills in an order that never skips what a skill is built on, and finishes every one, in %s', (_name, range) => {
    const { learner, firstDay } = practise(range, 90, 20)
    for (const skill of VOICE_SKILLS) {
      expect(firstDay[skill.id], `${skill.id} was never practised`).toBeDefined()
      for (const p of skill.prerequisites) expect(firstDay[p], `${skill.id} before ${p}`).toBeLessThanOrEqual(firstDay[skill.id])
      const reached = learner.skills[skill.id]
      expect(reached.rating, skill.id).toBe(100)
      if (skill.steps) expect(reached.step, skill.id).toBe(maxStepFor(skill, range))
      else expect(reached.tempoCeiling, skill.id).toBe(skill.targetTempo)
    }
    // The first days belong to the one skill everything is built on.
    expect(firstDay['voice.pitch.match']).toBe(0)
    expect(Object.values(firstDay).filter((d) => d === 0)).toHaveLength(1)
  })
})
