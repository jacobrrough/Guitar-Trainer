import { describe, expect, it } from 'vitest'
import { WIZARD_FRAME_STYLE } from './wizardLayout'

type Insets = { top: number; right: number; bottom: number; left: number }

/** Works out a padding value in px the way a browser would, for the two forms the wizard uses. */
function resolve(value: unknown, insets: Insets): number {
  const px = (term: string): number => {
    const t = term.trim()
    const env = /^env\(safe-area-inset-(top|right|bottom|left)\)$/.exec(t)
    if (env) return insets[env[1] as keyof Insets]
    const rem = /^([\d.]+)rem$/.exec(t)
    if (rem) return Number(rem[1]) * 16
    throw new Error(`unexpected term ${t}`)
  }
  const text = String(value)
  const calc = /^calc\((.+) \+ (.+)\)$/.exec(text)
  if (calc) return px(calc[1]) + px(calc[2])
  const max = /^max\((.+), (.+)\)$/.exec(text)
  if (max) return Math.max(px(max[1]), px(max[2]))
  throw new Error(`unexpected value ${text}`)
}

describe('set-up wizard frame', () => {
  const pad = (insets: Insets) => ({
    top: resolve(WIZARD_FRAME_STYLE.paddingTop, insets),
    right: resolve(WIZARD_FRAME_STYLE.paddingRight, insets),
    bottom: resolve(WIZARD_FRAME_STYLE.paddingBottom, insets),
    left: resolve(WIZARD_FRAME_STYLE.paddingLeft, insets),
  })

  it('keeps the usual gaps on a screen with no cut-outs', () => {
    expect(pad({ top: 0, right: 0, bottom: 0, left: 0 })).toEqual({ top: 16, right: 16, bottom: 32, left: 16 })
  })

  it('starts below the status bar of an installed iPhone app', () => {
    // iPhone 15 upright: 59 px status bar and Dynamic Island, 34 px home indicator.
    const p = pad({ top: 59, right: 0, bottom: 34, left: 0 })
    expect(p.top).toBeGreaterThanOrEqual(59 + 16)
    expect(p.bottom).toBeGreaterThanOrEqual(34 + 16)
  })

  it('clears the notch when the phone is held sideways', () => {
    const p = pad({ top: 0, right: 59, bottom: 21, left: 59 })
    expect(p.left).toBeGreaterThanOrEqual(59)
    expect(p.right).toBeGreaterThanOrEqual(59)
  })
})
