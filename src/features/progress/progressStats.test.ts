import { describe, expect, it } from 'vitest'
import type { Attempt, LearnerModel, SkillDef } from '../../training/types'
import { categorySummary, practiceStreakDays, ratingSeries, weeklyMinutes } from './progressStats'

function attempt(at: number, extra: Partial<Attempt> = {}): Attempt {
  return { at, kind: 'practice', durationSec: 60, ...extra } as Attempt
}

// Wednesday 2026-11-11 12:00 local
const NOW = new Date(2026, 10, 11, 12).getTime()
const day = (offset: number, hour = 10) => new Date(2026, 10, 11 + offset, hour).getTime()

describe('weeklyMinutes', () => {
  it('buckets by Monday-start local weeks', () => {
    const res = weeklyMinutes(
      [attempt(day(0), { durationSec: 120 }), attempt(day(-2), { durationSec: 60 }), attempt(day(-3), { durationSec: 600 })],
      NOW,
      3,
    )
    expect(res.map((r) => r.weekStart)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(res.map((r) => r.minutes)).toEqual([0, 10, 3])
  })
  it('ignores attempts outside the window', () => {
    expect(weeklyMinutes([attempt(day(-100))], NOW, 2).every((r) => r.minutes === 0)).toBe(true)
  })
})

describe('ratingSeries', () => {
  it('filters by skill, requires ratingAfter and sorts ascending', () => {
    const res = ratingSeries(
      [
        attempt(3, { skillId: 'a', ratingAfter: 30 }),
        attempt(1, { skillId: 'a', ratingAfter: 10 }),
        attempt(2, { skillId: 'b', ratingAfter: 99 }),
        attempt(4, { skillId: 'a' }),
      ],
      'a',
    )
    expect(res).toEqual([
      { at: 1, rating: 10 },
      { at: 3, rating: 30 },
    ])
  })
})

describe('practiceStreakDays', () => {
  it('counts consecutive days ending today', () => {
    expect(practiceStreakDays([attempt(day(0)), attempt(day(-1)), attempt(day(-2)), attempt(day(-4))], NOW)).toBe(3)
  })
  it('allows ending yesterday', () => {
    expect(practiceStreakDays([attempt(day(-1)), attempt(day(-2))], NOW)).toBe(2)
  })
  it('is zero after a gap', () => {
    expect(practiceStreakDays([attempt(day(-2))], NOW)).toBe(0)
    expect(practiceStreakDays([], NOW)).toBe(0)
  })
})

describe('categorySummary', () => {
  it('averages effective ratings with missing as 0', () => {
    const skills = [
      { id: 'a', category: 'fretting' },
      { id: 'b', category: 'fretting' },
      { id: 'c', category: 'ear' },
    ] as SkillDef[]
    const model = {
      skills: { a: { skillId: 'a', rating: 95, lastPracticedAt: NOW } },
      songItems: {},
      profile: {},
    } as unknown as LearnerModel
    const res = categorySummary(model, skills, NOW)
    expect(res.map((r) => r.category)).toEqual(['fretting', 'ear'])
    expect(res[0]).toMatchObject({ mean: 47.5, mastered: 1, total: 2 })
    expect(res[1]).toMatchObject({ mean: 0, mastered: 0, total: 1 })
  })
})
