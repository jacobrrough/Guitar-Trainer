/**
 * Daily session planner (docs §6, §8). Pure functions over plain data: everything the planner needs
 * (skills, library, effective-rating function) is injected through PlannerInput.
 */
import type {
  Attempt,
  Block,
  ExerciseBlock,
  Goal,
  LearnerModel,
  Performance,
  Prefs,
  SessionPlan,
  SkillCategory,
  SkillDef,
  SkillState,
  SongBlock,
  SongItemState,
  SongSummary,
  TestBlock,
  TestType,
} from './types'
import {
  BAND_THRESHOLDS,
  CHECKPOINT_MINUTES,
  COMEBACK_AFTER_DAYS,
  COMEBACK_TEMPO_FACTOR,
  DAY_FACTOR_BY_WARMUP,
  FOCUS_REPEAT_LIMIT_DAYS,
  GOAL_WEIGHT_ALL_ROUND,
  GOAL_WEIGHT_MATCH,
  GOAL_WEIGHT_OTHER,
  MAX_SESSION_TEMPO_GAIN,
  MONTHLY_MINUTES,
  PLACEMENT_MINUTES,
  REP_DOWN_ACCURACY,
  REP_TEMPO_DOWN,
  REP_TEMPO_UP,
  REP_UP_ACCURACY,
  SESSION_TEMPLATES,
  SONG_LEVEL_UP_ACCURACY,
  SONG_SLOW_DOWN_ACCURACY,
  SONG_TARGET_ACCURACY,
  START_TEMPO_FACTOR,
  UNLOCK_RATING,
} from './constants'

export interface PlannerInput {
  model: LearnerModel
  skills: SkillDef[]
  library: SongSummary[]
  prefs: Prefs
  now: Date
  /** A test that is due today, if any (decided elsewhere). */
  dueTest?: TestType | null
  /** Focus skill ids used on the previous two sessions, most recent first. */
  recentFocusSkillIds?: string[]
  /** Days since the last completed session; undefined = first session ever. */
  daysSinceLastSession?: number
  /** Quick 5-minute session: a single focus block. */
  quick?: boolean
  /** Effective-rating function (rust rule) injected from the learner module. */
  effectiveRating?: (state: SkillState, now: number) => number
}

const DAY_MS = 86_400_000
const QUICK_MINUTES = 5
const MIN_TEMPO = 40
const WARMUP_TEMPO_FACTOR = 0.9
const WARMUP_MIN_TEMPO = 40
const MASTERED_RATING = 90
const REVIEW_RUST_RATING = 75
const SLOW_SONG_SPEED = 0.85
const DEFAULT_SONG_LEVEL = 2
const DEFAULT_MAX_LEVEL = 5
const EXERCISE_BARS = 4
const RECENCY_CAP_DAYS = 7
const READINESS_MIN = 0.6
const READINESS_MAX = 1.0
const REPS = { focus: 3, second: 3, review: 2, warmup: 1, ear: 2 } as const

const GOAL_CATEGORIES: Record<Exclude<Goal, 'all-round'>, SkillCategory[]> = {
  songs: ['chords', 'picking'],
  rhythm: ['picking', 'timing', 'chords'],
  lead: ['lead'],
  technique: ['fretting', 'picking', 'timing'],
}

type ExerciseKind = ExerciseBlock['kind']

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function bandOf(rating: number): string {
  return (BAND_THRESHOLDS.find((b) => rating >= b.min) ?? BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1]).band
}

function daysAgoText(state: SkillState | undefined, nowMs: number): string {
  if (!state?.lastPracticedAt) return 'not practised yet'
  const d = Math.max(0, Math.floor((nowMs - state.lastPracticedAt) / DAY_MS))
  if (d === 0) return 'last practised today'
  return `last practised ${d} day${d === 1 ? '' : 's'} ago`
}

function goalWeight(skill: SkillDef, prefs: Prefs): number {
  if (prefs.goals.length === 0 || prefs.goals.includes('all-round')) return GOAL_WEIGHT_ALL_ROUND
  const match = prefs.goals.some((g) => g !== 'all-round' && GOAL_CATEGORIES[g].includes(skill.category))
  return match ? GOAL_WEIGHT_MATCH : GOAL_WEIGHT_OTHER
}

/** priority = goalWeight × (1 − r/100) × recency × readiness (docs §6.3). */
export function focusPriority(
  skill: SkillDef,
  state: SkillState | undefined,
  prefs: Prefs,
  now: number,
  ratings: Record<string, number>,
): number {
  const r = ratings[skill.id] ?? state?.rating ?? 0
  const days = state?.lastPracticedAt ? Math.max(0, (now - state.lastPracticedAt) / DAY_MS) : Infinity
  const recency = 1 + Math.min(days, RECENCY_CAP_DAYS) / RECENCY_CAP_DAYS
  let readiness = READINESS_MAX
  if (skill.prerequisites.length > 0) {
    const mean = skill.prerequisites.reduce((s, p) => s + (ratings[p] ?? 0), 0) / skill.prerequisites.length
    readiness = clamp(mean / 100, READINESS_MIN, READINESS_MAX)
  }
  return goalWeight(skill, prefs) * (1 - r / 100) * recency * readiness
}

/** Tempo for the next rep (docs §6.4). */
export function nextRepTempo(currentTempo: number, accuracy: number, sessionStartTempo: number): number {
  let t = currentTempo
  if (accuracy >= REP_UP_ACCURACY) {
    const cap = sessionStartTempo * (1 + MAX_SESSION_TEMPO_GAIN)
    t = Math.min(currentTempo * (1 + REP_TEMPO_UP), Math.max(cap, currentTempo))
  } else if (accuracy < REP_DOWN_ACCURACY) {
    t = currentTempo * (1 - REP_TEMPO_DOWN)
  }
  return Math.max(MIN_TEMPO, Math.round(t))
}

/** Picks the song, level, speed and loop range for a song block. `levelOffset` shifts the level (comeback = -1). */
export function pickSongBlock(
  library: SongSummary[],
  songItems: Record<string, SongItemState>,
  minutes: number,
  levelOffset = 0,
): SongBlock | null {
  if (library.length === 0) return null
  const itemsOf = (songId: number): SongItemState[] => Object.values(songItems).filter((i) => i.songId === songId)
  const lastActivity = (songId: number): number => itemsOf(songId).reduce((m, i) => Math.max(m, i.lastAt ?? -1), -1)

  let song = library[0]
  let best = lastActivity(song.id)
  for (const s of library) {
    const a = lastActivity(s.id)
    if (a > best) {
      best = a
      song = s
    }
  }
  const items = itemsOf(song.id)
  const byLevel = new Map<number, SongItemState>()
  for (const i of items) byLevel.set(i.level, i)
  const maxLevel = Math.max(0, (song.levelNoteCounts.length || DEFAULT_MAX_LEVEL + 1) - 1)

  const played = items.filter((i) => i.bestAccuracy !== null).map((i) => i.level).sort((a, b) => a - b)
  const passed = played.filter((l) => (byLevel.get(l)?.bestAccuracy ?? 0) >= SONG_TARGET_ACCURACY)
  let level: number
  let why: string
  if (passed.length > 0) {
    level = passed[passed.length - 1]
    why = `Level ${level + 1} is cleared`
    if ((byLevel.get(level)?.bestAccuracy ?? 0) >= SONG_LEVEL_UP_ACCURACY) {
      level += 1
      why = `Level ${level} scored over ${Math.round(SONG_LEVEL_UP_ACCURACY * 100)} %, so stepping up`
    }
  } else if (played.length > 0) {
    level = played[0]
    why = `Level ${level + 1} is not yet at ${Math.round(SONG_TARGET_ACCURACY * 100)} %`
  } else {
    level = DEFAULT_SONG_LEVEL
    why = 'Nothing played yet, starting at a medium level'
  }
  level = clamp(level + levelOffset, 0, maxLevel)
  if (levelOffset < 0) why += ' (one level easier today)'

  const item = byLevel.get(level)
  const acc = item?.bestAccuracy ?? null
  const speed = acc !== null && acc < SONG_SLOW_DOWN_ACCURACY ? SLOW_SONG_SPEED : 1
  const block: SongBlock = {
    id: '',
    kind: 'song',
    status: 'pending',
    minutes,
    songId: song.id,
    level,
    speed,
    reason: `${song.title}: ${why}${speed < 1 ? `; slowed to ${Math.round(speed * 100)} % speed` : ''}.`,
  }
  if (item && item.weakBars.length > 0) {
    block.loopBars = [Math.min(...item.weakBars), Math.max(...item.weakBars)]
    block.reason += ` Loops bars ${block.loopBars[0]}-${block.loopBars[1]} first.`
  }
  return block
}

function startTempoOf(skill: SkillDef, state: SkillState | undefined): number {
  return state && state.tempoCeiling > 0 ? state.tempoCeiling * START_TEMPO_FACTOR : skill.startTempo
}

function makeExercise(
  kind: ExerciseKind,
  skill: SkillDef,
  minutes: number,
  tempo: number,
  reason: string,
): ExerciseBlock {
  return {
    id: '',
    kind,
    status: 'pending',
    minutes,
    skillId: skill.id,
    generatorId: skill.generators[0] ?? '',
    params: { tempo, bars: EXERCISE_BARS, startTempo: tempo },
    tempo,
    reps: REPS[kind],
    reason,
  }
}

function reviewTempo(skill: SkillDef, state: SkillState | undefined, dayFactor: number): number {
  const base = state && state.tempoCeiling > 0 ? state.tempoCeiling : skill.startTempo
  return Math.max(MIN_TEMPO, Math.round(base * dayFactor))
}

function pickWarmupSkill(skills: SkillDef[]): SkillDef | undefined {
  const pool = skills.filter((s) => s.tier === 1 && (s.category === 'fretting' || s.category === 'timing'))
  const byName = (word: string) => pool.find((s) => s.id.includes(word))
  return byName('chromatic') ?? byName('metronome') ?? pool[0] ?? skills.find((s) => s.tier === 1)
}

interface Draft {
  kind: BlockKindDraft
  minutes: number
  block?: Block
}
type BlockKindDraft = Block['kind']

function rebalance(drafts: Draft[], target: number): void {
  const sum = () => drafts.reduce((s, d) => s + d.minutes, 0)
  while (sum() > target) {
    const cand = drafts.filter((d) => d.kind !== 'test' && d.kind !== 'warmup' && d.minutes > 1)
    if (cand.length === 0) break
    cand.sort((a, b) => b.minutes - a.minutes)
    cand[0].minutes -= 1
  }
  const sink = drafts.find((d) => d.kind === 'focus') ?? drafts.find((d) => d.kind !== 'test')
  if (sink) while (sum() < target) sink.minutes += 1
}

export function planSession(input: PlannerInput): SessionPlan {
  const { model, skills, library, prefs, now } = input
  const nowMs = now.getTime()
  const date = localDate(now)
  const comeback = input.daysSinceLastSession !== undefined && input.daysSinceLastSession >= COMEBACK_AFTER_DAYS
  const dayFactor = comeback ? COMEBACK_TEMPO_FACTOR : 1
  const explanation: string[] = []

  const finish = (blocks: Block[], factor: number): SessionPlan => {
    const out = blocks.map((b, i) => ({ ...b, id: `${date}-${i}-${b.kind}` }) as Block)
    return { date, minutes: out.reduce((s, b) => s + b.minutes, 0), dayFactor: factor, blocks: out, explanation: explanation.slice(0, 6) }
  }

  if (input.dueTest === 'placement' && !input.quick && !comeback) {
    explanation.push('First session: a short placement test sets your starting levels.')
    const test: TestBlock = {
      id: '',
      kind: 'test',
      status: 'pending',
      minutes: PLACEMENT_MINUTES,
      test: 'placement',
      reason: 'Placement test to find your starting level on each skill.',
    }
    explanation.push('Training sessions with warm-up, focus and songs start after it.')
    explanation.push('You can stop the test at any time; skipped skills start from the beginning.')
    return finish([test], 1)
  }

  const stateOf = (id: string): SkillState | undefined => model.skills[id]
  const ratings: Record<string, number> = {}
  const rawRatings: Record<string, number> = {}
  for (const s of skills) {
    const st = stateOf(s.id)
    rawRatings[s.id] = st ? st.rating : 0
    ratings[s.id] = st ? (input.effectiveRating ? input.effectiveRating(st, nowMs) : st.rating) : 0
  }
  const skillById = new Map(skills.map((s) => [s.id, s]))
  const unlocked = (s: SkillDef) => s.prerequisites.every((p) => (ratings[p] ?? 0) >= UNLOCK_RATING)
  const unlockedSkills = skills.filter(unlocked)
  let candidates = unlockedSkills.filter((s) => ratings[s.id] < MASTERED_RATING)
  if (candidates.length === 0) candidates = unlockedSkills
  const priority = (s: SkillDef) => focusPriority(s, stateOf(s.id), prefs, nowMs, ratings)
  const ranked = [...candidates].sort((a, b) => priority(b) - priority(a))

  // Focus selection
  const recent = input.recentFocusSkillIds ?? []
  const repeated = (id: string) =>
    recent.length >= FOCUS_REPEAT_LIMIT_DAYS && recent.slice(0, FOCUS_REPEAT_LIMIT_DAYS).every((r) => r === id)
  const pinned = prefs.pinnedSkillId ? skillById.get(prefs.pinnedSkillId) : undefined
  let focus: SkillDef | undefined
  let focusNote = ''
  if (pinned && unlocked(pinned)) {
    focus = pinned
    focusNote = 'pinned by you'
  } else {
    focus = ranked.find((s) => !repeated(s.id)) ?? ranked[0]
    focusNote = ranked[0] && focus && ranked[0].id !== focus.id ? 'next in line, to rotate focus' : 'top priority for your goals'
  }

  const focusReason = (skill: SkillDef, note: string): string => {
    const st = stateOf(skill.id)
    const r = Math.round(ratings[skill.id] ?? 0)
    const ceil = st && st.tempoCeiling > 0 ? ` Tempo ceiling ${Math.round(st.tempoCeiling)} bpm.` : ''
    return `Rated ${r} (${bandOf(r)}), ${note}; ${daysAgoText(st, nowMs)}.${ceil}`
  }

  const mkFocusLike = (kind: 'focus' | 'second', skill: SkillDef, minutes: number, note: string): ExerciseBlock => {
    const tempo = Math.max(MIN_TEMPO, Math.round(startTempoOf(skill, stateOf(skill.id)) * dayFactor))
    return makeExercise(kind, skill, minutes, tempo, focusReason(skill, note))
  }

  // Quick session
  if (input.quick) {
    explanation.push('Quick session: one focused block.')
    if (!focus) return finish([], dayFactor)
    explanation.push(`Focus: ${focus.name} (${focusNote}).`)
    if (comeback) explanation.push('Welcome back after a break: tempos are eased.')
    return finish([mkFocusLike('focus', focus, QUICK_MINUTES, focusNote)], dayFactor)
  }

  const tpl = SESSION_TEMPLATES[prefs.dailyMinutes]
  const warmSkill = pickWarmupSkill(skills)
  const mkWarmup = (minutes: number): ExerciseBlock | null => {
    if (!warmSkill) return null
    const st = stateOf(warmSkill.id)
    const base = st && st.tempoCeiling > 0 ? st.tempoCeiling : warmSkill.startTempo
    const tempo = Math.max(WARMUP_MIN_TEMPO, Math.round(WARMUP_TEMPO_FACTOR * base))
    return makeExercise('warmup', warmSkill, minutes, tempo, "Warm-up sets today's tempo")
  }

  // Comeback session
  if (comeback) {
    const drafts: Block[] = []
    const w = mkWarmup(tpl.warmup || 1)
    if (w) drafts.push(w)
    const strongest = [...skills]
      .filter((s) => stateOf(s.id))
      .sort((a, b) => ratings[b.id] - ratings[a.id] || a.tier - b.tier)
      .slice(0, 2)
    const total = prefs.dailyMinutes
    const song = pickSongBlock(library, model.songItems, tpl.song, -1)
    const songMin = song ? tpl.song : 0
    const pool = Math.max(strongest.length, total - (w ? w.minutes : 0) - songMin)
    strongest.forEach((s, i) => {
      const share = Math.floor(pool / strongest.length) + (i < pool % strongest.length ? 1 : 0)
      const st = stateOf(s.id)
      const r = Math.round(ratings[s.id])
      drafts.push(
        makeExercise(
          'review',
          s,
          share,
          reviewTempo(s, st, dayFactor),
          `Rated ${r} (${bandOf(r)}), one of your strongest skills; ${daysAgoText(st, nowMs)}.`,
        ),
      )
    })
    if (song) drafts.push(song)
    explanation.push(`Welcome back after ${input.daysSinceLastSession} days away: an easy day to shake off the rust.`)
    explanation.push(`Tempos are ${Math.round((1 - COMEBACK_TEMPO_FACTOR) * 100)} % lower and no tests today.`)
    if (strongest.length > 0) explanation.push(`Reviewing your strongest skills: ${strongest.map((s) => s.name).join(', ')}.`)
    if (song) explanation.push(`Song one level easier than usual (level ${song.level + 1}).`)
    return finish(drafts, dayFactor)
  }

  // Regular session
  const inPlan = new Set<string>()
  const drafts: Draft[] = []
  const push = (kind: BlockKindDraft, minutes: number, block?: Block) => drafts.push({ kind, minutes, block })

  const warm = tpl.warmup > 0 ? mkWarmup(tpl.warmup) : null
  let extra = tpl.warmup > 0 && !warm ? tpl.warmup : 0
  if (warm) inPlan.add(warm.skillId)
  const monthly = input.dueTest === 'monthly'
  const checkpoint = input.dueTest === 'checkpoint'

  let second: SkillDef | undefined
  if (tpl.second > 0 && focus) second = ranked.find((s) => s.id !== focus.id && s.category !== focus.category)
  if (tpl.second > 0 && !second) extra += tpl.second
  if (focus) inPlan.add(focus.id)
  if (second) inPlan.add(second.id)

  const song = tpl.song > 0 ? pickSongBlock(library, model.songItems, tpl.song) : null
  if (tpl.song > 0 && !song) extra += tpl.song

  let ear: SkillDef | undefined
  if (tpl.ear > 0) {
    ear = unlockedSkills.find((s) => s.category === 'ear' && !inPlan.has(s.id))
    if (!ear) extra += tpl.ear
  }

  const testBlock = (test: TestType, minutes: number): TestBlock => ({
    id: '',
    kind: 'test',
    status: 'pending',
    minutes,
    test: test as TestBlock['test'],
    reason: test === 'monthly' ? 'Monthly assessment of your progress.' : 'Weekly checkpoint to confirm recent gains.',
  })

  if (warm) push('warmup', warm.minutes, warm)
  if (monthly) {
    push('test', MONTHLY_MINUTES, testBlock('monthly', MONTHLY_MINUTES))
  } else {
    if (focus) push('focus', tpl.focus + extra, mkFocusLike('focus', focus, tpl.focus + extra, focusNote))
    if (second) {
      if (checkpoint) push('test', CHECKPOINT_MINUTES, testBlock('checkpoint', CHECKPOINT_MINUTES))
      else push('second', tpl.second, mkFocusLike('second', second, tpl.second, 'next best skill from a different area'))
    }
  }
  if (song) push('song', tpl.song, song)

  // Review block
  const reviewMinutes = tpl.review
  const needReview = reviewMinutes > 0 && !(checkpoint && !second)
  if (needReview) {
    const pool = skills.filter((s) => stateOf(s.id) && !inPlan.has(s.id))
    const due = pool
      .filter((s) => (stateOf(s.id)?.nextReviewAt ?? Infinity) <= nowMs)
      .sort((a, b) => (stateOf(a.id)?.nextReviewAt ?? 0) - (stateOf(b.id)?.nextReviewAt ?? 0))[0]
    const rustOf = (s: SkillDef) => rawRatings[s.id] - ratings[s.id]
    const rusty = pool
      .filter((s) => rawRatings[s.id] >= REVIEW_RUST_RATING && rustOf(s) > 0)
      .sort((a, b) => rustOf(b) - rustOf(a))[0]
    const strong = [...skills.filter((s) => !inPlan.has(s.id))].sort((a, b) => ratings[b.id] - ratings[a.id] || a.tier - b.tier)[0]
    const pick = due ?? rusty ?? strong
    if (pick) {
      const st = stateOf(pick.id)
      const r = Math.round(ratings[pick.id])
      const why = due
        ? 'review is due'
        : rusty
          ? `rust has cost ${Math.round(rustOf(pick))} points`
          : 'keeping a strong skill fresh'
      const reason = `Rated ${r} (${bandOf(r)}), ${why}; ${daysAgoText(st, nowMs)}.`
      push('review', reviewMinutes, makeExercise('review', pick, reviewMinutes, reviewTempo(pick, st, dayFactor), reason))
    } else {
      const sink = drafts.find((d) => d.kind === 'focus')
      if (sink) sink.minutes += reviewMinutes
    }
  } else if (reviewMinutes > 0) {
    // checkpoint replaces the review block when there is no second block
    push('test', CHECKPOINT_MINUTES, testBlock('checkpoint', CHECKPOINT_MINUTES))
  }
  if (ear) {
    const st = stateOf(ear.id)
    const reason = `Ear training: ${ear.name}; ${daysAgoText(st, nowMs)}.`
    push('ear', tpl.ear, makeExercise('ear', ear, tpl.ear, reviewTempo(ear, st, dayFactor), reason))
  }
  if (checkpoint && !drafts.some((d) => d.kind === 'test')) {
    push('test', CHECKPOINT_MINUTES, testBlock('checkpoint', CHECKPOINT_MINUTES))
  }

  const target = prefs.dailyMinutes
  rebalance(drafts, target)
  const blocks = drafts.map((d) => ({ ...(d.block as Block), minutes: d.minutes }) as Block)

  if (monthly) explanation.push('Monthly assessment today: it replaces the focus and second blocks.')
  else if (focus) explanation.push(`Focus: ${focus.name} (${focusNote}).`)
  if (second && !checkpoint && !monthly) explanation.push(`Second skill: ${second.name}, from a different area.`)
  if (song) explanation.push(song.reason)
  else explanation.push('No songs in your library yet, so that time goes to practice.')
  if (checkpoint) explanation.push('A weekly checkpoint is due and is part of today.')
  if (input.daysSinceLastSession === undefined) explanation.push('First session: starting gently.')
  return finish(blocks, dayFactor)
}

function isExercise(b: Block): b is ExerciseBlock {
  return b.kind !== 'song' && b.kind !== 'test'
}

function dayFactorFor(acc: number): number {
  return (DAY_FACTOR_BY_WARMUP.find((r) => acc >= r.minAcc) ?? DAY_FACTOR_BY_WARMUP[DAY_FACTOR_BY_WARMUP.length - 1]).factor
}

function withTempo(b: ExerciseBlock, tempo: number, startTempo: number): ExerciseBlock {
  return { ...b, tempo, params: { ...b.params, tempo, startTempo } }
}

/** Marks a block done and adapts the remaining pending blocks (docs §6.4). Returns a new plan. */
export function adaptAfterBlock(plan: SessionPlan, blockId: string, attempt: Attempt, performance: Performance): SessionPlan {
  void attempt
  const done = plan.blocks.find((b) => b.id === blockId)
  if (!done) return { ...plan, blocks: plan.blocks.map((b) => ({ ...b })), explanation: [...plan.explanation] }

  let dayFactor = plan.dayFactor
  const isWarmup = done.kind === 'warmup'
  if (isWarmup) dayFactor = dayFactorFor(performance.acc)
  const ratio = plan.dayFactor > 0 ? dayFactor / plan.dayFactor : 1

  const blocks = plan.blocks.map((b): Block => {
    if (b.id === blockId) return { ...b, status: 'done' }
    if (!isExercise(b) || b.status !== 'pending') return { ...b }
    const start = typeof b.params.startTempo === 'number' ? b.params.startTempo : b.tempo
    if (isWarmup) {
      return withTempo(b, Math.round(b.tempo * ratio), Math.round(start * ratio))
    }
    if (isExercise(done) && b.skillId === done.skillId) {
      return withTempo(b, nextRepTempo(b.tempo, performance.acc, start), start)
    }
    return { ...b }
  })

  return { ...plan, dayFactor, blocks, explanation: [...plan.explanation] }
}
