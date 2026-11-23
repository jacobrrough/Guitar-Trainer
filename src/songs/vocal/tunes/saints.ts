import type { VocalSong } from '../types'

// Do to sol. "Oh when the" is sung before the first bar line, on beats 2, 3 and 4; the bars that follow
// a long note open with one beat of rest, which is written at the end of the line it follows.
export const saints: VocalSong = {
  id: 'sing-saints',
  title: 'When the Saints Go Marching In',
  credit: 'Traditional',
  description: 'A bright, bouncy song that climbs to the same top note again and again.',
  // Brisk on purpose: "Oh Lord I want to be in that number" is seventeen beats on one breath.
  bpm: 108,
  beatsPerBar: 4,
  pickupBeats: 3,
  lines: [
    [
      [0, 1, 'Oh'], [4, 1, 'when'], [5, 1, 'the'],
      [7, 4, 'saints'],
      [null, 1],
    ],
    [
      [0, 1, 'go'], [4, 1, 'march-'], [5, 1, 'ing'],
      [7, 4, 'in'],
      [null, 1],
    ],
    [
      [0, 1, 'Oh'], [4, 1, 'when'], [5, 1, 'the'],
      [7, 2, 'saints'], [4, 2, 'go'],
      [0, 2, 'march-'], [4, 2, 'ing'],
      [2, 4, 'in'],
      [null, 1],
    ],
    // "-ber" fills the first half of its bar and "when the" the second half. So this line is a beat longer
    // than four bars, and the last line starts with a pickup of two beats where the others have three.
    [
      [4, 1, 'Oh'], [4, 1, 'Lord'], [2, 1, 'I'],
      [0, 3, 'want'], [0, 1, 'to'],
      [4, 2, 'be'], [7, 2, 'in'],
      [7, 2, 'that'], [5, 2, 'num-'],
      [5, 2, 'ber'],
    ],
    // The beat of rest after "in" is the last bar of the tune: with the three beats sung before bar 1 it makes a whole bar.
    [
      [4, 1, 'when'], [5, 1, 'the'],
      [7, 2, 'saints'], [4, 2, 'go'],
      [0, 2, 'march-'], [2, 2, 'ing'],
      [0, 4, 'in'],
      [null, 1],
    ],
  ],
  // The chords of the guitar's version of the song, bar for bar.
  chords: ['I', 'I', 'I', 'I', 'I', 'I', 'V7', 'V7', 'I', 'I', 'IV', 'IV', 'I', 'V7', 'I', 'I'],
  lessonLevel: 8,
}
