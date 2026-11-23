import type { VocalSong } from '../types'

// Mi, re and do only (4, 2 and 0 above home): the smallest song there is, and the first one of the course.
export const hotCrossBuns: VocalSong = {
  id: 'sing-hot-cross-buns',
  title: 'Hot Cross Buns',
  credit: 'Traditional',
  description: 'Just three notes, each one next door to the last.',
  bpm: 72,
  beatsPerBar: 4,
  pickupBeats: 0,
  lines: [
    [[4, 1, 'Hot'], [2, 1, 'cross'], [0, 2, 'buns']],
    [[4, 1, 'Hot'], [2, 1, 'cross'], [0, 2, 'buns']],
    // "Two a penny" runs straight into the last "hot cross buns" with nowhere to breathe, so the two bars are one line.
    [
      [0, 0.5, 'One'], [0, 0.5, 'a'], [0, 0.5, 'pen-'], [0, 0.5, 'ny'], [2, 0.5, 'two'], [2, 0.5, 'a'], [2, 0.5, 'pen-'], [2, 0.5, 'ny'],
      [4, 1, 'hot'], [2, 1, 'cross'], [0, 2, 'buns'],
    ],
  ],
  // The home chord all the way: under "one a penny, two a penny" any other chord would rub against half the bar.
  chords: ['I', 'I', 'I', 'I'],
  lessonLevel: 4,
}
