import { lazySong, repeat, strumChart, uniqueChords } from './util'

const BARS: string[] = repeat(['D', 'D', 'A', 'A'], 4)

export const dAGroove = () =>
  lazySong(
    { id: 'd-a-groove', title: 'D and A Groove', artist: 'Guitar Trainer', description: 'Swap between D and A every two bars.', bpm: 84, lessonLevel: 7, chords: uniqueChords(BARS) },
    () => strumChart({ title: 'D and A Groove', artist: 'Guitar Trainer', bpm: 84, bars: BARS, everyBeatFromBar: 8 }),
  )
