import {
  CALIBRATION_MAX_AGE_DAYS,
  CHECKPOINT_MIN_DAYS,
  CHECKPOINT_MIN_SESSIONS,
  GOOD_HIT_WEIGHT,
  MIN_HITS_FOR_TIMING,
  MONTHLY_MIN_DAYS,
  PLACEMENT_INHERIT_OFFSET,
  PLACEMENT_MISS_MAX_RATING,
  PLACEMENT_PASS_MIN_RATING,
  PLACEMENT_PASS_OFFSET,
  PLACEMENT_STOP_AFTER_FAILS,
  TEST_PASS,
  UNLOCK_RATING,
  VOICE_TEST_PASS,
} from './constants'
import { itemDifficulty } from './difficulty'
import { exerciseParams } from './exercises'
import { stepWithin, tempoProgressRating } from './learner'
import { prerequisitesSolid } from './skills'
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

function newState(skillId: string, rating: number, tempoCeiling = 0): SkillState {
  return { skillId, rating, confidence: 1, tempoCeiling, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 0 }
}

/** Bars (even count, min 2) that fill roughly 35 s at the tempo. */
function barsFor(tempo: number): number {
  const bars = (35 * tempo) / 240
  return Math.max(2, Math.round(bars / 2) * 2)
}

/** One task of a placement or monthly check, as it is written down: what is played, and which skills it is evidence for. */
export interface LadderSpec {
  title: string
  instructions: string
  skillIds: string[]
  generatorId: string
  params: { tempo: number; [extra: string]: unknown }
  techniques?: number
  bonus?: number
}

/** The guitar's ten tasks: the list every placement and monthly check is built from unless another is given. */
const LADDER: LadderSpec[] = [
  {
    title: 'Single-string melody',
    instructions: 'Play the melody on one string.',
    skillIds: ['fret.single-string'],
    generatorId: 'melody',
    // Key and frets come from the skill's own drill: three notes on the thin E string.
    params: { tempo: 70, noteValue: 'quarter', strings: 1 },
  },
  {
    title: 'Open-position melody',
    instructions: 'Play the melody across the strings in open position.',
    skillIds: ['fret.cross-string'],
    generatorId: 'melody',
    // The skill's own drill: C major in frets 0 to 3 on the three thin strings.
    params: { tempo: 70, noteValue: 'quarter', strings: 3 },
  },
  {
    title: 'Em - Am - D changes',
    instructions: 'Change chords on time, two beats each.',
    skillIds: ['chord.open', 'chord.changes-open'],
    generatorId: 'chordChanges',
    params: { tempo: 60, noteValue: 'quarter', chords: ['Em', 'Am', 'D'], beatsPerChord: 2, strumsPerChord: 1 },
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
    title: 'Hammer-ons and pull-offs',
    instructions: 'Pick the first note of each group and sound the others with hammer-ons and pull-offs.',
    // Only what the lick contains: it has no bends, so it says nothing about bending.
    skillIds: ['lead.hammer-pull'],
    generatorId: 'legatoLick',
    params: { tempo: 80, noteValue: 'eighth', key: 'A' },
    techniques: 1,
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
    // Box 2: box 1 is already task 5, and this task is the evidence for the other boxes.
    params: { tempo: 120, noteValue: 'eighth', key: 'A', box: 2 },
  },
]

function primarySkill(skills: SkillDef[], id: string | undefined): Pick<SkillDef, 'tier' | 'refTempo'> {
  const s = id === undefined ? undefined : skills.find((x) => x.id === id)
  return s ?? { tier: 1, refTempo: 80 }
}

/** The 10-task placement ladder (docs §7), or the tasks of the list given in `specs`. */
export function placementLadder(skills: SkillDef[], specs: LadderSpec[] = LADDER): TestTask[] {
  return specs.map((spec, i) => {
    const tempo = spec.params.tempo
    const asked: ExerciseParams = { ...spec.params, bars: barsFor(tempo) }
    // What the task does not say comes from the drill of the skill it tests (its key, its place on the neck).
    const tested = skills.find((s) => s.id === spec.skillIds[0])
    const params = tested ? exerciseParams(tested, spec.generatorId, tempo, asked) : asked
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

function dayNumber(now: number): number {
  return Math.floor(now / DAY_MS)
}

/**
 * What differs between instruments in a weekly check. Every field is optional and its default is what
 * the guitar check has always done.
 */
export interface CheckpointOptions {
  /** What passes a task, on every task of the check. Default TEST_PASS. */
  criteria?: PassCriteria
  /** The word every instruction begins with. Default "Play". */
  verb?: string
  /**
   * More generator params for a skill's task: what the caller knows about this learner and the skill
   * does not (a singer's range as `low`, `high`, `easy`; the highest step it can hold as `maxStep`).
   */
  paramsFor?: (skill: SkillDef, state: SkillState | undefined) => Partial<ExerciseParams>
  /** The longest a task may be, in bars. Default: as many bars as fill about 35 seconds. */
  maxBars?: number
  /** The slowest a skill may be asked for. Default: the skill's own floor (`SkillDef.minTempo`), if it has one. */
  minTempoOf?: (skill: SkillDef) => number | undefined
  /** false where a song has a single speed: the song task then does not ask for "full speed". Default true. */
  songsHaveSpeeds?: boolean
}

/**
 * The weekly check of a singer (docs/SINGING.md §6 and §12.14). The Coach adds `paramsFor` with the
 * singer's range and reachable steps.
 */
export const VOICE_CHECK_OPTIONS: CheckpointOptions = { criteria: VOICE_TEST_PASS, verb: 'Sing', maxBars: 8, songsHaveSpeeds: false }

/** Checkpoint tasks (docs §7): focus skill, retention task, stretch song. */
export function checkpointTasks(
  model: LearnerModel,
  skills: SkillDef[],
  library: SongSummary[],
  now: number,
  focusSkillId: string,
  options: CheckpointOptions = {},
): TestTask[] {
  const tasks: TestTask[] = []
  const criteria = options.criteria ?? TEST_PASS
  const verb = options.verb ?? 'Play'
  const skillTask = (id: string, skill: SkillDef, label: string): TestTask => {
    const state = model.skills[skill.id]
    const extra = options.paramsFor?.(skill, state) ?? {}
    const steps = skill.steps ?? []
    const generatorId = skill.generators[0] ?? 'melody'
    // Never faster than the skill aims for (a tempo stored by an earlier version can be above it)...
    let tempo = Math.min(skill.targetTempo, state?.tempoCeiling || skill.startTempo)
    // ...and never under its floor (a ceiling after rough rounds is eight tenths of what was asked).
    const floor = options.minTempoOf ? options.minTempoOf(skill) : skill.minTempo
    if (floor !== undefined) tempo = Math.max(tempo, floor)
    const asked: Partial<ExerciseParams> = { ...extra }
    let stepDifficulty: number | undefined
    let instructions = `${verb} ${skill.name} at ${tempo} bpm.`
    if (steps.length > 0) {
      // A step skill is checked as it is practised: at its one tempo, on the step the learner has
      // reached, as far as this learner can go. The limit travels with the task because the rating needs it.
      tempo = skill.startTempo
      const last = steps.length - 1
      const maxStep = stepWithin(extra.maxStep, last, last)
      const step = Math.min(stepWithin(state?.step, last, 0), maxStep)
      asked.step = step
      // Only a real limit is kept, as in a planned block: without one the ladder ends at its last step.
      if (maxStep < last) asked.maxStep = maxStep
      else delete asked.maxStep
      // A step is one item wherever it is sung: rated as its exercise is in practice, by the step alone
      // (docs/SINGING.md §6), not by the note values its drill happens to be written in.
      stepDifficulty = itemDifficulty(skill, { tempo: skill.refTempo, bonus: steps[step].bonus })
      // The step is named in the learner's words. The tempo is not theirs to change, so it is not named.
      instructions = `${verb} ${skill.name}: ${steps[step].label}.`
    }
    const bars = Math.min(barsFor(tempo), options.maxBars ?? Infinity)
    // The check plays the drill the skill is practised with (its note values, hand position and technique),
    // only longer, and is rated for those note values (on a ladder: for the step).
    const params = exerciseParams(skill, generatorId, tempo, { ...asked, bars })
    return {
      id,
      title: `${label}: ${skill.name}`,
      instructions,
      skillIds: [skill.id],
      generatorId,
      params,
      difficulty: stepDifficulty ?? itemDifficulty(skill, { tempo, noteValue: params.noteValue }),
      passCriteria: { ...criteria },
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
      instructions: `${verb} ${stretch.song.title} at Level ${stretch.level + 1}${options.songsHaveSpeeds === false ? '' : ', full speed'}.`,
      skillIds: [],
      generatorId: 'song',
      params: { tempo: stretch.song.bpm, bars: 0, songId: stretch.song.id, level: stretch.level },
      difficulty: 30 + 10 * stretch.level,
      passCriteria: { ...criteria },
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

/** Monthly test: placement ladder (or the list given in `specs`) from one tier below the current tier upward. */
export function monthlyTasks(model: LearnerModel, skills: SkillDef[], specs: LadderSpec[] = LADDER): TestTask[] {
  const fromTier = Math.max(1, playerTier(model, skills) - 1)
  return placementLadder(skills, specs).filter((t) => primarySkill(skills, t.skillIds[0]).tier >= fromTier)
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

/** Skills the planner may schedule (everything they build on is solid), lowest rating first. */
function lowestUnlocked(ratings: Record<string, number>, skills: SkillDef[], count: number): string[] {
  const byId = new Map(skills.map((s) => [s.id, s]))
  return skills
    .filter((s) => prerequisitesSolid(s, ratings, byId))
    .sort((a, b) => (ratings[a.id] ?? 0) - (ratings[b.id] ?? 0) || a.id.localeCompare(b.id))
    .slice(0, count)
    .map((s) => s.id)
}

/**
 * True when a task plays a skill's own exercise: the same drill, and nothing the task sets differs from
 * what the exercise sets (note values, beats per chord, strums, key). Only then does the tempo of the
 * task mean the same as the tempo of the exercise: chords changed every four beats at 60 bpm say
 * nothing about changing them every two beats at 60.
 */
function isOwnDrill(task: TestTask, skill: SkillDef, tempo: number): boolean {
  const generatorId = skill.generators[0]
  if (generatorId === undefined || task.generatorId !== generatorId) return false
  const own: Record<string, unknown> = exerciseParams(skill, generatorId, tempo)
  const asked: Record<string, unknown> = task.params ?? {}
  return Object.keys(own).every((key) => key === 'tempo' || key === 'bars' || asked[key] === undefined || JSON.stringify(asked[key]) === JSON.stringify(own[key]))
}

export function applyPlacement(
  model: LearnerModel,
  tasks: TestTask[],
  results: TestTaskResult[],
  skills: SkillDef[],
  now: number,
): { model: LearnerModel; report: TestReport } {
  const resultById = new Map(results.map((r) => [r.taskId, r]))
  const byId = new Map(skills.map((s) => [s.id, s]))
  const passedVals = new Map<string, number>()
  const failedVals = new Map<string, number>()
  /** Tempo the learner showed on a skill's own drill in a passed task: where its exercises start from. */
  const shownTempo = new Map<string, number>()
  for (const task of tasks) {
    const res = resultById.get(task.id)
    if (!res) continue
    const taskTempo = task.params?.tempo
    for (const id of task.skillIds) {
      if (res.passed) {
        let v = clamp(Math.max(task.difficulty + PLACEMENT_PASS_OFFSET, PLACEMENT_PASS_MIN_RATING), 0, 100)
        const def = byId.get(id)
        if (def && typeof taskTempo === 'number') {
          // As for any other run: below the skill's target tempo a pass proves it up to just under
          // "mastered" at most. (One slow task used to rate sixteenth notes 93, and a skill rated
          // 90 or more is never planned as an exercise.) A pass always opens what builds on the skill.
          if (taskTempo < def.targetTempo) v = Math.max(PLACEMENT_PASS_MIN_RATING, Math.min(v, tempoProgressRating(taskTempo, { start: def.startTempo, target: def.targetTempo })))
          // Played on the skill's own drill: the first exercise can start from there and not from the
          // slowest tempo again.
          if (isOwnDrill(task, def, taskTempo)) shownTempo.set(id, Math.max(shownTempo.get(id) ?? 0, Math.min(def.targetTempo, taskTempo)))
        }
        passedVals.set(id, Math.max(passedVals.get(id) ?? -Infinity, v))
      } else {
        const v = clamp(Math.min(task.difficulty - PLACEMENT_PASS_OFFSET, PLACEMENT_MISS_MAX_RATING), 0, 100)
        failedVals.set(id, Math.min(failedVals.get(id) ?? Infinity, v))
      }
    }
  }

  // A pass also vouches for everything the skill builds on, all the way down the chain: those skills
  // are rated a little under the pass, and never under the minimum pass rating.
  const impliedByPass = new Map<string, number>()
  const vouchFor = (id: string, value: number): void => {
    for (const p of byId.get(id)?.prerequisites ?? []) {
      if ((impliedByPass.get(p) ?? -Infinity) >= value) continue
      impliedByPass.set(p, value)
      vouchFor(p, value)
    }
  }
  for (const [id, v] of passedVals) vouchFor(id, Math.max(PLACEMENT_PASS_MIN_RATING, v - PLACEMENT_INHERIT_OFFSET))
  const passValues = [...passedVals.values()]
  const meanPass = passValues.length > 0 ? passValues.reduce((sum, v) => sum + v, 0) / passValues.length : 0

  const memo = new Map<string, number>()
  const resolving = new Set<string>()
  const ratingOf = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    let r: number
    const implied = impliedByPass.get(id)
    if (passedVals.has(id)) r = Math.max(passedVals.get(id) as number, implied ?? 0)
    else if (implied !== undefined) r = implied
    else if (failedVals.has(id)) r = failedVals.get(id) as number
    else {
      const def = byId.get(id)
      const prereqs = (def?.prerequisites ?? []).filter((p) => byId.has(p) && !resolving.has(p))
      if (prereqs.length === 0) {
        // The ladder has no task for the very first basics or for playing to the click, but every
        // pass shows them: the task was played on a guitar and inside the timing limits.
        if (passValues.length === 0) r = 0
        else if (def?.tier === 0) r = PLACEMENT_PASS_MIN_RATING
        else if (def?.category === 'timing') r = meanPass
        else r = 0
      } else {
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
  for (const s of skills) nextSkills[s.id] = newState(s.id, ratingOf(s.id), shownTempo.get(s.id) ?? 0)
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
      // A test task measures, it is not practice: the rating moves, but the count of practice rounds stays,
      // so a skill met only in a check is still new to the learner when the next days are planned.
      nextSkills[id] = { ...applyAttempt(current, res.attempt, def), attempts: current.attempts, lastTestedAt: now }
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
