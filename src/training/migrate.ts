import { db } from '../db/db'
import { DRILL_REV } from './constants'
import { SKILLS_BY_ID } from './skills'

/**
 * Skills whose own drill now has twice the notes per beat (sixteenths where it had eighths, eighths
 * where it had quarters). A tempo reached on the old drill would start the new one twice as fast.
 */
const DOUBLED_DRILLS = ['pick.alternate-16', 'lead.major-scale']

/**
 * Brings tempos stored by an earlier version in line with today's drills: once per learner, marked
 * on the profile in the same transaction, so it can never be applied twice. Resolves to the number
 * of skills changed. A new learner's profile is created at the current revision and is left alone.
 */
export function migrateStoredTempos(): Promise<number> {
  return db.transaction('rw', db.profile, db.skillStates, async () => {
    const profile = await db.profile.get(1)
    if (!profile || (profile.drillRev ?? 0) >= DRILL_REV) return 0
    let changed = 0
    for (const id of DOUBLED_DRILLS) {
      const state = await db.skillStates.get(id)
      const start = SKILLS_BY_ID[id]?.startTempo
      if (!state || start === undefined || !(state.tempoCeiling > start)) continue
      await db.skillStates.put({ ...state, tempoCeiling: Math.max(start, Math.round(state.tempoCeiling / 2)) })
      changed++
    }
    await db.profile.put({ ...profile, drillRev: DRILL_REV })
    return changed
  })
}
