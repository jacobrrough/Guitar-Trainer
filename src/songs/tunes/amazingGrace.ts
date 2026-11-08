import { lazySong, strumChart, uniqueChords } from './util'

const BARS: string[] = ['G', 'G', 'C', 'G', 'G', 'C', 'G', 'G', 'G', 'G', 'C', 'G', 'G', 'D', 'G', 'G']

export const amazingGrace = () =>
  lazySong(
    { id: 'amazing-grace', title: 'Amazing Grace', artist: 'Traditional', description: 'A slow waltz with G, C and D.', bpm: 72, lessonLevel: 8, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'Amazing Grace', artist: 'Traditional', bpm: 72, beatsPerBar: 3, bars: BARS, everyBeatFromBar: 0 }),
  )
