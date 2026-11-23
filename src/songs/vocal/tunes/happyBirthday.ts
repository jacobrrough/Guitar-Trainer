import type { VocalSong } from '../types'

// In three, from the sol below home (-5) to the sol above it (7), which the third line reaches in one jump.
// "Hap-py" is two even half beats before the bar line, as the guitar's version has it (many prints dot the first).
export const happyBirthday: VocalSong = {
  id: 'sing-happy-birthday',
  title: 'Happy Birthday',
  credit: 'Tune by Mildred and Patty Hill (1893); in the public domain',
  description: 'Sing it for someone you like; the third line has one big jump up.',
  bpm: 80,
  beatsPerBar: 3,
  pickupBeats: 1,
  lines: [
    [
      [-5, 0.5, 'Hap-'], [-5, 0.5, 'py'],
      [-3, 1, 'birth-'], [-5, 1, 'day'], [0, 1, 'to'],
      [-1, 2, 'you'],
    ],
    [
      [-5, 0.5, 'hap-'], [-5, 0.5, 'py'],
      [-3, 1, 'birth-'], [-5, 1, 'day'], [2, 1, 'to'],
      [0, 2, 'you'],
    ],
    // The two notes after "dear" are where the name goes: "friend" is carried over both, as a short name would be.
    [
      [-5, 0.5, 'hap-'], [-5, 0.5, 'py'],
      [7, 1, 'birth-'], [4, 1, 'day'], [0, 1, 'dear'],
      [-1, 1, 'friend'], [-3, 1, ''],
    ],
    // The last bar is the two beats of "you": with the beat of "Hap-py" before bar 1 it makes a whole bar.
    [
      [5, 0.5, 'hap-'], [5, 0.5, 'py'],
      [4, 1, 'birth-'], [0, 1, 'day'], [2, 1, 'to'],
      [0, 2, 'you'],
    ],
  ],
  chords: ['I', 'V7', 'V7', 'I', 'I', 'IV', 'I', 'I'],
  lessonLevel: 10,
  needs: ['voice.interval.leaps'],
}
