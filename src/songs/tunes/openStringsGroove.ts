import { lazySong, melodyChart, type MelodyStep } from './util'

const E = (len: number): MelodyStep => [0, 0, len]
const A = (len: number): MelodyStep => [1, 0, len]

export const openStringsGroove = () =>
  lazySong(
    { id: 'open-strings-groove', title: 'Open Strings Groove', artist: 'Guitar Trainer', description: 'Your first tune: just two open strings over a beat.', bpm: 60, lessonLevel: 1 },
    () =>
      melodyChart({
        title: 'Open Strings Groove',
        artist: 'Guitar Trainer',
        bpm: 60,
        bars: 8,
        steps: [E(2), A(2), E(2), A(2), E(2), E(2), A(2), A(2), E(2), A(2), E(2), A(2), A(2), A(2), E(4)],
      }),
  )
