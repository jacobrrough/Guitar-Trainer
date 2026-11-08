import { PLATEAU_MAX_SLOPE_PER_DAY, PLATEAU_MIN_ATTEMPTS, PLATEAU_MIN_DAYS, PLATEAU_RATING_BELOW } from './constants'
import type { Attempt, SkillState } from './types'

const DAY_MS = 86_400_000

export interface PlateauResult {
  plateau: boolean
  slopePerDay: number
  days: number
  count: number
}

/** Plateau detection (docs §8.1) over the attempts of a single skill. */
export function detectPlateau(attempts: Attempt[], _now: number): PlateauResult {
  const pts = attempts
    .filter((a) => typeof a.ratingAfter === 'number')
    .map((a) => ({ at: a.at, r: a.ratingAfter as number }))
    .sort((a, b) => a.at - b.at)
  const count = pts.length
  if (count === 0) return { plateau: false, slopePerDay: 0, days: 0, count: 0 }
  const t0 = pts[0].at
  const days = (pts[count - 1].at - t0) / DAY_MS
  const xs = pts.map((p) => (p.at - t0) / DAY_MS)
  const meanX = xs.reduce((s, x) => s + x, 0) / count
  const meanY = pts.reduce((s, p) => s + p.r, 0) / count
  let num = 0
  let den = 0
  for (let i = 0; i < count; i++) {
    num += (xs[i] - meanX) * (pts[i].r - meanY)
    den += (xs[i] - meanX) ** 2
  }
  const slopePerDay = den > 0 ? num / den : 0
  const latest = pts[count - 1].r
  const plateau =
    count >= PLATEAU_MIN_ATTEMPTS &&
    days >= PLATEAU_MIN_DAYS &&
    slopePerDay < PLATEAU_MAX_SLOPE_PER_DAY &&
    latest < PLATEAU_RATING_BELOW
  return { plateau, slopePerDay, days, count }
}

export interface Intervention {
  step: 1 | 2 | 3 | 4
  description: string
  tempoFactor: number
  repsMultiplier: number
  switchVariant: boolean
  prerequisiteSessions: number
}

const STEPS: Intervention[] = [
  {
    step: 1,
    description: 'precision week: tempo down 20 %, reps doubled',
    tempoFactor: 0.8,
    repsMultiplier: 2,
    switchVariant: false,
    prerequisiteSessions: 0,
  },
  {
    step: 2,
    description: 'switch to a different exercise variant',
    tempoFactor: 1,
    repsMultiplier: 1,
    switchVariant: true,
    prerequisiteSessions: 0,
  },
  {
    step: 3,
    description: 'three sessions on the prerequisite skill',
    tempoFactor: 1,
    repsMultiplier: 1,
    switchVariant: false,
    prerequisiteSessions: 3,
  },
  {
    step: 4,
    description: 'review the technique tips and film yourself; this skill is parked for two weeks',
    tempoFactor: 1,
    repsMultiplier: 1,
    switchVariant: false,
    prerequisiteSessions: 0,
  },
]

/** The next plateau intervention after state.plateauStep; null once all four steps were applied (parked). */
export function nextIntervention(state: SkillState): Intervention | null {
  const idx = Math.max(0, Math.floor(state.plateauStep))
  return idx >= STEPS.length ? null : { ...STEPS[idx] }
}
