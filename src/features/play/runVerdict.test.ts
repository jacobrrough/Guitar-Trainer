import { describe, expect, it } from 'vitest'
import { runVerdict } from './runVerdict'

const summary = (perfects: number, goods: number, total: number) => ({ perfects, goods, total })

describe('runVerdict', () => {
  it('counts an ordinary run, also a poor one that was clearly heard', () => {
    expect(runVerdict(summary(5, 1, 8), { coverage: 1 })).toBe('counted')
    expect(runVerdict(summary(0, 0, 8), { coverage: 0.9 })).toBe('counted')
    expect(runVerdict(summary(0, 1, 8), { coverage: 0.1 })).toBe('counted')
  })

  it('does not count a run in which the microphone delivered nothing', () => {
    expect(runVerdict(summary(0, 0, 0), { coverage: 1 })).toBe('unscored')
  })

  it('does not count a run with no hit and hardly a sound: the guitar was not heard', () => {
    expect(runVerdict(summary(0, 0, 8), { coverage: 0 })).toBe('unscored')
    expect(runVerdict(summary(0, 0, 8), { coverage: 0.1 })).toBe('unscored')
  })

  it('does not count a run that covered only part of the piece', () => {
    expect(runVerdict(summary(6, 0, 6), { coverage: 1, partial: true })).toBe('partial')
    // Not heard at all is the more useful thing to say when both are true.
    expect(runVerdict(summary(0, 0, 6), { coverage: 0, partial: true })).toBe('unscored')
  })

  it('does not count a run in which the microphone heard the app’s own guitar part', () => {
    expect(runVerdict(summary(8, 0, 8), { coverage: 1, bleed: true })).toBe('bleed')
  })
})
