import Dexie, { type EntityTable } from 'dexie'
import type { Chart, ChartSource } from '../chart/types'
import type { LessonProgress } from '../lessons/types'
import type { Attempt, Profile, SessionRecord, SkillState, SongItemState, TestRecord, Milestone } from '../training/types'

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
  /**
   * Raw audio bytes. Stored as an ArrayBuffer rather than a Blob because Blob
   * records in IndexedDB have a history of corruption on iOS Safari.
   */
  audioData?: ArrayBuffer
  /** Legacy records (first dev builds) kept the Blob itself. */
  audio?: Blob
  audioType: string
  audioName: string
  /** Audio length in seconds. */
  duration: number
  chart: Chart
  source: ChartSource
  bpm: number
  /** Id of the bundled song this record was created from (source 'builtin'). */
  builtinId?: string
  /** Best result per level, keyed by level number. */
  bestScores: Record<string, ScoreRecord>
  lastLevel: number | null
  lastSpeed: number
  playCount: number
}

export type NewSong = Pick<SongRecord, 'title' | 'artist' | 'audioType' | 'audioName' | 'duration' | 'chart' | 'source' | 'bpm'> & { audio: Blob; builtinId?: string }

/** The song's audio as a Blob, whichever way it was stored. */
export function songAudioBlob(song: SongRecord): Blob | null {
  if (song.audioData) return new Blob([song.audioData], { type: song.audioType || 'audio/mpeg' })
  return song.audio ?? null
}

export const db = new Dexie('guitar-trainer') as Dexie & {
  songs: EntityTable<SongRecord, 'id'>
  skillStates: EntityTable<SkillState, 'skillId'>
  attempts: EntityTable<Attempt, 'id'>
  sessions: EntityTable<SessionRecord, 'id'>
  tests: EntityTable<TestRecord, 'id'>
  songItems: EntityTable<SongItemState, 'key'>
  profile: EntityTable<Profile, 'id'>
  milestones: EntityTable<Milestone, 'id'>
  lessons: EntityTable<LessonProgress, 'id'>
}

db.version(1).stores({
  songs: '++id, title, artist, createdAt, updatedAt',
})

// Adaptive training tables (docs/ADAPTIVE_TRAINING.md §10).
db.version(2).stores({
  songs: '++id, title, artist, createdAt, updatedAt',
  skillStates: 'skillId, rating, nextReviewAt',
  attempts: '++id, at, kind, skillId, songId, sessionId',
  sessions: '++id, &date',
  tests: '++id, at, type',
  songItems: 'key, songId, nextReviewAt',
  profile: 'id',
})

// Milestones (Phase 3).
db.version(3).stores({
  songs: '++id, title, artist, createdAt, updatedAt',
  skillStates: 'skillId, rating, nextReviewAt',
  attempts: '++id, at, kind, skillId, songId, sessionId',
  sessions: '++id, &date',
  tests: '++id, at, type',
  songItems: 'key, songId, nextReviewAt',
  profile: 'id',
  milestones: '++id, &key, at, type, skillId',
})

// First steps: bundled songs and lesson progress.
db.version(4).stores({
  songs: '++id, title, artist, createdAt, updatedAt, builtinId',
  skillStates: 'skillId, rating, nextReviewAt',
  attempts: '++id, at, kind, skillId, songId, sessionId',
  sessions: '++id, &date',
  tests: '++id, at, type',
  songItems: 'key, songId, nextReviewAt',
  profile: 'id',
  milestones: '++id, &key, at, type, skillId',
  lessons: 'id, status',
})

export async function addSong(input: NewSong): Promise<number> {
  const now = Date.now()
  const { audio, ...rest } = input
  const audioData = await audio.arrayBuffer()
  const id = await db.songs.add({
    ...rest,
    audioData,
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
