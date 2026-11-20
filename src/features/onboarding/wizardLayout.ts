import type { CSSProperties } from 'react'

/**
 * Space around the set-up screens. They are shown outside the app's usual frame, and the installed
 * iPhone app draws under the status bar and around the notch, so each side keeps its normal gap and
 * makes room for the phone's safe area as well. On every other device the safe area is zero.
 */
export const WIZARD_FRAME_STYLE: CSSProperties = {
  paddingTop: 'calc(env(safe-area-inset-top) + 1rem)',
  paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)',
  paddingLeft: 'max(1rem, env(safe-area-inset-left))',
  paddingRight: 'max(1rem, env(safe-area-inset-right))',
}
