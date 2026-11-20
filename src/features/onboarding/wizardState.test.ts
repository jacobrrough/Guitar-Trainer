import { describe, expect, it } from 'vitest'
import { canContinue, canSkipSetup, initialWizardState, skipSetup, stepOrder, summarise, toSetup, wizardReducer } from './wizardState'

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
  it('skipping keeps the answers given so far', () => {
    // A left-handed player with an electric guitar who has played before, leaving on the tuning screen.
    let s = wizardReducer(initialWizardState(true), { type: 'setExperience', value: 'played' })
    s = wizardReducer(s, { type: 'setGuitar', value: 'electric' })
    s = wizardReducer(s, { type: 'setHand', value: 'left' })
    s = wizardReducer(s, { type: 'setMinutes', value: 30 })
    expect(skipSetup(s)).toEqual({ experience: 'played', handedness: 'left', guitarType: 'electric', dailyMinutes: 30, goalSongId: undefined })
    // A beginner who picked a goal song keeps it too.
    let b = wizardReducer(initialWizardState(true), { type: 'setExperience', value: 'some' })
    b = wizardReducer(b, { type: 'setSong', value: 'ode' })
    expect(skipSetup(b)).toMatchObject({ experience: 'some', goalSongId: 'ode' })
  })
  it('skipping before any answer gives the beginner defaults', () => {
    expect(skipSetup(initialWizardState(true))).toEqual({ experience: 'new', handedness: 'right', guitarType: 'acoustic', dailyMinutes: 10, goalSongId: undefined })
  })
  it('offers Skip setup only on screens without their own way out', () => {
    expect(stepOrder(true).filter(canSkipSetup)).toEqual(['welcome', 'guitar', 'time', 'song', 'phone'])
    expect(canSkipSetup('tune')).toBe(false)
    expect(canSkipSetup('finish')).toBe(false)
  })
})
