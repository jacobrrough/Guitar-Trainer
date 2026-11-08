import { lazySong, repeat, strumChart, uniqueChords } from './util'

const BARS: string[] = repeat(['G', 'G', 'D7', 'G'], 4)

export const tomDooley = () =>
  lazySong(
    { id: 'tom-dooley', title: 'Tom Dooley', artist: 'Traditional', description: 'A folk classic with just G and D7.', bpm: 88, lessonLevel: 8, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'Tom Dooley', artist: 'Traditional', bpm: 88, bars: BARS, everyBeatFromBar: 0 }),
  )
