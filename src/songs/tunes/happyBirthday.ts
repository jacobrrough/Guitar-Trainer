import { lazySong, melodyChart, rest, type MelodyStep } from './util'

// Key of C in 3/4 on the G, B and high E strings.
const G3 = (len = 1): MelodyStep => [3, 0, len]
const A3 = (len = 1): MelodyStep => [3, 2, len]
const B3 = (len = 1): MelodyStep => [4, 0, len]
const C4 = (len = 1): MelodyStep => [4, 1, len]
const D4 = (len = 1): MelodyStep => [4, 3, len]
const E4 = (len = 1): MelodyStep => [5, 0, len]
const F4 = (len = 1): MelodyStep => [5, 1, len]
const G4 = (len = 1): MelodyStep => [5, 3, len]

export const happyBirthday = () =>
  lazySong(
    { id: 'happy-birthday', title: 'Happy Birthday', artist: 'Traditional', description: 'Play it for someone; it only needs the first three frets.', bpm: 76, lessonLevel: 4 },
    () =>
      melodyChart({
        title: 'Happy Birthday',
        artist: 'Traditional',
        bpm: 76,
        // "Hap-py" is a pickup on beat 3: the first bar starts with two silent beats, so that
        // "birth-" and "you" fall on beat 1 with the accent and the drums. Each line below ends on its pickup.
        bars: 9,
        beatsPerBar: 3,
        steps: [
          rest(2), G3(0.5), G3(0.5),
          A3(), G3(), C4(), B3(2), G3(0.5), G3(0.5),
          A3(), G3(), D4(), C4(2), G3(0.5), G3(0.5),
          G4(), E4(), C4(), B3(), A3(), F4(0.5), F4(0.5),
          E4(), C4(), D4(), C4(2),
        ],
      }),
  )
