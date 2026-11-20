import { lazySong, strumChart, uniqueChords } from './util'

// Bar 1 is "-maz-"; the "A-" before it is sung over the count-in.
const BARS: string[] = [
  'G', 'G', 'C', 'G', // -mazing | grace, how | sweet the | sound, that
  'G', 'G', 'D', 'D', // saved a | wretch like | me | I
  'G', 'G', 'C', 'G', // once was | lost, but | now am | found, was
  'G', 'D', 'G', 'G', // blind, but | now I | see
]

export const amazingGrace = () =>
  lazySong(
    { id: 'amazing-grace', title: 'Amazing Grace', artist: 'Traditional', description: 'A slow waltz with G, C and D.', bpm: 72, lessonLevel: 8, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'Amazing Grace', artist: 'Traditional', bpm: 72, beatsPerBar: 3, bars: BARS, everyBeatFromBar: 0 }),
  )
