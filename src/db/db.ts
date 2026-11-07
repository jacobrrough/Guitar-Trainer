import Dexie, { type EntityTable } from 'dexie'
import type { Chart, ChartSource } from '../chart/types'

export interface ScoreRecord {
  level: number
  score: number
  /** 0..1 */
  accuracy: number
  maxStreak: number
  perfects: number
  goods: number
  misses: number
  /** Playback speed used, 1 = normal. */
  speed: number
  date: number
}

export interface SongRecord {
  id: number
  title: string
  artist: string
  createdAt: number
  updatedAt: number
  audio: Blob
  audioType: string
  audioName: string
  /** Audio length in seconds. */
  duration: number
  chart: Chart
  source: ChartSource
  bpm: number
  /** Best result per level, keyed by level number. */
  bestScores: Record<string, ScoreRecord>
  lastLevel: number | null
  lastSpeed: number
  playCount: number
}

export type NewSong = Pick<SongRecord, 'title' | 'artist' | 'audio' | 'audioType' | 'audioName' | 'duration' | 'chart' | 'source' | 'bpm'>

export const db = new Dexie('guitar-trainer') as Dexie & {
  songs: EntityTable<SongRecord, 'id'>
}

db.version(1).stores({
  songs: '++id, title, artist, createdAt, updatedAt',
})

export async function addSong(input: NewSong): Promise<number> {
  const now = Date.now()
  const id = await db.songs.add({
    ...input,
    createdAt: now,
    updatedAt: now,
    bestScores: {},
    lastLevel: null,
    lastSpeed: 1,
    playCount: 0,
  })
  return id
}

export function getSong(id: number): Promise<SongRecord | undefined> {
  return db.songs.get(id)
}

export function deleteSong(id: number): Promise<void> {
  return db.songs.delete(id)
}

export async function updateSong(id: number, patch: Partial<Omit<SongRecord, 'id'>>): Promise<void> {
  await db.songs.update(id, { ...patch, updatedAt: Date.now() })
}

export async function recordResult(id: number, result: ScoreRecord): Promise<void> {
  const song = await db.songs.get(id)
  if (!song) return
  const key = String(result.level)
  const prev = song.bestScores[key]
  const bestScores = { ...song.bestScores }
  if (!prev || result.score > prev.score) bestScores[key] = result
  await db.songs.update(id, {
    bestScores,
    lastLevel: result.level,
    lastSpeed: result.speed,
    playCount: song.playCount + 1,
    updatedAt: Date.now(),
  })
}
