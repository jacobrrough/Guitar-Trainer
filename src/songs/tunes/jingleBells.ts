import { lazySong, melodyChart, type MelodyStep } from './util'

// Key of G, mostly on the B string.
const G3 = (len = 1): MelodyStep => [3, 0, len]
const A3 = (len = 1): MelodyStep => [3, 2, len]
const B3 = (len = 1): MelodyStep => [4, 0, len]
const C4 = (len = 1): MelodyStep => [4, 1, len]
const D4 = (len = 1): MelodyStep => [4, 3, len]

export const jingleBells = () =>
  lazySong(
    { id: 'jingle-bells', title: 'Jingle Bells', artist: 'Traditional', description: 'The chorus, mostly on a single string.', bpm: 80, lessonLevel: 4 },
    () =>
      melodyChart({
        title: 'Jingle Bells',
        artist: 'Traditional',
        bpm: 80,
        bars: 8,
        steps: [
          B3(), B3(), B3(2), B3(), B3(), B3(2),
          B3(), D4(), G3(1.5), A3(0.5), B3(4),
          C4(), C4(), C4(1.5), C4(0.5), C4(), B3(), B3(), B3(0.5), B3(0.5),
          B3(), A3(), A3(), B3(), A3(2), G3(2),
        ],
      }),
  )
