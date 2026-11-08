import { lazySong, strumChart, uniqueChords } from './util'

const BARS: string[] = ['G', 'G', 'G', 'G', 'C', 'C', 'G', 'G', 'G', 'G', 'D7', 'D7', 'G', 'C', 'D7', 'G']

export const saints = () =>
  lazySong(
    { id: 'saints', title: 'When the Saints Go Marching In', artist: 'Traditional', description: 'A joyful song with G, C and D7.', bpm: 96, lessonLevel: 8, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'When the Saints Go Marching In', artist: 'Traditional', bpm: 96, bars: BARS, everyBeatFromBar: 0 }),
  )
