import type { VocalSong } from '../types'

// In three, from the sol below home (-5) to the sol above it (7): a whole octave. Every line starts with
// one note before the bar line, and several syllables are carried over two notes, as hymn books print them.
export const amazingGrace: VocalSong = {
  id: 'sing-amazing-grace',
  title: 'Amazing Grace',
  credit: 'Words by John Newton (1779), traditional tune; in the public domain',
  description: 'A slow, calm song with long notes and a wide reach from low to high.',
  // Not slower: each line is twelve beats on one breath.
  bpm: 84,
  beatsPerBar: 3,
  pickupBeats: 1,
  lines: [
    [
      [-5, 1, 'A-'],
      [0, 2, 'ma-'], [4, 0.5, 'zing'], [0, 0.5, ''],
      [4, 2, 'grace'], [2, 1, 'how'],
      [0, 2, 'sweet'], [-3, 1, 'the'],
      [-5, 2, 'sound'],
    ],
    // "Me" is held through its bar and two beats of the next.
    [
      [-5, 1, 'that'],
      [0, 2, 'saved'], [4, 0.5, 'a'], [0, 0.5, ''],
      [4, 2, 'wretch'], [2, 1, 'like'],
      [7, 5, 'me'],
    ],
    [
      [4, 1, 'I'],
      [7, 1.5, 'once'], [4, 0.5, ''], [7, 0.5, 'was'], [4, 0.5, ''],
      [0, 2, 'lost'], [-5, 1, 'but'],
      [-3, 1.5, 'now'], [0, 0.5, ''], [0, 0.5, 'am'], [-3, 0.5, ''],
      [-5, 2, 'found'],
    ],
    // The last bar is the two beats "see" is still held for: with the one note before bar 1 it makes a whole bar.
    [
      [-5, 1, 'was'],
      [0, 2, 'blind'], [4, 0.5, 'but'], [0, 0.5, ''],
      [4, 2, 'now'], [2, 1, 'I'],
      [0, 5, 'see'],
    ],
  ],
  // The chords of the guitar's version of the song, bar for bar.
  chords: ['I', 'I', 'IV', 'I', 'I', 'I', 'V', 'V', 'I', 'I', 'IV', 'I', 'I', 'V', 'I', 'I'],
  lessonLevel: 10,
  needs: ['voice.interval.triad'],
}
