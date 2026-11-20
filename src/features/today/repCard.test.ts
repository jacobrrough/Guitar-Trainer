import { describe, expect, it } from 'vitest'
import { REP_DOWN_ACCURACY, REP_UP_ACCURACY } from '../../training/constants'
import { nextRepTempo } from '../../training/planner'
import { blockResultLine, hasPace, nextRoundText } from './repCard'

describe('nextRoundText: the rep card says what the next round will really be', () => {
  it('says slower when the round went badly and the tempo drops', () => {
    // 3 of 8 notes: the next round is slowed down.
    const next = nextRepTempo(60, 3 / 8, 60)
    expect(next).toBeLessThan(60)
    expect(nextRoundText(60, next)).toMatch(/slower/)
    expect(nextRoundText(60, next)).not.toMatch(/faster/)
  })

  it('says the same pace when the tempo stays', () => {
    const accuracy = (REP_DOWN_ACCURACY + REP_UP_ACCURACY) / 2
    const next = nextRepTempo(60, accuracy, 60)
    expect(next).toBe(60)
    expect(nextRoundText(60, next)).toBe('Next round at the same pace')
  })

  it('says faster only when the tempo goes up', () => {
    const next = nextRepTempo(60, 1, 60)
    expect(next).toBeGreaterThan(60)
    expect(nextRoundText(60, next)).toBe('Next round a bit faster')
  })

  it('compares the tempos as they are shown, in whole beats per minute', () => {
    expect(nextRoundText(60.2, 59.8)).toBe('Next round at the same pace')
    // Already at the cap for the day: a perfect round stays where it is.
    expect(nextRoundText(69, nextRepTempo(69, 1, 60))).toBe('Next round at the same pace')
  })
})

describe('hasPace / blockResultLine: ear rounds have no timing and no tempo', () => {
  it('treats ear training as unpaced and everything else as paced', () => {
    expect(hasPace({ interaction: 'ear' })).toBe(false)
    expect(hasPace({ interaction: undefined })).toBe(true)
  })

  it('leaves the tempo out of the result of an ear block', () => {
    expect(blockResultLine(75, 60, false)).toBe('75% accuracy')
    expect(blockResultLine(75, 63.6, true)).toBe('75% accuracy · reached 64 bpm')
  })
})
