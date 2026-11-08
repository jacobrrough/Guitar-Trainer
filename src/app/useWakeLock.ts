import { useEffect } from 'react'
import { iosVersion, isIOS, isStandalone } from './platform'

/**
 * iOS home-screen web apps (and WKWebView wrappers, which have no `navigator.wakeLock` at all)
 * cannot hold a screen wake lock before iOS 18.4: the request resolves in a standalone app
 * but the screen still auto-locks. Playing a muted inline video keeps the screen on instead.
 */
function needsVideoFallback(): boolean {
  if (!isIOS()) return false
  if (!('wakeLock' in navigator)) return true
  const v = iosVersion()
  return isStandalone() && v !== null && v < 18.04
}

/** Muted 2x2 canvas stream played in a hidden <video>. Returns a disposer, or null if unsupported. */
function startVideoFallback(): (() => void) | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    const g = canvas.getContext('2d')
    if (!g || typeof canvas.captureStream !== 'function') return null
    let flip = false
    const paint = () => {
      flip = !flip
      g.fillStyle = flip ? '#000' : '#010101'
      g.fillRect(0, 0, 2, 2)
    }
    paint()
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.setAttribute('aria-hidden', 'true')
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none'
    video.srcObject = canvas.captureStream(5)
    document.body.appendChild(video)
    const timer = window.setInterval(paint, 500)
    const play = () => void video.play().catch(() => undefined)
    play()
    document.addEventListener('visibilitychange', play)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', play)
      video.pause()
      video.srcObject = null
      video.remove()
    }
  } catch {
    return null
  }
}

/**
 * Keeps the screen on while `active` (playing a song, tuning, metronome running).
 * Re-acquires the lock when the tab becomes visible again; falls back to a muted video on iOS
 * where the Wake Lock API is missing or ineffective; no-op elsewhere.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false
    let stopFallback: (() => void) | null = null
    if (needsVideoFallback()) stopFallback = startVideoFallback()
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
      void sentinel?.release().catch(() => undefined)
      sentinel = null
      stopFallback?.()
    }
  }, [active])
}
