/**
 * The words of the Today page and the block runner that differ between the two instruments.
 *
 * A guitarist reads, word for word, what these screens said before singing existed. A singer reads
 * about singing: no tuner, no chords, nothing to "play". The singer's words follow docs/SINGING.md §10:
 * short sentences, nothing that blames, never a request for more voice, and no number a beginner
 * cannot use.
 */
import type { InstrumentId } from '../../training/instruments'
import { RANGE_COPY } from '../voice/rangeFinder'

export interface TodayCopy {
  /** The links under the next lesson while the First steps course is running. */
  tools: readonly { to: string; label: string }[]
  /** Leaving the course for daily sessions: the link, and the question asked before anything is skipped. */
  skip: { lead: string; link: string; title: string; body: readonly string[]; keep: string; confirm: string }
  /** The card under a plan whose blocks are all finished. */
  complete: { body: (minutes: number) => string; action: string }
}

/** Said to both: the lessons do not go away when the course is left. */
const NOTHING_LOST = 'Nothing is lost. The lessons stay on this page, under “First steps lessons”, and you can carry on with them any time.'

const GUITAR: TodayCopy = {
  tools: [
    { to: '/tune', label: 'Tune up' },
    { to: '/metronome', label: 'Metronome' },
    { to: '/lessons', label: 'All lessons and songs' },
  ],
  skip: {
    lead: 'Played before?',
    link: 'Skip the course and go to daily sessions',
    title: 'Skip the First steps course?',
    body: ['You will go straight to daily practice sessions. They expect that you can already hold the guitar, tune it and play a few notes.', NOTHING_LOST],
    keep: 'Stay in the course',
    confirm: 'Yes, skip the course',
  },
  complete: { body: (minutes) => `You practised ${minutes} minutes today. Nice work.`, action: 'Play a song' },
}

const VOICE: TodayCopy = {
  // A voice needs no tuner and no metronome. What a singer comes back to is the page of their easy notes.
  tools: [
    { to: '/range', label: 'Find my easy notes' },
    { to: '/lessons', label: 'All lessons and songs' },
  ],
  skip: {
    lead: 'Sung before?',
    link: 'Skip the course and go to daily sessions',
    title: 'Skip the First steps course?',
    body: ['You will go straight to daily practice sessions. They expect that you can already sing a note back when you hear it.', NOTHING_LOST],
    keep: 'Stay in the course',
    confirm: 'Yes, skip the course',
  },
  complete: { body: (minutes) => `You practised ${minutes} minutes today. Nice work.`, action: 'Sing a song' },
}

export function todayCopy(instrument: InstrumentId): TodayCopy {
  return instrument === 'voice' ? VOICE : GUITAR
}

/** What only a singing day has: care for the voice, and a way to end the day when it is tired. */
export const VOICE_DAY = {
  /** Under the first block of the plan. */
  water: 'Have some water nearby.',
  /** The stop line, the same one the range page shows. */
  care: RANGE_COPY.hurt,
  tired: {
    button: 'My voice is tired',
    /** Asked first: one stray tap must not end the day. */
    ask: {
      title: 'Stop for today?',
      body: ['The rest of today is set aside. Nothing is lost by stopping early.', 'Tomorrow starts short and gentle.'],
      confirm: 'Yes, stop for today',
      keep: 'Keep going',
    },
    /** In place of "Session complete" on a day that was ended this way. */
    done: { title: 'Resting today', body: 'Good call. Rest is part of practice. Tomorrow starts short and gentle.' },
    trouble: 'That did not work. Please try again.',
  },
} as const

/** The words of the block runner for a sung exercise or a song to sing. */
export const SUNG_BLOCK = {
  /**
   * In place of the reason an exercise could not be built. That reason is written in note numbers
   * ("The range 55 to 48 is too small…"), which nobody new to singing can use.
   */
  buildTrouble: 'We could not set up this exercise. Finding your easy notes again on the My voice page may help.',
  /** Between two passes of a song. */
  between: { body: 'Take a breath, then sing it once more.', action: 'Sing it again' },
  /** The tracks of the song could not be made. */
  songNotReady: 'The song could not be made ready this time. Go back to Today and open it again.',
  /** The easy notes changed since the day was planned, and the song no longer fits them. */
  songLater: 'This song needs a few more notes than your easy notes hold right now. You can skip it on the Today page.',
  /** The row of the song is gone (songs to sing cannot be deleted, so this is a plan from another device's backup). */
  songGone: 'This song is not here to sing.',
} as const
