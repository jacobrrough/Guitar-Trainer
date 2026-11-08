import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { BUILT_IN_SONGS, builtInBacking, builtInSong, builtInSongRecord, installBuiltInSongs } from './index'
import { renderChartBacking } from '../audio/synth'

const IDS = [
  'open-strings-groove', 'ode-to-joy', 'twinkle-twinkle', 'happy-birthday', 'jingle-bells', 'first-riff',
  'em-groove', 'em-am-groove', 'd-a-groove', 'tom-dooley', 'amazing-grace', 'saints',
]

describe('built-in songs', () => {
  it('has exactly the contracted ids, unique, ordered by level then title', () => {
    const ids = BUILT_IN_SONGS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...IDS].sort())
    for (let i = 1; i < BUILT_IN_SONGS.length; i++) {
      const a = BUILT_IN_SONGS[i - 1]
      const b = BUILT_IN_SONGS[i]
      expect(a.lessonLevel < b.lessonLevel || (a.lessonLevel === b.lessonLevel && a.title <= b.title)).toBe(true)
    }
  })

  for (const song of BUILT_IN_SONGS) {
    it(`${song.id} has a valid chart`, () => {
      const c = song.chart
      expect(song.chart).toBe(c)
      expect(c.beats.length).toBeGreaterThan(0)
      expect(c.duration).toBeGreaterThan(0)
      expect(song.description.length).toBeGreaterThan(0)
      for (let i = 0; i < c.notes.length; i++) {
        const n = c.notes[i]
        if (i > 0) expect(n.time).toBeGreaterThanOrEqual(c.notes[i - 1].time)
        expect(n.midi).toBe(c.tuning[n.string] + n.fret)
        expect(n.time + n.duration).toBeLessThanOrEqual(c.duration)
        if (song.lessonLevel <= 8) expect(n.fret).toBeLessThanOrEqual(5)
      }
      const chordNames = [...new Set(c.notes.map((n) => n.chordName).filter((x): x is string => !!x))]
      if (song.chords) {
        expect(song.chords).toEqual(chordNames)
      } else {
        expect(chordNames).toEqual([])
        for (const n of c.notes) if (n.fret > 0) expect(n.finger).toBeGreaterThanOrEqual(1)
      }
    })
  }

  it('amazing grace is in 3/4', () => {
    expect(builtInSong('amazing-grace')!.chart.timeSignatures[0].numerator).toBe(3)
  })

  describe('library', () => {
    beforeEach(async () => {
      await db.songs.clear()
    })

    it('installs each song once, even when called repeatedly', async () => {
      await Promise.all([installBuiltInSongs(), installBuiltInSongs()])
      await installBuiltInSongs()
      const rows = await db.songs.toArray()
      expect(rows).toHaveLength(BUILT_IN_SONGS.length)
      expect(new Set(rows.map((r) => r.builtinId)).size).toBe(BUILT_IN_SONGS.length)
      expect(rows.every((r) => r.source === 'builtin')).toBe(true)
    }, 60_000)

    it('builtInSongRecord installs a single song', async () => {
      const rec = await builtInSongRecord('ode-to-joy')
      expect(rec.source).toBe('builtin')
      expect(rec.builtinId).toBe('ode-to-joy')
      expect(await db.songs.count()).toBe(1)
      expect((await builtInSongRecord('ode-to-joy')).id).toBe(rec.id)
    })
  })

  it('backing is drums only: same length, less energy where the melody plays', () => {
    const song = builtInSong('ode-to-joy')!
    const full = renderChartBacking(song.chart, { plucks: true, click: true, seed: 1000 })
    const backing = builtInBacking('ode-to-joy')!
    expect(backing.length).toBe(full.length)
    const bar = Math.round(4 * (60 / song.bpm) * 44100)
    const rms = (a: Float32Array) => {
      let s = 0
      for (let i = bar; i < 2 * bar; i++) s += a[i] * a[i]
      return s / bar
    }
    expect(rms(backing)).toBeLessThan(rms(full))
    expect(builtInBacking('nope')).toBeNull()
  })
})
