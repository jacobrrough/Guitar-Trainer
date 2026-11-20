import { useEffect, useSyncExternalStore } from 'react'

/**
 * App updates. The service worker downloads a new version in the background. It must never replace
 * the page in the middle of a song, so a downloaded version waits for a quiet moment:
 * - found while the app is still opening and nothing has been touched: applied at once, so the app
 *   simply opens up to date;
 * - found later: the main screens show an "Update ready" bar and the learner decides; if they put
 *   the app away on a quiet screen first, it is applied then, out of sight.
 * An installed app on a phone is often resumed rather than reopened, so the app also asks for a new
 * version when it comes back to the foreground.
 */

/** What the service worker registration gives us to switch to the waiting version (reloads the page). */
type Apply = (reloadPage?: boolean) => Promise<void>

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'development build'

/** Screens on which a reload would interrupt something: playing, a lesson, the set-up, tuning, a test. */
const BUSY_ROUTES = [/^#\/play\//, /^#\/lessons\/./, /^#\/today\/block\//, /^#\/test\//, /^#\/start(\b|$)/, /^#\/tune($|[/?])/]

export function isBusyRoute(hash: string): boolean {
  return BUSY_ROUTES.some((r) => r.test(hash))
}

/** How long after launch a freshly found update may still be applied without asking. */
export const SILENT_UPDATE_WINDOW_MS = 6000
const RECHECK_AFTER_MS = 2 * 60 * 1000

/** An update found now: apply it straight away, or wait for the learner? */
export function shouldApplySilently(state: { sinceLaunchMs: number; touched: boolean; hash: string }): boolean {
  return !state.touched && state.sinceLaunchMs <= SILENT_UPDATE_WINDOW_MS && !isBusyRoute(state.hash)
}

let apply: Apply | null = null
let registration: ServiceWorkerRegistration | null = null
let ready = false
/**
 * The new version's service worker has taken this page over; only the reload is still to come. From
 * then on the old page cannot count on its own files any more (the new worker has dropped them), so the
 * reload must not wait for longer than it takes to interrupt nothing.
 */
let switched = false
/** The switch in progress: who asked for it, and how much the learner had done when it began. */
let switching: { askedFor: boolean; before: number; fallback: ReturnType<typeof setTimeout> } | null = null
let touched = false
/** Taps and key presses so far (to tell whether the learner has done anything since a switch began). */
let touches = 0
let lastCheck = 0
/** Something a reload would cut off that the route does not show (a running metronome, an open microphone). */
let busyElsewhere: () => boolean = () => false
/** Screens that have asked not to be reloaded for now (an import in progress, an open dialog with unsaved input). */
let holds = 0

/** True when a reload would interrupt nothing: a quiet route, nothing running, nobody holding. */
function quiet(): boolean {
  return holds === 0 && !isBusyRoute(window.location.hash) && !busyElsewhere()
}

/**
 * Keeps a waiting update from being applied by itself until the returned function is called. For work
 * that a reload would destroy and that the route does not show: a song being imported or transcribed,
 * a half-filled dialog.
 */
export function holdUpdates(): () => void {
  holds++
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
  }
}

/** `holdUpdates` for a component: held while `active`. */
export function useHoldUpdates(active = true): void {
  useEffect(() => (active ? holdUpdates() : undefined), [active])
}

const SILENT_KEY = 'guitar-trainer.silent-update'
/** A silent switch is not tried again for this long: if the new version did not take over, the page must not reload again and again. */
export const SILENT_RETRY_MS = 10 * 60 * 1000

/** Whether a silent switch may be tried now, given when the last one was (ms since epoch, or null). */
export function silentSwitchAllowed(lastAttempt: number | null, now: number): boolean {
  return lastAttempt === null || !Number.isFinite(lastAttempt) || now - lastAttempt >= SILENT_RETRY_MS
}

function silentAllowed(): boolean {
  try {
    const last = sessionStorage.getItem(SILENT_KEY)
    if (!silentSwitchAllowed(last === null ? null : Number(last), Date.now())) return false
    sessionStorage.setItem(SILENT_KEY, String(Date.now()))
  } catch {
    /* no session storage: allow it */
  }
  return true
}
const launchedAt = typeof performance !== 'undefined' ? performance.now() : 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/**
 * Switches to the downloaded version: the service worker takes over and the page reloads. Where the
 * worker's own reload does not come (a page that started before any worker controlled it), the page is
 * reloaded after a moment, but only if that still interrupts nothing; otherwise the "Update now" bar
 * stays, and the learner decides.
 */
function switchVersion(askedFor: boolean): void {
  if (switched) {
    // Nothing is waiting any more: the page only has to be loaded again.
    window.location.reload()
    return
  }
  const before = touches
  if (switching) clearTimeout(switching.fallback)
  const fallback = setTimeout(() => {
    switching = null
    const untouched = touches === before
    if (quiet() && (askedFor || untouched || document.visibilityState === 'hidden')) {
      window.location.reload()
      return
    }
    ready = true
    emit()
  }, 4000)
  switching = { askedFor, before, fallback }
  if (!apply) return
  apply(true).catch(() => {
    clearTimeout(fallback)
    switching = null
    if (askedFor) window.location.reload()
    else {
      ready = true
      emit()
    }
  })
}

/**
 * The new worker now controls the page. Reload at once when the learner asked for the update, or when
 * it interrupts nothing; otherwise (they have started something in the meantime) offer it and do it
 * at the next quiet moment.
 */
function onTakenOver(): void {
  switched = true
  const current = switching
  switching = null
  if (current) clearTimeout(current.fallback)
  const askedFor = current?.askedFor ?? false
  const untouched = current ? touches === current.before : false
  if (askedFor || (quiet() && (untouched || document.visibilityState === 'hidden'))) {
    window.location.reload()
    return
  }
  ready = true
  emit()
}

/** "Update now": the learner asked for it. */
export function applyUpdate(): void {
  switchVersion(true)
}

export type UpdateCheck = 'ready' | 'downloading' | 'current' | 'unavailable'

/** Asks the server for a new version now. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (ready) return 'ready'
  if (!registration) return 'unavailable'
  lastCheck = Date.now()
  try {
    await registration.update()
  } catch {
    return 'unavailable'
  }
  if (ready || registration.waiting) return 'ready'
  return registration.installing ? 'downloading' : 'current'
}

/** Wires the service worker registration in. Call once at start-up with the callbacks the registration expects. */
export function connectUpdates(
  register: (callbacks: {
    onNeedRefresh: () => void
    onNeedReload: () => void
    onRegisteredSW: (url: string, reg: ServiceWorkerRegistration | undefined) => void
  }) => Apply,
  busy: () => boolean = () => false,
): void {
  busyElsewhere = busy
  const markTouched = () => {
    touched = true
    touches++
  }
  window.addEventListener('pointerdown', markTouched, { capture: true, passive: true })
  window.addEventListener('keydown', markTouched, { capture: true, passive: true })
  apply = register({
    onNeedRefresh: () => {
      // Deferred: the registration may call back before `apply` is set.
      setTimeout(() => {
        const opening = shouldApplySilently({ sinceLaunchMs: performance.now() - launchedAt, touched, hash: window.location.hash })
        if ((opening || document.visibilityState === 'hidden') && quiet() && silentAllowed()) {
          switchVersion(false)
          return
        }
        ready = true
        emit()
      }, 0)
    },
    // Ours, not the registration's own unconditional reload: the learner may have started a song since.
    onNeedReload: onTakenOver,
    onRegisteredSW: (_url, reg) => {
      registration = reg ?? null
      lastCheck = Date.now()
    },
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Put away on a quiet screen with an update waiting: switch now, where nobody sees the reload.
      // (Once the new worker has taken over there is nothing to try again later: just reload.)
      if (ready && quiet() && (switched || silentAllowed())) switchVersion(false)
      return
    }
    if (!registration || Date.now() - lastCheck < RECHECK_AFTER_MS) return
    lastCheck = Date.now()
    registration.update().catch(() => {
      /* offline: try again next time */
    })
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True once a new version has been downloaded and is waiting to be switched to. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ready,
    () => false,
  )
}
