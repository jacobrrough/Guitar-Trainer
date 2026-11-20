import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { localDateString } from '../../training/store'
import type { SessionRecord } from '../../training/types'
import { msUntilNextDay, sessionForDate } from './todayDate'

function session(date: string, id = 1): SessionRecord {
  return { id, date, plan: { date, minutes: 0, dayFactor: 1, blocks: [], explanation: [] }, minutesDone: 12, completedBlockIds: [], startedAt: 0 }
}

describe('msUntilNextDay', () => {
  it('lands just after midnight, on the next calendar day', () => {
    for (const now of [new Date(2026, 10, 20, 21, 30, 0), new Date(2026, 10, 20, 0, 0, 0), new Date(2026, 11, 31, 23, 59, 59, 500), new Date(2026, 1, 28, 12, 0, 0)]) {
      const then = new Date(now.getTime() + msUntilNextDay(now))
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      expect(localDateString(then)).toBe(localDateString(tomorrow))
      // Within the first seconds of the new day.
      expect(then.getTime() - tomorrow.getTime()).toBeLessThan(5000)
    }
  })

  it('never asks for a timer shorter than a second', () => {
    expect(msUntilNextDay(new Date(2026, 10, 20, 23, 59, 59, 999))).toBeGreaterThanOrEqual(1000)
    expect(msUntilNextDay(new Date(2026, 10, 21, 0, 0, 0, 500))).toBeGreaterThanOrEqual(1000)
  })
})

describe('sessionForDate: Today never shows another day', () => {
  const yesterday = session('2026-11-19', 1)
  const today = session('2026-11-20', 2)

  it('shows the stored session of the day, or the one just planned', () => {
    expect(sessionForDate('2026-11-20', today, null)).toBe(today)
    expect(sessionForDate('2026-11-20', 'loading', today)).toBe(today)
    expect(sessionForDate('2026-11-20', null, today)).toBe(today)
    expect(sessionForDate('2026-11-20', 'loading', null)).toBeNull()
  })

  it('shows nothing, not yesterday, when the app is brought back the next morning', () => {
    // The date has moved on; the query for the new day is still running and the old plan is in memory.
    expect(sessionForDate('2026-11-20', 'loading', yesterday)).toBeNull()
    // The new day has no session yet.
    expect(sessionForDate('2026-11-20', null, yesterday)).toBeNull()
    // The query still holds yesterday's row for a moment.
    expect(sessionForDate('2026-11-20', yesterday, yesterday)).toBeNull()
    expect(sessionForDate('2026-11-20', yesterday, today)).toBe(today)
  })
})
