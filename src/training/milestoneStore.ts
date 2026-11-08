import { db } from '../db/db'
import type { Milestone } from './types'

/** Stores milestones whose key is not stored yet (one transaction); returns the newly stored ones with ids. */
export async function recordMilestones(ms: Milestone[]): Promise<Milestone[]> {
  if (ms.length === 0) return []
  return db.transaction('rw', db.milestones, async () => {
    const stored: Milestone[] = []
    const seen = new Set<string>()
    for (const m of ms) {
      if (seen.has(m.key)) continue
      seen.add(m.key)
      if (await db.milestones.where('key').equals(m.key).first()) continue
      const { id: _ignored, ...rest } = m
      void _ignored
      const id = (await db.milestones.add(rest)) as number
      stored.push({ ...rest, id })
    }
    return stored
  })
}

/** Newest-first milestones. */
export function listMilestones(limit = 20): Promise<Milestone[]> {
  return db.milestones.orderBy('at').reverse().limit(limit).toArray()
}

/** Milestones earned strictly after `ts`, newest first. */
export function milestonesSince(ts: number): Promise<Milestone[]> {
  return db.milestones.where('at').above(ts).reverse().sortBy('at')
}
