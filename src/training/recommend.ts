import { meetsCriteria } from './assessment'
import {
  CALIBRATION_MAX_AGE_DAYS,
  COMEBACK_AFTER_DAYS,
  COMEBACK_TEMPO_FACTOR,
  MIN_COVERAGE,
  REP_UP_ACCURACY,
  SONG_FULL_SPEED,
  SONG_LEVEL_UP_ACCURACY,
  SONG_SLOW_DOWN_ACCURACY,
  SONG_SPEED_STEPS,
  TEST_PASS,
  TIMING_BIAS_WARN_MS,
  VOICE_TEST_PASS,
  WEAK_BAR_ACCURACY,
} from './constants'
import { stepWithin } from './learner'
import { detectPlateau, nextIntervention } from './plateau'
import type { Attempt, InstrumentId, LearnerModel, PassCriteria, Recommendation, SkillDef, SongSummary } from './types'

const DAY_MS = 86_400_000
const MAX_RECOMMENDATIONS = 6
const SONG_WINDOW_DAYS = 7
const PLAY_MUSIC_AFTER_DAYS = 14
/** Levels a song has when the library entry does not say (Level 1 to 5 and Full). */
const DEFAULT_LEVEL_COUNT = 6

export interface RecommendContext {
  model: LearnerModel
  skills: SkillDef[]
  library: SongSummary[]
  recentAttempts: Attempt[]
  now: number
  calibrationAgeDays: number | null
  daysSinceLastSession?: number
  lastSongPlayedAt?: number
}

/**
 * What differs between instruments in the advice. With no options the cards are the guitar's, word
 * for word. Naming an instrument chooses its words and its own defaults for the other options; an
 * option that is given wins over what the instrument implies.
 *
 * Two things need no option because they belong to the skill itself: a tempo floor
 * (`SkillDef.minTempo`: no card proposes a tempo under it) and a step ladder (`SkillDef.steps`: its
 * cards speak of steps, never of a tempo, and their action carries none).
 */
export interface RecommendOptions {
  /** Whose words the cards speak. Default 'guitar'. */
  instrument?: InstrumentId
  /** What passes a skill check. Default TEST_PASS; for a voice VOICE_TEST_PASS. */
  passCriteria?: PassCriteria
  /**
   * Speeds a song may be asked for. With none under full speed no card offers a slower song or a
   * slower loop of its weak bars. Default SONG_SPEED_STEPS; a voice has one speed.
   */
  songSpeeds?: number[]
  /**
   * Whether the sound-sync card is offered (notes landing early or late, an old or missing measurement).
   * Default true; false for a voice, where the moment a note begins is no part of the result.
   */
  calibrate?: boolean
  /** false: skills with a step ladder get no round, check or plateau card at all. Default true: they get them in steps. */
  stepSkills?: boolean
}

interface Rules {
  voice: boolean
  passCriteria: PassCriteria
  slowerSongs: boolean
  calibrate: boolean
  stepSkills: boolean
}

function rulesOf(options: RecommendOptions): Rules {
  const voice = options.instrument === 'voice'
  const speeds = options.songSpeeds ?? (voice ? [1] : SONG_SPEED_STEPS)
  return {
    voice,
    passCriteria: options.passCriteria ?? (voice ? VOICE_TEST_PASS : TEST_PASS),
    slowerSongs: speeds.some((s) => s < SONG_FULL_SPEED),
    calibrate: options.calibrate ?? !voice,
    stepSkills: options.stepSkills ?? true,
  }
}

const pct = (x: number) => Math.round(x * 100)

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function groupBy<T>(items: T[], key: (t: T) => string | number | undefined): Map<string | number, T[]> {
  const out = new Map<string | number, T[]>()
  for (const it of items) {
    const k = key(it)
    if (k === undefined) continue
    const list = out.get(k)
    if (list) list.push(it)
    else out.set(k, [it])
  }
  return out
}

function hasSteps(skill: SkillDef | undefined): skill is SkillDef & { steps: NonNullable<SkillDef['steps']> } {
  return (skill?.steps?.length ?? 0) > 0
}

/** `tempo`, but not under the floor of the skill it is proposed for. A skill without a floor keeps the tempo as it is. */
function notUnderFloor(tempo: number, skill: SkillDef | undefined): number {
  return skill?.minTempo === undefined ? tempo : Math.max(skill.minTempo, tempo)
}

/**
 * Where a run of a step skill stood: its step, the highest step that learner can reach (the last one,
 * or the limit the run carries), and `start`, the step the next exercise of the skill begins on (the
 * one the learner has reached, as the planner reads it). A card names a step only where `start` bears
 * it out: the step after two clean rounds is not always open yet, and after two hard ones the next
 * exercise does not begin a step lower (the Coach goes a step down after a hard round, inside it).
 */
function ladderOfRun(skill: SkillDef & { steps: NonNullable<SkillDef['steps']> }, run: Attempt, model: LearnerModel): { step: number; top: number; start: number } {
  const last = skill.steps.length - 1
  const top = stepWithin(run.params?.maxStep, last, last)
  return { step: Math.min(stepWithin(run.params?.step, last, 0), top), top, start: Math.min(stepWithin(model.skills[skill.id]?.step, last, 0), top) }
}

function songRules(ctx: RecommendContext, desc: Attempt[], rules: Rules): Recommendation[] {
  const { voice } = rules
  const out: Recommendation[] = []
  const cutoff = ctx.now - SONG_WINDOW_DAYS * DAY_MS
  const songAttempts = desc.filter((a) => a.kind === 'song' && a.songId !== undefined && a.at >= cutoff)
  const bySong = groupBy(songAttempts, (a) => a.songId)
  const titleOf = (id: number) => ctx.library.find((s) => s.id === id)?.title ?? 'this song'
  for (const list of bySong.values()) {
    const a = list[0]
    const songId = a.songId as number
    // `level` is the 0-based index used everywhere in the training layer; the learner sees it as level + 1.
    const level = a.level ?? 0
    const shown = level + 1
    const title = titleOf(songId)
    const levelCount = ctx.library.find((s) => s.id === songId)?.levelNoteCounts.length || DEFAULT_LEVEL_COUNT
    if (a.accuracy >= SONG_LEVEL_UP_ACCURACY && a.speed >= SONG_FULL_SPEED) {
      if (level >= levelCount - 1) {
        // Nothing above the full version to unlock.
        out.push({
          id: 'song-top-level',
          priority: 50,
          title: voice ? 'You sang the whole song well.' : 'You played the full song well.',
          reason: voice
            ? `${title}: the hardest level went well. A good moment to pick a new song.`
            : `${title}: ${pct(a.accuracy)} % at full speed on the hardest level. A good moment to pick a new song.`,
        })
        continue
      }
      out.push({
        id: 'song-level-up',
        priority: 50,
        title: `Level ${shown + 1} unlocked.`,
        reason: voice
          ? `${title}: level ${shown} went well. It will come back now and then, so it stays fresh.`
          : `${title}: ${pct(a.accuracy)} % at full speed on level ${shown}. Level ${shown} goes into your review schedule.`,
        action: { type: 'song', songId, level: level + 1, speed: 1 },
      })
    } else if (a.accuracy >= SONG_SLOW_DOWN_ACCURACY && a.accuracy < SONG_LEVEL_UP_ACCURACY) {
      // This card is a loop of the weak bars at a slower speed. A song with one speed has no such card.
      if (!rules.slowerSongs) continue
      const bars = a.perBar ?? []
      const weak = bars.map((v, i) => ({ v, i })).filter((b) => b.v < WEAK_BAR_ACCURACY)
      if (weak.length === 0) continue
      let end = 0
      while (end + 1 < weak.length && weak[end + 1].i === weak[end].i + 1) end++
      const run = weak.slice(0, end + 1)
      const first = run[0].i
      const last = run[run.length - 1].i
      const mean = run.reduce((s, b) => s + b.v, 0) / run.length
      const range = first === last ? `Bar ${first + 1}` : `Bars ${first + 1}–${last + 1}`
      out.push({
        id: 'song-loop-weak-bars',
        priority: 50,
        title: `${range} ${first === last ? 'was' : 'were'} ${pct(mean)} %.`,
        reason: `${title}: ${pct(a.accuracy)} % overall. Tomorrow loops ${range.toLowerCase()} at 85 % speed.`,
        action: { type: 'song', songId, level, speed: 0.85, loopBars: [first + 1, last + 1] },
      })
    } else if (a.accuracy < SONG_SLOW_DOWN_ACCURACY) {
      // Same rule as the planner: two results in a row under 70 % on this level send the song back one level.
      const previous = list.slice(1).find((b) => (b.level ?? 0) === level)
      const prevFailed = previous !== undefined && previous.accuracy < SONG_SLOW_DOWN_ACCURACY
      const dropLevel = prevFailed && level > 0
      // One hard run is answered with a slower song. Where a song has one speed there is nothing to
      // offer yet: the level comes back as it was, and a second hard run takes it down a level.
      if (!dropLevel && !rules.slowerSongs) continue
      const guitarTitle = dropLevel
        ? `Two misses at level ${shown}: dropping to level ${shown - 1}.`
        : level > 0
          ? 'Let’s slow it down before dropping a level.'
          : 'Let’s slow it down.'
      const voiceTitle = dropLevel ? `Level ${shown} was hard twice: going back to level ${shown - 1}.` : `Level ${shown} once more, a little easier.`
      out.push({
        id: 'song-slow-down',
        priority: 50,
        title: voice ? voiceTitle : guitarTitle,
        reason: voice
          ? `${title}: level ${shown} was hard ${dropLevel ? 'two times in a row. The level before it will feel better' : 'last time'}.`
          : `${title}: ${pct(a.accuracy)} % on level ${shown}${prevFailed ? ' after another result under 70 %' : ''}.`,
        action: dropLevel
          ? { type: 'song', songId, level: level - 1, speed: 1 }
          : { type: 'song', songId, level, speed: 0.8 },
      })
    }
  }
  return out
}

function exerciseRules(ctx: RecommendContext, desc: Attempt[], rules: Rules): Recommendation[] {
  const { voice } = rules
  const out: Recommendation[] = []
  const nameOf = (id: string) => ctx.skills.find((s) => s.id === id)?.name ?? id
  const practice = groupBy(
    desc.filter((a) => a.kind === 'practice' && a.skillId),
    (a) => a.skillId,
  )
  let ratchet: Recommendation | null = null
  let fallback: Recommendation | null = null
  for (const [id, list] of practice) {
    if (list.length < 2) continue
    const skillId = id as string
    const [a, b] = list
    const def = ctx.skills.find((s) => s.id === skillId)
    if (hasSteps(def)) {
      // A step skill has one tempo: what comes next, and what is easier, is a step. No card names a
      // tempo for it and no action carries one.
      if (!rules.stepSkills) continue
      const { step, top, start } = ladderOfRun(def, a, ctx.model)
      if (!ratchet && a.accuracy >= REP_UP_ACCURACY && b.accuracy >= REP_UP_ACCURACY) {
        const next = start > step ? `Next comes: ${def.steps[start].label}.` : `One more clean round and the next step opens: ${def.steps[Math.min(step + 1, top)].label}.`
        ratchet = {
          id: 'step-ratchet',
          priority: 40,
          title: `${def.name}: two clean rounds in a row.`,
          reason: step < top ? next : 'That is as far as this exercise goes: a few more clean rounds there and it is done.',
          action: { type: 'practice', skillId },
        }
      }
      if (!fallback && a.accuracy < 0.6 && b.accuracy < 0.6) {
        fallback = {
          id: 'step-fallback',
          priority: 40,
          title: `${def.name}: listen first, then once more.`,
          reason: start > 0 ? 'The last two rounds were hard. Hearing it first helps, and after a hard round the next one is always a step easier.' : 'The last two rounds were hard. Hearing it first makes the next round easier.',
          action: { type: 'practice', skillId },
        }
      }
      continue
    }
    // Ear training is not played to a tempo: nothing to say about one.
    if (!ratchet && def?.category !== 'ear' && a.accuracy >= REP_UP_ACCURACY && b.accuracy >= REP_UP_ACCURACY) {
      const tempo = Math.round(a.playedTempo)
      // The Coach never asks for faster than the skill's target tempo, so the card must not promise it.
      const top = def?.targetTempo ?? Infinity
      const next = Math.min(top, Math.round(tempo * 1.05))
      const rounds = voice ? 'Two clean rounds in a row.' : `Two reps in a row at ${pct(b.accuracy)} % and ${pct(a.accuracy)} %.`
      ratchet = {
        id: 'tempo-ratchet',
        priority: 40,
        title: `${nameOf(skillId)} now clean at ${tempo} bpm.`,
        reason: next > tempo ? `${rounds} Next: ${next} bpm.` : `${rounds} That is the tempo this exercise aims for: a few more clean rounds there and it is done.`,
        action: { type: 'practice', skillId, tempo: Math.max(next, Math.min(tempo, top)) },
      }
    }
    if (!fallback && a.accuracy < 0.6 && b.accuracy < 0.6) {
      // Nine tenths of the tempo, but never under the floor of the skill. At the floor there is
      // nothing slower to offer: the same tempo again, after listening to it first.
      const tempo = notUnderFloor(Math.max(30, Math.round(a.playedTempo * 0.9)), def)
      const atFloor = def?.minTempo !== undefined && Math.round(a.playedTempo) <= def.minTempo
      const voiceTitle = atFloor ? `${nameOf(skillId)}: listen first, then once more.` : `${nameOf(skillId)}: a calmer pace next time, ${tempo} bpm.`
      const voiceReason = atFloor ? 'The last two rounds were hard. Hearing it first makes the next round easier.' : 'The last two rounds were hard. A calmer pace gives you time to hear each note.'
      fallback = {
        id: 'fallback-density',
        priority: 40,
        title: voice ? voiceTitle : `Back to quarters at ${tempo} bpm, then eighths.`,
        reason: voice ? voiceReason : `${nameOf(skillId)}: two reps under 60 % (${pct(b.accuracy)} % and ${pct(a.accuracy)} %).`,
        action: { type: 'practice', skillId, tempo },
      }
    }
  }
  if (ratchet) out.push(ratchet)
  if (fallback) out.push(fallback)
  return out
}

function testRules(ctx: RecommendContext, desc: Attempt[], rules: Rules): Recommendation[] {
  const { voice } = rules
  const out: Recommendation[] = []
  const nameOf = (id: string) => ctx.skills.find((s) => s.id === id)?.name ?? id
  const tests = groupBy(
    desc.filter((a) => a.kind === 'test' && a.skillId),
    (a) => a.skillId,
  )
  let up: Recommendation | null = null
  let down: Recommendation | null = null
  for (const [id, list] of tests) {
    const skillId = id as string
    const passed = (a: Attempt) => meetsCriteria(rules.passCriteria, a)
    const def = ctx.skills.find((s) => s.id === skillId)
    if (hasSteps(def)) {
      if (!rules.stepSkills) continue
      // A check passed below the highest step within reach names the next step. On that step there is nothing to add.
      // The check itself opens no step (that takes clean rounds in practice), so the card says which it is:
      // open already, or close.
      const { step, top, start } = ladderOfRun(def, list[0], ctx.model)
      if (!up && passed(list[0]) && step < top) {
        const open = start > step
        up = {
          id: 'test-passed-step-up',
          priority: 70,
          title: open ? `${def.name}: on to the next step.` : `${def.name}: the next step is close.`,
          reason: open
            ? `You passed the check. Next comes: ${def.steps[start].label}.`
            : `You passed the check. A clean round or two in practice and the next step opens: ${def.steps[step + 1].label}.`,
          action: { type: 'practice', skillId },
        }
      }
    } else {
      const top = def?.targetTempo ?? Infinity
      const from = Math.round(list[0].targetTempo)
      // A check passed at the skill's own target tempo has nowhere faster to go: no card.
      if (!up && passed(list[0]) && from < top) {
        const to = Math.min(top, Math.round(from * 1.1))
        up = {
          id: 'test-passed-target-up',
          priority: 70,
          title: `${nameOf(skillId)}: ${from} → ${to} bpm.`,
          reason: voice
            ? `You passed the check at ${from} bpm. Next comes ${to} bpm.`
            : `Check passed at ${from} bpm with ${pct(list[0].accuracy)} % accuracy. The next step is ${to} bpm.`,
          action: { type: 'practice', skillId, tempo: to },
        }
      }
    }
    if (!down && list.length >= 2 && !passed(list[0]) && !passed(list[1])) {
      const prereq = def?.prerequisites[0]
      // The exercise to go back to: the one under the skill, or the skill itself. Its floor holds for the
      // tempo proposed, and when it is a step skill no tempo is proposed at all.
      const target = ctx.skills.find((s) => s.id === (prereq ?? skillId))
      const paced = !hasSteps(target)
      const tempo = notUnderFloor(Math.round(list[0].targetTempo * 0.85), target)
      const guitarTitle = prereq ? `We’ll build this from the ${nameOf(prereq)} drill.` : `We’ll rebuild ${nameOf(skillId)} a little slower.`
      const plainTitle = prereq ? `We will build this from ${nameOf(prereq)}.` : `We will take ${nameOf(skillId)} a little easier.`
      // The built-in sentence promises a tempo; where none is proposed, or for a singer, the plain one is used.
      const plain = voice || !paced
      down = {
        id: 'test-failed-prereq',
        priority: 70,
        title: plain ? plainTitle : guitarTitle,
        reason: plain
          ? `${nameOf(skillId)} was not there yet in two checks, so we go back a little and build it up again.`
          : `${nameOf(skillId)} missed the test twice. Prerequisite drill for 3 sessions, tempo −15 % to ${tempo} bpm.`,
        action: paced ? { type: 'practice', skillId: prereq ?? skillId, tempo } : { type: 'practice', skillId: prereq ?? skillId },
      }
    }
  }
  if (up) out.push(up)
  if (down) out.push(down)
  return out
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/** What each plateau step asks of a singer, in plain words (the built-in descriptions speak of tempo, reps and filming the hands). */
function voicePlateauWords(step: 1 | 2 | 3 | 4, prerequisite: string | undefined): string {
  if (step === 1) return 'time for a gentler week, with more rounds'
  if (step === 2) return 'time for a different version of the exercise'
  if (step === 3) return prerequisite ? `time for a few days on ${prerequisite}` : 'time for a few easy days on it'
  return 'time for a two-week rest from this one'
}

function plateauRule(ctx: RecommendContext, desc: Attempt[], rules: Rules): Recommendation | null {
  const { voice } = rules
  const bySkill = groupBy(
    desc.filter((a) => a.skillId && a.kind !== 'test'),
    (a) => a.skillId,
  )
  let best: { rec: Recommendation; slope: number } | null = null
  for (const [id, list] of bySkill) {
    const skillId = id as string
    const state = ctx.model.skills[skillId]
    const def = ctx.skills.find((s) => s.id === skillId)
    if (!state || !def) continue
    if (hasSteps(def) && !rules.stepSkills) continue
    const det = detectPlateau(list, ctx.now)
    if (!det.plateau) continue
    const step = nextIntervention(state)
    if (!step) continue
    const base = Math.min(def.targetTempo, state.tempoCeiling || def.startTempo)
    const weeks = Math.max(1, Math.round(det.days / 7))
    const prereq = step.step === 3 ? def.prerequisites[0] : undefined
    const target = prereq ?? skillId
    const targetDef = ctx.skills.find((s) => s.id === target)
    // Never under the floor of the skill the tempo is for; a step skill is given no tempo at all.
    const tempo = notUnderFloor(Math.round(base * step.tempoFactor), targetDef)
    const span = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
    const prereqName = prereq ? (targetDef?.name ?? prereq) : undefined
    const rec: Recommendation = {
      id: 'plateau',
      priority: 60,
      title: voice ? `${def.name} has stayed the same for ${span}: ${voicePlateauWords(step.step, prereqName)}.` : `${span} flat on ${def.name}: ${step.description}.`,
      reason: voice
        ? 'That happens to everyone. A change often gets things moving again.'
        : `${det.count} attempts over ${Math.round(det.days)} days, ${det.slopePerDay.toFixed(2)} rating points per day.`,
      action: hasSteps(targetDef) ? { type: 'practice', skillId: target } : { type: 'practice', skillId: target, tempo },
    }
    if (!best || det.slopePerDay < best.slope) best = { rec, slope: det.slopePerDay }
  }
  return best ? best.rec : null
}

/** Rule-based recommendations (docs §8), highest priority first, at most six. */
export function recommendations(ctx: RecommendContext, options: RecommendOptions = {}): Recommendation[] {
  const rules = rulesOf(options)
  const { voice } = rules
  const desc = [...ctx.recentAttempts].sort((a, b) => b.at - a.at)
  const recs: Recommendation[] = []
  const stale = ctx.calibrationAgeDays === null || ctx.calibrationAgeDays > CALIBRATION_MAX_AGE_DAYS

  if (desc.length > 0) {
    const latestDay = desc.filter((a) => sameDay(a.at, desc[0].at))
    const biases = latestDay.map((a) => a.timingMedianMs).filter((x): x is number => x !== null)
    const bias = biases.length > 0 ? median(biases) : 0
    if (rules.calibrate && (Math.abs(bias) > TIMING_BIAS_WARN_MS || stale)) {
      const big = Math.abs(bias) > TIMING_BIAS_WARN_MS
      recs.push({
        id: 'calibrate',
        priority: 90,
        title: big
          ? `Everything landed ${Math.round(Math.abs(bias))} ms ${bias > 0 ? 'late' : 'early'} — recalibrate?`
          : 'Time to recalibrate the latency.',
        reason: big
          ? `Median timing across your last session was ${Math.round(bias)} ms (limit ${TIMING_BIAS_WARN_MS} ms).`
          : `The last calibration is older than ${CALIBRATION_MAX_AGE_DAYS} days.`,
        action: { type: 'calibrate' },
      })
    }
    const coverage = latestDay.reduce((s, a) => s + a.coverage, 0) / latestDay.length
    if (coverage < MIN_COVERAGE) {
      recs.push({
        id: 'mic-coverage',
        priority: 85,
        // To a singer: come closer. Never "sing louder": pushing the voice is what the app must not ask for.
        title: voice ? 'The microphone could hardly hear you. Move the phone a little closer.' : 'The mic barely heard you. Headphones or an interface help.',
        reason: voice
          ? 'Many of your notes were not heard last time, so those results count for less.'
          : `Only ${pct(coverage)} % of expected notes were heard in your last session (minimum ${pct(MIN_COVERAGE)} %). ` +
            'Those results are flagged.',
        action: { type: 'mic' },
      })
    }
  } else if (rules.calibrate && ctx.calibrationAgeDays !== null && ctx.calibrationAgeDays > CALIBRATION_MAX_AGE_DAYS) {
    recs.push({
      id: 'calibrate',
      priority: 90,
      title: 'Time to recalibrate the latency.',
      reason: `The last calibration is ${Math.round(ctx.calibrationAgeDays)} days old.`,
      action: { type: 'calibrate' },
    })
  }

  if (ctx.daysSinceLastSession !== undefined && ctx.daysSinceLastSession >= COMEBACK_AFTER_DAYS) {
    recs.push({
      id: 'comeback',
      priority: 80,
      title: voice ? 'Welcome back. An easy day to get your voice going again.' : 'Welcome back. Easy day to shake the rust off.',
      reason: voice
        ? `${Math.round(ctx.daysSinceLastSession)} days since your last session: no checks today, and everything is a little easier.`
        : `${Math.round(ctx.daysSinceLastSession)} days since your last session: no tests today, ` +
          `tempos at ${pct(COMEBACK_TEMPO_FACTOR)} %.`,
    })
  }

  recs.push(...testRules(ctx, desc, rules))
  const plateau = plateauRule(ctx, desc, rules)
  if (plateau) recs.push(plateau)
  recs.push(...songRules(ctx, desc, rules))
  recs.push(...exerciseRules(ctx, desc, rules))

  if (ctx.lastSongPlayedAt !== undefined && ctx.now - ctx.lastSongPlayedAt > PLAY_MUSIC_AFTER_DAYS * DAY_MS) {
    const days = Math.floor((ctx.now - ctx.lastSongPlayedAt) / DAY_MS)
    const song = ctx.library[0]
    recs.push({
      id: 'play-music',
      priority: 30,
      title: voice ? 'Time to sing a song.' : 'Time to play music with it.',
      reason: voice ? `No song for ${days} days. Songs are what the exercises are for.` : `No song played for ${days} days. A song block keeps technique musical.`,
      action: song ? { type: 'song', songId: song.id, level: 1, speed: 1 } : undefined,
    })
  }

  return recs.sort((a, b) => b.priority - a.priority).slice(0, MAX_RECOMMENDATIONS)
}
