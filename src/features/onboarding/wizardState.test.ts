import { describe, expect, it } from 'vitest'
import { canContinue, initialWizardState, stepOrder, summarise, toSetup, wizardReducer } from './wizardState'

describe('wizardState', () => {
  it('has beginner defaults', () => {
    const s = initialWizardState(true)
    expect(s).toMatchObject({ step: 'welcome', experience: null, guitarType: 'acoustic', handedness: 'right', dailyMinutes: 10 })
  })
  it('orders steps with and without songs', () => {
    expect(stepOrder(true)).toEqual(['welcome', 'guitar', 'time', 'song', 'phone', 'tune', 'finish'])
    expect(stepOrder(false)).toEqual(['welcome', 'guitar', 'time', 'phone', 'tune', 'finish'])
  })
  it('skips the song step for players who have played', () => {
    expect(stepOrder(true, 'played')).not.toContain('song')
    let s = wizardReducer(initialWizardState(true), { type: 'setExperience', value: 'played' })
    s = wizardReducer(wizardReducer(wizardReducer(s, { type: 'next' }), { type: 'next' }), { type: 'next' })
    expect(s.step).toBe('phone')
  })
  it('blocks continuing from welcome until answered', () => {
    const s = initialWizardState(false)
    expect(canContinue(s)).toBe(false)
    expect(wizardReducer(s, { type: 'next' }).step).toBe('welcome')
    expect(canContinue(wizardReducer(s, { type: 'setExperience', value: 'new' }))).toBe(true)
  })
  it('walks forward and back, clamped', () => {
    let s = wizardReducer(initialWizardState(true), { type: 'setExperience', value: 'new' })
    for (let i = 0; i < 10; i++) s = wizardReducer(s, { type: 'next' })
    expect(s.step).toBe('finish')
    s = wizardReducer(s, { type: 'back' })
    expect(s.step).toBe('tune')
    expect(wizardReducer(initialWizardState(), { type: 'back' }).step).toBe('welcome')
  })
  it('builds setup and summary', () => {
    let s = wizardReducer(initialWizardState(true), { type: 'setExperience', value: 'new' })
    s = wizardReducer(s, { type: 'setSong', value: 'ode' })
    expect(toSetup(s)).toEqual({ experience: 'new', handedness: 'right', guitarType: 'acoustic', dailyMinutes: 10, goalSongId: 'ode' })
    expect(summarise(s)).toBe('New to guitar · acoustic · right-handed · 10 min a day')
    s = wizardReducer(s, { type: 'setExperience', value: 'played' })
    expect(toSetup(s).goalSongId).toBeUndefined()
  })
})
