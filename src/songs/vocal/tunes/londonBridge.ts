import type { VocalSong } from '../types'

// Starts on sol, touches la (9 above home) and ends on do: two notes wider than the smallest range the
// app stores, so a singer with that range meets it under "Comes later".
export const londonBridge: VocalSong = {
  id: 'sing-london-bridge',
  title: 'London Bridge',
  credit: 'Traditional',
  description: 'A playground song that starts near the top and comes home at the end.',
  bpm: 84,
  beatsPerBar: 4,
  pickupBeats: 0,
  lines: [
    [
      [7, 1.5, 'Lon-'], [9, 0.5, 'don'], [7, 1, 'Bridge'], [5, 1, 'is'],
      [4, 1, 'fall-'], [5, 1, 'ing'], [7, 2, 'down'],
    ],
    [
      [2, 1, 'fall-'], [4, 1, 'ing'], [5, 2, 'down'],
      [4, 1, 'fall-'], [5, 1, 'ing'], [7, 2, 'down'],
    ],
    [
      [7, 1.5, 'Lon-'], [9, 0.5, 'don'], [7, 1, 'Bridge'], [5, 1, 'is'],
      [4, 1, 'fall-'], [5, 1, 'ing'], [7, 2, 'down'],
    ],
    [
      [2, 2, 'my'], [7, 2, 'fair'],
      [4, 1, 'la-'], [0, 1, 'dy'], [null, 2],
    ],
  ],
  chords: ['I', 'I', 'V7', 'I', 'I', 'I', 'V7', 'I'],
  lessonLevel: 8,
}
