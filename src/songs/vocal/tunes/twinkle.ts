import type { VocalSong, VocalStep } from '../types'

// Do up to la (9 above home) in the second bar: two notes wider than the smallest range the app stores,
// so a singer with that range meets it under "Comes later".

/** The two lines the tune opens and closes with, built afresh each time so no line is the same array twice. */
const star = (): VocalStep[][] => [
  [
    [0, 1, 'Twin-'], [0, 1, 'kle'], [7, 1, 'twin-'], [7, 1, 'kle'],
    [9, 1, 'lit-'], [9, 1, 'tle'], [7, 2, 'star'],
  ],
  [
    [5, 1, 'How'], [5, 1, 'I'], [4, 1, 'won-'], [4, 1, 'der'],
    [2, 1, 'what'], [2, 1, 'you'], [0, 2, 'are'],
  ],
]

/** The middle line, sung twice to different words. */
const above = (words: [string, string, string, string, string, string, string]): VocalStep[] => [
  [7, 1, words[0]], [7, 1, words[1]], [5, 1, words[2]], [5, 1, words[3]],
  [4, 1, words[4]], [4, 1, words[5]], [2, 2, words[6]],
]

export const twinkle: VocalSong = {
  id: 'sing-twinkle',
  title: 'Twinkle, Twinkle, Little Star',
  credit: 'Traditional tune, words by Jane Taylor (1806); in the public domain',
  description: 'A tune you have known all your life, with one big jump right at the start.',
  bpm: 80,
  beatsPerBar: 4,
  pickupBeats: 0,
  lines: [
    ...star(),
    above(['Up', 'a-', 'bove', 'the', 'world', 'so', 'high']),
    above(['Like', 'a', 'dia-', 'mond', 'in', 'the', 'sky']),
    ...star(),
  ],
  // The middle lines hang on the chord a fifth up: with its seventh it holds both "sol sol" and "fa fa",
  // and without it the long re each line ends on (the seventh would rub against "mi mi").
  chords: ['I', 'IV', 'IV', 'I', 'V7', 'V', 'V7', 'V', 'I', 'IV', 'IV', 'I'],
  lessonLevel: 9,
}
