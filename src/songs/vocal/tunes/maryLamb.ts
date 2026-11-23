import type { VocalSong } from '../types'

// Do to sol, in even quarter notes as beginners' books print it (many songbooks dot the first note of "Ma-ry").
export const maryLamb: VocalSong = {
  id: 'sing-mary-lamb',
  title: 'Mary Had a Little Lamb',
  credit: 'Words by Sarah Josepha Hale (1830), tune by Lowell Mason; in the public domain',
  description: 'A tune you already know that moves in small steps, with one little jump.',
  bpm: 84,
  beatsPerBar: 4,
  pickupBeats: 0,
  lines: [
    [
      [4, 1, 'Ma-'], [2, 1, 'ry'], [0, 1, 'had'], [2, 1, 'a'],
      [4, 1, 'lit-'], [4, 1, 'tle'], [4, 2, 'lamb'],
    ],
    [
      [2, 1, 'lit-'], [2, 1, 'tle'], [2, 2, 'lamb'],
      [4, 1, 'lit-'], [7, 1, 'tle'], [7, 2, 'lamb'],
    ],
    // This "lamb" is one beat, and "its" is sung on the last beat of the same bar: the breath comes between
    // them, so the line ends a beat before the bar line and the next one starts with "its" as its pickup.
    [
      [4, 1, 'Ma-'], [2, 1, 'ry'], [0, 1, 'had'], [2, 1, 'a'],
      [4, 1, 'lit-'], [4, 1, 'tle'], [4, 1, 'lamb'],
    ],
    [
      [4, 1, 'its'],
      [2, 1, 'fleece'], [2, 1, 'was'], [4, 1, 'white'], [2, 1, 'as'],
      [0, 4, 'snow'],
    ],
  ],
  chords: ['I', 'I', 'V7', 'I', 'I', 'I', 'V7', 'I'],
  lessonLevel: 5,
}
