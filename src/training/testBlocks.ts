import { db } from '../db/db'
import { finishTest, instrumentOfCheck, minutesPlayed } from './coach'
import { recordMilestones } from './milestoneStore'
import { streakMilestone } from './milestones'
import { completeBlock, getSession, loadProfile, localDateString, saveProfile, updateStreak } from './store'
import type { Attempt, InstrumentId, Profile, SessionRecord, TestBlock, TestRecord, TestTask, TestTaskResult, TestType } from './types'
import { milestonesFor } from './voicePlan'

/**
 * A day can hold two plans, one for the guitar and one for singing, and each can have a skill check
 * open. Everything here is told which instrument the check was taken on, so a sung check closes the
 * block of the singing plan and counts the day for the singing streak, and never the guitar's. Left
 * out, the instrument is guitar, as it was before there were two.
 */

/**
 * Counts the day for the streak of one instrument. The check that has just been saved reset the number
 * of sessions since the last check, and the day it was taken on is not one of them, so that number is
 * left alone.
 */
function markStreakDay(date: string, instrument: InstrumentId): Promise<{ before: Profile; after: Profile }> {
  return db.transaction('rw', db.profile, async () => {
    const before = await loadProfile(instrument)
    const after = updateStreak(before, date)
    if (after !== before) await saveProfile(after)
    return { before, after }
  })
}

/** The plan of one instrument for the day `now` falls on and its open skill-check block of this type, if it has one. */
async function openTestBlock(type: TestType, now: number, instrument: InstrumentId = 'guitar'): Promise<{ session: SessionRecord; sessionId: number; block: TestBlock } | null> {
  const session = await getSession(localDateString(new Date(now)), instrument)
  if (!session || session.id === undefined) return null
  const block = session.plan.blocks.find((b): b is TestBlock => b.kind === 'test' && b.test === type && (b.status === 'pending' || b.status === 'active'))
  return block ? { session, sessionId: session.id, block } : null
}

/**
 * Runs that can be the result of an exercise or song block. The tasks of a skill check carry the
 * session's id too, so that their time counts for the day, but they are the check's own: a task on
 * the same skill or song must not be shown as the result of that block.
 */
export function blockRuns<T extends Pick<Attempt, 'kind'>>(attempts: T[]): T[] {
  return attempts.filter((a) => a.kind !== 'test')
}

/**
 * Closes the skill-check block of this type in the plan of the day the check was finished on, with
 * the bookkeeping any finished block gets: status, time played, the end of the session and the streak.
 * `runs` are the check's task runs; their length is the time the block took.
 * `instrument` says whose plan and whose streak (a streak reached by singing is stored as a singer's).
 * Returns the updated session, or null when that day's plan has no open block of this type (the
 * check was started from somewhere else, or it has been closed already): then nothing changes.
 */
export async function completeTestBlock(
  type: TestType,
  now = Date.now(),
  runs: Pick<Attempt, 'durationSec' | 'bleed'>[] = [],
  instrument: InstrumentId = 'guitar',
): Promise<SessionRecord | null> {
  const open = await openTestBlock(type, now, instrument)
  if (!open) return null
  const updated = await completeBlock(open.sessionId, open.block.id, minutesPlayed(runs))
  if (!updated) return null
  const { before, after } = await markStreakDay(open.session.date, instrument)
  const milestone = streakMilestone(before.streak, after.streak, now)
  if (milestone) await recordMilestones(milestonesFor(instrument, [milestone]))
  return updated
}

/**
 * Saves a finished skill check and then closes its block in today's plan, so the plan does not
 * offer the same check again. The block is only touched once the check itself is stored.
 *
 * When the plan has the check open, its task runs are stored as runs of that session: the session's
 * time is counted afresh from its runs whenever a later block is finished, and the check's time
 * would drop out of it otherwise.
 *
 * `whose`: whose check it is. Left out, it is read from the tasks (`instrumentOfCheck`: one task on a
 * singing skill makes it a sung check, and so does a song to sing in a check that names no skill). The
 * check screen of a singer still hands it over: it knows, and nothing then has to be looked up.
 */
export async function saveFinishedTest(type: TestType, tasks: TestTask[], results: TestTaskResult[], now = Date.now(), whose?: InstrumentId): Promise<TestRecord> {
  const instrument = whose ?? (await instrumentOfCheck(tasks))
  const open = await openTestBlock(type, now, instrument).catch(() => null)
  const stored = open ? results.map((r) => ({ ...r, attempt: { ...r.attempt, sessionId: open.sessionId } })) : results
  const record = await finishTest(type, tasks, stored, now, instrument)
  try {
    await completeTestBlock(
      type,
      now,
      record.results.map((r) => r.attempt),
      instrument,
    )
  } catch {
    // The check is saved and its report must still be shown; the block stays open for now.
  }
  return record
}
