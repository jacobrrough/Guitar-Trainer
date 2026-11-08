import { describe, expect, it } from 'vitest'
import { COURSE } from '../../lessons/course'
import { feedbackLine, hitFraction, lessonSteps, tipFor } from './lessonUtils'

describe('lessonUtils', () => {
  it('builds the steps per lesson', () => {
    expect(lessonSteps(COURSE[0])).toEqual(['learn', 'try', 'play', 'done'])
    expect(lessonSteps(COURSE[1])).toEqual(['learn', 'tune', 'play', 'done'])
  })

  it('words the score plainly', () => {
    expect(feedbackLine({ perfects: 5, goods: 1, total: 8 })).toBe('You hit 6 of 8 notes.')
    expect(hitFraction({ perfects: 5, goods: 1, total: 8 })).toBeCloseTo(0.75)
    expect(feedbackLine({ perfects: 0, goods: 0, total: 0 })).toMatch(/did not hear/)
  })

  it('picks a lesson mistake as the tip and rotates it', () => {
    const a = tipFor(COURSE[2], 0.4, 1)
    const b = tipFor(COURSE[2], 0.4, 2)
    expect(a).toMatch(/^If /)
    expect(a).not.toBe(b)
    expect(tipFor(COURSE[2], 0.95, 1)).not.toMatch(/^If /)
  })
})
