/** Small platform helpers, mostly for iOS Safari quirks. */

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports itself as a Mac with touch support.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iDevice || iPadOS
}

export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
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

/** Ask iOS for a mic + speaker session so playback is not routed to the earpiece or ducked. */
export function setAudioSessionType(type: AudioSessionType): void {
  try {
    const session = navigator.audioSession
    if (session && session.type !== type) session.type = type
  } catch {
    /* unsupported */
  }
}
