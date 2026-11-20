/**
 * Keeping the learner's songs and progress safe from the browser's own clean-up.
 *
 * Everything the app saves lives in the browser's storage, which is "best effort" by default:
 * a phone that runs low on space may wipe it, and the app would start again from the set-up
 * screens. A browser can be asked to keep it ("persistent storage").
 *
 * The rule for asking: only when the browser answers by itself, without showing anything.
 * - Safari and Chromium browsers never show a prompt. They decide silently (an app added to the
 *   home screen is granted), so asking there is always safe.
 * - Firefox shows a permission prompt. A beginner should not be asked a question about storage,
 *   so Firefox is asked only when the permission has already been granted and no prompt can appear.
 */

/** The parts of `navigator` used here, so tests can pass a stand-in. */
export interface StorageNavigator {
  userAgent: string
  storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }
  permissions?: { query: (descriptor: { name: PermissionName }) => Promise<{ state: PermissionState }> }
}

export type StorageProtection = 'protected' | 'unprotected' | 'unknown'

function browserNavigator(): StorageNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as StorageNavigator)
}

/** True for Firefox on its own engine. Firefox on iPhone is Safari underneath and never asks. */
export function browserAsksBeforeProtecting(userAgent: string): boolean {
  return /Gecko\/\d/.test(userAgent) && /Firefox\/\d/.test(userAgent)
}

async function alreadyAllowed(nav: StorageNavigator): Promise<boolean> {
  try {
    const status = await nav.permissions?.query({ name: 'persistent-storage' })
    return status?.state === 'granted'
  } catch {
    return false
  }
}

/** Whether the browser has promised to keep this app's saved data. `unknown` when it cannot say. */
export async function storageProtection(nav: StorageNavigator | undefined = browserNavigator()): Promise<StorageProtection> {
  try {
    const persisted = nav?.storage?.persisted
    if (!persisted) return 'unknown'
    return (await persisted.call(nav.storage)) ? 'protected' : 'unprotected'
  } catch {
    return 'unknown'
  }
}

/**
 * Asks the browser to keep the saved data, but only where that cannot show a prompt (see the rule
 * at the top). Safe to call more than once. Resolves to whether the data is protected afterwards;
 * never throws, because a "no" must not get in the way of what the learner was doing.
 */
export async function protectStorage(nav: StorageNavigator | undefined = browserNavigator()): Promise<boolean> {
  try {
    const storage = nav?.storage
    if (!nav || !storage?.persist) return false
    if ((await storageProtection(nav)) === 'protected') return true
    if (browserAsksBeforeProtecting(nav.userAgent) && !(await alreadyAllowed(nav))) return false
    return await storage.persist()
  } catch {
    return false
  }
}

/**
 * The line shown in Settings. Nothing is shown when the browser cannot tell us.
 * `installHelps`: adding the app to the home screen is what gets the protection (not yet installed,
 * and not a browser that would have to ask first).
 */
export function storageStatusText(status: StorageProtection, installHelps: boolean): string | null {
  if (status === 'unknown') return null
  if (status === 'protected') return 'Saved data: protected. Your device keeps your songs and progress even when it runs low on space.'
  const risk = 'Saved data: not protected. Your device may clear your songs and progress if it runs low on space.'
  return installHelps ? `${risk} Adding this app to your home screen usually protects them.` : `${risk} Export your training data now and then to be safe.`
}

/** Whether installing is the way to get protection in this browser. */
export function installProtects(installed: boolean, userAgent: string): boolean {
  return !installed && !browserAsksBeforeProtecting(userAgent)
}
