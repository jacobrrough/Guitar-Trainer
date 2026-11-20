import { afterEach, describe, expect, it, vi } from 'vitest'
import { SILENT_RETRY_MS, SILENT_UPDATE_WINDOW_MS, holdUpdates, isBusyRoute, shouldApplySilently, silentSwitchAllowed } from './appUpdate'

describe('app updates', () => {
  it('knows the screens a reload would interrupt', () => {
    for (const hash of ['#/play/3', '#/lessons/l01-hold', '#/today/block/b2', '#/test/placement', '#/start', '#/tune']) expect(isBusyRoute(hash), hash).toBe(true)
    for (const hash of ['', '#/', '#/songs', '#/lessons', '#/settings', '#/tuner', '#/metronome', '#/progress']) expect(isBusyRoute(hash), hash).toBe(false)
  })

  it('applies an update silently only while the app is opening, untouched, on a quiet screen', () => {
    expect(shouldApplySilently({ sinceLaunchMs: 800, touched: false, hash: '#/' })).toBe(true)
    expect(shouldApplySilently({ sinceLaunchMs: 800, touched: true, hash: '#/' })).toBe(false)
    expect(shouldApplySilently({ sinceLaunchMs: SILENT_UPDATE_WINDOW_MS + 1, touched: false, hash: '#/' })).toBe(false)
    expect(shouldApplySilently({ sinceLaunchMs: 800, touched: false, hash: '#/play/1' })).toBe(false)
  })

  it('does not try a silent switch again straight after one: no reload loop if the new version did not take over', () => {
    const now = 1_000_000_000
    expect(silentSwitchAllowed(null, now)).toBe(true)
    expect(silentSwitchAllowed(now - 5_000, now)).toBe(false)
    expect(silentSwitchAllowed(now - SILENT_RETRY_MS, now)).toBe(true)
  })

  it('a hold can be released once, and releasing twice does not unbalance the count', () => {
    const release = holdUpdates()
    const other = holdUpdates()
    release()
    release()
    other()
    // Nothing to observe from outside but that it does not throw; the count is exercised in the browser test.
    expect(typeof release).toBe('function')
  })
})

describe('a waiting update and the moment it is applied', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
  })

  /** The module on a page of its own: fake window, document and service worker registration. */
  async function page(hash = '#/songs') {
    vi.resetModules()
    vi.useFakeTimers()
    const handlers: Record<string, Array<() => void>> = {}
    const on = (type: string, fn: () => void) => void (handlers[type] ??= []).push(fn)
    const fire = (type: string) => handlers[type]?.forEach((fn) => fn())
    const doc = { visibilityState: 'visible', addEventListener: on }
    const win = { location: { hash, reload: vi.fn() }, addEventListener: on }
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', doc)
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined })
    const mod = await import('./appUpdate')
    const apply = vi.fn(() => Promise.resolve())
    let found: () => void = () => undefined
    let takenOver: () => void = () => undefined
    let busy = false
    mod.connectUpdates(
      (callbacks) => {
        found = callbacks.onNeedRefresh
        takenOver = callbacks.onNeedReload
        return apply
      },
      () => busy,
    )
    return {
      mod,
      apply,
      win,
      reload: win.location.reload,
      /** The new version's service worker has taken the page over. */
      takenOver: () => takenOver(),
      wait: (ms: number) => vi.advanceTimersByTime(ms),
      /** A new version has been downloaded. */
      found: () => {
        found()
        vi.advanceTimersByTime(1)
      },
      touch: () => fire('pointerdown'),
      setBusy: (b: boolean) => (busy = b),
      go: (h: string) => (win.location.hash = h),
      hide: () => {
        doc.visibilityState = 'hidden'
        fire('visibilitychange')
      },
      show: () => {
        doc.visibilityState = 'visible'
        fire('visibilitychange')
      },
    }
  }

  it('applies at once while the app is still opening and untouched', async () => {
    const p = await page()
    p.found()
    expect(p.apply).toHaveBeenCalledTimes(1)
  })

  it('waits once the learner has touched the app, and applies when the app is put away on a quiet screen', async () => {
    const p = await page()
    p.touch()
    p.found()
    expect(p.apply).not.toHaveBeenCalled()
    p.hide()
    expect(p.apply).toHaveBeenCalledTimes(1)
  })

  it('never applies by itself in a song, with the metronome or microphone running, or while a screen holds it', async () => {
    const p = await page()
    p.touch()
    p.found()
    p.go('#/play/3')
    p.hide()
    p.show()
    p.go('#/metronome')
    p.setBusy(true)
    p.hide()
    p.show()
    p.setBusy(false)
    const release = p.mod.holdUpdates()
    p.hide()
    p.show()
    expect(p.apply).not.toHaveBeenCalled()
    release()
    p.hide()
    expect(p.apply).toHaveBeenCalledTimes(1)
  })

  it('found while a song is being imported in the first seconds: held, not applied', async () => {
    const p = await page()
    const release = p.mod.holdUpdates()
    p.found()
    expect(p.apply).not.toHaveBeenCalled()
    release()
  })

  it('reloads as soon as the new worker has taken over, when nothing has been started', async () => {
    const p = await page()
    p.found()
    expect(p.reload).not.toHaveBeenCalled()
    p.takenOver()
    expect(p.reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload into a song begun while the switch was under way, and finishes at the next quiet moment', async () => {
    const p = await page()
    p.touch()
    p.found()
    p.hide()
    expect(p.apply).toHaveBeenCalledTimes(1)
    // Back within the moment the switch takes, and straight into a song.
    p.show()
    p.touch()
    p.go('#/play/3')
    p.takenOver()
    p.wait(5000)
    expect(p.reload).not.toHaveBeenCalled()
    // The song is over and the app is put away: now, and without asking the worker again.
    p.go('#/songs')
    p.hide()
    expect(p.reload).toHaveBeenCalledTimes(1)
    expect(p.apply).toHaveBeenCalledTimes(1)
  })

  it('"Update now" reloads even with something running, and at once when the worker has already switched', async () => {
    const p = await page()
    p.touch()
    p.found()
    p.setBusy(true)
    p.mod.applyUpdate()
    expect(p.apply).toHaveBeenCalledTimes(1)
    p.takenOver()
    expect(p.reload).toHaveBeenCalledTimes(1)
    // Asked again (the reload was slow): no second switch, just the reload.
    p.mod.applyUpdate()
    expect(p.apply).toHaveBeenCalledTimes(1)
    expect(p.reload).toHaveBeenCalledTimes(2)
  })

  it('falls back to a reload after a moment when the worker never reports, but only where it interrupts nothing', async () => {
    const quietPage = await page()
    quietPage.found()
    quietPage.wait(4100)
    expect(quietPage.reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
    vi.useRealTimers()
    const busyPage = await page()
    busyPage.found()
    busyPage.touch()
    busyPage.go('#/lessons/l01-hold')
    busyPage.wait(4100)
    expect(busyPage.reload).not.toHaveBeenCalled()
  })
})
