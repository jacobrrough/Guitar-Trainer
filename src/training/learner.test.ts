import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  applyAttempt,
  applyToModel,
  effectiveRating,
  expectedScore,
  masteryBand,
  newSkillState,
  ratingDelta,
  runScore,
  tempoProgressRating,
  updateTempoCeiling,
} from './learner'
import { attemptPerformance } from './performance'
import { AT_TARGET_MIN_GAIN, BELOW_TARGET_RATING, RATING_HEADROOM, START_TEMPO_RATING, STEP_DOWN_LOW_RUNS, STEP_UP_CLEAN_RUNS, UNLOCK_RATING } from './constants'
import { itemDifficulty } from './difficulty'
import type { Attempt, LearnerModel, SkillDef, SkillState } from './types'

const DAY = 86400000
const NOW = 1_700_000_000_000

const skill: SkillDef = {
  id: 'alt-picking', name: 'Alt', category: 'picking', tier: 1, prerequisites: [], refTempo: 80, startTempo: 60, targetTempo: 120,
  description: '', tips: [], generators: ['x'],
}

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    perfects: 10, goods: 0, misses: 0, total: 10, timingMedianMs: 0, timingStdevMs: 0, coverage: 1, durationSec: 10,
    playedTempo: 100, targetTempo: 100, speed: 1, at: NOW, kind: 'practice', difficulty: 50, performance: 1, accuracy: 1, reliable: true,
    ...over,
  }
}

const confident = { ...newSkillState('alt-picking', 50), confidence: 10 }

describe('basics', () => {
  it('creates a fresh state', () => {
    expect(newSkillState('s', 12, NOW)).toEqual({
      skillId: 's', rating: 12, confidence: 0, tempoCeiling: 0, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 0,
    })
  })

  it('maps ratings to bands', () => {
    expect([0, 19.9, 20, 49, 50, 74, 75, 89, 90, 100].map(masteryBand)).toEqual([
      'new', 'new', 'learning', 'learning', 'developing', 'developing', 'solid', 'solid', 'mastered', 'mastered',
    ])
  })

  it('computes expected score', () => {
    expect(expectedScore(50, 50)).toBe(0.5)
    expect(expectedScore(75, 50)).toBeCloseTo(10 / 11, 10)
    expect(expectedScore(50, 75)).toBeCloseTo(1 / 11, 10)
  })
})

describe('effectiveRating (rust)', () => {
  const s = { ...confident, lastPracticedAt: NOW }
  it('is the rating when never practised or within grace', () => {
    expect(effectiveRating(confident, NOW)).toBe(50)
    expect(effectiveRating(s, NOW + 14 * DAY)).toBe(50)
  })
  it('loses 2 points per week after 14 days', () => {
    expect(effectiveRating(s, NOW + 21 * DAY)).toBeCloseTo(48, 10)
    expect(effectiveRating(s, NOW + 28 * DAY)).toBeCloseTo(46, 10)
  })
  it('never loses more than 20 points and never goes below 0', () => {
    expect(effectiveRating(s, NOW + 1000 * DAY)).toBe(30)
    expect(effectiveRating({ ...s, rating: 5 }, NOW + 1000 * DAY)).toBe(0)
  })
})

describe('ratingDelta', () => {
  it('is K·(p − E)·gain', () => {
    expect(ratingDelta(confident, attempt())).toBeCloseTo(6, 10)
    // A run with no performance hit no notes either (the fixture's default is every note hit).
    expect(ratingDelta(confident, attempt({ performance: 0, accuracy: 0 }))).toBeCloseTo(-6, 10)
  })
  it('doubles for tests', () => {
    expect(ratingDelta(confident, attempt({ kind: 'test' }))).toBeCloseTo(2 * ratingDelta(confident, attempt()), 10)
  })
  it('is x1.5 while confidence is low and /3 when unreliable', () => {
    expect(ratingDelta(newSkillState('s', 50), attempt())).toBeCloseTo(9, 10)
    expect(ratingDelta(confident, attempt({ reliable: false }))).toBeCloseTo(2, 10)
  })
})

describe('applyAttempt', () => {
  it('raises about 30 points over 10 perfect attempts at d = 50', () => {
    let s = confident
    for (let i = 0; i < 10; i++) s = applyAttempt(s, attempt({ at: NOW + i * 1000 }), skill)
    expect(s.rating - 50).toBeGreaterThan(25)
    expect(s.rating - 50).toBeLessThan(35)
    expect(s.attempts).toBe(10)
  })

  it('does not mutate and updates timestamps', () => {
    const out = applyAttempt(confident, attempt({ kind: 'test' }), skill)
    expect(confident.attempts).toBe(0)
    expect(out.lastPracticedAt).toBe(NOW)
    expect(out.lastTestedAt).toBe(NOW)
    expect(applyAttempt(confident, attempt(), skill).lastTestedAt).toBeUndefined()
  })

  it('slow rounds lead to solid and no further: the rest, up to just under mastered, is earned on the way to the target tempo', () => {
    // A hard item (difficulty 68 at the slowest tempo, like sixteenth notes): it used to read "mastered" after a few slow rounds.
    let slow = { ...confident, rating: 0 }
    for (let i = 0; i < 80; i++) slow = applyAttempt(slow, attempt({ difficulty: 68, playedTempo: skill.startTempo, targetTempo: skill.startTempo }), skill)
    expect(slow.rating).toBeCloseTo(START_TEMPO_RATING, 6)
    // Half way from the start tempo (60) to the target (120) the stop is half way from there to just under mastered.
    const halfWay = (START_TEMPO_RATING + BELOW_TARGET_RATING) / 2
    expect(tempoProgressRating(90, { start: 60, target: 120 })).toBeCloseTo(halfWay, 6)
    expect(tempoProgressRating(40, { start: 60, target: 120 })).toBe(START_TEMPO_RATING)
    expect(tempoProgressRating(500, { start: 60, target: 120 })).toBe(BELOW_TARGET_RATING)
    expect(BELOW_TARGET_RATING).toBeLessThan(90)
    let half = slow
    for (let i = 0; i < 80; i++) half = applyAttempt(half, attempt({ difficulty: 80, playedTempo: 90, targetTempo: 90 }), skill)
    expect(half.rating).toBeCloseTo(halfWay, 6)
    // However long, nothing under the target tempo reads mastered.
    let near = half
    for (let i = 0; i < 200; i++) near = applyAttempt(near, attempt({ difficulty: 95, playedTempo: 119, targetTempo: 119 }), skill)
    expect(near.rating).toBeLessThan(90)
    expect(masteryBand(near.rating)).toBe('solid')
    // An easy item still stops RATING_HEADROOM above its difficulty, whatever the tempo says.
    let easy = { ...confident, rating: 0 }
    for (let i = 0; i < 80; i++) easy = applyAttempt(easy, attempt({ difficulty: 20, playedTempo: 90, targetTempo: 90 }), skill)
    expect(easy.rating).toBeCloseTo(20 + RATING_HEADROOM, 6)
  })

  it('a rough round at a fast tempo proves nothing about that tempo', () => {
    // Clean up to 80 bpm so far (a third of the way from 60 to 120), rated at the stop for that.
    const stop80 = tempoProgressRating(80, { start: 60, target: 120 })
    const st = { ...confident, rating: stop80, tempoCeiling: 80 }
    // 72 % at 110 bpm on a hard item: by the numbers a gain (the item is far above the rating), but not clean.
    const rough = attempt({ difficulty: 95, playedTempo: 110, targetTempo: 110, accuracy: 0.72, performance: 0.7 })
    expect(ratingDelta(st, rough)).toBeGreaterThan(0)
    expect(applyAttempt(st, rough, skill).rating).toBeCloseTo(stop80, 6)
    // The same at the target tempo itself: no open top for a round that was not clean.
    const roughAtTarget = { ...rough, playedTempo: 120, targetTempo: 120 }
    let s2 = st
    for (let i = 0; i < 30; i++) s2 = applyAttempt({ ...s2, tempoCeiling: 80 }, roughAtTarget, skill)
    expect(s2.rating).toBeCloseTo(stop80, 6)
    // An accurate round at 110 does prove 110.
    const cleanAt110 = attempt({ difficulty: 95, playedTempo: 110, targetTempo: 110 })
    expect(applyAttempt(st, cleanAt110, skill).rating).toBeGreaterThan(stop80)
  })

  it('accurate rounds at the target tempo are all a skill can show: they carry it to the top, a point or more a round', () => {
    // Difficulty 44 at the target tempo (a first-tier skill): the usual bound would stop it at 84.
    let st = { ...confident, rating: 84 }
    const atTarget = attempt({ difficulty: 44, playedTempo: skill.targetTempo, targetTempo: skill.targetTempo })
    const first = applyAttempt(st, atTarget, skill).rating
    expect(first).toBeGreaterThanOrEqual(84 + AT_TARGET_MIN_GAIN)
    for (let i = 0; i < 16; i++) st = applyAttempt(st, atTarget, skill)
    expect(st.rating).toBe(100)
    // Not for a round that was not clean, and not for a slowed-down one.
    const at84 = { ...confident, rating: 84 }
    expect(applyAttempt(at84, { ...atTarget, accuracy: 0.8, performance: 0.8 }, skill).rating).toBeLessThanOrEqual(84)
    expect(applyAttempt(at84, { ...atTarget, speed: 0.75 }, skill).rating).toBeLessThanOrEqual(84)
    // A run the app could barely hear proves nothing extra.
    expect(applyAttempt(at84, { ...atTarget, reliable: false }, skill).rating).toBeLessThan(84 + AT_TARGET_MIN_GAIN)
    // A skill check passed at the target has the open top too (it is the best evidence there is), but no free point.
    const hard = { ...confident, rating: 89 }
    const check = attempt({ kind: 'test', difficulty: 95, playedTempo: skill.targetTempo, targetTempo: skill.targetTempo })
    expect(applyAttempt(hard, check, skill).rating).toBeGreaterThan(90)
    expect(applyAttempt(at84, { ...atTarget, kind: 'test' }, skill).rating).toBeLessThan(84 + AT_TARGET_MIN_GAIN)
    // A check passed below the target lifts no further than its tempo allows, even with nothing practised yet.
    const unpractised = { ...confident, rating: 80, tempoCeiling: 0 }
    const checkAt90 = attempt({ kind: 'test', difficulty: 95, playedTempo: 90, targetTempo: 90 })
    expect(applyAttempt(unpractised, checkAt90, skill).rating).toBeCloseTo((START_TEMPO_RATING + BELOW_TARGET_RATING) / 2, 6)
  })

  it('a state or a run stored without a usable tempo never turns the rating into nothing', () => {
    // A state from a backup without a stored tempo, and a round that was not accurate (so the stored tempo is asked for).
    const noCeiling = { ...confident, rating: 40, tempoCeiling: undefined as unknown as number }
    const soso = attempt({ difficulty: 60, accuracy: 0.8, performance: 0.8, playedTempo: 70, targetTempo: 70 })
    const after = applyAttempt(noCeiling, soso, skill).rating
    expect(Number.isFinite(after)).toBe(true)
    expect(after).toBeGreaterThan(40)
    expect(after).toBeLessThanOrEqual(START_TEMPO_RATING)
    // A run without a tempo that can be read is rated as before: by its difficulty alone.
    const noTempo = attempt({ difficulty: 30, playedTempo: Number.NaN })
    const plain = applyAttempt({ ...confident, rating: 40 }, noTempo, skill).rating
    expect(Number.isFinite(plain)).toBe(true)
    expect(plain).toBeGreaterThan(40)
  })

  it('clamps to 0..100', () => {
    // At the skill's target tempo: only there can a rating go all the way up.
    expect(applyAttempt({ ...confident, rating: 99.5 }, attempt({ difficulty: 99.5, playedTempo: skill.targetTempo }), skill).rating).toBe(100)
    expect(applyAttempt({ ...confident, rating: 0.5 }, attempt({ performance: 0, accuracy: 0, difficulty: 0.5 }), skill).rating).toBe(0)
  })

  it('updates confidence incrementally with recency decay', () => {
    const first = applyAttempt(newSkillState('s', 0), attempt(), skill)
    expect(first.confidence).toBe(1)
    const later = applyAttempt(first, attempt({ at: NOW + 30 * DAY }), skill)
    expect(later.confidence).toBeCloseTo(Math.exp(-1) + 1, 10)
  })

  it('sets the tempo ceiling from recent attempts', () => {
    const out = applyAttempt(confident, attempt({ playedTempo: 120 }), skill, [attempt({ playedTempo: 90, at: NOW - DAY })])
    expect(out.tempoCeiling).toBe(120)
  })
})

describe('updateTempoCeiling', () => {
  it('picks the highest tempo with >= 85% accuracy', () => {
    const list = [
      attempt({ playedTempo: 80, accuracy: 0.9 }),
      attempt({ playedTempo: 100, accuracy: 0.85 }),
      attempt({ playedTempo: 120, accuracy: 0.84 }),
    ]
    expect(updateTempoCeiling(list, NOW)).toBe(100)
  })
  it('falls back to 0.8 x the minimum tempo, and 0 when empty', () => {
    const list = [attempt({ playedTempo: 100, accuracy: 0.5 }), attempt({ playedTempo: 70, accuracy: 0.6 })]
    expect(updateTempoCeiling(list, NOW)).toBeCloseTo(56, 10)
    expect(updateTempoCeiling([], NOW)).toBe(0)
  })
  it('ignores attempts older than 30 days and keeps only the 10 most recent', () => {
    expect(updateTempoCeiling([attempt({ playedTempo: 200, at: NOW - 31 * DAY })], NOW)).toBe(0)
    const old = attempt({ playedTempo: 200, accuracy: 0.95, at: NOW - 20 * DAY })
    const recent = Array.from({ length: 10 }, (_, i) => attempt({ playedTempo: 80, accuracy: 0.9, at: NOW - i * 1000 }))
    expect(updateTempoCeiling([old, ...recent], NOW)).toBe(80)
  })
})

describe('applyToModel', () => {
  it('creates missing state without mutating the input', () => {
    const model: LearnerModel = {
      skills: {},
      songItems: {},
      profile: { id: 1, goals: [], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 },
    }
    const out = applyToModel(model, attempt(), skill)
    expect(model.skills).toEqual({})
    expect(out.skills['alt-picking'].attempts).toBe(1)
    expect(out.skills['alt-picking'].rating).toBeGreaterThan(0)
    expect(out.songItems).toBe(model.songItems)
  })
})

describe('a run the app scored from its own speaker (bleed)', () => {
  const heardItself = attempt({ bleed: true, reliable: false, playedTempo: 200, at: NOW })

  it('leaves the skill state untouched', () => {
    const state = { ...confident, lastPracticedAt: NOW - 3 * DAY, tempoCeiling: 90, attempts: 4 }
    expect(applyAttempt(state, heardItself, skill, [], NOW)).toEqual(state)
    const model: LearnerModel = { skills: {}, songItems: {}, profile: { id: 1, goals: [], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 } }
    expect(applyToModel(model, heardItself, skill)).toEqual(model)
  })

  it('never sets the tempo ceiling, even from the history of a later run', () => {
    expect(updateTempoCeiling([heardItself], NOW)).toBe(0)
    const played = attempt({ playedTempo: 80, at: NOW + 1000 })
    expect(updateTempoCeiling([heardItself, played], NOW + 1000)).toBe(80)
    expect(applyAttempt(confident, played, skill, [heardItself], NOW + 1000).tempoCeiling).toBe(80)
  })

  it('does not push real runs out of the recent window', () => {
    const real = attempt({ playedTempo: 120, at: NOW - 20 * 1000 })
    const noise = Array.from({ length: 10 }, (_, i) => attempt({ bleed: true, accuracy: 0.2, playedTempo: 60, at: NOW - i * 1000 }))
    expect(updateTempoCeiling([real, ...noise], NOW)).toBe(120)
  })
})

describe('the rating behaves like a sensible teacher', () => {
  /** A run as the app records it: 40 notes, `accuracy` of them hit, timing spread `sigma` ms, at the asked tempo. */
  const run = (accuracy: number, sigma: number, difficulty: number, over: Partial<Attempt> = {}): Attempt => {
    const perfects = Math.round(accuracy * 40)
    const result = { perfects, goods: 0, misses: 40 - perfects, total: 40, timingMedianMs: 5, timingStdevMs: sigma, coverage: 0.9, durationSec: 30, playedTempo: 60, targetTempo: 60, speed: 1 }
    const perf = attemptPerformance(result)
    return { ...result, at: NOW, kind: 'practice', difficulty, performance: perf.p, accuracy: perf.acc, reliable: true, ...over }
  }
  const rated = (rating: number) => ({ ...confident, rating })

  it('a clean run is a full score, however real the timing', () => {
    expect(runScore(run(0.97, 20, 10).performance)).toBe(1)
    expect(runScore(run(0.95, 30, 10).performance)).toBe(1)
    expect(runScore(1)).toBe(1)
    expect(runScore(0)).toBe(0)
  })

  it('a clean run never lowers a rating, even on an item far below it', () => {
    for (const rating of [20, 40, 60, 80, 95]) {
      for (const difficulty of [0, 5, 12, 20, 40]) {
        expect(ratingDelta(rated(rating), run(0.97, 20, difficulty)), `r ${rating} d ${difficulty}`).toBeGreaterThanOrEqual(0)
        expect(ratingDelta(rated(rating), run(0.95, 30, difficulty)), `r ${rating} d ${difficulty}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('a good run costs next to nothing on an easy item, where it used to cost about three points', () => {
    expect(ratingDelta(rated(60), run(0.85, 30, 12))).toBeGreaterThan(-0.6)
  })

  it('a weak run still lowers the rating, and more the worse it was', () => {
    const fair = ratingDelta(rated(50), run(0.6, 30, 30))
    const poor = ratingDelta(rated(50), run(0.3, 60, 30))
    expect(fair).toBeLessThan(-0.5)
    expect(poor).toBeLessThan(fair)
  })

  it('easy material cannot run a rating up: gains stop a fixed distance above the item', () => {
    let s = rated(10)
    for (let i = 0; i < 300; i++) s = applyAttempt(s, run(0.97, 20, 12, { at: NOW + i * 1000 }), skill)
    expect(s.rating).toBeLessThanOrEqual(12 + RATING_HEADROOM)
    expect(s.rating).toBeLessThan(UNLOCK_RATING)
    expect(s.rating).toBeGreaterThan(40)
    // The last step lands on the bound and does not jump over it.
    expect(ratingDelta(rated(12 + RATING_HEADROOM - 0.2), run(0.97, 20, 12, { kind: 'test' }))).toBeLessThanOrEqual(0.2 + 1e-9)
  })

  it('steady clean rounds at a tempo a little above the reference pass the unlock line; 60 % playing never does', () => {
    // A tier 1 exercise a little above its reference tempo has a difficulty of about 30.
    let good = rated(30)
    let rounds = 0
    while (good.rating < UNLOCK_RATING && rounds < 200) good = applyAttempt(good, run(0.95, 30, 30, { at: NOW + ++rounds * 1000 }), skill)
    expect(rounds).toBeLessThan(40)
    let weak = rated(30)
    for (let i = 0; i < 200; i++) weak = applyAttempt(weak, run(0.6, 30, 30, { at: NOW + i * 1000 }), skill)
    expect(weak.rating).toBeLessThan(UNLOCK_RATING - 10)
  })
})

describe('a run at the mark that raises the tempo (85 % of the notes) is good practice, not a setback', () => {
  /** A run as the app records it: 40 notes, timing spread `sigma` ms, played at `speed` times the asked tempo. */
  const run = (accuracy: number, sigma: number, difficulty: number, over: Partial<Attempt> = {}, speed = 1): Attempt => {
    const perfects = Math.round(accuracy * 40)
    const result = { perfects, goods: 0, misses: 40 - perfects, total: 40, timingMedianMs: 5, timingStdevMs: sigma, coverage: 0.9, durationSec: 30, playedTempo: 60 * speed, targetTempo: 60, speed }
    const perf = attemptPerformance(result)
    return { ...result, at: NOW, kind: 'practice', difficulty, performance: perf.p, accuracy: perf.acc, reliable: true, ...over }
  }
  const rated = (rating: number) => ({ ...confident, rating })

  it('never lowers a rating, whatever the timing spread within the hits, and can reach the same bound as a cleaner run', () => {
    for (const rating of [40, 60, 80]) {
      for (const difficulty of [5, 12, 20]) {
        expect(ratingDelta(rated(rating), run(0.85, 30, difficulty)), `r ${rating} d ${difficulty}`).toBeGreaterThanOrEqual(0)
        expect(ratingDelta(rated(rating), run(0.88, 45, difficulty)), `r ${rating} d ${difficulty}`).toBeGreaterThanOrEqual(0)
      }
    }
    // At a tier 1 skill's reference tempo (difficulty 20) it gets all the way to the unlock line.
    let s = rated(30)
    for (let i = 0; i < 300; i++) s = applyAttempt(s, run(0.85, 30, 20, { at: NOW + i * 1000 }), skill)
    expect(s.rating).toBeGreaterThanOrEqual(UNLOCK_RATING)
    expect(s.rating).toBeLessThanOrEqual(20 + RATING_HEADROOM)
  })

  it('just under that mark the score follows the performance as before', () => {
    expect(ratingDelta(rated(60), run(0.8, 30, 12))).toBeLessThan(0)
  })

  it('slowing the exercise down does not make it a full score: the item was rated for the tempo that was asked', () => {
    expect(ratingDelta(rated(60), run(0.95, 30, 12, {}, 0.5))).toBeLessThan(0)
  })

  it('a skill check keeps the whole measure, timing included', () => {
    expect(ratingDelta(rated(60), run(0.85, 70, 12, { kind: 'test' }))).toBeLessThan(0)
  })
})

describe('warm-ups and the tempo ceiling', () => {
  const warm = (tempo: number, accuracy: number, at: number): Attempt => attempt({ kind: 'warmup', playedTempo: tempo, targetTempo: tempo, accuracy, performance: accuracy, at })

  it('clean warm-up rounds, played below the ceiling on purpose, do not talk the ceiling down', () => {
    // The skill was played cleanly at 63 bpm; since then it has only been the warm-up, at nine tenths of that.
    const history = [attempt({ playedTempo: 63, targetTempo: 63, accuracy: 0.86, at: NOW - 5 * DAY }), ...Array.from({ length: 10 }, (_, i) => warm(57, 0.86, NOW - DAY + i * 1000))]
    const state = { ...confident, tempoCeiling: 63, lastPracticedAt: NOW - DAY }
    expect(applyAttempt(state, warm(57, 0.86, NOW), skill, history, NOW).tempoCeiling).toBe(63)
  })

  it('a clean warm-up above the ceiling raises it; a rough one does not lower it, month after month', () => {
    const state = { ...confident, tempoCeiling: 63, lastPracticedAt: NOW - DAY }
    expect(applyAttempt(state, warm(66, 0.95, NOW), skill, [], NOW).tempoCeiling).toBe(66)
    expect(applyAttempt(state, warm(57, 0.5, NOW), skill, [], NOW).tempoCeiling).toBe(63)
    // The best skill is the daily warm-up at nine tenths of its ceiling, with a rough round every fifth day.
    let st: SkillState = { ...confident, rating: 96, tempoCeiling: 100, lastPracticedAt: NOW - 31 * DAY }
    let history: Attempt[] = []
    for (let day = 30; day >= 1; day--) {
      const at = NOW - day * DAY
      const round = warm(Math.round(st.tempoCeiling * 0.9), day % 5 === 0 ? 0.7 : 0.9, at)
      st = applyAttempt(st, round, skill, history, at)
      history = [round, ...history].slice(0, 20)
    }
    expect(st.tempoCeiling).toBe(100)
    // A rough round that is not a warm-up still brings the ceiling down.
    expect(applyAttempt(state, attempt({ playedTempo: 60, targetTempo: 60, accuracy: 0.5, performance: 0.5, at: NOW }), skill, [], NOW).tempoCeiling).toBeLessThan(60)
  })
})

describe('guitar: a skill without steps is rated exactly as it was before singing', () => {
  // Recorded from applyAttempt as it stood before it knew about steps (commit ad9a5de).
  // A rating rule changed on purpose changes the digest: the failing case prints the new one.
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

  it('four months of mixed rounds, warm-ups, recaps and checks leave the same trail of states', () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
    const kinds = ['practice', 'practice', 'warmup', 'review', 'test'] as const
    let s = newSkillState('alt-picking', 0)
    const history: Attempt[] = []
    const trail = []
    for (let i = 0; i < 160; i++) {
      const accuracy = Math.round((0.4 + 0.6 * random()) * 100) / 100
      const tempo = 60 + Math.round(random() * 12) * 5
      const run = attempt({
        at: NOW + i * 18 * 3_600_000,
        kind: kinds[Math.floor(random() * kinds.length)],
        accuracy,
        performance: Math.round(accuracy * 95) / 100,
        playedTempo: tempo,
        targetTempo: tempo,
        difficulty: 20 + Math.round(random() * 40),
        reliable: random() > 0.1,
        bleed: random() > 0.95,
      })
      s = applyAttempt(s, run, skill, history.slice(0, 20), run.at)
      history.unshift(run)
      trail.push(s)
    }
    expect(trail.some((x) => 'step' in x)).toBe(false)
    expect(digest(trail)).toBe('594db4e497ec1299')
  })
})

describe('singing: a skill with steps is rated on its ladder, at one tempo', () => {
  // A stand-in for "Match a note": first tier, one tempo, four steps.
  const steps = [0, 12, 20, 28].map((bonus, i) => ({ label: `step ${i + 1}`, params: {}, bonus }))
  const match: SkillDef = { ...skill, id: 'voice.pitch.match', tier: 0, refTempo: 60, startTempo: 60, targetTempo: 60, minTempo: 60, steps }
  const MINUTE = 60_000
  /** A round on a step as the app records it: at the skill's one tempo, with the difficulty of that step. */
  const round = (step: number, accuracy: number, over: Partial<Attempt> = {}): Attempt =>
    attempt({
      playedTempo: 60,
      targetTempo: 60,
      accuracy,
      performance: accuracy,
      difficulty: itemDifficulty(match, { tempo: 60, bonus: steps[step].bonus }),
      params: { tempo: 60, bars: 4, step },
      ...over,
    })
  const on = (step: number | undefined, rating: number): SkillState => ({ ...confident, skillId: match.id, rating, ...(step === undefined ? {} : { step }) })
  /** Applies rounds one after another, a minute apart, each with the ones before it as its history. */
  const after = (start: SkillState, rounds: Attempt[]): SkillState => {
    let s = start
    const history: Attempt[] = []
    rounds.forEach((r, i) => {
      const run = { ...r, at: NOW + i * MINUTE }
      s = applyAttempt(s, run, match, history.slice(0, 20), run.at)
      history.unshift(run)
    })
    return s
  }

  it('clean rounds on a step lead to the stop of that step and no further: 50, 62 and 70 on the first three steps', () => {
    const stops = [50, 62, 70]
    stops.forEach((stop, step) => {
      let s = on(step, 0)
      for (let i = 0; i < 200; i++) s = applyAttempt(s, round(step, 1, { at: NOW + i * 1000 }), match)
      expect(s.rating, `step ${step}`).toBeCloseTo(stop, 6)
    })
    // Each is under what clean rounds at the start tempo give a tempo skill: the ladder sets the stop, not the tempo.
    expect(Math.max(...stops)).toBeLessThan(START_TEMPO_RATING)
  })

  it('reaches the top only by accurate rounds on the last step, a point or more a round', () => {
    const start = on(3, 70)
    expect(applyAttempt(start, round(3, 0.9), match).rating).toBeGreaterThanOrEqual(70 + AT_TARGET_MIN_GAIN)
    let s = start
    for (let i = 0; i < 30; i++) s = applyAttempt(s, round(3, 0.9, { at: NOW + i * 1000 }), match)
    expect(s.rating).toBe(100)
    // Not from the step below, however many clean rounds.
    let below = start
    for (let i = 0; i < 200; i++) below = applyAttempt(below, round(2, 1, { at: NOW + i * 1000 }), match)
    expect(below.rating).toBeCloseTo(70, 6)
    // Not by a round on the last step that was not accurate: it shows no more than the steps sung cleanly before.
    let rough = on(3, 30)
    for (let i = 0; i < 200; i++) rough = applyAttempt(rough, round(3, 0.8, { at: NOW + i * 1000, performance: 0.84 }), match)
    expect(rough.rating).toBeLessThan(80)
    // The tempo itself proves nothing here: the same clean rounds on step 0 stay at the first stop,
    // although they are "at the target tempo" of a skill that has only one.
    let slow = on(0, 0)
    for (let i = 0; i < 200; i++) slow = applyAttempt(slow, round(0, 1, { at: NOW + i * 1000 }), match)
    expect(slow.rating).toBeCloseTo(50, 6)
  })

  it('on a harder ladder the stops are "solid" and up: 75, 82, then the top, and a rough round proves only the steps sung cleanly before', () => {
    // A stand-in for "A whole line on one breath": third tier of five, three steps.
    const rungs = [0, 8, 16].map((bonus, i) => ({ label: `step ${i + 1}`, params: {}, bonus }))
    const phrases: SkillDef = { ...match, id: 'voice.breath.phrases', tier: 2, refTempo: 72, startTempo: 72, targetTempo: 72, minTempo: 72, steps: rungs }
    const line = (step: number, accuracy: number, at: number): Attempt =>
      attempt({ at, playedTempo: 72, targetTempo: 72, accuracy, performance: accuracy, difficulty: itemDifficulty(phrases, { tempo: 72, bonus: rungs[step].bonus }), params: { tempo: 72, bars: 4, step } })
    const reach = (step: number, accuracy: number, start: SkillState) => {
      let s = start
      for (let i = 0; i < 200; i++) s = applyAttempt(s, line(step, accuracy, NOW + i * 1000), phrases)
      return s.rating
    }
    const fresh = (step: number, rating = 0): SkillState => ({ ...confident, skillId: phrases.id, rating, step })
    expect(reach(0, 1, fresh(0))).toBeCloseTo(START_TEMPO_RATING, 6)
    expect(reach(1, 1, fresh(1))).toBeCloseTo((START_TEMPO_RATING + BELOW_TARGET_RATING) / 2, 6)
    expect(reach(2, 1, fresh(2))).toBe(100)
    // 84 % on the second step, by someone who has sung only the first step cleanly: it shows the first
    // step and no more, however often. Sung accurately, the same step leads on to its own stop.
    expect(reach(1, 0.84, fresh(1, 60))).toBeCloseTo(START_TEMPO_RATING, 6)
    expect(reach(1, 0.9, fresh(1, 60))).toBeCloseTo(82, 6)
    // And 84 % on the last step is not the top either.
    expect(reach(2, 0.84, fresh(2, 60))).toBeCloseTo(82, 6)
  })

  it('a voice that cannot hold the last steps finishes the skill on the highest step it can', () => {
    // The block says how far this singer's range reaches: step 1 of 4.
    const reach = { params: { tempo: 60, bars: 4, step: 1, maxStep: 1 } }
    let s = on(1, 62)
    for (let i = 0; i < 40; i++) s = applyAttempt(s, round(1, 0.9, { ...reach, at: NOW + i * 1000 }), match)
    expect(s.rating).toBe(100)
    // Without that limit the same rounds stop where step 1 stops.
    let unlimited = on(1, 62)
    for (let i = 0; i < 40; i++) unlimited = applyAttempt(unlimited, round(1, 0.9, { at: NOW + i * 1000 }), match)
    expect(unlimited.rating).toBeCloseTo(62, 6)
    // And the step practice starts from never passes what the range holds.
    const capped = after(on(1, 62), [round(1, 0.9, reach), round(1, 0.9, reach), round(1, 0.9, reach)])
    expect(capped.step).toBe(1)
  })

  it('the step practice starts from rises on the second clean round, one step at a time', () => {
    expect(STEP_UP_CLEAN_RUNS).toBe(2)
    expect(after(on(undefined, 30), [round(0, 0.9)]).step ?? 0).toBe(0)
    expect(after(on(undefined, 30), [round(0, 0.9), round(0, 0.86)]).step).toBe(1)
    // A third clean round on the same step proves no more about the next one.
    expect(after(on(undefined, 30), [round(0, 0.9), round(0, 0.9), round(0, 0.9)]).step).toBe(1)
    // A rough round in between does not undo the first clean one.
    expect(after(on(undefined, 30), [round(0, 0.9), round(0, 0.7), round(0, 0.9)]).step).toBe(1)
    // A clean round on the step above counts for the step below as well: two clean rounds, one on each.
    expect(after(on(undefined, 30), [round(0, 0.9), round(1, 0.9)]).step).toBe(1)
    expect(after(on(undefined, 30), [round(0, 0.9), round(1, 0.9), round(1, 0.9)]).step).toBe(2)
    // Never past the last step.
    expect(after(on(3, 80), [round(3, 0.9), round(3, 0.9), round(3, 0.9)]).step).toBe(3)
    // And clean rounds on an easier step than the one already reached leave it where it is.
    expect(after(on(2, 60), [round(0, 0.9), round(0, 0.9)]).step).toBe(2)
  })

  it('only rounds that count raise it: 85 % or better, heard well, recent, and not scored from the speaker', () => {
    const first = round(0, 0.9)
    expect(after(on(0, 30), [first, round(0, 0.84)]).step).toBe(0)
    expect(after(on(0, 30), [first, round(0, 0.9, { reliable: false })]).step).toBe(0)
    expect(after(on(0, 30), [round(0, 0.9, { reliable: false }), first]).step).toBe(0)
    expect(after(on(0, 30), [first, round(0, 0.9, { bleed: true })]).step).toBe(0)
    expect(after(on(0, 30), [round(0, 0.9, { bleed: true }), first]).step).toBe(0)
    expect(after(on(0, 30), [round(0, 0.9, { partial: true }), first]).step).toBe(0)
    // The first clean round was 31 days ago.
    const old = { ...first, at: NOW - 31 * DAY }
    expect(applyAttempt(on(0, 30), round(0, 0.9), match, [old], NOW).step ?? 0).toBe(0)
    // Or it has dropped out of the last ten rounds (this one and the nine before it).
    const since = Array.from({ length: 9 }, (_, i) => round(0, 0.8, { at: NOW - (i + 1) * MINUTE }))
    expect(applyAttempt(on(0, 30), round(0, 0.9), match, [...since, { ...first, at: NOW - 11 * MINUTE }], NOW).step ?? 0).toBe(0)
    expect(applyAttempt(on(0, 30), round(0, 0.9), match, [...since.slice(1), { ...first, at: NOW - 11 * MINUTE }], NOW).step).toBe(1)
  })

  it('falls one step after three rounds in a row under 60 %, and only then', () => {
    expect(STEP_DOWN_LOW_RUNS).toBe(3)
    const low = (step: number) => round(step, 0.5)
    expect(after(on(2, 60), [low(2), low(2)]).step).toBe(2)
    expect(after(on(2, 60), [low(2), low(2), low(2)]).step).toBe(1)
    // 60 % is not under 60 %, and a better round in between starts the count again.
    expect(after(on(2, 60), [low(2), round(2, 0.6), low(2)]).step).toBe(2)
    expect(after(on(2, 60), [low(2), low(2), round(2, 0.8), low(2), low(2)]).step).toBe(2)
    // Rounds that got easier on the way count: each was on the step reached or below it.
    expect(after(on(2, 60), [low(2), low(1), low(0)]).step).toBe(1)
    // A hard time on a step above the one reached says nothing against the one reached.
    expect(after(on(1, 60), [low(2), low(2), low(2)]).step).toBe(1)
    // Three more are needed for the next step down, and the first step is the floor.
    expect(after(on(2, 60), [low(2), low(2), low(2), low(2), low(2)]).step).toBe(1)
    expect(after(on(0, 60), [low(0), low(0), low(0)]).step ?? 0).toBe(0)
  })

  it('in a block that gets easier round by round, the step keeps falling for as long as the rounds stay under 60 %', () => {
    // What the Coach does after a rough round is the step below (`nextRepStep`), so in a real block
    // every low round is on the step reached or below it, and the last three are low from the third on.
    const low = (step: number) => round(step, 0.5)
    const trail = (rounds: Attempt[]) => rounds.map((_, i) => after(on(3, 70), rounds.slice(0, i + 1)).step)
    expect(trail([low(3), low(2), low(1), low(0), low(0), low(0)])).toEqual([3, 3, 2, 1, 0, 0])
    // It stops with the first round that is not low: 60 % on the easier step is enough.
    expect(trail([low(3), low(2), low(1), round(0, 0.6), low(0), low(0)])).toEqual([3, 3, 2, 2, 2, 2])
    expect(trail([low(3), low(2), low(1), round(0, 0.9), low(1), low(0)])).toEqual([3, 3, 2, 2, 2, 2])
    // And it is won back as quickly: two clean rounds a step.
    expect(after(on(0, 40), [round(0, 0.9), round(1, 0.9), round(1, 0.9)]).step).toBe(2)
  })

  it('a warm-up never lowers the step, however rough, and can raise it', () => {
    const warm = (step: number, accuracy: number) => round(step, accuracy, { kind: 'warmup' })
    expect(after(on(2, 60), [warm(1, 0.4), warm(1, 0.4), warm(1, 0.4)]).step).toBe(2)
    // The same three rounds as practice do lower it.
    expect(after(on(2, 60), [round(1, 0.4), round(1, 0.4), round(1, 0.4)]).step).toBe(1)
    expect(after(on(1, 60), [warm(1, 0.9), warm(1, 0.9)]).step).toBe(2)
    // A run that was not sung through is practice, not a result: it moves nothing, whatever came before it
    // (here three rough warm-ups, which were waiting for one more rough round that counts).
    const before = [0, 1, 2].map((i) => ({ ...warm(1, 0.4), at: NOW - (i + 1) * MINUTE }))
    expect(applyAttempt(on(2, 60), round(1, 0.4, { partial: true }), match, before, NOW).step).toBe(2)
    expect(applyAttempt(on(2, 60), round(1, 0.4), match, before, NOW).step).toBe(1)
  })

  it('a round that says nothing about its step counts as the first step, and bleed changes nothing at all', () => {
    const bare = round(0, 0.9, { params: undefined })
    expect(after(on(undefined, 30), [bare, bare]).step).toBe(1)
    const state = on(2, 60)
    expect(applyAttempt(state, round(2, 0.2, { bleed: true }), match, [round(2, 0.2), round(2, 0.2)], NOW)).toEqual(state)
  })

  it('a stored step that is no step is read as one on the ladder, in the state and in a round, and nothing breaks', () => {
    const before = round(0, 0.9, { at: NOW - MINUTE })
    for (const odd of [1.7, Number.NaN, -3, Number.POSITIVE_INFINITY, '2' as unknown as number]) {
      const fromState = applyAttempt(on(odd, 30), round(0, 0.9), match, [before], NOW)
      expect(Number.isInteger(fromState.step), `state ${odd}`).toBe(true)
      expect(fromState.step, `state ${odd}`).toBeGreaterThanOrEqual(1)
      expect(fromState.step, `state ${odd}`).toBeLessThanOrEqual(3)
      expect(Number.isFinite(fromState.rating)).toBe(true)
      const fromRound = applyAttempt(on(0, 30), round(0, 0.9, { params: { tempo: 60, bars: 4, step: odd, maxStep: odd } }), match, [before], NOW)
      expect([0, 1, 2, 3], `round ${odd}`).toContain(fromRound.step)
      expect(Number.isFinite(fromRound.rating)).toBe(true)
    }
    // A ladder of one step: that step is the top, so an accurate round there can finish the skill.
    const single: SkillDef = { ...match, steps: steps.slice(0, 1) }
    let s = on(undefined, 40)
    for (let i = 0; i < 80; i++) s = applyAttempt(s, round(0, 0.9, { at: NOW + i * 1000 }), single)
    expect(s.rating).toBe(100)
    expect(s.step).toBe(0)
    // An empty ladder is no ladder: the skill is rated by its tempos and gets no step.
    const none: SkillDef = { ...match, steps: [] }
    expect('step' in applyAttempt(on(undefined, 40), round(0, 0.9), none)).toBe(false)
  })

  it('a skill without steps never gets a step, and its tempo ceiling is kept as before for a step skill', () => {
    const plain = applyAttempt(confident, attempt({ params: { tempo: 100, bars: 4, step: 2 } }), skill, [attempt({ at: NOW - 1000 })])
    expect('step' in plain).toBe(false)
    expect(after(on(0, 30), [round(0, 0.9)]).tempoCeiling).toBe(60)
  })
})
