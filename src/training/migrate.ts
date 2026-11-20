import { db } from '../db/db'
import { BELOW_TARGET_RATING, CEILING_MIN_ACCURACY, DRILL_REV, SONG_FULL_SPEED } from './constants'
import { tempoProgressRating } from './learner'
import { SKILLS_BY_ID } from './skills'
import type { SkillState } from './types'

/**
 * Skills whose own drill now has twice the notes per beat (sixteenths where it had eighths, eighths
 * where it had quarters). A tempo reached on the old drill would start the new one twice as fast.
 */
const DOUBLED_DRILLS = ['pick.alternate-16', 'lead.major-scale']

/**
 * Revision 2: the Coach stops at a skill's target tempo, and a rating above "solid" has to be earned on
 * the way there. What an earlier version stored is brought in line:
 * - a tempo ceiling above the target comes down to the target (the learner did play it that fast, so
 *   the rating stays);
 * - a practised skill that was never played accurately at its target keeps at most the rating its
 *   fastest accurate tempo can show. Earlier versions rated a hard skill "mastered" after a few slow
 *   rounds, and a mastered skill is never planned as an exercise again: without this the learner would
 *   stay stuck with it.
 * `shown` is the fastest accurate round on record for the skill. The stored ceiling alone is not enough:
 * it follows the last ten rounds, so it falls when those were warm-ups (played at 0.9 x) or a check at a
 * set tempo, and a learner who did reach the target would lose a rating they had earned.
 * A skill rated by the first check alone (never practised) has no tempo of its own to go by. It keeps
 * its rating up to just under "mastered": the first check of earlier versions could rate a skill 93 or
 * 100 from one slow task, and such a skill was never planned, and never went rusty either.
 */
function alignWithTarget(state: SkillState, shown: number): SkillState {
  const def = SKILLS_BY_ID[state.skillId]
  if (!def) return state
  const next = state.tempoCeiling > def.targetTempo ? { ...state, tempoCeiling: def.targetTempo } : state
  const fastest = Math.max(shown, Number.isFinite(state.tempoCeiling) ? state.tempoCeiling : 0)
  if (fastest >= def.targetTempo) return next
  const stop = state.attempts <= 0 ? BELOW_TARGET_RATING : tempoProgressRating(fastest, { start: def.startTempo, target: def.targetTempo })
  return next.rating > stop ? { ...next, rating: stop } : next
}

/**
 * For each skill, the fastest tempo among its stored rounds that were accurate (CEILING_MIN_ACCURACY, not
 * slowed down) and counted. The two drills whose tempo changed its meaning are left out: their rounds
 * from before the change were at twice the tempo, and nothing on a round says which drill it was.
 */
async function fastestAccurateTempos(): Promise<Map<string, number>> {
  const fastest = new Map<string, number>()
  await db.attempts
    .where('skillId')
    .above('')
    .each((a) => {
      if (!a.skillId || a.bleed || a.partial || DOUBLED_DRILLS.includes(a.skillId)) return
      if (!(a.accuracy >= CEILING_MIN_ACCURACY) || (a.speed ?? 1) < SONG_FULL_SPEED || !Number.isFinite(a.playedTempo)) return
      fastest.set(a.skillId, Math.max(fastest.get(a.skillId) ?? 0, a.playedTempo))
    })
  return fastest
}

/**
 * Brings what an earlier version stored in line with today's drills and rules: once per learner, marked
 * on the profile in the same transaction, so no step can ever be applied twice. Resolves to the number
 * of skills changed. A new learner's profile is created at the current revision and is left alone.
 */
export function migrateStoredTempos(): Promise<number> {
  return db.transaction('rw', db.profile, db.skillStates, db.attempts, async () => {
    const profile = await db.profile.get(1)
    const from = profile?.drillRev ?? 0
    if (!profile || from >= DRILL_REV) return 0
    const changed = new Set<string>()
    if (from < 1) {
      for (const id of DOUBLED_DRILLS) {
        const state = await db.skillStates.get(id)
        const start = SKILLS_BY_ID[id]?.startTempo
        if (!state || start === undefined || !(state.tempoCeiling > start)) continue
        await db.skillStates.put({ ...state, tempoCeiling: Math.max(start, Math.round(state.tempoCeiling / 2)) })
        changed.add(id)
      }
    }
    if (from < 2) {
      const shown = await fastestAccurateTempos()
      for (const state of await db.skillStates.toArray()) {
        const next = alignWithTarget(state, shown.get(state.skillId) ?? 0)
        if (next === state) continue
        await db.skillStates.put(next)
        changed.add(state.skillId)
      }
    }
    await db.profile.put({ ...profile, drillRev: DRILL_REV })
    return changed.size
  })
}
