import { describe, expect, it, vi } from 'vitest'
import { browserAsksBeforeProtecting, installProtects, protectStorage, storageProtection, storageStatusText } from './storage'
import type { StorageNavigator } from './storage'

const UA = {
  iphoneApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  firefoxDesktop: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
}

function fakeNavigator(opts: { userAgent: string; persisted?: boolean; grants?: boolean; permission?: PermissionState }) {
  let persisted = opts.persisted ?? false
  const persist = vi.fn(async () => {
    if (opts.grants ?? true) persisted = true
    return persisted
  })
  const nav: StorageNavigator = {
    userAgent: opts.userAgent,
    storage: { persist, persisted: async () => persisted },
    permissions: opts.permission ? { query: async () => ({ state: opts.permission as PermissionState }) } : undefined,
  }
  return { nav, persist }
}

describe('browserAsksBeforeProtecting', () => {
  it('is true only for Firefox on its own engine', () => {
    expect(browserAsksBeforeProtecting(UA.firefoxDesktop)).toBe(true)
    expect(browserAsksBeforeProtecting(UA.firefoxAndroid)).toBe(true)
    expect(browserAsksBeforeProtecting(UA.firefoxIos)).toBe(false)
    expect(browserAsksBeforeProtecting(UA.chromeAndroid)).toBe(false)
    expect(browserAsksBeforeProtecting(UA.iphoneApp)).toBe(false)
  })
})

describe('protectStorage', () => {
  it('asks the browser when the library is still unprotected (installed iPhone app)', async () => {
    const { nav, persist } = fakeNavigator({ userAgent: UA.iphoneApp })
    expect(await storageProtection(nav)).toBe('unprotected')
    expect(await protectStorage(nav)).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(await storageProtection(nav)).toBe('protected')
  })

  it('does not ask again once storage is protected', async () => {
    const { nav, persist } = fakeNavigator({ userAgent: UA.chromeAndroid, persisted: true })
    expect(await protectStorage(nav)).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports false when the browser says no', async () => {
    const { nav, persist } = fakeNavigator({ userAgent: UA.chromeAndroid, grants: false })
    expect(await protectStorage(nav)).toBe(false)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(await storageProtection(nav)).toBe('unprotected')
  })

  it('never triggers the Firefox permission prompt', async () => {
    for (const permission of ['prompt', 'denied', undefined] as const) {
      const { nav, persist } = fakeNavigator({ userAgent: UA.firefoxDesktop, permission })
      expect(await protectStorage(nav)).toBe(false)
      expect(persist).not.toHaveBeenCalled()
    }
  })

  it('asks Firefox only when the answer is already yes', async () => {
    const { nav, persist } = fakeNavigator({ userAgent: UA.firefoxAndroid, permission: 'granted' })
    expect(await protectStorage(nav)).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('copes with browsers that lack the storage API or throw', async () => {
    expect(await protectStorage(undefined)).toBe(false)
    expect(await protectStorage({ userAgent: UA.chromeAndroid })).toBe(false)
    expect(await storageProtection({ userAgent: UA.chromeAndroid })).toBe('unknown')
    const broken: StorageNavigator = {
      userAgent: UA.chromeAndroid,
      storage: {
        persist: async () => {
          throw new Error('blocked')
        },
        persisted: async () => {
          throw new Error('blocked')
        },
      },
    }
    expect(await protectStorage(broken)).toBe(false)
    expect(await storageProtection(broken)).toBe('unknown')
  })
})

describe('storageStatusText', () => {
  it('says plainly whether saved data is protected', () => {
    expect(storageStatusText('protected', false)).toMatch(/^Saved data: protected\./)
    expect(storageStatusText('unprotected', true)).toMatch(/^Saved data: not protected\./)
    expect(storageStatusText('unknown', true)).toBeNull()
  })
  it('suggests the home screen only where that helps', () => {
    expect(storageStatusText('unprotected', true)).toMatch(/home screen/i)
    expect(storageStatusText('unprotected', false)).not.toMatch(/home screen/i)
    expect(storageStatusText('unprotected', false)).toMatch(/export/i)
    // Not installed yet, in a browser that grants protection to installed apps.
    expect(installProtects(false, UA.chromeAndroid)).toBe(true)
    // Already installed, or Firefox, where installing changes nothing.
    expect(installProtects(true, UA.iphoneApp)).toBe(false)
    expect(installProtects(false, UA.firefoxDesktop)).toBe(false)
  })
})
