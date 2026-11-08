import type { Chart } from '../chart/types'
import { addSong, db, type SongRecord, updateSong } from '../db/db'
import { renderChartBackingAsync } from '../audio/renderBacking'
import { SYNTH_SAMPLE_RATE, encodeWav, renderChartBacking, synthAudioName } from '../audio/synth'
import { amazingGrace } from './tunes/amazingGrace'
import { dAGroove } from './tunes/dAGroove'
import { emAmGroove } from './tunes/emAmGroove'
import { emGroove } from './tunes/emGroove'
import { firstRiff } from './tunes/firstRiff'
import { happyBirthday } from './tunes/happyBirthday'
import { jingleBells } from './tunes/jingleBells'
import { odeToJoy } from './tunes/odeToJoy'
import { openStringsGroove } from './tunes/openStringsGroove'
import { saints } from './tunes/saints'
import { tomDooley } from './tunes/tomDooley'
import { twinkleTwinkle } from './tunes/twinkleTwinkle'

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

const SEED = 1000
const installing = new Map<string, Promise<SongRecord>>()

async function findRecord(id: string): Promise<SongRecord | undefined> {
  return db.songs.where('builtinId').equals(id).first()
}

function install(song: BuiltInSong): Promise<SongRecord> {
  const running = installing.get(song.id)
  if (running) return running
  const job = (async () => {
    const existing = await findRecord(song.id)
    if (existing) return existing
    const samples = await renderChartBackingAsync(song.chart, { sampleRate: SYNTH_SAMPLE_RATE, seed: SEED, plucks: true, click: true })
    const key = await addSong({
      title: song.title,
      artist: song.artist,
      audioType: 'audio/wav',
      audioName: synthAudioName(song.id),
      duration: song.chart.duration,
      chart: song.chart,
      source: 'builtin',
      bpm: song.bpm,
      builtinId: song.id,
      audio: encodeWav(samples, SYNTH_SAMPLE_RATE),
    })
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

/** True when the record's audio was rendered by an older synth. */
export function hasStaleAudio(record: Pick<SongRecord, 'builtinId' | 'audioName'>): boolean {
  return !!record.builtinId && record.audioName !== synthAudioName(record.builtinId)
}

/** Renders the bundled song again with the current synth and stores it on the existing record (scores and play count stay). */
export async function rerenderBuiltIn(record: SongRecord): Promise<SongRecord> {
  const song = record.builtinId ? builtInSong(record.builtinId) : undefined
  if (!song) return record
  const samples = await renderChartBackingAsync(song.chart, { sampleRate: SYNTH_SAMPLE_RATE, seed: SEED, plucks: true, click: true })
  const audioData = await encodeWav(samples, SYNTH_SAMPLE_RATE).arrayBuffer()
  await updateSong(record.id, { audioData, audio: undefined, audioType: 'audio/wav', audioName: synthAudioName(song.id) })
  return (await db.songs.get(record.id)) ?? record
}

/** The library record for a bundled song, installing it first if needed and refreshing audio from an older synth. */
export async function builtInSongRecord(id: string): Promise<SongRecord> {
  const song = builtInSong(id)
  if (!song) throw new Error(`Unknown built-in song ${id}`)
  const existing = await findRecord(id)
  if (!existing) return install(song)
  return hasStaleAudio(existing) ? rerenderBuiltIn(existing) : existing
}

/**
 * Drums and click only (no plucks) at 44.1 kHz: what plays while the microphone scores. The synth
 * levels every stem with the gain of the full mix, so this is exactly as loud as the drums are under
 * the strings. Cached per song for the session.
 */
const backingCache = new Map<string, Float32Array>()

export function builtInBacking(id: string): Float32Array | null {
  const song = builtInSong(id)
  if (!song) return null
  const cached = backingCache.get(id)
  if (cached) return cached
  const drums = renderChartBacking(song.chart, { sampleRate: SYNTH_SAMPLE_RATE, seed: SEED, plucks: false })
  backingCache.set(id, drums)
  return drums
}
