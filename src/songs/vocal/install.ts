/**
 * The songs to sing as rows of the song table. A row is light: the whole tune as written, the name, the
 * tempo, and no audio at all. The sound is made when a song is opened, in the singer's own key
 * (`render.ts`), so nothing here ever has to be rendered again when a range changes.
 *
 * Rows are written straight into the table, not through `addSong`, which is for songs that come with
 * audio. They are found again by `builtinId`, so the id of a row, which song items and results hang on,
 * never changes once it exists.
 */
import { db, type SongRecord } from '../../db/db'
import { arrange, vocalRevision } from './arrange'
import { VOCAL_TUNES } from './tunes'
import type { VocalSong } from './types'

/** What a row takes from the song as this build ships it. The level and key are only for a list or a summary to read: a run arranges its own. */
function content(song: VocalSong): Pick<SongRecord, 'title' | 'artist' | 'bpm' | 'duration' | 'chart' | 'builtinRev'> {
  const chart = arrange(song, { shift: 0, level: 2 })
  return { title: song.title, artist: song.credit, bpm: song.bpm, duration: chart.duration, chart, builtinRev: vocalRevision(song) }
}

/**
 * The stored row of one song: found by its `builtinId`, written when it is missing, and brought up to
 * date in place when it was made from an older version of the song. One transaction, so two callers at
 * the same moment (the launch and a lesson, or two tabs) cannot both find nothing and write two rows.
 */
function stored(song: VocalSong): Promise<SongRecord> {
  return db.transaction('rw', db.songs, async () => {
    const existing = await db.songs.where('builtinId').equals(song.id).first()
    if (existing) {
      if (existing.builtinRev === vocalRevision(song)) return existing
      // Only what comes from the song: the id, the results, the play count and the last level stay.
      await db.songs.update(existing.id, { ...content(song), updatedAt: Date.now() })
      return (await db.songs.get(existing.id)) ?? existing
    }
    const now = Date.now()
    const id = await db.songs.add({
      ...content(song),
      instrument: 'voice',
      source: 'builtin',
      builtinId: song.id,
      // Not a file: the name says there is no audio to look for, and never matches a rendered guitar track.
      audioName: `${song.id}.voice`,
      audioType: 'audio/wav',
      createdAt: now,
      updatedAt: now,
      bestScores: {},
      lastLevel: null,
      lastSpeed: 1,
      playCount: 0,
    })
    const row = await db.songs.get(id)
    if (!row) throw new Error(`The song ${song.id} could not be saved`)
    return row
  })
}

/**
 * The library row of a song to sing, by its bundled id (`sing-…`). The row is written first when it is
 * missing, so a lesson, a plan block, a check or the library can ask for a song without caring whether
 * the songs were installed. An id that is not a song to sing is refused.
 */
export async function vocalSongRecord(builtinId: string): Promise<SongRecord> {
  const song = VOCAL_TUNES.find((s) => s.id === builtinId)
  if (!song) throw new Error(`Unknown song to sing: ${builtinId}`)
  return stored(song)
}

/** Writes the row of every song to sing that is not there yet. Calling it again changes nothing. */
export async function installVocalSongs(): Promise<void> {
  for (const song of VOCAL_TUNES) await stored(song)
}
