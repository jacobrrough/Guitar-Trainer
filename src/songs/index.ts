import type { Chart } from '../chart/types'
import type { SongRecord } from '../db/db'

/** A bundled, synthesised, public-domain song. */
export interface BuiltInSong {
  id: string
  title: string
  artist: string
  /** One sentence shown in the course and the library. */
  description: string
  chart: Chart
  bpm: number
  /** Lesson number after which the song is playable (1 = after lesson 1). */
  lessonLevel: number
  /** Chord names used, in order of appearance (strumming songs). */
  chords?: string[]
}

export const BUILT_IN_SONGS: BuiltInSong[] = []

export function builtInSong(id: string): BuiltInSong | undefined {
  return BUILT_IN_SONGS.find((s) => s.id === id)
}

/** Adds every bundled song that is not yet in the library (idempotent by builtinId). */
export async function installBuiltInSongs(): Promise<void> {
  return
}

/** The library record for a bundled song, installing it first if needed. */
export async function builtInSongRecord(id: string): Promise<SongRecord> {
  throw new Error(`Built-in song ${id} is not available yet`)
}
