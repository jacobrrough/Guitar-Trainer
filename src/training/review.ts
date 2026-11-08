import {
  REVIEW_FIRST_INTERVAL_DAYS,
  REVIEW_HOLD_P,
  REVIEW_MAX_EASE,
  REVIEW_MIN_EASE,
  REVIEW_PASS_P,
  REVIEW_START_EASE,
  WEAK_BAR_ACCURACY,
} from './constants'
import type { Attempt, LearnerModel, SongItemState } from './types'

const DAY_MS = 86400000

export interface ReviewSchedule {
  ease: number
  intervalDays: number
  nextReviewAt: number
}

export function startReview(now: number): ReviewSchedule {
  return { ease: REVIEW_START_EASE, intervalDays: REVIEW_FIRST_INTERVAL_DAYS, nextReviewAt: now + REVIEW_FIRST_INTERVAL_DAYS * DAY_MS }
}

/** SM-2-style update (docs §4.4). */
export function nextReview(current: { ease: number; intervalDays: number }, p: number, now: number): ReviewSchedule {
  let { ease, intervalDays } = current
  if (p >= REVIEW_PASS_P) {
    intervalDays = Math.max(1, Math.round(intervalDays * ease))
    ease = Math.min(REVIEW_MAX_EASE, ease + 0.05)
  } else if (p >= REVIEW_HOLD_P) {
    intervalDays = Math.max(1, Math.round(intervalDays * 1.2))
  } else {
    intervalDays = 1
    ease = Math.max(REVIEW_MIN_EASE, ease - 0.2)
  }
  return { ease, intervalDays, nextReviewAt: now + intervalDays * DAY_MS }
}

export function songItemKey(songId: number, level: number): string {
  return `${songId}:${level}`
}

export function newSongItem(songId: number, level: number): SongItemState {
  return {
    key: songItemKey(songId, level),
    songId,
    level,
    bestAccuracy: null,
    lastAt: null,
    ease: REVIEW_START_EASE,
    intervalDays: 0,
    weakBars: [],
  }
}

export function applySongAttempt(item: SongItemState, attempt: Attempt, now = attempt.at): SongItemState {
  const weakBars: number[] = []
  attempt.perBar?.forEach((acc, i) => {
    if (acc < WEAK_BAR_ACCURACY) weakBars.push(i)
  })
  const next: SongItemState = {
    ...item,
    bestAccuracy: Math.max(item.bestAccuracy ?? 0, attempt.accuracy),
    lastAt: now,
    weakBars,
  }
  if (item.nextReviewAt !== undefined) {
    return { ...next, ...nextReview(item, attempt.performance, now) }
  }
  if (attempt.accuracy >= 0.9 && attempt.speed >= 1) return { ...next, ...startReview(now) }
  return next
}

/** Items whose review is due, most overdue first. */
export function dueReviews(model: LearnerModel, now = Date.now()): { skillIds: string[]; songItemKeys: string[] } {
  const due = <T>(entries: [string, T][], at: (v: T) => number | undefined): string[] =>
    entries
      .map(([id, v]) => ({ id, at: at(v) }))
      .filter((e): e is { id: string; at: number } => e.at !== undefined && e.at <= now)
      .sort((a, b) => a.at - b.at)
      .map((e) => e.id)
  return {
    skillIds: due(Object.entries(model.skills), (s) => s.nextReviewAt),
    songItemKeys: due(Object.entries(model.songItems), (s) => s.nextReviewAt),
  }
}
