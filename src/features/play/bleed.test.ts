import { describe, expect, it } from 'vitest'
import { detectBleed } from './bleed'

describe('detectBleed', () => {
  const clicks = [1.0, 1.5, 2.0, 2.5]

  it('flags attacks that follow the clicks', () => {
    expect(detectBleed(clicks, [1.04, 1.55, 2.03, 2.56])).toBe(true)
    expect(detectBleed(clicks, [1.04, 1.55, 2.03])).toBe(true)
  })

  it('ignores attacks that are too late, too early or too few', () => {
    expect(detectBleed(clicks, [1.3, 1.8, 2.3, 2.8])).toBe(false)
    expect(detectBleed(clicks, [0.95, 1.45, 1.95, 2.45])).toBe(false)
    expect(detectBleed(clicks, [1.04, 2.03])).toBe(false)
    expect(detectBleed(clicks, [])).toBe(false)
    expect(detectBleed([], [1, 2, 3])).toBe(false)
  })
})
