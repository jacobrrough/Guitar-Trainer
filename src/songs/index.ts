import type { Chart } from '../chart/types'
import { addSong, db, type NewSong, type SongRecord } from '../db/db'
import { guitarVoice, recordingsOrTimeout, renderChartVoiced } from '../audio/guitar'
import { SYNTH_SAMPLE_RATE, encodeWav, isStaleRender, renderDrums, synthAudioName } from '../audio/synth'
import { instrumentOf } from '../training/instruments'
import { amazingGrace } from './tunes/amazingGrace'
import { dAGroove } from './tunes/dAGroove'
import { emAmGroove } from './tunes/emAmGroove'
import { emGroove } from './tunes/emGroove'
import { firstRiff } from './tunes/firstRiff'
import { happyBirthday } from './tunes/happyBirthday'
import { jingleBells } from './tunes/jingleBells'
import { odeToJoy } from './tunes/odeToJoy'
import { openStringsGroove } from './tunes/openStringsGroove'
import { contentRevision } from './revision'
import { saints } from './tunes/saints'
import { tomDooley } from './tunes/tomDooley'
import { twinkleTwinkle } from './tunes/twinkleTwinkle'

/** A bundled public-domain song, played by the app's own guitar. */
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

/** Charts are built lazily on first access, so loading this module is cheap. */
export const BUILT_IN_SONGS: BuiltInSong[] = [
  openStringsGroove(),
  odeToJoy(),
  twinkleTwinkle(),
  happyBirthday(),
  jingleBells(),
  emGroove(),
  emAmGroove(),
  dAGroove(),
  tomDooley(),
  amazingGrace(),
  saints(),
  firstRiff(),
].sort((a, b) => a.lessonLevel - b.lessonLevel || a.title.localeCompare(b.title))

export function builtInSong(id: string): BuiltInSong | undefined {
  return BUILT_IN_SONGS.find((s) => s.id === id)
}

const revisions = new Map<string, string>()

/**
 * Fingerprint of the song as this build ships it. A stored copy made from other notes, another tempo or
 * another title carries a different one (or none, if it was stored before copies carried one).
 */
export function builtInRevision(song: BuiltInSong): string {
  let rev = revisions.get(song.id)
  if (rev === undefined) {
    rev = contentRevision(song)
    revisions.set(song.id, rev)
  }
  return rev
}

const SEED = 1000
const installing = new Map<string, Promise<SongRecord>>()

/** The bundled song played by the app's guitar with its click, and the name that says what rendered it. */
async function renderSong(song: BuiltInSong): Promise<{ wav: Blob; audioName: string }> {
  // Named after the voice that really played it: a render that had to fall back to the string model is made again later.
  const { samples, voice } = await renderChartVoiced(song.chart, { sampleRate: SYNTH_SAMPLE_RATE, seed: SEED, plucks: true, click: true })
  return { wav: encodeWav(samples, SYNTH_SAMPLE_RATE), audioName: synthAudioName(song.id, voice) }
}

async function findRecord(id: string): Promise<SongRecord | undefined> {
  return db.songs.where('builtinId').equals(id).first()
}

function install(song: BuiltInSong): Promise<SongRecord> {
  const running = installing.get(song.id)
  if (running) return running
  const job = (async () => {
    const existing = await findRecord(song.id)
    if (existing) return existing
    const { wav, audioName } = await renderSong(song)
    // addSong stores every field it is given, so the revision lands in the same write as the chart and the audio.
    const copy: NewSong = {
      title: song.title,
      artist: song.artist,
      audioType: 'audio/wav',
      audioName,
      duration: song.chart.duration,
      chart: song.chart,
      source: 'builtin',
      bpm: song.bpm,
      builtinId: song.id,
      builtinRev: builtInRevision(song),
      audio: wav,
    }
    const key = await addSong(copy)
    const record = await db.songs.get(key)
    if (!record) throw new Error(`Built-in song ${song.id} could not be saved`)
    return record
  })().finally(() => installing.delete(song.id))
  installing.set(song.id, job)
  return job
}

/** Adds every bundled song that is not yet in the library (idempotent by builtinId). */
export async function installBuiltInSongs(): Promise<void> {
  const have = new Set((await db.songs.orderBy('builtinId').uniqueKeys()).map(String))
  for (const song of BUILT_IN_SONGS) if (!have.has(song.id)) await install(song)
}

/**
 * True when the stored copy of a bundled song should be made again: its chart is not the one this build
 * ships (a corrected tune, or a copy from before charts carried a revision), or its audio came from an
 * older renderer, or from the string model while the recorded guitar is available now. Call after
 * `loadGuitar()` has settled.
 */
export function hasStaleAudio(record: Pick<SongRecord, 'builtinId' | 'audioName' | 'builtinRev' | 'instrument'>): boolean {
  // A song to sing is stored without audio and arranged when it is opened: there is nothing to make again.
  // Without this it would fall through to the check of the audio name below and look stale at every launch.
  if (instrumentOf(record) === 'voice') return false
  if (!record.builtinId) return false
  const song = builtInSong(record.builtinId)
  if (song && record.builtinRev !== builtInRevision(song)) return true
  return isStaleRender(record.audioName, record.builtinId, guitarVoice())
}

const rerendering = new Map<number, Promise<SongRecord>>()

/**
 * Makes the stored copy of a bundled song match this build: the chart, its tempo, length and names, and
 * audio rendered from that same chart with the current voice. Scores, play count and the last level and
 * speed stay.
 */
export function rerenderBuiltIn(record: SongRecord): Promise<SongRecord> {
  const song = record.builtinId ? builtInSong(record.builtinId) : undefined
  if (!song) return Promise.resolve(record)
  const running = rerendering.get(record.id)
  if (running) return running
  const job = (async () => {
    const { wav, audioName } = await renderSong(song)
    const audioData = await wav.arrayBuffer()
    // One write for the chart and the audio made from it: a copy can never hold the notes of one version
    // and the sound of another. The song may have been deleted while it rendered: update only what is still there.
    const changed = await db.songs.update(record.id, {
      title: song.title,
      artist: song.artist,
      bpm: song.bpm,
      duration: song.chart.duration,
      chart: song.chart,
      builtinRev: builtInRevision(song),
      audioData,
      audio: undefined,
      audioType: 'audio/wav',
      audioName,
      updatedAt: Date.now(),
    })
    return (changed ? await db.songs.get(record.id) : undefined) ?? record
  })().finally(() => rerendering.delete(record.id))
  rerendering.set(record.id, job)
  return job
}

/** The library record for a bundled song, installing it first if needed and bringing an older copy (chart or audio) up to date. */
export async function builtInSongRecord(id: string): Promise<SongRecord> {
  const song = builtInSong(id)
  if (!song) throw new Error(`Unknown built-in song ${id}`)
  const existing = await findRecord(id)
  if (!existing) return install(song)
  // A screen is waiting for this: on a stalled first download it gets the copy there is, and the
  // refresh that runs when the recordings arrive brings it up to date.
  await recordingsOrTimeout()
  return hasStaleAudio(existing) ? rerenderBuiltIn(existing) : existing
}

/**
 * The click track alone at 44.1 kHz: what plays while the microphone scores, at the level it has under
 * the guitar. Cached per song for the session.
 */
const backingCache = new Map<string, Float32Array>()

export function builtInBacking(id: string): Float32Array | null {
  const song = builtInSong(id)
  if (!song) return null
  const cached = backingCache.get(id)
  if (cached) return cached
  const drums = renderDrums(song.chart, { sampleRate: SYNTH_SAMPLE_RATE })
  backingCache.set(id, drums)
  return drums
}
