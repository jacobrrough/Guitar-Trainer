import { useLiveQuery } from 'dexie-react-hooks'
import { listMilestones, milestonesSince } from './milestoneStore'
import { listTests, peekLearnerModel, peekProfile, peekSession, recentAttempts } from './store'
import type { Attempt, InstrumentId, LearnerModel, Milestone, Profile, SessionRecord, TestRecord } from './types'

/**
 * Live views of the training data. Each takes the instrument it shows and answers for guitar when none is
 * given. They only read: the queries behind them are the `peek…` and list functions of the stores, which
 * never write, so a live query can never create a profile or stamp a session while a screen is open.
 */

/** Read-only: returns the stored profile, or the default (unsaved) one until `loadProfile()` creates it. */
export function useProfile(instrument: InstrumentId = 'guitar'): Profile | undefined {
  return useLiveQuery(() => peekProfile(instrument), [instrument])
}

/** Read-only snapshot of the learner model; writes go through store.ts so live queries never write. */
export function useLearnerModel(instrument: InstrumentId = 'guitar'): LearnerModel | undefined {
  return useLiveQuery(() => peekLearnerModel(instrument), [instrument])
}

/** `'loading'` until the query resolves, then the instrument's session for the date or `null`. */
export function useTodaySession(date: string, instrument: InstrumentId = 'guitar'): SessionRecord | null | 'loading' {
  return useLiveQuery(async () => (await peekSession(date, instrument)) ?? null, [date, instrument], 'loading' as const)
}

export function useRecentAttempts(days: number, instrument: InstrumentId = 'guitar'): Attempt[] | undefined {
  return useLiveQuery(() => recentAttempts({ sinceDays: days, instrument }), [days, instrument])
}

export function useTests(limit = 10, instrument: InstrumentId = 'guitar'): TestRecord[] | undefined {
  return useLiveQuery(() => listTests(limit, instrument), [limit, instrument])
}

/** Newest-first milestones (live). */
export function useMilestones(limit = 20, instrument: InstrumentId = 'guitar'): Milestone[] | undefined {
  return useLiveQuery(() => listMilestones(limit, instrument), [limit, instrument])
}

/** Milestones earned after `ts` (live), newest first. */
export function useMilestonesSince(ts: number, instrument: InstrumentId = 'guitar'): Milestone[] | undefined {
  return useLiveQuery(() => milestonesSince(ts, instrument), [ts, instrument])
}
