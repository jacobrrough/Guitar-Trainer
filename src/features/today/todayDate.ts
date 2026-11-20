import { useEffect, useState } from 'react'
import { localDateString } from '../../training/store'
import type { SessionRecord } from '../../training/types'

/** Milliseconds from `now` until just after the next local midnight, when the calendar date has changed. */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  // Never less than a second, so a timer that fires a moment early cannot spin.
  return Math.max(1000, next.getTime() - now.getTime())
}

/**
 * The session to show for `date`: the stored one, or the one that was just planned. Never another
 * day's: when the date moves on, yesterday's session is still in memory until today's is ready.
 */
export function sessionForDate(date: string, live: SessionRecord | null | 'loading', created: SessionRecord | null): SessionRecord | null {
  if (live !== 'loading' && live !== null && live.date === date) return live
  return created !== null && created.date === date ? created : null
}

/**
 * Today's date (YYYY-MM-DD, local time) that follows the calendar while the app stays open: it is
 * read again at midnight and whenever the app comes back to the front. A home-screen app is rarely
 * reloaded, so a date read once at start would still be yesterday's the next morning.
 */
export function useLocalDate(): string {
  const [date, setDate] = useState(() => localDateString(new Date()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      const now = new Date()
      setDate(localDateString(now))
      clearTimeout(timer)
      timer = setTimeout(refresh, msUntilNextDay(now))
    }
    // Timers do not run while the app is in the background, so coming back is checked as well.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }, [])
  return date
}
