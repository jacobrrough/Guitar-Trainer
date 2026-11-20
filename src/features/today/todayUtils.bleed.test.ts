import { describe, expect, it } from 'vitest'
import type { Attempt, Block } from '../../training/types'
import { attemptForBlock, minutesThisWeek } from './todayUtils'

const block = { id: 'b1', kind: 'focus', status: 'done', minutes: 5, skillId: 'nope', generatorId: 'x', params: { tempo: 80, bars: 4 }, tempo: 80, reps: 3, reason: '' } as Block

describe('runs that did not count (the app heard its own guitar part)', () => {
  it('are not shown as the result of a block', () => {
    const at = (over: Partial<Attempt>) => ({ at: 1, sessionId: 7, skillId: 'nope', ...over }) as Attempt
    const list = [at({ at: 5, accuracy: 0.6 }), at({ at: 9, accuracy: 1, bleed: true })]
    expect(attemptForBlock(list, 7, block)?.accuracy).toBe(0.6)
    expect(attemptForBlock([at({ at: 9, accuracy: 1, bleed: true })], 7, block)).toBeUndefined()
  })

  it('add no practice minutes', () => {
    expect(minutesThisWeek([{ durationSec: 120 }, { durationSec: 600, bleed: true }])).toBe(2)
  })
})
