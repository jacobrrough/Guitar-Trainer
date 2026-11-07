import { useEffect } from 'react'

/**
 * Keeps the screen on while `active` (playing a song, tuning, metronome running).
 * Re-acquires the lock when the tab becomes visible again; no-op where unsupported.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false
    const request = async () => {
      try {
        if (document.visibilityState !== 'visible') return
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        /* denied (low battery) or unsupported */
      }
    }
    const onVisibility = () => {
      if (!cancelled && document.visibilityState === 'visible') void request()
    }
    void request()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release()
      sentinel = null
    }
  }, [active])
}
