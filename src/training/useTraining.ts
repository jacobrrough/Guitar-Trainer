import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { defaultProfile, recentAttempts } from './store'
import type { Attempt, LearnerModel, Profile, SessionRecord, TestRecord } from './types'

/** Read-only: returns the stored profile, or the default (unsaved) one until `loadProfile()` creates it. */
export function useProfile(): Profile | undefined {
  return useLiveQuery(async () => (await db.profile.get(1)) ?? defaultProfile(), [])
}

/** Read-only snapshot of the learner model; writes go through store.ts so live queries never write. */
export function useLearnerModel(): LearnerModel | undefined {
  return useLiveQuery(async () => {
    const [states, items, profile] = await Promise.all([db.skillStates.toArray(), db.songItems.toArray(), db.profile.get(1)])
    return {
      skills: Object.fromEntries(states.map((st) => [st.skillId, st])),
      songItems: Object.fromEntries(items.map((it) => [it.key, it])),
      profile: profile ?? defaultProfile(),
    }
  }, [])
}

/** `'loading'` until the query resolves, then the session for the date or `null`. */
export function useTodaySession(date: string): SessionRecord | null | 'loading' {
  return useLiveQuery(async () => (await db.sessions.where('date').equals(date).first()) ?? null, [date], 'loading' as const)
}

export function useRecentAttempts(days: number): Attempt[] | undefined {
  return useLiveQuery(() => recentAttempts({ sinceDays: days }), [days])
}

export function useTests(limit = 10): TestRecord[] | undefined {
  return useLiveQuery(() => db.tests.orderBy('at').reverse().limit(limit).toArray(), [limit])
}
