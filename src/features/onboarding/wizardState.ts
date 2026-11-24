import type { AppSettings } from '../../app/settings'
import type { FirstStepsSetup, VoiceFirstStepsSetup } from '../../training/coach'
import type { InstrumentId, Profile, VoiceRange } from '../../training/types'
import { voiceIsSetUp } from '../../training/voicePlan'
import { rangeText } from '../voice/rangeFinder'

export type WizardStep = 'welcome' | 'guitar' | 'time' | 'song' | 'phone' | 'tune' | 'range' | 'finish'

export interface WizardState {
  step: WizardStep
  experience: FirstStepsSetup['experience'] | null
  guitarType: FirstStepsSetup['guitarType']
  handedness: FirstStepsSetup['handedness']
  dailyMinutes: FirstStepsSetup['dailyMinutes']
  goalSongId?: string
  hasSongs: boolean
  /** Whose set-up this is. The guitar's unless the singing set-up was asked for. */
  instrument: InstrumentId
  /** A singer's answer to "Are you wearing headphones?"; null until it is given. */
  headphones: boolean | null
  /** A singer's easy notes, as the range finder stored them; null until they are found. */
  range: VoiceRange | null
}

export type WizardAction =
  | { type: 'setExperience'; value: NonNullable<WizardState['experience']> }
  | { type: 'setGuitar'; value: WizardState['guitarType'] }
  | { type: 'setHand'; value: WizardState['handedness'] }
  | { type: 'setMinutes'; value: WizardState['dailyMinutes'] }
  | { type: 'setSong'; value: string | undefined }
  | { type: 'setHeadphones'; value: boolean }
  /** The easy notes were found (and stored, by the range finder); null when the singer asks to find them again. */
  | { type: 'setRange'; value: VoiceRange | null }
  | { type: 'next' }
  | { type: 'back' }

/** The address of the singing set-up. The shell and every singing page send a singer here who has not been through it. */
export const VOICE_SETUP_PATH = '/start?instrument=voice'

/**
 * Whose set-up an address opens: `param` is its `instrument` query value. The singing set-up is only
 * there while the singing side is switched on; otherwise the address is the guitar set-up it always was.
 */
export function wizardInstrument(param: string | null, voiceOn: boolean): InstrumentId {
  return voiceOn && param === 'voice' ? 'voice' : 'guitar'
}

/**
 * Order of screens.
 *
 * Guitar: the goal-song step is dropped when there are no songs or the player has played before.
 *
 * Singing: the phone comes before the easy notes (the range finder needs the microphone that the phone
 * step asks for), and the song after them. Nothing about a guitar and nothing to tune. The song step
 * stays whatever was answered: the daily plan sings the picked song first, course or no course.
 */
export function stepOrder(hasSongs: boolean, experience: WizardState['experience'] = null, instrument: InstrumentId = 'guitar'): WizardStep[] {
  if (instrument === 'voice') return ['welcome', 'time', 'phone', 'range', ...(hasSongs ? (['song'] as const) : []), 'finish']
  const steps: WizardStep[] = ['welcome', 'guitar', 'time']
  if (hasSongs && experience !== 'played') steps.push('song')
  steps.push('phone', 'tune', 'finish')
  return steps
}

export function initialWizardState(hasSongs = false, instrument: InstrumentId = 'guitar'): WizardState {
  return {
    step: 'welcome',
    experience: null,
    guitarType: 'acoustic',
    handedness: 'right',
    dailyMinutes: 10,
    goalSongId: undefined,
    hasSongs,
    instrument,
    headphones: null,
    range: null,
  }
}

/**
 * Whether "Continue" may move on. The first screen waits for its answer. A singer's range step waits
 * for the easy notes: every exercise and song is placed in them, so the set-up never ends without.
 */
export function canContinue(state: WizardState): boolean {
  if (state.step === 'welcome') return state.experience !== null
  if (state.step === 'range') return state.range !== null
  return true
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'setExperience': {
      // A guitar player who can play goes to a check, not to a course with a song to aim for. A singer keeps theirs.
      const dropSong = action.value === 'played' && state.instrument === 'guitar'
      return { ...state, experience: action.value, goalSongId: dropSong ? undefined : state.goalSongId }
    }
    case 'setGuitar':
      return { ...state, guitarType: action.value }
    case 'setHand':
      return { ...state, handedness: action.value }
    case 'setMinutes':
      return { ...state, dailyMinutes: action.value }
    case 'setSong':
      return { ...state, goalSongId: action.value }
    case 'setHeadphones':
      return { ...state, headphones: action.value }
    case 'setRange':
      return { ...state, range: action.value }
    case 'next': {
      if (!canContinue(state)) return state
      const order = stepOrder(state.hasSongs, state.experience, state.instrument)
      const i = order.indexOf(state.step)
      return { ...state, step: order[Math.min(i + 1, order.length - 1)] }
    }
    case 'back': {
      const order = stepOrder(state.hasSongs, state.experience, state.instrument)
      const i = order.indexOf(state.step)
      return { ...state, step: order[Math.max(i - 1, 0)] }
    }
  }
}

export function toSetup(state: WizardState): FirstStepsSetup {
  return {
    experience: state.experience ?? 'new',
    handedness: state.handedness,
    guitarType: state.guitarType,
    dailyMinutes: state.dailyMinutes,
    goalSongId: state.experience === 'played' ? undefined : state.goalSongId,
  }
}

/**
 * What the singing set-up saves. Only what a singer was asked: the hand and the guitar type belong to
 * the guitar side, and a learner who set them there keeps them.
 */
export function toVoiceSetup(state: WizardState): VoiceFirstStepsSetup {
  return { experience: state.experience ?? 'new', dailyMinutes: state.dailyMinutes, goalSongId: state.goalSongId }
}

/**
 * What finishing the singing set-up changes in the settings: the app shows the singing side from here
 * on, and the headphones answer is stored when one was given. An unanswered question leaves the
 * setting alone (off, on a new device: the guide voice then stays out of the microphone).
 */
export function voiceSettings(state: WizardState): Partial<Pick<AppSettings, 'instrument' | 'voiceHeadphones'>> {
  return { instrument: 'voice', ...(state.headphones === null ? {} : { voiceHeadphones: state.headphones }) }
}

/** What "Not now, back to guitar" changes: the switch. No profile, no lesson, no song is written for it. */
export const BACK_TO_GUITAR: Pick<AppSettings, 'instrument'> = { instrument: 'guitar' }

/**
 * "Not now, back to guitar" is the way out for someone who tapped "Singing" to have a look. Only on
 * the first screen: this walk through the set-up has stored nothing yet there (the easy notes are
 * stored from the range step on), so leaving really leaves nothing behind.
 */
export function offersBackToGuitar(state: Pick<WizardState, 'instrument' | 'step'>): boolean {
  return state.instrument === 'voice' && state.step === 'welcome'
}

/**
 * What to save when the wizard is left early. Every answer given so far is kept (a left-handed
 * player must not end up with right-handed diagrams); only unanswered questions get the beginner default.
 */
export function skipSetup(state: WizardState): FirstStepsSetup {
  return toSetup(state)
}

/** The tuning and last screens have their own way out, so "Skip setup" is not offered there. */
export function canSkipSetup(step: WizardStep): boolean {
  return step !== 'tune' && step !== 'finish'
}

/**
 * Whether this screen offers "Skip setup". A singer is never offered it: skipping would end the
 * set-up without easy notes. Each of their screens can be passed with one tap instead, and the range
 * finder has its own "skip" that still leaves a range behind.
 */
export function offersSkipSetup(state: Pick<WizardState, 'instrument' | 'step'>): boolean {
  return state.instrument === 'guitar' && canSkipSetup(state.step)
}

export function summarise(state: WizardState): string {
  if (state.instrument === 'voice') {
    const notes = state.range ? [`easy notes ${rangeText(state.range)}`] : []
    return [VOICE_SETUP_COPY.summary[state.experience ?? 'new'], ...notes, `${state.dailyMinutes} min a day`].join(' · ')
  }
  const exp = { new: 'New to guitar', some: 'Played a little', played: 'Has played before' }[state.experience ?? 'new']
  return `${exp} · ${state.guitarType} · ${state.handedness}-handed · ${state.dailyMinutes} min a day`
}

/**
 * What the shell does with a page: show it, hold it back for a moment, or send the learner to the
 * singing set-up first.
 */
export type SetUpDoor = 'open' | 'wait' | 'set-up'

/** Where the shell is: whether the singing side is switched on, which side is showing, and the page's path. */
export interface ShellPlace {
  voiceOn: boolean
  instrument: InstrumentId
  pathname: string
}

/**
 * Whether a page of the shell is about the singer: every page while the singing side is showing, and
 * "My voice" whichever side is showing. Never while the singing side is switched off.
 */
export function forTheSinger(at: ShellPlace): boolean {
  return at.voiceOn && (at.instrument === 'voice' || at.pathname === '/range' || at.pathname.startsWith('/range/'))
}

/**
 * The shell's rule for a singer who has not been through the set-up (docs/SINGING.md §12.21): every
 * page of the shell sends them there. That also covers the device whose singing data was reset or
 * replaced by a backup while the switch still says "Singing".
 *
 * `singer` is the singing profile, undefined while it is still being read. It is asked what the singer
 * answered in the set-up, never whether it exists: the range finder stores the easy notes on it before
 * the set-up is finished. While it is being read the page is held back ('wait'), so no page starts work
 * (a plan for the day, say) for a singer it may be about to send away.
 *
 * A guitar learner is never held up and never asked anything, and with the singing side switched off
 * there is no door at all.
 */
export function setUpDoor(at: ShellPlace, singer: Pick<Profile, 'experience' | 'placementDoneAt'> | undefined): SetUpDoor {
  if (!forTheSinger(at)) return 'open'
  if (!singer) return 'wait'
  return voiceIsSetUp(singer) ? 'open' : 'set-up'
}

/** Everything the singing set-up says that the guitar set-up does not. Kept here so one test can read every word. */
export const VOICE_SETUP_COPY = {
  welcome: {
    title: "Let's get you singing.",
    question: 'Have you sung before?',
    new: { title: 'Never', hint: 'Start from the very beginning' },
    some: { title: 'A little', hint: 'I sing along now and then' },
    played: { title: 'Yes, often', hint: 'Go straight to daily practice' },
    backToGuitar: 'Not now, back to guitar',
  },
  phone: {
    title: 'Phone and sound',
    place: 'Stand or sit about a forearm from the phone, in a quiet room.',
    lean: 'Lean the phone on something, so it faces you.',
    headphones: {
      question: 'Are you wearing headphones?',
      yes: 'Yes',
      no: 'No',
      withThem: 'Good. You will hear a guide voice while you sing.',
      without: 'That is fine. You will sing to a click and a starting note.',
    },
    micPrompt: 'Say or hum anything and watch the bar move.',
    sync: {
      title: 'Line up the sound',
      text: 'The phone plays a few clicks and listens for them. After that, the notes you sing line up with what you see.',
      start: 'Sync your sound',
      later: 'You can skip this. It is in Settings whenever you want it.',
      done: 'Done. Your sound is in sync.',
    },
  },
  range: {
    title: 'Your easy notes',
    text: 'These are the notes we will use for your exercises and songs.',
    again: 'Find them again',
  },
  song: {
    title: 'Pick a song to aim for',
    text: 'Optional. It gives your first weeks a target.',
  },
  finish: {
    title: "You're ready",
    course: 'Start lesson 1',
    practice: "Go to today's practice",
    trouble: 'We could not save your answers. Please try again.',
  },
  summary: { new: 'New to singing', some: 'Sung a little', played: 'Sings often' },
} as const
