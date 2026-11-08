import { lazySong, repeat, strumChart, uniqueChords } from './util'

const BARS: string[] = repeat(['Em'], 8)

export const emGroove = () =>
  lazySong(
    { id: 'em-groove', title: 'Em Groove', artist: 'Guitar Trainer', description: 'One easy chord, strummed to a steady beat.', bpm: 80, lessonLevel: 5, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'Em Groove', artist: 'Guitar Trainer', bpm: 80, bars: BARS, everyBeatFromBar: 4 }),
  )
