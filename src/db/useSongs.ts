import { useLiveQuery } from 'dexie-react-hooks'
import { db, type SongRecord } from './db'

export function useSongs(): SongRecord[] | undefined {
  return useLiveQuery(() => db.songs.orderBy('updatedAt').reverse().toArray(), [])
}

/** `'loading'` until the query resolves, then the song or `null`. */
export function useSong(id: number | null): SongRecord | null | 'loading' {
  return useLiveQuery(
    async () => (id === null || Number.isNaN(id) ? null : ((await db.songs.get(id)) ?? null)),
    [id],
    'loading' as const,
  )
}
