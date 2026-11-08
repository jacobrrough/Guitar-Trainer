import {
  CALIBRATION_MAX_AGE_DAYS,
  CHECKPOINT_MIN_DAYS,
  CHECKPOINT_MIN_SESSIONS,
  GOOD_HIT_WEIGHT,
  MIN_HITS_FOR_TIMING,
  MONTHLY_MIN_DAYS,
  PLACEMENT_INHERIT_OFFSET,
  PLACEMENT_PASS_OFFSET,
  PLACEMENT_STOP_AFTER_FAILS,
  TEST_PASS,
  UNLOCK_RATING,
} from './constants'
import { itemDifficulty } from './difficulty'
import type {
  Attempt,
  AttemptResult,
  ExerciseParams,
  LearnerModel,
  NoteValue,
  PassCriteria,
  Profile,
  SkillDef,
  SkillState,
  SongSummary,
  TestReport,
  TestTask,
  TestTaskResult,
  TestType,
} from './types'

const DAY_MS = 86_400_000

export type ApplyAttemptFn = (state: SkillState, attempt: Attempt, skill: SkillDef) => SkillState

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const round1 = (x: number) => Math.round(x * 10) / 10

function newState(skillId: string, rating: number): SkillState {
  return { skillId, rating, confidence: 1, tempoCeiling: 0, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 0 }
}

/** Bars (even count, min 2) that fill roughly 35 s at the tempo. */
function barsFor(tempo: number): number {
  const bars = (35 * tempo) / 240
  return Math.max(2, Math.round(bars / 2) * 2)
}

interface LadderSpec {
  title: string
  instructions: string
  skillIds: string[]
  generatorId: string
  params: { tempo: number; [extra: string]: unknown }
  techniques?: number
  bonus?: number
}

const LADDER: LadderSpec[] = [
  {
    title: 'Single-string melody',
    instructions: 'Play the melody on one string.',
    skillIds: ['fret.single-string'],
    generatorId: 'melody',
    params: { tempo: 70, noteValue: 'quarter', position: 0, key: 'E', strings: 1 },
  },
  {
    title: 'Open-position melody',
    instructions: 'Play the melody across the strings in open position.',
    skillIds: ['fret.cross-string'],
    generatorId: 'melody',
    params: { tempo: 70, noteValue: 'quarter', position: 0, key: 'E', strings: 3 },
  },
  {
    title: 'Em - Am - D changes',
    instructions: 'Change chords on time, two beats each.',
    skillIds: ['chord.open', 'chord.changes-open'],
    generatorId: 'chordChanges',
    params: { tempo: 60, noteValue: 'quarter', chords: ['Em', 'Am', 'D'], beatsPerChord: 2 },
  },
  {
    title: 'Power-chord riff',
    instructions: 'Play the power-chord riff in eighth notes with downstrokes.',
    skillIds: ['chord.power', 'pick.downstrokes'],
    generatorId: 'powerChordRiff',
    params: { tempo: 90, noteValue: 'eighth', key: 'E' },
  },
  {
    title: 'Pentatonic box 1',
    instructions: 'Play A minor pentatonic box 1 in eighth notes, alternate picking.',
    skillIds: ['lead.pent-box1', 'pick.alternate-8'],
    generatorId: 'scaleRun',
    params: { tempo: 80, noteValue: 'eighth', key: 'A', box: 1 },
  },
  {
    title: 'Alternate-picked sixteenths',
    instructions: 'Play the chromatic pattern in sixteenth notes, strictly alternate picked.',
    skillIds: ['pick.alternate-16'],
    generatorId: 'chromatic',
    params: { tempo: 70, noteValue: 'sixteenth' },
  },
  {
    title: 'F - C barre changes',
    instructions: 'Change between the F and C barre shapes on time.',
    skillIds: ['chord.barre'],
    generatorId: 'chordChanges',
    params: { tempo: 60, noteValue: 'quarter', chords: ['F', 'C'], beatsPerChord: 4 },
    bonus: 10,
  },
  {
    title: 'Blues lick with hammer-ons',
    instructions: 'Play the blues lick with hammer-ons and bends.',
    skillIds: ['lead.hammer-pull', 'lead.bends'],
    generatorId: 'legatoLick',
    params: { tempo: 80, noteValue: 'eighth', key: 'A' },
    techniques: 2,
  },
  {
    title: 'Strumming D-DU-UDU',
    instructions: 'Strum D-DU-UDU on a G chord.',
    skillIds: ['chord.strum-patterns'],
    generatorId: 'strumPattern',
    params: { tempo: 90, noteValue: 'eighth', pattern: 'D-DU-UDU', chord: 'G' },
  },
  {
    title: 'Pentatonic eighths at 120',
    instructions: 'Play the pentatonic boxes in eighth notes at speed.',
    skillIds: ['lead.pent-boxes', 'pick.alternate-8'],
    generatorId: 'scaleRun',
    params: { tempo: 120, noteValue: 'eighth', key: 'A', box: 1 },
  },
]

function primarySkill(skills: SkillDef[], id: string | undefined): Pick<SkillDef, 'tier' | 'refTempo'> {
  const s = id === undefined ? undefined : skills.find((x) => x.id === id)
  return s ?? { tier: 1, refTempo: 80 }
}

/** The 10-task placement ladder (docs §7). */
export function placementLadder(skills: SkillDef[]): TestTask[] {
  return LADDER.map((spec, i) => {
    const tempo = spec.params.tempo
    const params: ExerciseParams = { ...spec.params, bars: barsFor(tempo) }
    const difficulty = itemDifficulty(primarySkill(skills, spec.skillIds[0]), {
      tempo,
      noteValue: spec.params.noteValue as NoteValue | undefined,
      techniques: spec.techniques,
      bonus: spec.bonus,
    })
    return {
      id: `placement-${String(i + 1).padStart(2, '0')}`,
      title: spec.title,
      instructions: spec.instructions,
      skillIds: [...spec.skillIds],
      generatorId: spec.generatorId,
      params,
      difficulty,
      passCriteria: { ...TEST_PASS },
    }
  })
}

/** True after PLACEMENT_STOP_AFTER_FAILS consecutive failures at the end of the results. */
export function shouldStopPlacement(results: TestTaskResult[]): boolean {
  if (results.length < PLACEMENT_STOP_AFTER_FAILS) return false
  return results.slice(-PLACEMENT_STOP_AFTER_FAILS).every((r) => !r.passed)
}

/** The next unanswered task, or null when finished or the stop rule triggered. */
export function nextPlacementTask(tasks: TestTask[], results: TestTaskResult[]): TestTask | null {
  if (shouldStopPlacement(results)) return null
  const done = new Set(results.map((r) => r.taskId))
  return tasks.find((t) => !done.has(t.id)) ?? null
}

/** Pass check for raw numbers against criteria. */
export function meetsCriteria(criteria: PassCriteria, result: AttemptResult): boolean {
  const acc = result.total > 0 ? (result.perfects + GOOD_HIT_WEIGHT * result.goods) / result.total : 0
  if (acc < criteria.minAccuracy) return false
  const hits = result.perfects + result.goods
  if (result.timingMedianMs === null) {
    if (hits >= MIN_HITS_FOR_TIMING) return false
  } else if (Math.abs(result.timingMedianMs) > criteria.maxMedianMs) return false
  if (result.timingStdevMs !== null && result.timingStdevMs > criteria.maxStdevMs) return false
  return true
}

export function evaluateTask(task: TestTask, result: AttemptResult): boolean {
  return meetsCriteria(task.passCriteria, result)
}

function playerTier(model: LearnerModel, skills: SkillDef[]): number {
  let tier = 1
  for (const s of skills) {
    const st = model.skills[s.id]
    if (st && st.rating >= UNLOCK_RATING && s.tier > tier) tier = s.tier
  }
  return tier
}

function taskTempoParams(tempo: number): ExerciseParams {
  return { tempo, bars: barsFor(tempo), noteValue: 'quarter', position: 0 }
}

function dayNumber(now: number): number {
  return Math.floor(now / DAY_MS)
}

/** Checkpoint tasks (docs §7): focus skill, retention task, stretch song. */
export function checkpointTasks(
  model: LearnerModel,
  skills: SkillDef[],
  library: SongSummary[],
  now: number,
  focusSkillId: string,
): TestTask[] {
  const tasks: TestTask[] = []
  const skillTask = (id: string, skill: SkillDef, label: string): TestTask => {
    const tempo = model.skills[skill.id]?.tempoCeiling || skill.startTempo
    const params = taskTempoParams(tempo)
    return {
      id,
      title: `${label}: ${skill.name}`,
      instructions: `Play ${skill.name} at ${tempo} bpm.`,
      skillIds: [skill.id],
      generatorId: skill.generators[0] ?? 'melody',
      params,
      difficulty: itemDifficulty(skill, { tempo, noteValue: 'quarter' }),
      passCriteria: { ...TEST_PASS },
    }
  }

  const focus = skills.find((s) => s.id === focusSkillId)
  if (focus) tasks.push(skillTask('checkpoint-01', focus, 'Focus'))

  const solid = skills
    .filter((s) => s.id !== focusSkillId && (model.skills[s.id]?.rating ?? 0) >= 75)
    .sort((a, b) => a.id.localeCompare(b.id))
  if (solid.length > 0) {
    const seed = dayNumber(now)
    const pick = solid[((seed * 1103515245 + 12345) >>> 0) % solid.length]
    tasks.push(skillTask('checkpoint-02', pick, 'Retention'))
  }

  const stretch = stretchSong(model, library)
  if (stretch) {
    tasks.push({
      id: 'checkpoint-03',
      title: `Stretch: ${stretch.song.title} (Level ${stretch.level + 1})`,
      instructions: `Play ${stretch.song.title} at Level ${stretch.level + 1}, full speed.`,
      skillIds: [],
      generatorId: 'song',
      params: { tempo: stretch.song.bpm, bars: 0, songId: stretch.song.id, level: stretch.level },
      difficulty: 30 + 10 * stretch.level,
      passCriteria: { ...TEST_PASS },
    })
  }
  return tasks
}

function stretchSong(model: LearnerModel, library: SongSummary[]): { song: SongSummary; level: number } | null {
  let best: { song: SongSummary; level: number; at: number } | null = null
  for (const song of library) {
    const items = Object.values(model.songItems).filter((i) => i.songId === song.id)
    let level = -1
    let at = -1
    for (const it of items) {
      if (it.lastAt !== null) at = Math.max(at, it.lastAt)
      if ((it.bestAccuracy ?? 0) >= 0.85) level = Math.max(level, it.level)
    }
    if (level < 0) continue
    if (!best || at > best.at) best = { song, level, at }
  }
  if (!best) return null
  // Levels are 0-based indexes into generateLevels(); the stretch is one above the best cleared level.
  const maxIndex = best.song.levelNoteCounts.length > 0 ? best.song.levelNoteCounts.length - 1 : 5
  const next = Math.min(best.level + 1, maxIndex)
  return { song: best.song, level: next }
}

/** Monthly test: placement ladder from one tier below the current tier upward. */
export function monthlyTasks(model: LearnerModel, skills: SkillDef[]): TestTask[] {
  const fromTier = Math.max(1, playerTier(model, skills) - 1)
  return placementLadder(skills).filter((t) => primarySkill(skills, t.skillIds[0]).tier >= fromTier)
}

/** Which skill check is due now, if any (docs §7). */
export function isTestDue(profile: Profile, now: number, calibrationAgeDays: number | null): TestType | null {
  if (!profile.placementDoneAt) return 'placement'
  if (calibrationAgeDays === null || calibrationAgeDays > CALIBRATION_MAX_AGE_DAYS) return null
  const sinceMonthly = (now - Math.max(profile.placementDoneAt, profile.lastMonthlyAt ?? 0)) / DAY_MS
  if (sinceMonthly >= MONTHLY_MIN_DAYS) return 'monthly'
  const sinceCheckpoint = (now - (profile.lastCheckpointAt ?? profile.placementDoneAt)) / DAY_MS
  if (sinceCheckpoint >= CHECKPOINT_MIN_DAYS && profile.sessionsSinceTest >= CHECKPOINT_MIN_SESSIONS) return 'checkpoint'
  return null
}

function ratingsOf(model: LearnerModel): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, st] of Object.entries(model.skills)) out[id] = st.rating
  return out
}

/** Skills whose prerequisites all reach UNLOCK_RATING, lowest rating first. */
function lowestUnlocked(ratings: Record<string, number>, skills: SkillDef[], count: number): string[] {
  return skills
    .filter((s) => s.prerequisites.every((p) => (ratings[p] ?? 0) >= UNLOCK_RATING))
    .sort((a, b) => (ratings[a.id] ?? 0) - (ratings[b.id] ?? 0) || a.id.localeCompare(b.id))
    .slice(0, count)
    .map((s) => s.id)
}

export function applyPlacement(
  model: LearnerModel,
  tasks: TestTask[],
  results: TestTaskResult[],
  skills: SkillDef[],
  now: number,
): { model: LearnerModel; report: TestReport } {
  const resultById = new Map(results.map((r) => [r.taskId, r]))
  const passedVals = new Map<string, number>()
  const failedVals = new Map<string, number>()
  for (const task of tasks) {
    const res = resultById.get(task.id)
    if (!res) continue
    for (const id of task.skillIds) {
      if (res.passed) {
        const v = clamp(task.difficulty + PLACEMENT_PASS_OFFSET, 0, 100)
        passedVals.set(id, Math.max(passedVals.get(id) ?? -Infinity, v))
      } else {
        const v = clamp(task.difficulty - PLACEMENT_PASS_OFFSET, 0, 100)
        failedVals.set(id, Math.min(failedVals.get(id) ?? Infinity, v))
      }
    }
  }

  const byId = new Map(skills.map((s) => [s.id, s]))
  const memo = new Map<string, number>()
  const resolving = new Set<string>()
  const ratingOf = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    let r: number
    if (passedVals.has(id)) r = passedVals.get(id) as number
    else if (failedVals.has(id)) r = failedVals.get(id) as number
    else {
      const def = byId.get(id)
      const prereqs = (def?.prerequisites ?? []).filter((p) => byId.has(p) && !resolving.has(p))
      if (prereqs.length === 0) r = 0
      else {
        resolving.add(id)
        const mean = prereqs.reduce((s, p) => s + ratingOf(p), 0) / prereqs.length
        resolving.delete(id)
        r = Math.max(0, mean - PLACEMENT_INHERIT_OFFSET)
      }
    }
    r = round1(clamp(r, 0, 100))
    memo.set(id, r)
    return r
  }

  const nextSkills: Record<string, SkillState> = { ...model.skills }
  for (const s of skills) nextSkills[s.id] = newState(s.id, ratingOf(s.id))
  const next: LearnerModel = {
    ...model,
    skills: nextSkills,
    profile: { ...model.profile, placementDoneAt: now, sessionsSinceTest: 0 },
  }

  const ratings = ratingsOf(next)
  const passedCount = results.filter((r) => r.passed).length
  const tier = playerTier(next, skills)
  const lines = tasks.map((t) => {
    const r = resultById.get(t.id)
    return `${t.title}: ${r ? (r.passed ? 'passed' : 'not yet') : 'not attempted'}`
  })
  const ratingDeltas: Record<string, number> = {}
  for (const s of skills) ratingDeltas[s.id] = ratings[s.id]
  return {
    model: next,
    report: {
      headline: `Placement: ${passedCount} of ${tasks.length} tasks passed — starting at tier ${tier}`,
      lines,
      ratingDeltas,
      nextFocus: lowestUnlocked(ratings, skills, 3),
    },
  }
}

export function applyTestResults(
  model: LearnerModel,
  type: Exclude<TestType, 'placement'>,
  tasks: TestTask[],
  results: TestTaskResult[],
  skills: SkillDef[],
  applyAttempt: ApplyAttemptFn,
  now: number,
): { model: LearnerModel; report: TestReport } {
  const byId = new Map(skills.map((s) => [s.id, s]))
  const resultById = new Map(results.map((r) => [r.taskId, r]))
  const nextSkills: Record<string, SkillState> = { ...model.skills }
  const before: Record<string, number> = {}
  const failedSkills: string[] = []
  const lines: string[] = []

  for (const task of tasks) {
    const res = resultById.get(task.id)
    if (!res) continue
    lines.push(`${task.title}: ${res.passed ? 'passed' : 'not yet'}`)
    if (task.generatorId === 'song') continue
    for (const id of task.skillIds) {
      const def = byId.get(id)
      if (!def) continue
      const current = nextSkills[id] ?? newState(id, 0)
      if (!(id in before)) before[id] = current.rating
      nextSkills[id] = { ...applyAttempt(current, res.attempt, def), lastTestedAt: now }
      if (!res.passed && !failedSkills.includes(id)) failedSkills.push(id)
    }
  }

  const profile: Profile = { ...model.profile, sessionsSinceTest: 0 }
  if (type === 'checkpoint') profile.lastCheckpointAt = now
  else profile.lastMonthlyAt = now
  const next: LearnerModel = { ...model, skills: nextSkills, profile }

  const ratingDeltas: Record<string, number> = {}
  for (const id of Object.keys(before)) ratingDeltas[id] = round1(nextSkills[id].rating - before[id])

  const passedCount = tasks.filter((t) => resultById.get(t.id)?.passed).length
  const label = type === 'checkpoint' ? 'Checkpoint' : 'Monthly check'
  const ratings = ratingsOf(next)
  const lowest = skills
    .filter((s) => s.id in ratings)
    .sort((a, b) => ratings[a.id] - ratings[b.id] || a.id.localeCompare(b.id))
    .map((s) => s.id)
  const nextFocus = [...failedSkills, ...lowest.filter((id) => !failedSkills.includes(id))].slice(0, 3)
  return {
    model: next,
    report: { headline: `${label}: ${passedCount} of ${tasks.length} passed`, lines, ratingDeltas, nextFocus },
  }
}
