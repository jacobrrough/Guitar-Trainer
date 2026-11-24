import { describe, expect, it } from 'vitest'
import { isBusyRoute } from '../../app/appUpdate'
import type { VoiceRange } from '../../training/types'
import {
  BACK_TO_GUITAR,
  VOICE_SETUP_COPY,
  VOICE_SETUP_PATH,
  canContinue,
  canSkipSetup,
  forTheSinger,
  initialWizardState,
  offersBackToGuitar,
  offersSkipSetup,
  setUpDoor,
  skipSetup,
  stepOrder,
  summarise,
  toSetup,
  toVoiceSetup,
  voiceSettings,
  wizardInstrument,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from './wizardState'

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

/** G3 to D4, as a range finder would hand it over. */
const RANGE: VoiceRange = { low: 55, high: 62, easy: 58, source: 'measured', at: 0 }

const walk = (state: WizardState, ...actions: WizardAction[]): WizardState => actions.reduce(wizardReducer, state)
const next: WizardAction = { type: 'next' }

describe('wizardState, the singing set-up', () => {
  const singer = () => initialWizardState(true, 'voice')

  it('is the guitar set-up unless it is asked for a voice', () => {
    expect(initialWizardState(true).instrument).toBe('guitar')
    expect(stepOrder(true, null, 'guitar')).toEqual(stepOrder(true))
    expect(stepOrder(true, 'played', 'guitar')).toEqual(stepOrder(true, 'played'))
  })
  it('opens the singing set-up only for its own address, and only while the singing side is switched on', () => {
    expect(wizardInstrument('voice', true)).toBe('voice')
    // A preview key that is gone must not leave a guitar learner in a set-up for something they cannot see.
    expect(wizardInstrument('voice', false)).toBe('guitar')
    expect(wizardInstrument(null, true)).toBe('guitar')
    expect(wizardInstrument('guitar', true)).toBe('guitar')
    expect(wizardInstrument('Voice', true)).toBe('guitar')
    expect(VOICE_SETUP_PATH).toBe('/start?instrument=voice')
  })
  it('orders the steps for a singer: phone before the easy notes, the song after them, nothing about a guitar', () => {
    expect(stepOrder(true, null, 'voice')).toEqual(['welcome', 'time', 'phone', 'range', 'song', 'finish'])
    expect(stepOrder(false, null, 'voice')).toEqual(['welcome', 'time', 'phone', 'range', 'finish'])
    for (const experience of ['new', 'some', 'played'] as const) {
      const order = stepOrder(true, experience, 'voice')
      expect(order, experience).not.toContain('guitar')
      expect(order, experience).not.toContain('tune')
      // The daily plan sings the picked song first, so a singer who sings often is asked as well.
      expect(order, experience).toContain('song')
    }
  })
  it('walks a singer from the first screen to the last', () => {
    let s = walk(singer(), { type: 'setExperience', value: 'new' })
    const seen = [s.step]
    for (let i = 0; i < 3; i++) {
      s = wizardReducer(s, next)
      seen.push(s.step)
    }
    expect(seen).toEqual(['welcome', 'time', 'phone', 'range'])
    s = walk(s, { type: 'setRange', value: RANGE }, next)
    expect(s.step).toBe('song')
    expect(wizardReducer(s, next).step).toBe('finish')
    expect(wizardReducer(s, { type: 'back' }).step).toBe('range')
  })
  it('never leaves the range step without easy notes', () => {
    const atRange = walk(singer(), { type: 'setExperience', value: 'some' }, next, next, next)
    expect(atRange.step).toBe('range')
    expect(atRange.range).toBeNull()
    expect(canContinue(atRange)).toBe(false)
    // Tapping on, however often, stays put: every exercise and song is placed in these notes.
    expect(walk(atRange, next, next, next).step).toBe('range')
    const found = wizardReducer(atRange, { type: 'setRange', value: RANGE })
    expect(found.range).toEqual(RANGE)
    expect(canContinue(found)).toBe(true)
    // "Find them again" forgets them for this walk, and the step holds once more.
    const again = wizardReducer(found, { type: 'setRange', value: null })
    expect(again.range).toBeNull()
    expect(wizardReducer(again, next).step).toBe('range')
  })
  it('the guitar set-up never waits for easy notes', () => {
    let s = walk(initialWizardState(true), { type: 'setExperience', value: 'new' })
    for (let i = 0; i < 10; i++) s = wizardReducer(s, next)
    expect(s.step).toBe('finish')
    expect(s.range).toBeNull()
  })
  it('remembers the headphones answer, and has none until it is given', () => {
    expect(singer().headphones).toBeNull()
    expect(wizardReducer(singer(), { type: 'setHeadphones', value: true }).headphones).toBe(true)
    expect(wizardReducer(singer(), { type: 'setHeadphones', value: false }).headphones).toBe(false)
  })
  it('saves what a singer answered and nothing of a guitar', () => {
    const s = walk(singer(), { type: 'setExperience', value: 'some' }, { type: 'setMinutes', value: 20 }, { type: 'setSong', value: 'sing-saints' })
    expect(toVoiceSetup(s)).toEqual({ experience: 'some', dailyMinutes: 20, goalSongId: 'sing-saints' })
    // A guitar learner who has left-handed diagrams keeps them: the hand and the guitar are not a singer's to set.
    const lefty = walk(s, { type: 'setHand', value: 'left' }, { type: 'setGuitar', value: 'electric' })
    expect(Object.keys(toVoiceSetup(lefty)).sort()).toEqual(['dailyMinutes', 'experience', 'goalSongId'])
    expect(toVoiceSetup(singer())).toEqual({ experience: 'new', dailyMinutes: 10, goalSongId: undefined })
  })
  it('keeps the song of a singer who sings often, also when the answer comes after the song', () => {
    const s = walk(singer(), { type: 'setExperience', value: 'new' }, { type: 'setSong', value: 'sing-mary-lamb' }, { type: 'setExperience', value: 'played' })
    expect(s.goalSongId).toBe('sing-mary-lamb')
    expect(toVoiceSetup(s)).toEqual({ experience: 'played', dailyMinutes: 10, goalSongId: 'sing-mary-lamb' })
    // The guitar set-up still drops it: a player who can play goes to a check, not to a course.
    const g = walk(initialWizardState(true), { type: 'setExperience', value: 'new' }, { type: 'setSong', value: 'ode' }, { type: 'setExperience', value: 'played' })
    expect(g.goalSongId).toBeUndefined()
  })
  it('sums a singer up in their own words', () => {
    const s = walk(singer(), { type: 'setExperience', value: 'new' }, { type: 'setRange', value: RANGE })
    expect(summarise(s)).toBe('New to singing · easy notes G3 to D4 · 10 min a day')
    expect(summarise(walk(s, { type: 'setExperience', value: 'some' }, { type: 'setMinutes', value: 30 }))).toBe('Sung a little · easy notes G3 to D4 · 30 min a day')
    expect(summarise(walk(s, { type: 'setExperience', value: 'played' }))).toBe('Sings often · easy notes G3 to D4 · 10 min a day')
    for (const experience of ['new', 'some', 'played'] as const) {
      expect(summarise(walk(s, { type: 'setExperience', value: experience }, { type: 'setHand', value: 'left' }))).not.toMatch(/guitar|handed|acoustic|electric/i)
    }
  })
  it('never offers a singer "Skip setup": the set-up must not end without easy notes', () => {
    for (const step of stepOrder(true, null, 'voice')) expect(offersSkipSetup({ instrument: 'voice', step }), step).toBe(false)
    // The guitar set-up offers it where it always did.
    expect(stepOrder(true).filter((step) => offersSkipSetup({ instrument: 'guitar', step }))).toEqual(stepOrder(true).filter(canSkipSetup))
    expect(offersSkipSetup(initialWizardState(true))).toBe(true)
  })
  it('"Not now, back to guitar" is offered on the first screen only, and changes the switch and nothing else', () => {
    expect(offersBackToGuitar(singer())).toBe(true)
    expect(offersBackToGuitar(walk(singer(), { type: 'setExperience', value: 'new' }))).toBe(true)
    // From the phone step on, the set-up has started to store things (the sound sync, then the easy notes).
    let s = walk(singer(), { type: 'setExperience', value: 'new' })
    for (const step of stepOrder(true, 'new', 'voice').slice(1)) {
      s = step === 'song' ? walk(s, { type: 'setRange', value: RANGE }, next) : wizardReducer(s, next)
      expect(s.step).toBe(step)
      expect(offersBackToGuitar(s), step).toBe(false)
    }
    expect(offersBackToGuitar(initialWizardState(true))).toBe(false)
    expect(BACK_TO_GUITAR).toEqual({ instrument: 'guitar' })
  })
  it('finishing shows the singing side, and stores the headphones answer only when one was given', () => {
    expect(voiceSettings(singer())).toEqual({ instrument: 'voice' })
    expect(voiceSettings(wizardReducer(singer(), { type: 'setHeadphones', value: true }))).toEqual({ instrument: 'voice', voiceHeadphones: true })
    expect(voiceSettings(wizardReducer(singer(), { type: 'setHeadphones', value: false }))).toEqual({ instrument: 'voice', voiceHeadphones: false })
  })
  it('a singer answers the first question before anything else, like a guitar learner', () => {
    expect(canContinue(singer())).toBe(false)
    // Answers to later screens do not stand in for it (the stored notes of an earlier walk arrive on the first screen).
    const eager = walk(singer(), { type: 'setMinutes', value: 30 }, { type: 'setHeadphones', value: true }, { type: 'setRange', value: RANGE }, { type: 'setSong', value: 'sing-saints' })
    expect(canContinue(eager)).toBe(false)
    expect(walk(eager, next, next, next).step).toBe('welcome')
  })
  it('sums up a singer whose easy notes are not there yet without a gap or a made-up range', () => {
    const s = walk(singer(), { type: 'setExperience', value: 'some' }, { type: 'setMinutes', value: 20 })
    expect(summarise(s)).toBe('Sung a little · 20 min a day')
    // Found, then asked for again ("Find them again"): the old notes are not named any more.
    expect(summarise(walk(s, { type: 'setRange', value: RANGE }, { type: 'setRange', value: null }))).toBe('Sung a little · 20 min a day')
  })
  it('stays on the last screen, and on the first, however often the singer taps on', () => {
    let s = walk(singer(), { type: 'setExperience', value: 'played' }, next, next, next, { type: 'setRange', value: RANGE }, next, next)
    expect(s.step).toBe('finish')
    expect(walk(s, next, next).step).toBe('finish')
    for (let i = 0; i < 10; i++) s = wizardReducer(s, { type: 'back' })
    expect(s.step).toBe('welcome')
    // Going all the way back loses nothing that was answered or found.
    expect(s).toMatchObject({ experience: 'played', range: RANGE, instrument: 'voice' })
  })
  it('whatever a singer taps, in whatever order, the set-up never gets past the range step without easy notes', () => {
    // A small generator with a fixed start, so the same walks are taken on every run.
    let seed = 20261124
    const pick = <T>(from: T[]): T => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return from[Math.floor((seed / 2147483648) * from.length)]
    }
    const order = stepOrder(true, null, 'voice')
    const seen = new Set<string>()
    for (let run = 0; run < 400; run++) {
      let s = singer()
      for (let tap = 0; tap < 40; tap++) {
        const taps: WizardAction[] = [
          next,
          next,
          { type: 'back' },
          { type: 'setExperience', value: pick(['new', 'some', 'played'] as const) },
          { type: 'setMinutes', value: pick([10, 20, 30] as const) },
          { type: 'setHeadphones', value: pick([true, false]) },
          { type: 'setSong', value: pick(['sing-saints', undefined]) },
          // Notes stored on an earlier walk can arrive on any screen: they are read while the set-up opens.
          { type: 'setRange', value: RANGE },
        ]
        // "Find them again" is only on the range step.
        if (s.step === 'range') taps.push({ type: 'setRange', value: null })
        s = wizardReducer(s, pick(taps))
        seen.add(s.step)
        expect(order, s.step).toContain(s.step)
        if (s.step === 'song' || s.step === 'finish') expect(s.range, s.step).not.toBeNull()
        if (s.step !== 'welcome') expect(s.experience, s.step).not.toBeNull()
      }
    }
    // The walks were not all stuck on the first screens: every screen was reached.
    expect([...seen].sort()).toEqual([...order].sort())
  })
})

describe('who the shell sends to the singing set-up', () => {
  const setUp = { experience: 'new' as const, placementDoneAt: 1 }
  const here = (pathname: string, instrument: 'guitar' | 'voice' = 'voice', voiceOn = true) => ({ voiceOn, instrument, pathname })
  const SHELL_PAGES = ['/', '/songs', '/progress', '/tuner', '/metronome', '/settings', '/test/checkpoint', '/lessons', '/tune', '/range']

  it('a singer who has not been through the set-up, from every page of the shell', () => {
    for (const page of SHELL_PAGES) expect(setUpDoor(here(page), {}), page).toBe('set-up')
  })
  it('goes by what the singer answered, not by whether there is a profile', () => {
    // The range finder stores the easy notes on the singing profile before the set-up is finished.
    expect(setUpDoor(here('/'), { experience: undefined, placementDoneAt: undefined })).toBe('set-up')
    expect(setUpDoor(here('/'), { experience: 'new' })).toBe('set-up')
    expect(setUpDoor(here('/'), { placementDoneAt: 1 })).toBe('set-up')
  })
  it('lets a singer who is set up through everywhere', () => {
    for (const page of SHELL_PAGES) expect(setUpDoor(here(page), setUp), page).toBe('open')
  })
  it('waits while the singing profile is being read, so no page opens for a singer it does not know yet', () => {
    expect(setUpDoor(here('/'), undefined)).toBe('wait')
    expect(setUpDoor(here('/range', 'guitar'), undefined)).toBe('wait')
  })
  it('never holds a guitar learner up', () => {
    for (const page of SHELL_PAGES.filter((p) => p !== '/range')) {
      expect(setUpDoor(here(page, 'guitar'), undefined), page).toBe('open')
      expect(setUpDoor(here(page, 'guitar'), {}), page).toBe('open')
      expect(setUpDoor(here(page, 'guitar', false), {}), page).toBe('open')
    }
  })
  it('"My voice" is a singer\'s page whichever side is showing', () => {
    expect(setUpDoor(here('/range', 'guitar'), {})).toBe('set-up')
    expect(setUpDoor(here('/range/', 'guitar'), {})).toBe('set-up')
    expect(setUpDoor(here('/range', 'guitar'), setUp)).toBe('open')
    // Another page whose address merely starts the same way is not it.
    expect(setUpDoor(here('/ranges', 'guitar'), {})).toBe('open')
  })
  it('does nothing at all while the singing side is switched off', () => {
    // The page behind /range goes home by itself then; the shell must not open a set-up nobody can see.
    for (const page of SHELL_PAGES) expect(setUpDoor(here(page, 'guitar', false), undefined), page).toBe('open')
  })
  it('the switched-off side wins over a place that says "singing"', () => {
    // The setting can still say 'voice' after a preview. Whoever fills in the place, off means no door:
    // not a wait (a blank page for good, nothing would ever be read) and not a set-up nobody can see.
    for (const page of SHELL_PAGES) {
      expect(forTheSinger(here(page, 'voice', false)), page).toBe(false)
      expect(setUpDoor(here(page, 'voice', false), undefined), page).toBe('open')
      expect(setUpDoor(here(page, 'voice', false), {}), page).toBe('open')
    }
  })
  it('is one rule: a page is behind the door exactly when it is about the singer', () => {
    // The shell reads the singing profile only for the pages `forTheSinger` names. If the two ever
    // disagreed, a guitar learner's page would wait for a profile that nobody is reading.
    for (const page of [...SHELL_PAGES, '/range/', '/ranges', '/arrange']) {
      for (const instrument of ['guitar', 'voice'] as const) {
        for (const voiceOn of [true, false]) {
          const at = here(page, instrument, voiceOn)
          expect(setUpDoor(at, undefined) === 'wait', `${page} ${instrument} ${voiceOn}`).toBe(forTheSinger(at))
        }
      }
    }
  })
})

describe('the singing screens and app updates', () => {
  it('an update never reloads the singing set-up, a song being sung, the range page or the hidden check', () => {
    for (const hash of ['#/start?instrument=voice', '#/sing/12', '#/sing/12?level=3', '#/range', '#/range?again=1', '#/range/', '#/voice-check']) {
      expect(isBusyRoute(hash), hash).toBe(true)
    }
  })
  it('still leaves the quiet pages free, also those that merely start the same way', () => {
    for (const hash of ['#/', '#/songs', '#/progress', '#/settings', '#/ranges', '#/singing', '#/voice-checks']) expect(isBusyRoute(hash), hash).toBe(false)
  })
})

describe('the words of the singing set-up', () => {
  const words = (value: unknown): string[] => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(words) : [])
  const all = words(VOICE_SETUP_COPY)

  it('has words to read', () => {
    expect(all.length).toBeGreaterThan(20)
    for (const text of all) expect(text.trim(), text).not.toBe('')
  })
  it('asks the questions the design asks', () => {
    expect(VOICE_SETUP_COPY.welcome.question).toBe('Have you sung before?')
    expect(VOICE_SETUP_COPY.welcome.backToGuitar).toBe('Not now, back to guitar')
    expect(VOICE_SETUP_COPY.phone.place).toBe('Stand or sit about a forearm from the phone, in a quiet room.')
    expect(VOICE_SETUP_COPY.phone.headphones.question).toBe('Are you wearing headphones?')
    expect(VOICE_SETUP_COPY.phone.micPrompt).toBe('Say or hum anything and watch the bar move.')
  })
  it('never uses a word that would put a new singer off, or a number they cannot use', () => {
    // Every form of "fail" (fails, failing, failure), as the course's own list has it.
    const banned = /\b(bpm|ratings?|accuracy|reps?|tiers?|push\w*|belt\w*|louder|wrong\w*|fail\w*|cents|latency|calibrat\w*)\b|as loud|tone deaf/i
    for (const word of ['It failed.', 'a failure', 'Failing that', 'Do not push.', 'pushing', 'belting it out', 'tone deaf', 'the wrong note', 'wrongly']) expect(word, word).toMatch(banned)
    for (const text of all) expect(text, text).not.toMatch(banned)
  })
  it('says nothing about a guitar, except on the way back to it', () => {
    const { backToGuitar, ...welcome } = VOICE_SETUP_COPY.welcome
    expect(backToGuitar).toMatch(/guitar/)
    for (const text of words({ ...VOICE_SETUP_COPY, welcome })) expect(text, text).not.toMatch(/guitar|pluck|strum|string|\bplay(ing|ed)?\b/i)
  })
  it('keeps every sentence short', () => {
    for (const text of all) for (const sentence of text.split(/(?<=[.?!])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(22)
  })
})
