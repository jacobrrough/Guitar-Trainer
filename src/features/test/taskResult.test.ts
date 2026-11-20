import { describe, expect, it } from 'vitest'
import { meetsCriteria } from '../../training/assessment'
import { TEST_PASS } from '../../training/constants'
import type { AttemptResult } from '../../training/types'
import { failedCriteria, failureReasons, passRuleText, ruleAccuracy, shownAccuracyPct, verdictBadge } from './taskResult'

function result(partial: Partial<AttemptResult> = {}): AttemptResult {
  return {
    perfects: 16,
    goods: 0,
    misses: 0,
    total: 16,
    timingMedianMs: 4,
    timingStdevMs: 20,
    coverage: 1,
    durationSec: 30,
    playedTempo: 70,
    targetTempo: 70,
    speed: 1,
    ...partial,
  }
}

describe('task result: the card shows what the pass rule uses', () => {
  it('every note hit a little off: 80%, not 100%, and the reason is accuracy', () => {
    // All 16 notes inside the "good" window, none "perfect": hits / notes is 100%, the rule counts 80%.
    const r = result({ perfects: 0, goods: 16, timingMedianMs: 20, timingStdevMs: 25 })
    expect(meetsCriteria(TEST_PASS, r)).toBe(false)
    expect(shownAccuracyPct(ruleAccuracy(r), TEST_PASS.minAccuracy)).toBe(80)
    expect(failedCriteria(TEST_PASS, r)).toEqual(['accuracy'])
    expect(verdictBadge(failedCriteria(TEST_PASS, r))).toBe('accuracy below target')
    expect(failureReasons(TEST_PASS, r)).toEqual([
      'Accuracy: you scored 80%, and 85% is needed. A note that is a little early or late counts as 80% of a note, and 16 of yours were.',
    ])
  })

  it('names timing when the notes were clean but late', () => {
    const r = result({ timingMedianMs: 42 })
    expect(meetsCriteria(TEST_PASS, r)).toBe(false)
    expect(failedCriteria(TEST_PASS, r)).toEqual(['timing'])
    expect(failureReasons(TEST_PASS, r)[0]).toBe('Timing: most of your notes came after the beat, by about 42 ms. 30 ms or less is needed.')
    expect(failureReasons(TEST_PASS, result({ timingMedianMs: -38 }))[0]).toContain('before the beat, by about 38 ms')
  })

  it('names steadiness when the notes were scattered', () => {
    const r = result({ timingStdevMs: 75 })
    expect(failedCriteria(TEST_PASS, r)).toEqual(['spread'])
    expect(verdictBadge(['spread'])).toBe('timing not steady')
    expect(failureReasons(TEST_PASS, r)[0]).toContain('spread 75 ms')
  })

  it('names every part that was missed', () => {
    const r = result({ perfects: 4, goods: 4, misses: 8, timingMedianMs: -50, timingStdevMs: 90 })
    expect(failedCriteria(TEST_PASS, r)).toEqual(['accuracy', 'timing', 'spread'])
    expect(failureReasons(TEST_PASS, r)).toHaveLength(3)
    expect(verdictBadge(failedCriteria(TEST_PASS, r))).toBe('accuracy below target · timing off target · timing not steady')
  })

  it('says on target, with no reasons, when the task is passed', () => {
    const r = result({ perfects: 14, goods: 2 })
    expect(meetsCriteria(TEST_PASS, r)).toBe(true)
    expect(failedCriteria(TEST_PASS, r)).toEqual([])
    expect(verdictBadge([])).toBe('on target')
    expect(failureReasons(TEST_PASS, r)).toEqual([])
    expect(shownAccuracyPct(ruleAccuracy(r), TEST_PASS.minAccuracy)).toBe(98)
  })

  it('never rounds a failing accuracy up to the pass mark', () => {
    expect(shownAccuracyPct(0.848, 0.85)).toBe(84)
    expect(shownAccuracyPct(0.85, 0.85)).toBe(85)
    expect(shownAccuracyPct(0.4, 0.85)).toBe(40)
    expect(shownAccuracyPct(0, 0.85)).toBe(0)
  })

  it('agrees with the pass rule for every mix of notes and timing', () => {
    const timings = [null, -45, -30, 0, 30, 31]
    const spreads = [null, 20, 60, 61]
    for (let perfects = 0; perfects <= 16; perfects += 2) {
      for (let goods = 0; perfects + goods <= 16; goods += 2) {
        for (const timingMedianMs of timings) {
          for (const timingStdevMs of spreads) {
            const r = result({ perfects, goods, misses: 16 - perfects - goods, timingMedianMs, timingStdevMs })
            expect(failedCriteria(TEST_PASS, r).length === 0).toBe(meetsCriteria(TEST_PASS, r))
          }
        }
      }
    }
  })

  it('states the rule before the task with the numbers the task uses', () => {
    expect(passRuleText(TEST_PASS)).toBe('To pass: 85% accuracy with steady timing. A note that is a little early or late counts as 80% of a note.')
    expect(passRuleText({ ...TEST_PASS, minAccuracy: 0.7 })).toContain('70% accuracy')
  })
})
