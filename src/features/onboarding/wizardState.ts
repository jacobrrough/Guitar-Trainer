import type { FirstStepsSetup } from '../../training/coach'

export type WizardStep = 'welcome' | 'guitar' | 'time' | 'song' | 'phone' | 'tune' | 'finish'

export interface WizardState {
  step: WizardStep
  experience: FirstStepsSetup['experience'] | null
  guitarType: FirstStepsSetup['guitarType']
  handedness: FirstStepsSetup['handedness']
  dailyMinutes: FirstStepsSetup['dailyMinutes']
  goalSongId?: string
  hasSongs: boolean
}

export type WizardAction =
  | { type: 'setExperience'; value: NonNullable<WizardState['experience']> }
  | { type: 'setGuitar'; value: WizardState['guitarType'] }
  | { type: 'setHand'; value: WizardState['handedness'] }
  | { type: 'setMinutes'; value: WizardState['dailyMinutes'] }
  | { type: 'setSong'; value: string | undefined }
  | { type: 'next' }
  | { type: 'back' }

/** Order of screens. The goal-song step is dropped when there are no songs or the player has played before. */
export function stepOrder(hasSongs: boolean, experience: WizardState['experience'] = null): WizardStep[] {
  const steps: WizardStep[] = ['welcome', 'guitar', 'time']
  if (hasSongs && experience !== 'played') steps.push('song')
  steps.push('phone', 'tune', 'finish')
  return steps
}

export function initialWizardState(hasSongs = false): WizardState {
  return {
    step: 'welcome',
    experience: null,
    guitarType: 'acoustic',
    handedness: 'right',
    dailyMinutes: 10,
    goalSongId: undefined,
    hasSongs,
  }
}

export function canContinue(state: WizardState): boolean {
  return state.step !== 'welcome' || state.experience !== null
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'setExperience':
      return { ...state, experience: action.value, goalSongId: action.value === 'played' ? undefined : state.goalSongId }
    case 'setGuitar':
      return { ...state, guitarType: action.value }
    case 'setHand':
      return { ...state, handedness: action.value }
    case 'setMinutes':
      return { ...state, dailyMinutes: action.value }
    case 'setSong':
      return { ...state, goalSongId: action.value }
    case 'next': {
      if (!canContinue(state)) return state
      const order = stepOrder(state.hasSongs, state.experience)
      const i = order.indexOf(state.step)
      return { ...state, step: order[Math.min(i + 1, order.length - 1)] }
    }
    case 'back': {
      const order = stepOrder(state.hasSongs, state.experience)
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

export function summarise(state: WizardState): string {
  const exp = { new: 'New to guitar', some: 'Played a little', played: 'Has played before' }[state.experience ?? 'new']
  return `${exp} · ${state.guitarType} · ${state.handedness}-handed · ${state.dailyMinutes} min a day`
}
