import { describe, expect, it } from 'vitest'
import type { Profile } from '../../training/types'
import { setUpPath, todayGate, type TodayGate } from './todayGate'

type Fields = Partial<Pick<Profile, 'experience' | 'placementDoneAt' | 'firstStepsStartedAt' | 'firstStepsDoneAt'>>

const guitar = (fields: Fields = {}) => ({ id: 1 as const, ...fields })
const voice = (fields: Fields = {}) => ({ id: 2 as const, ...fields })

describe('todayGate: what Today shows a guitarist (as it always did)', () => {
  it('sends a brand-new profile to the set-up', () => {
    expect(todayGate('guitar', guitar())).toBe('start')
  })

  it('shows the course while it is running, whatever else is set', () => {
    expect(todayGate('guitar', guitar({ experience: 'new', firstStepsStartedAt: 1, placementDoneAt: 1 }))).toBe('course')
    expect(todayGate('guitar', guitar({ firstStepsStartedAt: 1 }))).toBe('course')
  })

  it('shows the set-up card to someone who has played before and has not taken or skipped the starting check', () => {
    expect(todayGate('guitar', guitar({ experience: 'played' }))).toBe('setup')
    // The course was left before the starting check was ever marked: the card asks for it.
    expect(todayGate('guitar', guitar({ firstStepsStartedAt: 1, firstStepsDoneAt: 2 }))).toBe('setup')
  })

  it('shows the plan once the starting check is behind them', () => {
    expect(todayGate('guitar', guitar({ experience: 'played', placementDoneAt: 1 }))).toBe('plan')
    expect(todayGate('guitar', guitar({ experience: 'new', placementDoneAt: 1, firstStepsStartedAt: 1, firstStepsDoneAt: 2 }))).toBe('plan')
    // A profile from before the set-up asked about experience.
    expect(todayGate('guitar', guitar({ placementDoneAt: 1 }))).toBe('plan')
  })
})

describe('todayGate: what Today shows a singer', () => {
  it('sends a singer who has not been through the singing set-up there', () => {
    expect(todayGate('voice', voice())).toBe('start')
    // The range finder stores its result on the profile row before the set-up is finished: a row is not a set-up.
    expect(todayGate('voice', voice({ experience: 'new' }))).toBe('start')
    expect(todayGate('voice', voice({ placementDoneAt: 1 }))).toBe('start')
    // Not even a course that looks as if it were running counts without the set-up's answers.
    expect(todayGate('voice', voice({ firstStepsStartedAt: 1 }))).toBe('start')
  })

  it('shows the course while it is running', () => {
    expect(todayGate('voice', voice({ experience: 'new', placementDoneAt: 1, firstStepsStartedAt: 1 }))).toBe('course')
    expect(todayGate('voice', voice({ experience: 'some', placementDoneAt: 1, firstStepsStartedAt: 1 }))).toBe('course')
  })

  it('shows the plan after the course, and to a singer who has sung before', () => {
    expect(todayGate('voice', voice({ experience: 'new', placementDoneAt: 1, firstStepsStartedAt: 1, firstStepsDoneAt: 2 }))).toBe('plan')
    expect(todayGate('voice', voice({ experience: 'played', placementDoneAt: 1, firstStepsDoneAt: 1 }))).toBe('plan')
    expect(todayGate('voice', voice({ experience: 'played', placementDoneAt: 1 }))).toBe('plan')
  })

  it('never shows a singer the set-up card: that card offers the guitar starting check', () => {
    const maybe = [undefined, 1]
    const seen = new Set<TodayGate>()
    for (const experience of [undefined, 'new', 'some', 'played'] as const) {
      for (const placementDoneAt of maybe) {
        for (const firstStepsStartedAt of maybe) {
          for (const firstStepsDoneAt of maybe) {
            seen.add(todayGate('voice', voice({ experience, placementDoneAt, firstStepsStartedAt, firstStepsDoneAt })))
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['course', 'plan', 'start'])
  })
})

describe('todayGate: whose profile it is', () => {
  it('waits while the profile is not there yet', () => {
    expect(todayGate('guitar', undefined)).toBe('loading')
    expect(todayGate('voice', undefined)).toBe('loading')
  })

  it("never reads one learner's answers from the other's row", () => {
    // Right after the switch the profile hook still hands over the row it had. A guitarist with years
    // of practice must not make Today plan a day for a singer who has not been set up, nor the reverse.
    const seasoned = { experience: 'played' as const, placementDoneAt: 1 }
    expect(todayGate('voice', guitar(seasoned))).toBe('loading')
    expect(todayGate('guitar', voice(seasoned))).toBe('loading')
    expect(todayGate('guitar', voice())).toBe('loading')
  })
})

describe('setUpPath: where the set-up of an instrument is', () => {
  it('is the wizard, and for singing the wizard told so', () => {
    expect(setUpPath('guitar')).toBe('/start')
    expect(setUpPath('voice')).toBe('/start?instrument=voice')
  })
})
