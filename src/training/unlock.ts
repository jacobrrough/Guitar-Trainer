/**
 * One answer to "is this skill open for the learner?", shared by the planner, the "unlocked"
 * milestones and the skill map, so the plan, the announcements and the picture never disagree.
 */
import { COURSE } from '../lessons/course'
import type { Lesson } from '../lessons/types'
import { BEGINNER_MAX_RATING, UNLOCK_RATING } from './constants'
import { effectiveRating } from './learner'
import { prerequisitesSolid } from './skills'
import type { LearnerModel, SkillDef } from './types'

export interface OpenContext {
  /** Effective ratings (rust applied); a missing skill counts as 0. */
  ratings: Record<string, number>
  /** Stored ratings, to tell "gone rusty" from "never solid". Defaults to `ratings`. */
  rawRatings?: Record<string, number>
  /** Recorded practice rounds per skill (a skill check does not count). */
  attempts?: Record<string, number>
  /** Skills a finished lesson of the First steps course drilled. */
  taught?: ReadonlySet<string> | string[]
}

/**
 * Returns the test for one skill. A skill is open when
 * - everything under it, all the way down, is solid (rated UNLOCK_RATING or more), or
 * - the learner has already practised it and it is at most one tier above something they can do, or
 * - the skill itself is rated solid (shown in a first check), or
 * - a finished lesson taught it.
 * A prerequisite that was solid and has gone rusty closes the last three again until it is refreshed.
 */
export function skillOpener(skills: SkillDef[], ctx: OpenContext): (skill: SkillDef) => boolean {
  const { ratings } = ctx
  const raw = ctx.rawRatings ?? ratings
  const attempts = ctx.attempts ?? {}
  const taught = new Set(ctx.taught ?? [])
  const byId = new Map(skills.map((s) => [s.id, s]))
  const rated = (id: string) => ratings[id] ?? 0
  const reachTier = 1 + Math.max(0, ...skills.filter((s) => rated(s.id) >= BEGINNER_MAX_RATING).map((s) => s.tier))
  const rusted = (id: string) => (raw[id] ?? 0) >= UNLOCK_RATING && rated(id) < UNLOCK_RATING
  return (s) => {
    if (prerequisitesSolid(s, ratings, byId)) return true
    if (s.prerequisites.some(rusted)) return false
    const started = (attempts[s.id] ?? 0) > 0 && s.tier <= reachTier
    return started || rated(s.id) >= UNLOCK_RATING || taught.has(s.id)
  }
}

/**
 * Skills the finished lessons of the First steps course drilled, in course order, read from the lesson rows.
 * `course` is the course to read them for (the guitar course unless another is given): the lesson
 * table holds the rows of every course, and a row of another course teaches this one nothing.
 */
export function taughtSkillIds(progress: { id: string; status: string }[], course: Pick<Lesson, 'id' | 'drill'>[] = COURSE): string[] {
  const done = new Set(progress.filter((p) => p.status === 'done').map((p) => p.id))
  return [...new Set(course.filter((l) => done.has(l.id)).flatMap((l) => (l.drill ? [l.drill.skillId] : [])))]
}

/** The numbers `skillOpener` needs, read from a learner model at a point in time. */
export function openContextOf(model: LearnerModel, now: number, taught?: OpenContext['taught']): OpenContext {
  const ratings: Record<string, number> = {}
  const rawRatings: Record<string, number> = {}
  const attempts: Record<string, number> = {}
  for (const [id, st] of Object.entries(model.skills)) {
    ratings[id] = effectiveRating(st, now)
    rawRatings[id] = st.rating
    attempts[id] = st.attempts
  }
  return { ratings, rawRatings, attempts, taught }
}

/** Everything under a skill, nearest first, that is not solid yet: what the learner still has to build up. */
export function missingPrerequisites(skill: SkillDef, ratings: Record<string, number>, skills: SkillDef[]): SkillDef[] {
  const byId = new Map(skills.map((s) => [s.id, s]))
  const out: SkillDef[] = []
  const seen = new Set<string>()
  const queue = [...skill.prerequisites]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    const def = byId.get(id)
    if (!def) continue
    if ((ratings[id] ?? 0) < UNLOCK_RATING) out.push(def)
    queue.push(...def.prerequisites)
  }
  return out
}
