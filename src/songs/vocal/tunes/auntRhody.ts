import type { VocalSong } from '../types'

// Do to sol, with a long note at the start of nearly every bar.
export const auntRhody: VocalSong = {
  id: 'sing-aunt-rhody',
  title: 'Go Tell Aunt Rhody',
  credit: 'Traditional',
  description: 'A gentle folk song with long notes to rest on.',
  bpm: 84,
  beatsPerBar: 4,
  pickupBeats: 0,
  lines: [
    [
      [4, 2, 'Go'], [4, 1, 'tell'], [2, 1, 'Aunt'],
      [0, 2, 'Rho-'], [0, 2, 'dy'],
    ],
    // The second "Rho-" is carried down a step before "-dy".
    [
      [2, 2, 'go'], [2, 1, 'tell'], [5, 1, 'Aunt'],
      [4, 1, 'Rho-'], [2, 1, ''], [0, 2, 'dy'],
    ],
    // "The" is sung on the last beat of the bar of this "Rhody": the breath comes before it, so the line
    // ends a beat before the bar line and the last line starts with "the" as its pickup.
    [
      [7, 2, 'go'], [7, 1, 'tell'], [5, 1, 'Aunt'],
      [4, 2, 'Rho-'], [4, 1, 'dy'],
    ],
    [
      [4, 1, 'the'],
      [2, 1, 'old'], [0, 1, 'grey'], [2, 1, 'goose'], [4, 1, 'is'],
      [0, 4, 'dead'],
    ],
  ],
  chords: ['I', 'I', 'V7', 'I', 'I', 'I', 'V7', 'I'],
  lessonLevel: 7,
}
