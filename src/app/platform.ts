/** Small platform helpers, mostly for iOS Safari quirks. */

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports itself as a Mac with touch support.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iDevice || iPadOS
}

/** iOS major.minor from the UA ("CPU iPhone OS 18_3 like Mac OS X"); null on iPadOS desktop UA or non-iOS. */
export function iosVersion(): number | null {
  if (typeof navigator === 'undefined') return null
  const m = /OS (\d+)[_.](\d+)/.exec(navigator.userAgent)
  return m ? Number(m[1]) + Number(m[2]) / 100 : null
}

/**
 * What kind of iOS browser this is. Only meaningful when `isIOS()`.
 * - `safari`: Mobile Safari, can Add to Home Screen.
 * - `browser`: Chrome/Firefox/Edge/Opera for iOS (WebKit under the hood). They also offer
 *   Share -> Add to Home Screen since iOS 16.4.
 * - `webview`: in-app browsers (Instagram, Facebook, Line, Google app...). No install possible.
 */
export function iosBrowser(): 'safari' | 'browser' | 'webview' {
  if (typeof navigator === 'undefined') return 'safari'
  const ua = navigator.userAgent
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|Twitter|GSA\/|; wv\)/.test(ua)) return 'webview'
  if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)) return 'browser'
  // Real Mobile Safari always carries "Version/x" and "Safari/"; WKWebView wrappers carry neither.
  return /Version\/[\d.]+/.test(ua) && /Safari\//.test(ua) ? 'safari' : 'webview'
}

export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  if (isIOS()) return iosBrowser() === 'safari'
  const ua = navigator.userAgent
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)
}

/** True when running as an installed (home screen) web app or inside a native wrapper. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true || isCapacitor()
}

export function isCapacitor(): boolean {
  return typeof window !== 'undefined' && 'Capacitor' in window
}

/**
 * Ask iOS for an audio session type. `play-and-record` keeps playback on the speaker at full volume
 * while the mic is open; `playback` makes Web Audio ignore the hardware silent switch
 * (by default iOS mutes Web Audio, but not <audio>, when the switch is on silent).
 */
export function setAudioSessionType(type: AudioSessionType): void {
  try {
    const session = navigator.audioSession
    if (session && session.type !== type) session.type = type
  } catch {
    /* unsupported */
  }
}

/**
 * Keeps an AudioContext alive across iOS interruptions. WebKit moves a running context to the
 * non-standard `"interrupted"` state for phone calls, Siri, alarms and app switches, and it does
 * not come back on its own. Retries `resume()` when the page becomes visible again, when the
 * audio session or the context changes state, and on the next tap as a last resort.
 * Returns a disposer.
 */
export function keepAudioContextRunning(ctx: AudioContext, onResumed?: () => void): () => void {
  let wasRunning = ctx.state === 'running'
  let busy = false
  const tryResume = () => {
    const state = ctx.state as string
    if (state === 'running') {
      wasRunning = true
      return
    }
    if (!wasRunning || state === 'closed' || busy) return
    busy = true
    ctx
      .resume()
      .then(() => onResumed?.())
      .catch(() => {
        /* needs a gesture: the tap fallback below retries */
      })
      .finally(() => {
        busy = false
      })
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') tryResume()
  }
  const onPageShow = () => tryResume()
  const onState = () => tryResume()
  const onGesture = () => tryResume()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('focus', onPageShow)
  document.addEventListener('pointerdown', onGesture, true)
  ctx.addEventListener('statechange', onState)
  const session = typeof navigator !== 'undefined' ? navigator.audioSession : undefined
  session?.addEventListener('statechange', onState)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('focus', onPageShow)
    document.removeEventListener('pointerdown', onGesture, true)
    ctx.removeEventListener('statechange', onState)
    session?.removeEventListener('statechange', onState)
  }
}
