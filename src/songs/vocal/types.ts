/**
 * A song to sing, written as data. Nothing here is a pitch yet: the tune is counted in semitones from
 * its home note, and is only placed in a singer's range when it is opened.
 */

/**
 * One note or rest of a line: semitones above the home note (negative below it, null for a rest), its
 * length in beats, and the syllable sung on it. A trailing hyphen means the word goes on with the next
 * note; '' means the syllable before is still being held.
 */
export type VocalStep = [semitonesAboveHome: number | null, beats: number, syllable?: string]

/** A chord by its place in the key, so the accompaniment moves with the tune when the key changes. */
export type Degree = 'I' | 'IV' | 'V' | 'V7' | 'vi' | 'ii'

export interface VocalSong {
  id: `sing-${string}`
  title: string
  /** Who wrote it, or "Traditional". */
  credit: string
  /** One plain sentence shown in the course and the library. */
  description: string
  bpm: number
  beatsPerBar: 3 | 4
  /** Beats of the first line that are sung before the first full bar; 0 when the tune starts on beat 1. */
  pickupBeats: number
  /** The tune, line by line. A line is what is sung on one breath. */
  lines: VocalStep[][]
  /** One chord per bar. */
  chords: Degree[]
  /** Lesson number of the singing course after which the song can be sung; 10 = after the course. */
  lessonLevel: number
  /** Ids of skills the song asks for; the Coach holds it back until they are under way. */
  needs?: string[]
}
