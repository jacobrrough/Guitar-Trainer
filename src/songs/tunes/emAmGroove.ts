import { lazySong, repeat, strumChart, uniqueChords } from './util'

const BARS: string[] = repeat(['Em', 'Em', 'Am', 'Am'], 4)

export const emAmGroove = () =>
  lazySong(
    { id: 'em-am-groove', title: 'Em to Am Groove', artist: 'Guitar Trainer', description: 'Switch between two friendly chords every two bars.', bpm: 80, lessonLevel: 6, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'Em to Am Groove', artist: 'Guitar Trainer', bpm: 80, bars: BARS, everyBeatFromBar: 8 }),
  )
