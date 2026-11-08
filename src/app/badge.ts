/** App Badging API (home screen icon badge). Not in lib.dom for all TS versions, so typed locally. */
interface BadgeNavigator {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/** Show a badge when `count` > 0, otherwise clear it. No-op when unsupported; never throws. */
export async function setAppBadge(count: number | null): Promise<void> {
  try {
    if (typeof navigator === 'undefined') return
    const nav = navigator as Navigator & BadgeNavigator
    if (count !== null && count > 0) {
      await nav.setAppBadge?.(count)
    } else {
      await nav.clearAppBadge?.()
    }
  } catch {
    /* unsupported or denied */
  }
}
