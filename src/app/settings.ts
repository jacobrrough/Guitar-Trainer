import { useSyncExternalStore } from 'react'

export type OctaveTolerance = 'chords' | 'all' | 'none'

export interface MetronomePrefs {
  bpm: number
  beatsPerBar: number
  subdivision: number
  accentFirst: boolean
  volume: number
}

export interface AppSettings {
  inputDeviceId: string
  /** Total round-trip latency compensation applied when scoring, in milliseconds. */
  latencyMs: number
  a4: number
  tunerTuningId: string
  defaultTuningId: string
  octaveTolerance: OctaveTolerance
  /** Minimum detector clarity (0..1) to accept a pitch. Lower for distorted tones. */
  clarityThreshold: number
  /** Seconds of upcoming notes visible on the highway. */
  visibleSeconds: number
  showNoteNames: boolean
  metronome: MetronomePrefs
}

export const DEFAULT_SETTINGS: AppSettings = {
  inputDeviceId: '',
  latencyMs: 60,
  a4: 440,
  tunerTuningId: 'standard',
  defaultTuningId: 'standard',
  octaveTolerance: 'chords',
  clarityThreshold: 0.85,
  visibleSeconds: 3,
  showNoteNames: false,
  metronome: { bpm: 100, beatsPerBar: 4, subdivision: 1, accentFirst: true, volume: 0.8 },
}

const STORAGE_KEY = 'guitar-trainer.settings.v1'

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...parsed, metronome: { ...DEFAULT_SETTINGS.metronome, ...(parsed.metronome ?? {}) } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

let current: AppSettings = load()
const listeners = new Set<() => void>()

export function getSettings(): AppSettings {
  return current
}

export function updateSettings(patch: Partial<AppSettings>): void {
  current = { ...current, ...patch, metronome: { ...current.metronome, ...(patch.metronome ?? {}) } }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* storage may be unavailable (private mode); keep in memory */
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings)
}
