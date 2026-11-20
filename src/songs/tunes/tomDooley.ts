import { lazySong, repeat, strumChart, uniqueChords } from './util'

// One verse, played twice. The song moves to D7 on "cry" and stays there until the last word.
const VERSE: string[] = [
  'G', 'G', 'G', 'D7', // Hang down your head, Tom | Dooley | hang down your head and | cry
  'D7', 'D7', 'D7', 'G', // Hang down your head, Tom | Dooley | poor boy, you're bound to | die
]
const BARS: string[] = repeat(VERSE, 2)

export const tomDooley = () =>
  lazySong(
    { id: 'tom-dooley', title: 'Tom Dooley', artist: 'Traditional', description: 'A folk classic with just G and D7.', bpm: 88, lessonLevel: 8, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'Tom Dooley', artist: 'Traditional', bpm: 88, bars: BARS, everyBeatFromBar: 0 }),
  )
