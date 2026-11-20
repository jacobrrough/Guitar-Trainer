import { useEffect } from 'react'
import { keepAwakeVideo, videoFallbackNeeded } from './keepAwake'
import { iosVersion, isIOS, isStandalone } from './platform'

/**
 * iOS home-screen web apps (and WKWebView wrappers, which have no `navigator.wakeLock` at all)
 * cannot hold a screen wake lock before iOS 18.4: the request resolves in a standalone app
 * but the screen still auto-locks. A silent video keeps the screen on instead (see keepAwake.ts).
 */
function needsVideoFallback(refused = false): boolean {
  if (typeof navigator === 'undefined') return false
  return videoFallbackNeeded({ ios: isIOS(), hasWakeLock: 'wakeLock' in navigator, standalone: isStandalone(), iosVersion: iosVersion(), refused })
}

/** Sets the silent video up where it is needed, so that taps can unlock it. Plays nothing. */
function prepareVideoFallback(): void {
  if (!needsVideoFallback()) return
  try {
    keepAwakeVideo()?.prepare()
  } catch {
    /* no video support: the screen may lock, nothing else breaks */
  }
}

// Done when the app loads, not when a screen that needs it opens: guided tuning starts listening by
// itself, so the taps that can unlock the video all happen on the screens before it.
prepareVideoFallback()

/** Starts the silent video. Returns the function that stops it, or null if it could not be set up. */
function startVideoFallback(): (() => void) | null {
  try {
    return keepAwakeVideo()?.acquire() ?? null
  } catch {
    return null
  }
}

/**
 * Keeps the screen on while `active` (playing a song, tuning, metronome running).
 * Re-acquires the lock when the tab becomes visible again; falls back to a silent video on iOS
 * where the Wake Lock API is missing, does not work or refuses; no-op elsewhere.
 */
export function useWakeLock(active: boolean): void {
  // Normally done already when the app loaded. Repeated here in case that was too early for the
  // page; a second call does nothing.
  useEffect(prepareVideoFallback, [])

  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false
    let stopFallback: (() => void) | null = null
    const switchToVideo = () => {
      if (!cancelled && !stopFallback) stopFallback = startVideoFallback()
    }
    if (needsVideoFallback()) switchToVideo()
    const request = async () => {
      if (!('wakeLock' in navigator)) return
      try {
        if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
        const lock = await navigator.wakeLock.request('screen')
        // Unmounted while the request was in flight: do not leak the lock.
        if (cancelled) {
          void lock.release().catch(() => undefined)
          return
        }
        sentinel = lock
      } catch {
        // Denied or unsupported. A request made while hidden always fails, so only a refusal on a visible page counts.
        if (document.visibilityState === 'visible' && needsVideoFallback(true)) switchToVideo()
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
      void sentinel?.release().catch(() => undefined)
      sentinel = null
      stopFallback?.()
    }
  }, [active])
}
