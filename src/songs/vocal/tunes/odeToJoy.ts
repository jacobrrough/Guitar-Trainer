import type { VocalSong } from '../types'

// The first eight bars of the melody, which stay between do and sol. The hymn goes on with four bars that
// drop to the sol below home, out of the smallest range the app stores, so the song stops here, as the
// guitar's does. The words are the hymn "Joyful, joyful, we adore thee", written for this melody.
export const odeToJoy: VocalSong = {
  id: 'sing-ode-to-joy',
  title: 'Ode to Joy',
  credit: 'Ludwig van Beethoven (1824), words by Henry van Dyke (1907); in the public domain',
  description: 'A famous melody that climbs five notes and comes back down.',
  bpm: 80,
  beatsPerBar: 4,
  pickupBeats: 0,
  lines: [
    [
      [4, 1, 'Joy-'], [4, 1, 'ful'], [5, 1, 'joy-'], [7, 1, 'ful'],
      [7, 1, 'we'], [5, 1, 'a-'], [4, 1, 'dore'], [2, 1, 'thee'],
    ],
    [
      [0, 1, 'God'], [0, 1, 'of'], [2, 1, 'glo-'], [4, 1, 'ry'],
      [4, 1.5, 'Lord'], [2, 0.5, 'of'], [2, 2, 'love'],
    ],
    // "Flowers" and "opening" are each sung a syllable short, as hymn books print them.
    [
      [4, 1, 'Hearts'], [4, 1, 'un-'], [5, 1, 'fold'], [7, 1, 'like'],
      [7, 1, "flow'rs"], [5, 1, 'be-'], [4, 1, 'fore'], [2, 1, 'thee'],
    ],
    [
      [0, 1, "Op'-"], [0, 1, 'ning'], [2, 1, 'to'], [4, 1, 'the'],
      [2, 1.5, 'sun'], [0, 0.5, 'a-'], [0, 2, 'bove'],
    ],
  ],
  chords: ['I', 'V7', 'I', 'V', 'I', 'V7', 'I', 'I'],
  lessonLevel: 6,
}
