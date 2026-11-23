import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VOICE_TEST_PASS } from './constants'
import { recommendations } from './recommend'
import type { RecommendContext } from './recommend'
import type { Attempt, LearnerModel, Recommendation, SkillDef, SkillState, SongSummary } from './types'

const DAY = 86_400_000
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime()

type Tier = 1 | 2 | 3 | 4
function skill(id: string, name: string, category: SkillDef['category'], tier: Tier, prerequisites: string[], gen: string): SkillDef {
  return {
    id, name, category, tier, prerequisites, refTempo: 80, startTempo: 60, targetTempo: 120,
    description: '', tips: [], generators: [gen],
  }
}
const skills: SkillDef[] = [
  skill('chord.power', 'Power chords', 'chords', 2, ['pick.downstrokes'], 'powerChordRiff'),
  skill('pick.downstrokes', 'Downstroke drill', 'picking', 1, [], 'chromatic'),
]
const library: SongSummary[] = [{ id: 7, title: 'Song', artist: 'X', duration: 100, bpm: 100, levelNoteCounts: [1, 2, 3, 4, 5, 6] }]
const st = (skillId: string, over: Partial<SkillState> = {}): SkillState => ({
  skillId, rating: 50, confidence: 3, tempoCeiling: 80, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 10, ...over,
})
const model: LearnerModel = {
  skills: { 'chord.power': st('chord.power'), 'pick.downstrokes': st('pick.downstrokes') },
  songItems: {},
  profile: { id: 1, goals: ['all-round'], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 },
}

function at(over: Partial<Attempt> = {}): Attempt {
  return {
    at: NOW - 1000, kind: 'practice', perfects: 9, goods: 1, misses: 0, total: 10, timingMedianMs: 5, timingStdevMs: 20, coverage: 0.9,
    durationSec: 30, playedTempo: 100, targetTempo: 100, speed: 1, difficulty: 40, performance: 0.8, accuracy: 0.95,
    reliable: true, ...over,
  }
}
const ctx = (recentAttempts: Attempt[], over: Partial<RecommendContext> = {}): RecommendContext => ({
  model, skills, library, recentAttempts, now: NOW, calibrationAgeDays: 5, ...over,
})
const find = (recs: ReturnType<typeof recommendations>, id: string) => recs.find((r) => r.id === id)

describe('song rules', () => {
  it('level up', () => {
    const r = find(recommendations(ctx([at({ kind: 'song', songId: 7, level: 3, accuracy: 0.93 })])), 'song-level-up')
    // Level index 3 is what the learner sees as Level 4, so the next one is Level 5.
    expect(r?.title).toBe('Level 5 unlocked.')
    expect(r?.reason).toContain('on level 4.')
    expect(r?.reason).toContain('Level 4 goes into your review schedule')
    expect(r?.action).toEqual({ type: 'song', songId: 7, level: 4, speed: 1 })
  })
  it('names levels the way the learner sees them, starting at 1', () => {
    const first = find(recommendations(ctx([at({ kind: 'song', songId: 7, level: 0, accuracy: 0.95 })])), 'song-level-up')
    expect(first?.title).toBe('Level 2 unlocked.')
    expect(first?.reason).not.toMatch(/level 0/i)
    expect(first?.reason).toContain('on level 1.')
  })
  it('does not announce a new level after the hardest one', () => {
    const recs = recommendations(ctx([at({ kind: 'song', songId: 7, level: 5, accuracy: 0.95 })]))
    expect(find(recs, 'song-level-up')).toBeUndefined()
    expect(recs.some((r) => /unlocked/i.test(r.title))).toBe(false)
    expect(find(recs, 'song-top-level')?.action).toBeUndefined()
  })
  it('a level-up needs full speed', () => {
    expect(find(recommendations(ctx([at({ kind: 'song', songId: 7, level: 0, accuracy: 0.95, speed: 0.75 })])), 'song-level-up')).toBeUndefined()
  })
  it('loops weak bars', () => {
    const perBar = [0.9, 0.9, 0.9, 0.9, 0.55, 0.6, 0.57, 0.6]
    const r = find(recommendations(ctx([at({ kind: 'song', songId: 7, level: 2, accuracy: 0.8, perBar })])), 'song-loop-weak-bars')
    expect(r?.title).toMatch(/Bars 5–8 were 58 %/)
    expect(r?.action).toMatchObject({ type: 'song', speed: 0.85, loopBars: [5, 8] })
  })
  it('slows down, then levels down after two failures', () => {
    const one = find(recommendations(ctx([at({ kind: 'song', songId: 7, level: 3, accuracy: 0.5 })])), 'song-slow-down')
    expect(one?.action).toMatchObject({ level: 3, speed: 0.8 })
    const two = find(
      recommendations(
        ctx([
          at({ kind: 'song', songId: 7, level: 3, accuracy: 0.5 }),
          at({ at: NOW - DAY, kind: 'song', songId: 7, level: 3, accuracy: 0.6 }),
        ]),
      ),
      'song-slow-down',
    )
    expect(two?.action).toMatchObject({ level: 2 })
    expect(two?.title).toBe('Two misses at level 4: dropping to level 3.')
    expect(two?.reason).toContain('on level 4')
  })
  it('drops from the second level to the first, and only slows down on the first', () => {
    const miss = (level: number, when = NOW - 1000) => at({ at: when, kind: 'song', songId: 7, level, accuracy: 0.5 })
    const second = find(recommendations(ctx([miss(1), miss(1, NOW - DAY)])), 'song-slow-down')
    expect(second?.title).toBe('Two misses at level 2: dropping to level 1.')
    expect(second?.action).toMatchObject({ level: 0 })
    const first = find(recommendations(ctx([miss(0), miss(0, NOW - DAY)])), 'song-slow-down')
    expect(first?.title).toBe('Let’s slow it down.')
    expect(first?.action).toMatchObject({ level: 0, speed: 0.8 })
    expect(first?.reason).toContain('on level 1')
  })
  it('counts two misses on the same level only', () => {
    const mixed = [at({ kind: 'song', songId: 7, level: 3, accuracy: 0.5 }), at({ at: NOW - DAY, kind: 'song', songId: 7, level: 4, accuracy: 0.5 })]
    expect(find(recommendations(ctx(mixed)), 'song-slow-down')?.action).toMatchObject({ level: 3, speed: 0.8 })
  })
  it('ignores songs older than 7 days', () => {
    const old = at({ at: NOW - 8 * DAY, kind: 'song', songId: 7, level: 3, accuracy: 0.95 })
    expect(find(recommendations(ctx([old])), 'song-level-up')).toBeUndefined()
  })
})

describe('exercise rules', () => {
  it('ratchets after two good reps', () => {
    const reps = [at({ skillId: 'pick.downstrokes' }), at({ skillId: 'pick.downstrokes', at: NOW - 5000 })]
    const r = find(recommendations(ctx(reps)), 'tempo-ratchet')
    expect(r?.title).toBe('Downstroke drill now clean at 100 bpm.')
    expect(r?.reason).toContain('Next: 105 bpm.')
    expect(r?.action).toEqual({ type: 'practice', skillId: 'pick.downstrokes', tempo: 105 })
  })
  it('never promises a tempo above the one the skill aims for', () => {
    // The skills here aim for 120 bpm.
    const near = find(recommendations(ctx([at({ skillId: 'pick.downstrokes', playedTempo: 118 }), at({ skillId: 'pick.downstrokes', playedTempo: 118, at: NOW - 5000 })])), 'tempo-ratchet')
    expect(near?.reason).toContain('Next: 120 bpm.')
    expect(near?.action).toEqual({ type: 'practice', skillId: 'pick.downstrokes', tempo: 120 })
    const there = find(recommendations(ctx([at({ skillId: 'pick.downstrokes', playedTempo: 120 }), at({ skillId: 'pick.downstrokes', playedTempo: 120, at: NOW - 5000 })])), 'tempo-ratchet')
    expect(there?.title).toBe('Downstroke drill now clean at 120 bpm.')
    expect(there?.reason).not.toMatch(/Next:/)
    expect(there?.reason).toContain('the tempo this exercise aims for')
    expect(there?.action).toEqual({ type: 'practice', skillId: 'pick.downstrokes', tempo: 120 })
    // A round that is clean by the Coach's own line (85 %) counts here too.
    const clean = at({ skillId: 'pick.downstrokes', accuracy: 0.86 })
    expect(find(recommendations(ctx([clean, { ...clean, at: NOW - 5000 }])), 'tempo-ratchet')).toBeDefined()
  })
  it('says nothing about tempo for ear training', () => {
    const ear = skill('ear.tuning', 'Tuning by ear', 'ear', 1, [], 'tuneByEar')
    const reps = [at({ skillId: 'ear.tuning', playedTempo: 80 }), at({ skillId: 'ear.tuning', playedTempo: 80, at: NOW - 5000 })]
    expect(find(recommendations(ctx(reps, { skills: [...skills, ear] })), 'tempo-ratchet')).toBeUndefined()
  })
  it('falls back after two bad reps', () => {
    const bad = { skillId: 'chord.power', accuracy: 0.4, playedTempo: 80 }
    const r = find(recommendations(ctx([at(bad), at({ ...bad, at: NOW - 5000 })])), 'fallback-density')
    expect(r?.title).toBe('Back to quarters at 72 bpm, then eighths.')
  })
})

describe('test rules', () => {
  it('names the next step after a pass, up to the tempo the skill aims for and never past it', () => {
    const r = find(recommendations(ctx([at({ kind: 'test', skillId: 'chord.power', targetTempo: 90 })])), 'test-passed-target-up')
    expect(r?.title).toBe('Power chords: 90 → 99 bpm.')
    expect(r?.priority).toBe(70)
    const near = find(recommendations(ctx([at({ kind: 'test', skillId: 'chord.power', targetTempo: 115 })])), 'test-passed-target-up')
    expect(near?.title).toBe('Power chords: 115 → 120 bpm.')
    expect(near?.action).toEqual({ type: 'practice', skillId: 'chord.power', tempo: 120 })
    expect(find(recommendations(ctx([at({ kind: 'test', skillId: 'chord.power', targetTempo: 120 })])), 'test-passed-target-up')).toBeUndefined()
  })
  it('adds a prerequisite after two failed tests', () => {
    const fail = { kind: 'test' as const, skillId: 'chord.power', perfects: 3, goods: 0, misses: 7, accuracy: 0.3, targetTempo: 100 }
    const r = find(recommendations(ctx([at(fail), at({ ...fail, at: NOW - DAY })])), 'test-failed-prereq')
    expect(r?.title).toBe('We’ll build this from the Downstroke drill drill.')
    expect(r?.action).toEqual({ type: 'practice', skillId: 'pick.downstrokes', tempo: 85 })
  })
})

describe('session rules', () => {
  it('calibrate on timing bias', () => {
    const r = find(recommendations(ctx([at({ timingMedianMs: 45 }), at({ timingMedianMs: 45 })])), 'calibrate')
    expect(r?.title).toContain('45 ms late')
    expect(r?.priority).toBe(90)
  })
  it('calibrate on stale calibration, not when fresh', () => {
    expect(find(recommendations(ctx([at()], { calibrationAgeDays: 45 })), 'calibrate')).toBeDefined()
    expect(find(recommendations(ctx([at()])), 'calibrate')).toBeUndefined()
  })
  it('mic coverage', () => {
    const r = find(recommendations(ctx([at({ coverage: 0.3 }), at({ coverage: 0.4 })])), 'mic-coverage')
    expect(r?.action).toEqual({ type: 'mic' })
    expect(r?.reason).toContain('35 %')
  })
  it('comeback and play-music', () => {
    const recs = recommendations(ctx([], { daysSinceLastSession: 9, lastSongPlayedAt: NOW - 20 * DAY }))
    expect(find(recs, 'comeback')?.priority).toBe(80)
    expect(find(recs, 'play-music')?.priority).toBe(30)
    expect(find(recommendations(ctx([], { daysSinceLastSession: 6, lastSongPlayedAt: NOW - 3 * DAY })), 'comeback')).toBeUndefined()
  })
  it('plateau', () => {
    const flat = Array.from({ length: 10 }, (_, i) =>
      at({ skillId: 'chord.power', at: NOW - (20 - i * 2) * DAY, ratingAfter: 50 + (i % 2) * 0.1, accuracy: 0.8 }),
    )
    const r = find(recommendations(ctx(flat)), 'plateau')
    expect(r?.title).toMatch(/weeks flat on Power chords: precision week/)
    expect(r?.priority).toBe(60)
  })
  it('a plateau step is worked out from the tempo the skill aims for at most, whatever tempo an earlier version stored', () => {
    const flat = Array.from({ length: 10 }, (_, i) =>
      at({ skillId: 'chord.power', at: NOW - (20 - i * 2) * DAY, ratingAfter: 50 + (i % 2) * 0.1, accuracy: 0.8 }),
    )
    const tempoOf = (tempoCeiling: number) => {
      const stored: LearnerModel = { ...model, skills: { ...model.skills, 'chord.power': st('chord.power', { tempoCeiling }) } }
      const r = find(recommendations(ctx(flat, { model: stored })), 'plateau')
      expect(r?.action?.type).toBe('practice')
      return r?.action?.type === 'practice' ? r.action.tempo : undefined
    }
    // The skills here aim for 120 bpm: a stored 240 gives the same step as 120.
    expect(tempoOf(240)).toBe(tempoOf(120))
    expect(tempoOf(240)!).toBeLessThanOrEqual(120)
    expect(tempoOf(100)!).toBeLessThan(tempoOf(120)!)
  })
})

describe('ordering and limits', () => {
  it('sorts by priority and caps at 6', () => {
    const perBar = [0.5, 0.5]
    const attempts = [
      at({ timingMedianMs: 60, coverage: 0.2, kind: 'song', songId: 7, level: 1, accuracy: 0.8, perBar }),
      at({ skillId: 'pick.downstrokes', timingMedianMs: 60 }),
      at({ skillId: 'pick.downstrokes', at: NOW - 5000, timingMedianMs: 60 }),
      at({ kind: 'test', skillId: 'chord.power', targetTempo: 90, timingMedianMs: 60 }),
    ]
    const recs = recommendations(ctx(attempts, { daysSinceLastSession: 10, lastSongPlayedAt: NOW - 30 * DAY }))
    expect(recs.length).toBeLessThanOrEqual(6)
    for (let i = 1; i < recs.length; i++) expect(recs[i - 1].priority).toBeGreaterThanOrEqual(recs[i].priority)
    expect(recs[0].id).toBe('calibrate')
  })
})

describe('guitar: advice asked for with no options reads as it did before singing', () => {
  // Recorded from the rules as they stood before they took any option (commit ad9a5de): every card, word for word.
  // A card reworded on purpose changes the digest: the failing case prints the new one.
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
  const song = (over: Partial<Attempt>) => at({ kind: 'song', songId: 7, ...over })
  const flat = Array.from({ length: 10 }, (_, i) => at({ skillId: 'chord.power', at: NOW - (20 - i * 2) * DAY, ratingAfter: 50 + (i % 2) * 0.1, accuracy: 0.8 }))
  const failed = { kind: 'test' as const, perfects: 3, goods: 0, misses: 7, accuracy: 0.3, targetTempo: 100 }
  const CASES: Record<string, RecommendContext> = {
    'level up': ctx([song({ level: 3, accuracy: 0.93 })]),
    'top level': ctx([song({ level: 5, accuracy: 0.95 })]),
    'weak bars': ctx([song({ level: 2, accuracy: 0.8, perBar: [0.9, 0.9, 0.9, 0.9, 0.55, 0.6, 0.57, 0.6] })]),
    'one weak bar': ctx([song({ level: 2, accuracy: 0.8, perBar: [0.9, 0.5, 0.9] })]),
    'slow down': ctx([song({ level: 3, accuracy: 0.5 })]),
    'slow down on the first level': ctx([song({ level: 0, accuracy: 0.5 }), song({ level: 0, accuracy: 0.5, at: NOW - DAY })]),
    'drop a level': ctx([song({ level: 3, accuracy: 0.5 }), song({ level: 3, accuracy: 0.6, at: NOW - DAY })]),
    ratchet: ctx([at({ skillId: 'pick.downstrokes' }), at({ skillId: 'pick.downstrokes', at: NOW - 5000 })]),
    'ratchet at the target': ctx([at({ skillId: 'pick.downstrokes', playedTempo: 120 }), at({ skillId: 'pick.downstrokes', playedTempo: 120, at: NOW - 5000 })]),
    fallback: ctx([at({ skillId: 'chord.power', accuracy: 0.4, playedTempo: 80 }), at({ skillId: 'chord.power', accuracy: 0.4, playedTempo: 80, at: NOW - 5000 })]),
    'check passed': ctx([at({ kind: 'test', skillId: 'chord.power', targetTempo: 90 })]),
    'check missed twice': ctx([at({ ...failed, skillId: 'chord.power' }), at({ ...failed, skillId: 'chord.power', at: NOW - DAY })]),
    'check missed twice, nothing under the skill': ctx([at({ ...failed, skillId: 'pick.downstrokes' }), at({ ...failed, skillId: 'pick.downstrokes', at: NOW - DAY })]),
    late: ctx([at({ timingMedianMs: 45 }), at({ timingMedianMs: 45 })]),
    early: ctx([at({ timingMedianMs: -55 }), at({ timingMedianMs: -55 })]),
    'old calibration': ctx([at()], { calibrationAgeDays: 45 }),
    'old calibration, nothing played': ctx([], { calibrationAgeDays: 45.4 }),
    'never calibrated': ctx([at()], { calibrationAgeDays: null }),
    'hard to hear': ctx([at({ coverage: 0.3 }), at({ coverage: 0.4 })]),
    'back after a break, no song for weeks': ctx([], { daysSinceLastSession: 9, lastSongPlayedAt: NOW - 20 * DAY }),
    'no song for weeks, empty library': ctx([], { lastSongPlayedAt: NOW - 20 * DAY, library: [] }),
    plateau: ctx(flat),
    'everything at once': ctx(
      [
        at({ timingMedianMs: 60, coverage: 0.2, kind: 'song', songId: 7, level: 1, accuracy: 0.8, perBar: [0.5, 0.5] }),
        at({ skillId: 'pick.downstrokes', timingMedianMs: 60 }),
        at({ skillId: 'pick.downstrokes', at: NOW - 5000, timingMedianMs: 60 }),
        at({ kind: 'test', skillId: 'chord.power', targetTempo: 90, timingMedianMs: 60 }),
      ],
      { daysSinceLastSession: 10, lastSongPlayedAt: NOW - 30 * DAY },
    ),
  }

  it('gives the same cards, in the same words, for every rule', () => {
    const cards = Object.entries(CASES).map(([name, c]) => [name, recommendations(c)] as const)
    // Every case really reaches its rule: an empty list would pin nothing.
    for (const [name, list] of cards) expect(list.length, name).toBeGreaterThan(0)
    expect(digest(cards)).toBe('4b5a172935ee4188')
  })
})

describe('advice for a singer', () => {
  // Stand-ins for three singing skills: two that climb a ladder of steps at one tempo, one with a tempo floor.
  const rungs = (labels: string[]) => labels.map((label, i) => ({ label, params: {}, bonus: 8 * i }))
  const fixed = { refTempo: 60, startTempo: 60, targetTempo: 60, minTempo: 60 }
  const match: SkillDef = { ...skill('voice.pitch.match', 'Match a note', 'pitch', 1, [], 'voiceEcho'), ...fixed, tier: 0, steps: rungs(['close notes', 'wider notes', 'the whole range']) }
  const hold: SkillDef = { ...skill('voice.pitch.hold', 'Hold a note steady', 'breath', 1, ['voice.pitch.match'], 'voiceHold'), ...fixed, steps: rungs(['4 beats', '6 beats', '8 beats']) }
  const stepwise: SkillDef = { ...skill('voice.pitch.steps', 'Step up and down', 'pitch', 1, [], 'voicePattern'), refTempo: 66, startTempo: 60, targetTempo: 88, minTempo: 54 }
  const five: SkillDef = { ...skill('voice.pitch.five-note', 'Five notes up and back', 'pitch', 1, ['voice.pitch.steps'], 'voicePattern'), refTempo: 66, startTempo: 60, targetTempo: 96, minTempo: 54 }
  const singing = [match, hold, stepwise, five]
  const singer: LearnerModel = {
    ...model,
    skills: {
      'voice.pitch.match': st('voice.pitch.match', { step: 2, tempoCeiling: 60 }),
      'voice.pitch.hold': st('voice.pitch.hold', { step: 1, tempoCeiling: 60 }),
      'voice.pitch.steps': st('voice.pitch.steps', { tempoCeiling: 60 }),
      'voice.pitch.five-note': st('voice.pitch.five-note', { tempoCeiling: 60 }),
    },
  }
  const sung = (recentAttempts: Attempt[], over: Partial<RecommendContext> = {}): RecommendContext => ({ model: singer, skills: singing, library, recentAttempts, now: NOW, calibrationAgeDays: null, ...over })
  const advice = (recentAttempts: Attempt[], over: Partial<RecommendContext> = {}) => recommendations(sung(recentAttempts, over), { instrument: 'voice' })
  const twice = (over: Partial<Attempt>) => [at(over), at({ ...over, at: NOW - 5000 })]
  const onStep = (def: SkillDef, step: number, over: Partial<Attempt> = {}): Partial<Attempt> => ({ skillId: def.id, playedTempo: 60, targetTempo: 60, params: { tempo: 60, bars: 4, step }, ...over })
  const textOf = (r: Recommendation | undefined) => `${r?.title} ${r?.reason}`
  /** The singer, with one skill standing on a given step of its ladder. */
  const reached = (def: SkillDef, step: number): LearnerModel => ({ ...singer, skills: { ...singer.skills, [def.id]: st(def.id, { step, tempoCeiling: 60 }) } })
  const song = (level: number, accuracy: number, when = NOW - 1000, over: Partial<Attempt> = {}) => at({ kind: 'song', songId: 7, level, accuracy, at: when, ...over })
  const flat = (def: SkillDef) => Array.from({ length: 10 }, (_, i) => at({ skillId: def.id, at: NOW - (20 - i * 2) * DAY, ratingAfter: 50 + (i % 2) * 0.1, accuracy: 0.8, playedTempo: 60 }))
  const notPassed = (def: SkillDef, targetTempo = 60) => twiceOn({ kind: 'test', skillId: def.id, perfects: 3, goods: 0, misses: 7, accuracy: 0.3, targetTempo, playedTempo: targetTempo })
  function twiceOn(over: Partial<Attempt>): Attempt[] {
    return [at(over), at({ ...over, at: NOW - DAY })]
  }

  it('offers no sound-sync card: not for late notes, not for an old or missing measurement, not before anything was sung', () => {
    const late = twice({ skillId: stepwise.id, timingMedianMs: 180, playedTempo: 60 })
    for (const calibrationAgeDays of [null, 5, 45]) {
      for (const attempts of [late, []]) {
        const cards = advice(attempts, { calibrationAgeDays })
        expect(find(cards, 'calibrate')).toBeUndefined()
        expect(cards.some((r) => r.action?.type === 'calibrate')).toBe(false)
      }
    }
    // The same rounds do get the card in the built-in advice, and the switch alone removes it.
    expect(find(recommendations(sung(late)), 'calibrate')).toBeDefined()
    expect(find(recommendations(sung(late), { calibrate: false }), 'calibrate')).toBeUndefined()
    expect(find(recommendations(sung([], { calibrationAgeDays: 45 })), 'calibrate')).toBeDefined()
    expect(find(recommendations(sung([], { calibrationAgeDays: 45 }), { calibrate: false }), 'calibrate')).toBeUndefined()
    // Asked for by name, a singer gets it too: the option wins over what the instrument implies.
    expect(find(recommendations(sung(late), { instrument: 'voice', calibrate: true }), 'calibrate')).toBeDefined()
  })

  it('never offers a slower song: one hard run gets no card, two in a row go back a level at the same speed', () => {
    expect(find(advice([song(3, 0.5)]), 'song-slow-down')).toBeUndefined()
    expect(find(advice([song(0, 0.5), song(0, 0.5, NOW - DAY)]), 'song-slow-down')).toBeUndefined()
    const back = find(advice([song(3, 0.5), song(3, 0.6, NOW - DAY)]), 'song-slow-down')
    expect(back?.action).toEqual({ type: 'song', songId: 7, level: 2, speed: 1 })
    expect(textOf(back)).toContain('level 3')
    expect(textOf(back)).not.toMatch(/slow|fast|speed|miss/i)
    // No loop of the weak bars at 85 % speed either.
    const weak = advice([song(2, 0.8, NOW - 1000, { perBar: [0.9, 0.5, 0.5, 0.9] })])
    expect(find(weak, 'song-loop-weak-bars')).toBeUndefined()
    expect(weak.some((r) => r.action?.type === 'song' && (r.action.speed !== 1 || r.action.loopBars !== undefined))).toBe(false)
    // Good news stays, at the one speed there is.
    expect(find(advice([song(3, 0.93)]), 'song-level-up')?.action).toEqual({ type: 'song', songId: 7, level: 4, speed: 1 })
    expect(find(advice([song(5, 0.95)]), 'song-top-level')).toBeDefined()
    // The speed list alone does it, in the built-in words; a list with a slower speed keeps the card.
    expect(find(recommendations(ctx([song(3, 0.5)]), { songSpeeds: [1] }), 'song-slow-down')).toBeUndefined()
    expect(find(recommendations(ctx([song(2, 0.8, NOW - 1000, { perBar: [0.9, 0.5, 0.5, 0.9] })]), { songSpeeds: [1] }), 'song-loop-weak-bars')).toBeUndefined()
    expect(find(recommendations(ctx([song(3, 0.5), song(3, 0.6, NOW - DAY)]), { songSpeeds: [1] }), 'song-slow-down')?.action).toEqual({ type: 'song', songId: 7, level: 2, speed: 1 })
    expect(find(recommendations(ctx([song(3, 0.5)]), { songSpeeds: [0.75, 0.85, 1] }), 'song-slow-down')?.action).toMatchObject({ level: 3, speed: 0.8 })
  })

  it('never proposes a tempo under the floor of a skill, in any card', () => {
    // Two hard rounds at 56: nine tenths of that would be 50.
    const easier = find(advice(twice({ skillId: stepwise.id, accuracy: 0.4, playedTempo: 56 })), 'fallback-density')
    expect(easier?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 54 })
    expect(textOf(easier)).toContain('54 bpm')
    // At the floor there is nothing slower to offer: the same tempo again, after listening.
    const floor = find(advice(twice({ skillId: stepwise.id, accuracy: 0.4, playedTempo: 54 })), 'fallback-density')
    expect(floor?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 54 })
    expect(floor?.title).toMatch(/listen first, then once more/i)
    // Two checks not passed at 60: 85 % of that would be 51, on the skill itself or on the one under it.
    expect(find(advice(notPassed(stepwise)), 'test-failed-prereq')?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 54 })
    expect(find(advice(notPassed(five)), 'test-failed-prereq')?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 54 })
    // A plateau: eight tenths of 60 would be 48.
    expect(find(advice(flat(stepwise)), 'plateau')?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 54 })
    // Nothing written on any of these cards names a tempo under the floor either.
    const cards = [twice({ skillId: stepwise.id, accuracy: 0.4, playedTempo: 56 }), twice({ skillId: stepwise.id, accuracy: 0.4, playedTempo: 54 }), notPassed(stepwise), notPassed(five), flat(stepwise)].flatMap((a) => advice(a))
    const named = cards.flatMap((r) => [...textOf(r).matchAll(/(\d+) bpm/g)].map((m) => Number(m[1])))
    expect(named.length).toBeGreaterThan(0)
    expect(Math.min(...named)).toBeGreaterThanOrEqual(54)
    // The floor belongs to the skill, so it holds in the built-in advice as well.
    expect(find(recommendations(sung(twice({ skillId: stepwise.id, accuracy: 0.4, playedTempo: 56 }))), 'fallback-density')?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 54 })
    // A skill without one is as before: 30 is the least any card names.
    expect(find(recommendations(ctx(twice({ skillId: 'chord.power', accuracy: 0.4, playedTempo: 32 }))), 'fallback-density')?.action).toMatchObject({ tempo: 30 })
  })

  it('speaks of steps, never of a tempo, for a skill that climbs a ladder', () => {
    const up = find(advice(twice(onStep(hold, 1))), 'step-ratchet')
    expect(textOf(up)).toContain('Hold a note steady')
    expect(textOf(up)).toContain('8 beats')
    expect(up?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.hold' })
    expect(find(advice(twice(onStep(hold, 1))), 'tempo-ratchet')).toBeUndefined()
    // On the last step, or the highest one the voice can hold, no further step is promised.
    for (const top of [twice(onStep(hold, 2)), twice(onStep(hold, 1, { params: { tempo: 60, bars: 4, step: 1, maxStep: 1 } }))]) {
      const last = find(advice(top), 'step-ratchet')
      expect(last).toBeDefined()
      expect(textOf(last)).not.toMatch(/8 beats|next comes/i)
    }
    // Two hard rounds: "listen first", and what the Coach does after a hard round. No step is promised by
    // name: the next exercise starts on the step the singer has reached, not on the one below the last round.
    const down = find(advice(twice(onStep(hold, 1, { accuracy: 0.4 }))), 'step-fallback')
    expect(down?.title).toBe('Hold a note steady: listen first, then once more.')
    expect(down?.reason).toMatch(/a step easier/)
    expect(textOf(down)).not.toMatch(/\d beats|back to/i)
    expect(down?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.hold' })
    // On the first step there is nothing easier to speak of.
    const first = find(advice(twice(onStep(hold, 0, { accuracy: 0.4 })), { model: reached(hold, 0) }), 'step-fallback')
    expect(first?.title).toMatch(/listen first, then once more/i)
    expect(first?.reason).not.toMatch(/a step easier/)
    expect(find(advice(twice(onStep(hold, 1, { accuracy: 0.4 }))), 'fallback-density')).toBeUndefined()
    // A check passed below the last step names the next one; on the last step there is nothing to add.
    const passed = find(advice([at(onStep(hold, 1, { kind: 'test' }))]), 'test-passed-step-up')
    expect(textOf(passed)).toContain('8 beats')
    expect(passed?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.hold' })
    expect(advice([at(onStep(hold, 2, { kind: 'test' }))]).filter((r) => r.id.startsWith('test-passed'))).toEqual([])
    // Two checks not passed, and a plateau: the exercise to go back to, with no tempo attached.
    expect(find(advice(notPassed(hold)), 'test-failed-prereq')?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.match' })
    expect(find(advice(flat(hold)), 'plateau')?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.hold' })
    // None of it mentions a tempo.
    const all = [twice(onStep(hold, 1)), twice(onStep(hold, 2)), twice(onStep(hold, 1, { accuracy: 0.4 })), twice(onStep(hold, 0, { accuracy: 0.4 })), [at(onStep(hold, 1, { kind: 'test' }))], notPassed(hold), flat(hold)]
    for (const attempts of all) {
      const cards = advice(attempts)
      expect(cards.length).toBeGreaterThan(0)
      for (const r of cards) {
        expect(textOf(r)).not.toMatch(/bpm|tempo|→/i)
        expect(r.action && 'tempo' in r.action).toBeFalsy()
      }
    }
  })

  it('a step card promises what the next exercise will bring: the step the singer has reached, not one further', () => {
    // Two clean rounds on "6 beats". They have opened "8 beats": the next exercise starts there.
    const opened = find(advice(twice(onStep(hold, 1)), { model: reached(hold, 2) }), 'step-ratchet')
    expect(opened?.reason).toBe('Next comes: 8 beats.')
    // The second of them was the first on "6 beats" (the round before was on "4 beats"): the next exercise
    // starts on "6 beats" again, and one more clean round there opens "8 beats".
    const climbing = [at(onStep(hold, 1)), at({ ...onStep(hold, 0), at: NOW - 5000 })]
    const close = find(advice(climbing, { model: reached(hold, 1) }), 'step-ratchet')
    expect(close?.reason).toBe('One more clean round and the next step opens: 8 beats.')
    // A voice that holds no more than "6 beats": that is the end of the ladder for it, whatever is stored.
    const capped = twice(onStep(hold, 1, { params: { tempo: 60, bars: 4, step: 1, maxStep: 1 } }))
    expect(find(advice(capped, { model: reached(hold, 2) }), 'step-ratchet')?.reason).toMatch(/as far as this exercise goes/)
    // And below it, no card names a step beyond what that voice can hold (a step stored before the range got smaller).
    const below = twice(onStep(hold, 0, { params: { tempo: 60, bars: 4, step: 0, maxStep: 1 } }))
    expect(find(advice(below, { model: reached(hold, 2) }), 'step-ratchet')?.reason).toBe('Next comes: 6 beats.')
    // A check passed on "6 beats": the step itself moves in practice, so the card says how close it is...
    const check = [at(onStep(hold, 1, { kind: 'test' }))]
    const near = find(advice(check, { model: reached(hold, 1) }), 'test-passed-step-up')
    expect(near?.title).toBe('Hold a note steady: the next step is close.')
    expect(near?.reason).toBe('You passed the check. A clean round or two in practice and the next step opens: 8 beats.')
    // ...and where practice has opened it since, that it comes next.
    const there = find(advice(check, { model: reached(hold, 2) }), 'test-passed-step-up')
    expect(there?.title).toBe('Hold a note steady: on to the next step.')
    expect(there?.reason).toBe('You passed the check. Next comes: 8 beats.')
    // A skill the model does not know yet is read as standing on its first step.
    const unknown: LearnerModel = { ...singer, skills: {} }
    expect(find(advice(twice(onStep(hold, 1)), { model: unknown }), 'step-ratchet')?.reason).toBe('One more clean round and the next step opens: 8 beats.')
  })

  it('can leave step skills without cards of their own', () => {
    const off = (attempts: Attempt[]) => recommendations(sung(attempts), { instrument: 'voice', stepSkills: false })
    for (const attempts of [twice(onStep(hold, 1)), twice(onStep(hold, 1, { accuracy: 0.4 })), [at(onStep(hold, 1, { kind: 'test' }))]]) {
      expect(off(attempts).filter((r) => /ratchet|fallback|test-passed/.test(r.id))).toEqual([])
    }
    // Tempo skills keep theirs.
    expect(find(off(twice({ skillId: stepwise.id, playedTempo: 60 })), 'tempo-ratchet')).toBeDefined()
  })

  it('a tempo skill keeps its tempo cards, in words for a singer', () => {
    const up = find(advice(twice({ skillId: stepwise.id, playedTempo: 60 })), 'tempo-ratchet')
    expect(up?.title).toBe('Step up and down now clean at 60 bpm.')
    expect(up?.reason).toContain('Next: 63 bpm.')
    expect(up?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 63 })
    const there = find(advice(twice({ skillId: stepwise.id, playedTempo: 88 })), 'tempo-ratchet')
    expect(there?.reason).not.toMatch(/Next:/)
    expect(there?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 88 })
  })

  it('judges a check by the pass mark of the instrument: 84 % with a loose beat passes a sung check, not a played one', () => {
    const check: Partial<Attempt> = { kind: 'test', skillId: stepwise.id, perfects: 6, goods: 3, misses: 1, accuracy: 0.84, timingMedianMs: 150, timingStdevMs: null, targetTempo: 60, playedTempo: 60 }
    expect(find(advice([at(check)]), 'test-passed-target-up')?.action).toEqual({ type: 'practice', skillId: 'voice.pitch.steps', tempo: 66 })
    expect(find(recommendations(sung([at(check)])), 'test-passed-target-up')).toBeUndefined()
    expect(find(recommendations(sung([at(check)]), { passCriteria: VOICE_TEST_PASS }), 'test-passed-target-up')).toBeDefined()
    // Two such checks are two passes, not two misses.
    expect(find(advice(twiceOn(check)), 'test-failed-prereq')).toBeUndefined()
    expect(find(recommendations(sung(twiceOn(check))), 'test-failed-prereq')).toBeDefined()
  })

  it('when the microphone hears little, the card says to come closer, never to sing louder', () => {
    const quiet = find(advice(twice({ skillId: stepwise.id, coverage: 0.3, playedTempo: 60 })), 'mic-coverage')
    expect(quiet?.action).toEqual({ type: 'mic' })
    expect(textOf(quiet)).toMatch(/closer/)
    expect(textOf(quiet)).not.toMatch(/loud|interface/i)
  })

  it('every card a singer can get is in plain words for a singer', () => {
    const NOT_FOR_A_SINGER = /\b(play|played|playing|guitar|strings?|fingers?|hands?|louder|wrong|failed|rating|reps?|latency|recalibrate|interface|quarters|eighths|tests?|film|technique|slow|slower|faster)\b|% speed/i
    const cases: [Attempt[], Partial<RecommendContext>?][] = [
      [[song(3, 0.93)]],
      [[song(5, 0.95)]],
      [[song(3, 0.5), song(3, 0.6, NOW - DAY)]],
      [[song(2, 0.8, NOW - 1000, { perBar: [0.9, 0.5, 0.5, 0.9] })]],
      [twice({ skillId: stepwise.id, playedTempo: 60 })],
      [twice({ skillId: stepwise.id, playedTempo: 88 })],
      [twice({ skillId: stepwise.id, accuracy: 0.4, playedTempo: 70 })],
      [twice({ skillId: stepwise.id, accuracy: 0.4, playedTempo: 54 })],
      [twice(onStep(hold, 1))],
      [twice(onStep(hold, 2))],
      [twice(onStep(hold, 1, { accuracy: 0.4 }))],
      [twice(onStep(hold, 0, { accuracy: 0.4 }))],
      [[at({ kind: 'test', skillId: stepwise.id, targetTempo: 60, playedTempo: 60 })]],
      [[at(onStep(hold, 1, { kind: 'test' }))]],
      [notPassed(stepwise)],
      [notPassed(five)],
      [notPassed(hold)],
      [flat(stepwise)],
      [flat(hold)],
      [twice({ skillId: stepwise.id, coverage: 0.3, timingMedianMs: 200, playedTempo: 60 })],
      [[], { daysSinceLastSession: 9, lastSongPlayedAt: NOW - 20 * DAY, calibrationAgeDays: 45 }],
      [[], { lastSongPlayedAt: NOW - 20 * DAY, library: [] }],
    ]
    const ids = new Set<string>()
    for (const [attempts, over] of cases) {
      for (const r of advice(attempts, over)) {
        ids.add(r.id)
        expect(textOf(r), r.id).not.toMatch(NOT_FOR_A_SINGER)
      }
    }
    // Every kind of card a singer can get was looked at.
    expect([...ids].sort()).toEqual(
      ['comeback', 'fallback-density', 'mic-coverage', 'plateau', 'play-music', 'song-level-up', 'song-slow-down', 'song-top-level', 'step-fallback', 'step-ratchet', 'tempo-ratchet', 'test-failed-prereq', 'test-passed-step-up', 'test-passed-target-up'],
    )
    // The plateau steps beyond the first have words of their own too.
    for (const plateauStep of [1, 2, 3]) {
      const stuck: LearnerModel = { ...singer, skills: { ...singer.skills, 'voice.pitch.steps': st('voice.pitch.steps', { tempoCeiling: 60, plateauStep }) } }
      const card = find(advice(flat(stepwise), { model: stuck }), 'plateau')
      expect(card, `step ${plateauStep}`).toBeDefined()
      expect(textOf(card)).not.toMatch(NOT_FOR_A_SINGER)
    }
  })
})
