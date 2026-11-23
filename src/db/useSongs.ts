import { useLiveQuery } from 'dexie-react-hooks'
import { instrumentOf } from '../training/instruments'
import type { InstrumentId } from '../training/types'
import { db, type SongRecord } from './db'

/**
 * The songs of one instrument, the most recently changed first. The table holds the guitar songs (no
 * stamp) and the songs to sing side by side. A list must never mix them: a song to sing is stored without
 * audio, and the guitar screens cannot play it.
 */
export function listSongs(instrument: InstrumentId = 'guitar'): Promise<SongRecord[]> {
  return db.songs
    .orderBy('updatedAt')
    .reverse()
    .filter((song) => instrumentOf(song) === instrument)
    .toArray()
}

export function useSongs(instrument: InstrumentId = 'guitar'): SongRecord[] | undefined {
  return useLiveQuery(() => listSongs(instrument), [instrument])
}

/** `'loading'` until the query resolves, then the song or `null`. */
export function useSong(id: number | null): SongRecord | null | 'loading' {
  return useLiveQuery(
    async () => (id === null || Number.isNaN(id) ? null : ((await db.songs.get(id)) ?? null)),
    [id],
    'loading' as const,
  )
}
