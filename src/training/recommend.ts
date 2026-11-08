import { meetsCriteria } from './assessment'
import {
  CALIBRATION_MAX_AGE_DAYS,
  COMEBACK_AFTER_DAYS,
  COMEBACK_TEMPO_FACTOR,
  MIN_COVERAGE,
  REP_UP_ACCURACY,
  SONG_LEVEL_UP_ACCURACY,
  SONG_SLOW_DOWN_ACCURACY,
  TEST_PASS,
  TIMING_BIAS_WARN_MS,
  WEAK_BAR_ACCURACY,
} from './constants'
import { detectPlateau, nextIntervention } from './plateau'
import type { Attempt, LearnerModel, Recommendation, SkillDef, SongSummary } from './types'

const DAY_MS = 86_400_000
const MAX_RECOMMENDATIONS = 6
const SONG_WINDOW_DAYS = 7
const PLAY_MUSIC_AFTER_DAYS = 14

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

function songRules(ctx: RecommendContext, desc: Attempt[]): Recommendation[] {
  const out: Recommendation[] = []
  const cutoff = ctx.now - SONG_WINDOW_DAYS * DAY_MS
  const songAttempts = desc.filter((a) => a.kind === 'song' && a.songId !== undefined && a.at >= cutoff)
  const bySong = groupBy(songAttempts, (a) => a.songId)
  const titleOf = (id: number) => ctx.library.find((s) => s.id === id)?.title ?? 'this song'
  for (const list of bySong.values()) {
    const a = list[0]
    const songId = a.songId as number
    const level = a.level ?? 1
    const title = titleOf(songId)
    if (a.accuracy >= SONG_LEVEL_UP_ACCURACY && a.speed >= 0.99) {
      out.push({
        id: 'song-level-up',
        priority: 50,
        title: `Level ${level + 1} unlocked.`,
        reason: `${title}: ${pct(a.accuracy)} % at full speed on level ${level}. Level ${level} goes into your review schedule.`,
        action: { type: 'song', songId, level: level + 1, speed: 1 },
      })
    } else if (a.accuracy >= SONG_SLOW_DOWN_ACCURACY && a.accuracy < SONG_LEVEL_UP_ACCURACY) {
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
      const prevFailed = list.length > 1 && list[1].accuracy < SONG_SLOW_DOWN_ACCURACY
      const dropLevel = prevFailed && level > 1
      out.push({
        id: 'song-slow-down',
        priority: 50,
        title: dropLevel
          ? `Two misses at level ${level}: dropping to level ${level - 1}.`
          : 'Let’s slow it down before dropping a level.',
        reason: `${title}: ${pct(a.accuracy)} % on level ${level}${prevFailed ? ' after another result under 70 %' : ''}.`,
        action: dropLevel
          ? { type: 'song', songId, level: level - 1, speed: 1 }
          : { type: 'song', songId, level, speed: 0.8 },
      })
    }
  }
  return out
}

function exerciseRules(ctx: RecommendContext, desc: Attempt[]): Recommendation[] {
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
    if (!ratchet && a.accuracy >= REP_UP_ACCURACY && b.accuracy >= REP_UP_ACCURACY) {
      const tempo = Math.round(a.playedTempo)
      ratchet = {
        id: 'tempo-ratchet',
        priority: 40,
        title: `${nameOf(skillId)} now clean at ${tempo} bpm.`,
        reason: `Two reps in a row at ${pct(b.accuracy)} % and ${pct(a.accuracy)} %. Next target: ${Math.round(tempo * 1.05)} bpm (+5 %).`,
        action: { type: 'practice', skillId, tempo: Math.round(tempo * 1.05) },
      }
    }
    if (!fallback && a.accuracy < 0.6 && b.accuracy < 0.6) {
      const tempo = Math.max(30, Math.round(a.playedTempo * 0.9))
      fallback = {
        id: 'fallback-density',
        priority: 40,
        title: `Back to quarters at ${tempo} bpm, then eighths.`,
        reason: `${nameOf(skillId)}: two reps under 60 % (${pct(b.accuracy)} % and ${pct(a.accuracy)} %).`,
        action: { type: 'practice', skillId, tempo },
      }
    }
  }
  if (ratchet) out.push(ratchet)
  if (fallback) out.push(fallback)
  return out
}

function testRules(ctx: RecommendContext, desc: Attempt[]): Recommendation[] {
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
    const passed = (a: Attempt) => meetsCriteria(TEST_PASS, a)
    if (!up && passed(list[0])) {
      const from = Math.round(list[0].targetTempo)
      const to = Math.round(from * 1.1)
      up = {
        id: 'test-passed-target-up',
        priority: 70,
        title: `${nameOf(skillId)}: ${from} → ${to} bpm target.`,
        reason: `Test passed at ${from} bpm with ${pct(list[0].accuracy)} % accuracy. The target tempo goes up 10 %.`,
        action: { type: 'practice', skillId, tempo: to },
      }
    }
    if (!down && list.length >= 2 && !passed(list[0]) && !passed(list[1])) {
      const def = ctx.skills.find((s) => s.id === skillId)
      const prereq = def?.prerequisites[0]
      const tempo = Math.round(list[0].targetTempo * 0.85)
      down = {
        id: 'test-failed-prereq',
        priority: 70,
        title: prereq ? `We’ll build this from the ${nameOf(prereq)} drill.` : `We’ll rebuild ${nameOf(skillId)} a little slower.`,
        reason: `${nameOf(skillId)} missed the test twice. Prerequisite drill for 3 sessions, tempo −15 % to ${tempo} bpm.`,
        action: { type: 'practice', skillId: prereq ?? skillId, tempo },
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

function plateauRule(ctx: RecommendContext, desc: Attempt[]): Recommendation | null {
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
    const det = detectPlateau(list, ctx.now)
    if (!det.plateau) continue
    const step = nextIntervention(state)
    if (!step) continue
    const base = state.tempoCeiling || def.startTempo
    const tempo = Math.round(base * step.tempoFactor)
    const weeks = Math.max(1, Math.round(det.days / 7))
    const target = step.step === 3 && def.prerequisites[0] ? def.prerequisites[0] : skillId
    const rec: Recommendation = {
      id: 'plateau',
      priority: 60,
      title: `${weeks} ${weeks === 1 ? 'week' : 'weeks'} flat on ${def.name}: ${step.description}.`,
      reason: `${det.count} attempts over ${Math.round(det.days)} days, ${det.slopePerDay.toFixed(2)} rating points per day.`,
      action: { type: 'practice', skillId: target, tempo },
    }
    if (!best || det.slopePerDay < best.slope) best = { rec, slope: det.slopePerDay }
  }
  return best ? best.rec : null
}

/** Rule-based recommendations (docs §8), highest priority first, at most six. */
export function recommendations(ctx: RecommendContext): Recommendation[] {
  const desc = [...ctx.recentAttempts].sort((a, b) => b.at - a.at)
  const recs: Recommendation[] = []

  if (desc.length > 0) {
    const latestDay = desc.filter((a) => sameDay(a.at, desc[0].at))
    const biases = latestDay.map((a) => a.timingMedianMs).filter((x): x is number => x !== null)
    const bias = biases.length > 0 ? median(biases) : 0
    const stale = ctx.calibrationAgeDays === null || ctx.calibrationAgeDays > CALIBRATION_MAX_AGE_DAYS
    if (Math.abs(bias) > TIMING_BIAS_WARN_MS || stale) {
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
        title: 'The mic barely heard you. Headphones or an interface help.',
        reason: `Only ${pct(coverage)} % of expected notes were heard in your last session (minimum ${pct(MIN_COVERAGE)} %). ` +
          'Those results are flagged.',
        action: { type: 'mic' },
      })
    }
  } else if (ctx.calibrationAgeDays !== null && ctx.calibrationAgeDays > CALIBRATION_MAX_AGE_DAYS) {
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
      title: 'Welcome back. Easy day to shake the rust off.',
      reason:
        `${Math.round(ctx.daysSinceLastSession)} days since your last session: no tests today, ` +
        `tempos at ${pct(COMEBACK_TEMPO_FACTOR)} %.`,
    })
  }

  recs.push(...testRules(ctx, desc))
  const plateau = plateauRule(ctx, desc)
  if (plateau) recs.push(plateau)
  recs.push(...songRules(ctx, desc))
  recs.push(...exerciseRules(ctx, desc))

  if (ctx.lastSongPlayedAt !== undefined && ctx.now - ctx.lastSongPlayedAt > PLAY_MUSIC_AFTER_DAYS * DAY_MS) {
    const days = Math.floor((ctx.now - ctx.lastSongPlayedAt) / DAY_MS)
    const song = ctx.library[0]
    recs.push({
      id: 'play-music',
      priority: 30,
      title: 'Time to play music with it.',
      reason: `No song played for ${days} days. A song block keeps technique musical.`,
      action: song ? { type: 'song', songId: song.id, level: 1, speed: 1 } : undefined,
    })
  }

  return recs.sort((a, b) => b.priority - a.priority).slice(0, MAX_RECOMMENDATIONS)
}
