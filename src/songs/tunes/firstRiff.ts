import { lazySong, melodyChart, type MelodyStep } from './util'

const E = (fret: number, len: number): MelodyStep => [0, fret, len]
const A = (fret: number, len: number): MelodyStep => [1, fret, len]

export const firstRiff = () =>
  lazySong(
    { id: 'first-riff', title: 'First Riff', artist: 'Guitar Trainer', description: 'A catchy repeating riff on the two thickest strings.', bpm: 90, lessonLevel: 10 },
    () => {
      const e1 = [E(0, 0.5), E(0, 0.5), E(3, 1), E(0, 0.5), E(0, 0.5), E(5, 1)]
      const e2 = [E(0, 0.5), E(0, 0.5), E(3, 1), A(0, 0.5), A(0, 0.5), A(3, 1)]
      const a1 = [A(0, 0.5), A(0, 0.5), A(3, 1), A(0, 0.5), A(0, 0.5), A(5, 1)]
      const a2 = [A(0, 0.5), A(0, 0.5), A(3, 1), E(0, 0.5), E(0, 0.5), E(3, 1)]
      const end = [E(0, 0.5), E(0, 0.5), E(3, 1), E(0, 2)]
      // Played with the hand moved up, as lesson 10 teaches it: index finger on fret 3, ring finger on fret 5.
      return melodyChart({ title: 'First Riff', artist: 'Guitar Trainer', bpm: 90, bars: 8, steps: [...e1, ...e2, ...e1, ...e2, ...a1, ...a2, ...e1, ...end], fingers: { 3: 1, 5: 3 } })
    },
  )
