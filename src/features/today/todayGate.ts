import { profileIdFor, type InstrumentId } from '../../training/instruments'
import type { Profile } from '../../training/types'
import { voiceIsSetUp } from '../../training/voicePlan'

/**
 * What the Today page shows:
 * - `loading`: the profile of the instrument on screen has not been read yet;
 * - `start`: this learner has not been through the set-up, which is where they belong first;
 * - `course`: the First steps course is running: the next lesson, and little else;
 * - `setup`: the card that asks a guitarist who has played before for goals, minutes and a starting check;
 * - `plan`: the Coach's plan for the day.
 */
export type TodayGate = 'loading' | 'start' | 'course' | 'setup' | 'plan'

type GateProfile = Pick<Profile, 'id' | 'experience' | 'placementDoneAt' | 'firstStepsStartedAt' | 'firstStepsDoneAt'>

/**
 * Which of them it is, from the instrument on screen and that instrument's profile alone.
 *
 * The trap: a live query that is asked for another row goes on answering with the row it had until
 * the new one has been read. For a moment after the switch between guitar and singing, Today is handed
 * the other learner's profile. Read as its own, a seasoned guitarist's row would plan a day of singing
 * for someone who has never been through the singing set-up. So a row with the other id is "not read yet".
 *
 * A guitarist is sorted exactly as before singing existed. A singer has no set-up card: that card
 * offers the guitar's starting check, and singing has none (its set-up marks the check done whatever
 * was answered). "Set up" is asked of what the singer answered there, never of whether the row exists.
 */
export function todayGate(instrument: InstrumentId, profile: GateProfile | undefined): TodayGate {
  if (!profile || profile.id !== profileIdFor(instrument)) return 'loading'
  const inCourse = !!profile.firstStepsStartedAt && !profile.firstStepsDoneAt
  if (instrument === 'voice') {
    if (!voiceIsSetUp(profile)) return 'start'
    return inCourse ? 'course' : 'plan'
  }
  if (!profile.placementDoneAt && !profile.firstStepsStartedAt && !profile.experience) return 'start'
  if (inCourse) return 'course'
  return profile.placementDoneAt ? 'plan' : 'setup'
}

/** Where the set-up of an instrument is: the Start Here wizard, told which instrument it is for. */
export function setUpPath(instrument: InstrumentId): string {
  return instrument === 'voice' ? '/start?instrument=voice' : '/start'
}
