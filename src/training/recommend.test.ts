import { describe, expect, it } from 'vitest'
import { recommendations } from './recommend'
import type { RecommendContext } from './recommend'
import type { Attempt, LearnerModel, SkillDef, SkillState, SongSummary } from './types'

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
      expect(r?.action.type).toBe('practice')
      return r?.action.type === 'practice' ? r.action.tempo : undefined
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
