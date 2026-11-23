import type { VocalSong, VocalStep } from '../types'

// The chorus, twice round as it is sung: do to sol, and mi for most of the way. The first time ends up in
// the air on "hey", the second time comes home.

/** The three lines both times round start with, built afresh for each so no line is the same array twice. */
const opening = (): VocalStep[][] => [
  [
    [4, 1, 'Jin-'], [4, 1, 'gle'], [4, 2, 'bells'],
    [4, 1, 'jin-'], [4, 1, 'gle'], [4, 2, 'bells'],
  ],
  [
    [4, 1, 'jin-'], [7, 1, 'gle'], [0, 1.5, 'all'], [2, 0.5, 'the'],
    [4, 4, 'way'],
  ],
  // "In a" is sung on the last beat of the bar of "ride": the breath comes before it, so this line ends a
  // beat before the bar line and the next one starts with "in a" as its pickup.
  [
    [5, 1, 'Oh'], [5, 1, 'what'], [5, 1.5, 'fun'], [5, 0.5, 'it'],
    [5, 1, 'is'], [4, 1, 'to'], [4, 1, 'ride'],
  ],
]

export const jingleBells: VocalSong = {
  id: 'sing-jingle-bells',
  title: 'Jingle Bells',
  credit: 'James Lord Pierpont (1857); in the public domain',
  description: 'The chorus everyone knows, sitting on one note for most of the way.',
  bpm: 88,
  beatsPerBar: 4,
  pickupBeats: 0,
  lines: [
    ...opening(),
    [
      [4, 0.5, 'in'], [4, 0.5, 'a'],
      [4, 1, 'one-'], [2, 1, 'horse'], [2, 1, 'o-'], [4, 1, 'pen'],
      [2, 2, 'sleigh'], [7, 2, 'hey'],
    ],
    ...opening(),
    [
      [4, 0.5, 'in'], [4, 0.5, 'a'],
      [7, 1, 'one-'], [7, 1, 'horse'], [5, 1, 'o-'], [2, 1, 'pen'],
      [0, 4, 'sleigh'],
    ],
  ],
  chords: ['I', 'I', 'I', 'I', 'IV', 'I', 'V', 'V7', 'I', 'I', 'I', 'I', 'IV', 'I', 'V7', 'I'],
  lessonLevel: 9,
}
