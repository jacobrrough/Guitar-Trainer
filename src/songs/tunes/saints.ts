import { lazySong, strumChart, uniqueChords } from './util'

// Bar 1 is "saints"; "Oh when the" is sung over the count-in.
const BARS: string[] = [
  'G', 'G', 'G', 'G', // saints | go marching | in | oh when the
  'G', 'G', 'D7', 'D7', // saints go | marching | in | oh Lord I
  'G', 'G', 'C', 'C', // want to | be in | that num- | -ber, when the
  'G', 'D7', 'G', 'G', // saints go | marching | in
]

export const saints = () =>
  lazySong(
    { id: 'saints', title: 'When the Saints Go Marching In', artist: 'Traditional', description: 'A joyful song with G, C and D7.', bpm: 96, lessonLevel: 8, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'When the Saints Go Marching In', artist: 'Traditional', bpm: 96, bars: BARS, everyBeatFromBar: 0 }),
  )
