import { lazySong, melodyChart, type MelodyStep } from './util'

// Key of C on the B (string 4) and high E (string 5) strings.
const e = (len = 1): MelodyStep => [5, 0, len]
const f = (len = 1): MelodyStep => [5, 1, len]
const g = (len = 1): MelodyStep => [5, 3, len]
const d = (len = 1): MelodyStep => [4, 3, len]
const c = (len = 1): MelodyStep => [4, 1, len]

export const odeToJoy = () =>
  lazySong(
    { id: 'ode-to-joy', title: 'Ode to Joy', artist: 'Beethoven', description: 'A famous melody that sits comfortably on two strings.', bpm: 70, lessonLevel: 3 },
    () =>
      melodyChart({
        title: 'Ode to Joy',
        artist: 'Beethoven',
        bpm: 70,
        bars: 8,
        steps: [
          e(), e(), f(), g(), g(), f(), e(), d(),
          c(), c(), d(), e(), e(1.5), d(0.5), d(2),
          e(), e(), f(), g(), g(), f(), e(), d(),
          c(), c(), d(), e(), d(1.5), c(0.5), c(2),
        ],
      }),
  )
