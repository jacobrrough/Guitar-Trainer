import { describe, expect, it } from 'vitest'
import type { Attempt, Block, SessionRecord } from '../../training/types'
import {
  allFinished,
  attemptForBlock,
  blockTitle,
  minutesThisWeek,
  noneDone,
  pct,
  repSummaryText,
  streakText,
  timingText,
} from './todayUtils'

const exBlock = {
  id: 'b1',
  kind: 'focus',
  status: 'pending',
  minutes: 5,
  skillId: 'nope',
  generatorId: 'x',
  params: { tempo: 80, bars: 4 },
  tempo: 80,
  reps: 3,
  reason: '',
} as Block

describe('todayUtils', () => {
  it('sums minutes', () => {
    expect(minutesThisWeek([{ durationSec: 90 }, { durationSec: 150 }])).toBe(4)
    expect(minutesThisWeek([])).toBe(0)
  })

  it('formats percentages and streaks', () => {
    expect(pct(0.876)).toBe(88)
    expect(pct(2)).toBe(100)
    expect(streakText(0)).toBe('No streak yet')
    expect(streakText(3)).toContain('3-day streak')
  })

  it('titles blocks', () => {
    expect(blockTitle(exBlock)).toBe('nope · 80 bpm')
    const song = { id: 's', kind: 'song', status: 'pending', minutes: 5, songId: 2, level: 2, speed: 0.8, reason: '' } as Block
    expect(blockTitle(song, 'Demo')).toBe('Demo · Level 3 · 80% speed')
    expect(blockTitle({ ...song, speed: 1 } as Block, 'Demo')).toBe('Demo · Level 3')
    const test = { id: 't', kind: 'test', status: 'pending', minutes: 6, test: 'checkpoint', reason: '' } as Block
    expect(blockTitle(test)).toBe('Skill check: checkpoint')
  })

  it('describes timing and reps', () => {
    expect(timingText(null)).toContain('not enough')
    expect(timingText(2)).toContain('on the beat')
    expect(timingText(24.4)).toBe('timing: +24 ms (late)')
    expect(timingText(-18)).toBe('timing: -18 ms (early)')
    expect(repSummaryText({ perfects: 5, goods: 2, misses: 1 })).toBe('5 perfect · 2 good · 1 missed')
  })

  it('tracks session completion', () => {
    const mk = (statuses: Block['status'][]) =>
      ({ plan: { blocks: statuses.map((status) => ({ ...exBlock, status })) } }) as unknown as SessionRecord
    expect(allFinished(mk(['done', 'skipped']))).toBe(true)
    expect(allFinished(mk(['done', 'pending']))).toBe(false)
    expect(noneDone(mk(['skipped', 'pending']))).toBe(true)
    expect(noneDone(mk(['done']))).toBe(false)
  })

  it('finds the latest attempt of a block', () => {
    const at = (over: Partial<Attempt>) => ({ at: 1, sessionId: 7, skillId: 'nope', ...over }) as Attempt
    const list = [at({ at: 1, accuracy: 0.5 }), at({ at: 5, accuracy: 0.9 }), at({ at: 9, sessionId: 8 })]
    expect(attemptForBlock(list, 7, exBlock)?.accuracy).toBe(0.9)
    expect(attemptForBlock(list, undefined, exBlock)).toBeUndefined()
  })
})
