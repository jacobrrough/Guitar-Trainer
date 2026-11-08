import { lazySong, melodyChart, type MelodyStep } from './util'

// Key of G on the G, B and high E strings.
const G3 = (len = 1): MelodyStep => [3, 0, len]
const A3 = (len = 1): MelodyStep => [3, 2, len]
const B3 = (len = 1): MelodyStep => [4, 0, len]
const C4 = (len = 1): MelodyStep => [4, 1, len]
const D4 = (len = 1): MelodyStep => [4, 3, len]
const E4 = (len = 1): MelodyStep => [5, 0, len]

export const twinkleTwinkle = () =>
  lazySong(
    { id: 'twinkle-twinkle', title: 'Twinkle, Twinkle, Little Star', artist: 'Traditional', description: 'A tune everyone knows, played across three strings.', bpm: 72, lessonLevel: 4 },
    () => {
      const top = [G3(), G3(), D4(), D4(), E4(), E4(), D4(2), C4(), C4(), B3(), B3(), A3(), A3(), G3(2)]
      const mid = [D4(), D4(), C4(), C4(), B3(), B3(), A3(2)]
      return melodyChart({
        title: 'Twinkle, Twinkle, Little Star',
        artist: 'Traditional',
        bpm: 72,
        bars: 12,
        steps: [...top, ...mid, ...mid, ...top],
      })
    },
  )
