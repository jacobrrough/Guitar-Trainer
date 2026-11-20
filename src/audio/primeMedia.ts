import type { RefObject } from 'react'

/**
 * iOS Safari only lets a media element start from a user gesture, and our
 * count-in defers the real play() by a few seconds. Playing muted for an
 * instant inside the tap marks the element as user-activated so the later
 * programmatic play() is allowed.
 */
export function primeMediaElement(el: HTMLMediaElement, primed: RefObject<boolean>, playbackStarted: RefObject<boolean>): void {
  if (primed.current) return
  const wasMuted = el.muted
  el.muted = true
  const finish = () => {
    primed.current = true
    if (playbackStarted.current) return
    el.pause()
    try {
      if (el.currentTime > 0 && el.currentTime < 0.5) el.currentTime = 0
    } catch {
      /* not seekable yet */
    }
    el.muted = wasMuted
  }
  let promise: Promise<void> | undefined
  try {
    promise = el.play()
  } catch {
    el.muted = wasMuted
    return
  }
  if (promise && typeof promise.then === 'function') {
    promise.then(finish).catch(() => {
      if (!playbackStarted.current) el.muted = wasMuted
    })
  } else {
    finish()
  }
}
