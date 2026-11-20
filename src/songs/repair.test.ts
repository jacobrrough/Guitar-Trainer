import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chart, ChartNote } from '../chart/types'
import { addSong, db } from '../db/db'
import { repairStoredCharts } from './repair'

function note(id: number, time: number, string: number, fret: number, extra: Partial<ChartNote> = {}): ChartNote {
  return { id, time, duration: 0.5, midi: 40 + string * 5 + fret, string, fret, velocity: 0.8, chordId: id, ...extra }
}

function chart(source: Chart['source'], notes: ChartNote[]): Chart {
  return { version: 1, title: 'Song', artist: '', source, tuning: [40, 45, 50, 55, 59, 64], capo: 0, duration: 10, notes, beats: [], tempos: [{ time: 0, bpm: 120 }], timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }] }
}

async function store(c: Chart): Promise<number> {
  return addSong({ title: c.title, artist: '', audio: new Blob([new Uint8Array(4)]), audioType: 'audio/wav', audioName: 'a.wav', duration: 10, chart: c, source: c.source, bpm: 120 })
}

describe('repairStoredCharts', () => {
  beforeEach(async () => {
    await db.songs.clear()
    const memory = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) })
  })

  it('corrects a song stored by the old importer and leaves the others alone', async () => {
    const faulty = await store(chart('guitarpro', [note(0, 1, 2, 3), note(1, 1, 2, 3), note(2, 2, 0, 0, { tech: { dead: true } }), note(3, 3, 1, 2)]))
    const fine = await store(chart('midi', [note(0, 1, 2, 3), note(1, 1, 2, 3)]))
    await db.songs.update(faulty, { playCount: 4, bestScores: { '3': { level: 3, score: 100, accuracy: 0.5, maxStreak: 2, perfects: 1, goods: 0, misses: 1, speed: 1, date: 1 } } })

    expect(await repairStoredCharts()).toBe(1)

    const fixed = await db.songs.get(faulty)
    expect(fixed?.chart.notes.map((n) => n.id)).toEqual([0, 3])
    expect(fixed?.playCount).toBe(4)
    expect(Object.keys(fixed?.bestScores ?? {})).toEqual(['3'])
    expect((await db.songs.get(fine))?.chart.notes).toHaveLength(2)
  })

  it('runs once per device', async () => {
    await store(chart('guitarpro', [note(0, 1, 2, 3)]))
    expect(await repairStoredCharts()).toBe(0)
    const later = await store(chart('guitarpro', [note(0, 1, 2, 3), note(1, 1, 2, 3)]))
    expect(await repairStoredCharts()).toBe(0)
    expect((await db.songs.get(later))?.chart.notes).toHaveLength(2)
  })
})
