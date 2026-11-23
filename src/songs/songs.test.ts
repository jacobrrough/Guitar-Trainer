import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { distinctLevels, generateLevels } from '../chart/difficulty'
import type { Chart } from '../chart/types'
import { db, type SongRecord } from '../db/db'
import { COURSE } from '../lessons/course'
import { BUILT_IN_SONGS, builtInBacking, builtInRevision, builtInSong, builtInSongRecord, hasStaleAudio, installBuiltInSongs, type BuiltInSong } from './index'
import { contentRevision } from './revision'
import { setGuitarBankForTests } from '../audio/guitar'
import { loadRealBank } from '../audio/instrument/realBank.testutil'
import { renderChartBacking, renderDrums, synthAudioName } from '../audio/synth'
import { addSong } from '../db/db'
import { createDemoSong, DEMO_AUDIO_BASE } from '../features/library/demoSong'
import { defaultProfile } from '../training/store'
import { refreshRenderedAudio } from './refresh'
import { VOCAL_SONGS } from './vocal'
import { installVocalSongs, vocalSongRecord } from './vocal/install'

const MIDI: Record<string, number> = { G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67 }
const pitches = (names: string) => names.split(/\s+/).filter(Boolean).map((n) => MIDI[n])

/** Each note's start as a beat count from the start of the chart. */
const beatOf = (chart: Chart, time: number) => Math.round((time / (60 / chart.tempos[0].bpm)) * 1000) / 1000

/** The chord of every bar, checking that the whole bar stays on it. */
function barChords(chart: Chart): string[] {
  const perBar = chart.timeSignatures[0].numerator
  const bars: string[] = []
  for (const n of chart.notes) {
    const bar = Math.floor(beatOf(chart, n.time) / perBar + 1e-6)
    bars[bar] ??= n.chordName ?? '?'
    expect(n.chordName).toBe(bars[bar])
  }
  return bars
}

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

  describe('the chord songs follow the real songs', () => {
    // Bar 1 is the first full bar ("saints", "-maz-", "Hang"); words before it are sung over the count-in.
    it('When the Saints: G until the second "marching in" lands on D7, then C on "that number"', () => {
      expect(barChords(builtInSong('saints')!.chart)).toEqual(['G', 'G', 'G', 'G', 'G', 'G', 'D7', 'D7', 'G', 'G', 'C', 'C', 'G', 'D7', 'G', 'G'])
    })

    it('Amazing Grace: stays on G through "saved a wretch like" and comes to rest on D at "me"', () => {
      expect(barChords(builtInSong('amazing-grace')!.chart)).toEqual(['G', 'G', 'C', 'G', 'G', 'G', 'D', 'D', 'G', 'G', 'C', 'G', 'G', 'D', 'G', 'G'])
    })

    it('Tom Dooley: D7 from "cry" until the last word of the verse', () => {
      const verse = ['G', 'G', 'G', 'D7', 'D7', 'D7', 'D7', 'G']
      expect(barChords(builtInSong('tom-dooley')!.chart)).toEqual([...verse, ...verse])
    })

    it('only uses chords the course has taught by then', () => {
      for (const song of BUILT_IN_SONGS) {
        const taught = new Set(
          COURSE.filter((l) => l.number <= song.lessonLevel)
            .flatMap((l) => l.learn.map((card) => card.illustration ?? ''))
            .filter((id) => id.startsWith('chord:'))
            .map((id) => id.slice('chord:'.length)),
        )
        for (const chord of song.chords ?? []) expect(taught.has(chord), `${song.id} uses ${chord}`).toBe(true)
      }
    })
  })

  describe('the melodies are the real tunes', () => {
    it('Happy Birthday starts with a pickup so "birth-" and "you" land on beat 1', () => {
      const chart = builtInSong('happy-birthday')!.chart
      expect(chart.timeSignatures[0].numerator).toBe(3)
      expect(chart.notes.map((n) => n.midi)).toEqual(
        pitches('G3 G3 A3 G3 C4 B3  G3 G3 A3 G3 D4 C4  G3 G3 G4 E4 C4 B3 A3  F4 F4 E4 C4 D4 C4'),
      )
      // "Hap-py" is the last beat of a bar that starts silent.
      expect(chart.notes.slice(0, 3).map((n) => beatOf(chart, n.time))).toEqual([2, 2.5, 3])
      const onBeatOne = chart.notes.filter((n) => beatOf(chart, n.time) % 3 === 0)
      expect(onBeatOne.map((n) => n.midi)).toEqual(pitches('A3 B3 A3 C4 G4 B3 E4 C4'))
      // The accent follows the bar line, and so does the last note.
      expect(onBeatOne.every((n) => n.velocity > 0.85)).toBe(true)
      expect(chart.notes.filter((n) => n.velocity > 0.85)).toHaveLength(onBeatOne.length)
      expect(onBeatOne[onBeatOne.length - 1]).toBe(chart.notes[chart.notes.length - 1])
    })

    it('Jingle Bells ends "one-horse open sleigh" on the home note', () => {
      const chart = builtInSong('jingle-bells')!.chart
      expect(chart.notes.map((n) => n.midi)).toEqual(
        pitches('B3 B3 B3  B3 B3 B3  B3 D4 G3 A3  B3  C4 C4 C4 C4  C4 B3 B3 B3 B3  D4 D4 C4 A3  G3'),
      )
      const last = chart.notes[chart.notes.length - 1]
      expect(beatOf(chart, last.time)).toBe(28)
      expect(last.duration).toBeGreaterThan(3 * (60 / chart.tempos[0].bpm))
    })
  })

  describe('levels', () => {
    const ids = (c: Chart) => c.notes.map((n) => n.id)

    for (const song of BUILT_IN_SONGS) {
      it(`${song.id}: every level adds notes to the one below until the song is complete`, () => {
        const levels = generateLevels(song.chart)
        expect(levels).toHaveLength(6)
        for (let i = 1; i < levels.length; i++) {
          const below = new Set(ids(levels[i - 1]))
          const here = new Set(ids(levels[i]))
          for (const id of below) expect(here.has(id), `level ${i + 1} drops note ${id} of level ${i}`).toBe(true)
          if (below.size < song.chart.notes.length) expect(here.size, `level ${i + 1} against level ${i}`).toBeGreaterThan(below.size)
        }
        expect(levels[5]).toBe(song.chart)
        // Levels that add nothing (the song ran out of notes) are exactly the ones distinctLevels leaves out.
        const distinct = distinctLevels(levels)
        levels.forEach((l, i) => expect(distinct.includes(i)).toBe(i === 0 || l.notes.length > levels[i - 1].notes.length))
      })
    }

    it('Level 3 of a chord song from an unknown tab is two strings next to each other, never with an unplayed string between', () => {
      for (const id of ['saints', 'amazing-grace', 'tom-dooley', 'em-am-groove', 'd-a-groove']) {
        // The bundled songs themselves keep their chords whole (see below); the same charts as an import would not.
        const level3 = generateLevels({ ...builtInSong(id)!.chart, wholeChords: undefined })[2]
        const byStrum = new Map<number, number[]>()
        for (const n of level3.notes) byStrum.set(n.chordId, [...(byStrum.get(n.chordId) ?? []), n.string])
        for (const strings of byStrum.values()) {
          expect(strings).toHaveLength(2)
          expect(Math.abs(strings[0] - strings[1]), `${id}: strings ${strings.join(' and ')}`).toBe(1)
        }
      }
    })

    it('Level 2 of a strumming song in 4/4 adds strums on beat 3, never on beats 2 and 4', () => {
      for (const id of ['tom-dooley', 'saints']) {
        const chart = builtInSong(id)!.chart
        const level2 = generateLevels(chart)[1]
        const beatsUsed = [...new Set(level2.notes.map((n) => (beatOf(chart, n.time) % 4) + 1))].sort()
        expect(beatsUsed, id).toEqual([1, 3])
      }
    })
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

    it('renders audio again for songs stored by an older renderer, keeping scores', async () => {
      const rec = await builtInSongRecord('ode-to-joy')
      expect(rec.audioName).toBe(synthAudioName('ode-to-joy', null))
      await db.songs.update(rec.id, { audioName: 'ode-to-joy.v3.wav', playCount: 3 })
      const demoId = await addSong(await createDemoSong())
      await db.songs.update(demoId, { audioName: 'demo-riff.wav' })
      expect(await refreshRenderedAudio()).toBe(2)
      const fresh = await db.songs.get(rec.id)
      expect(fresh?.audioName).toBe(synthAudioName('ode-to-joy', null))
      expect(fresh?.playCount).toBe(3)
      expect(fresh?.audioData?.byteLength).toBeGreaterThan(1000)
      expect((await db.songs.get(demoId))?.audioName).toBe(synthAudioName(DEMO_AUDIO_BASE, null))
      expect(await refreshRenderedAudio()).toBe(0)
      // builtInSongRecord refreshes on its own too
      await db.songs.update(rec.id, { audioName: 'ode-to-joy.wav' })
      expect((await builtInSongRecord('ode-to-joy')).audioName).toBe(synthAudioName('ode-to-joy', null))
    }, 30_000)

    describe('a chart corrected in a newer build', () => {
      afterEach(() => {
        vi.restoreAllMocks()
      })

      /** What an older build left in the library: a slower, shorter chart under another title, with a play history. */
      async function storeOlderCopy(rev: string | undefined) {
        const song = builtInSong('ode-to-joy')!
        const rec = await builtInSongRecord('ode-to-joy')
        const chart: Chart = { ...song.chart, title: 'Ode', duration: 40, notes: song.chart.notes.slice(0, 20), tempos: [{ time: 0, bpm: 60 }] }
        const bestScores = { '2': { level: 2, score: 900, accuracy: 0.8, maxStreak: 9, perfects: 10, goods: 6, misses: 4, speed: 0.75, date: 5 } }
        await db.songs.update(rec.id, {
          chart, duration: 40, bpm: 60, title: 'Ode', artist: 'Somebody', builtinRev: rev,
          audioData: new ArrayBuffer(8), bestScores, playCount: 7, lastLevel: 2, lastSpeed: 0.75,
        })
        return { song, rec, bestScores }
      }

      function expectCurrent(stored: SongRecord | undefined, song: BuiltInSong, installed: SongRecord) {
        expect(stored?.chart).toEqual(song.chart)
        expect(stored?.duration).toBe(song.chart.duration)
        expect(stored?.bpm).toBe(song.bpm)
        expect(stored?.title).toBe(song.title)
        expect(stored?.artist).toBe(song.artist)
        expect(stored?.builtinRev).toBe(builtInRevision(song))
        // The audio is the bundled chart again: the same render the first install made.
        expect(stored?.audioData?.byteLength).toBe(installed.audioData?.byteLength)
      }

      it('a new install records the revision of the chart it stored', async () => {
        const rec = await builtInSongRecord('ode-to-joy')
        expect(rec.builtinRev).toBe(builtInRevision(builtInSong('ode-to-joy')!))
        expect(rec.builtinRev).toMatch(/^[0-9a-z]{6,}$/)
        expect(hasStaleAudio(rec)).toBe(false)
      })

      it('reaches a copy stored before revisions existed, chart and audio in one write, keeping the play history', async () => {
        const { song, rec, bestScores } = await storeOlderCopy(undefined)
        const before = await db.songs.get(rec.id)
        expect(before && 'builtinRev' in before).toBe(false)
        expect(hasStaleAudio(before!)).toBe(true)
        const update = vi.spyOn(db.songs, 'update')
        expect(await refreshRenderedAudio()).toBe(1)
        const writes = update.mock.calls.filter(([key]) => key === rec.id)
        expect(writes).toHaveLength(1)
        expect(Object.keys(writes[0][1])).toEqual(expect.arrayContaining(['chart', 'duration', 'bpm', 'title', 'artist', 'builtinRev', 'audioData', 'audioName']))
        const fresh = await db.songs.get(rec.id)
        expectCurrent(fresh, song, rec)
        expect(fresh?.bestScores).toEqual(bestScores)
        expect(fresh?.playCount).toBe(7)
        expect(fresh?.lastLevel).toBe(2)
        expect(fresh?.lastSpeed).toBe(0.75)
        // Up to date now: nothing is rendered a second time.
        expect(await refreshRenderedAudio()).toBe(0)
        expect((await builtInSongRecord('ode-to-joy')).updatedAt).toBe(fresh?.updatedAt)
      }, 30_000)

      it('reaches a copy with another revision when the song is opened', async () => {
        const { song, rec } = await storeOlderCopy('older')
        const opened = await builtInSongRecord('ode-to-joy')
        expect(opened.id).toBe(rec.id)
        expectCurrent(opened, song, rec)
        expectCurrent(await db.songs.get(rec.id), song, rec)
        expect(opened.playCount).toBe(7)
      }, 30_000)
    })

    it('the revision follows what the chart says and nothing else', () => {
      const { title, artist, bpm, chart } = builtInSong('ode-to-joy')!
      const base = { title, artist, bpm, chart }
      const rev = contentRevision(base)
      expect(rev).toBe(builtInRevision(builtInSong('ode-to-joy')!))
      // The same content built again (new objects, keys in another order) is the same revision.
      const rebuilt: Chart = {
        ...chart,
        notes: chart.notes.map((n) => ({ velocity: n.velocity, fret: n.fret, string: n.string, midi: n.midi, duration: n.duration, time: n.time, id: n.id, chordId: n.chordId, finger: n.finger })),
        beats: chart.beats.map((b) => ({ ...b })),
      }
      expect(contentRevision({ ...base, chart: rebuilt })).toBe(rev)
      const withNote = (i: number, patch: Partial<Chart['notes'][number]>): Chart => ({ ...chart, notes: chart.notes.map((n, j) => (j === i ? { ...n, ...patch } : n)) })
      const changed = [
        { ...base, title: 'Ode' },
        { ...base, artist: 'L. van Beethoven' },
        { ...base, bpm: bpm + 2 },
        { ...base, chart: { ...chart, tempos: [{ time: 0, bpm: bpm + 2 }] } },
        { ...base, chart: { ...chart, duration: chart.duration + 1 } },
        { ...base, chart: { ...chart, notes: chart.notes.slice(0, -1) } },
        { ...base, chart: withNote(3, { fret: chart.notes[3].fret + 1, midi: chart.notes[3].midi + 1 }) },
        { ...base, chart: withNote(3, { time: chart.notes[3].time + 0.01 }) },
        { ...base, chart: withNote(3, { duration: chart.notes[3].duration / 2 }) },
        { ...base, chart: withNote(3, { chordName: 'C' }) },
        { ...base, chart: { ...chart, beats: chart.beats.map((b, i) => (i === 4 ? { ...b, isDownbeat: false, beatInBar: 4, bar: b.bar - 1 } : b)) } },
        { ...base, chart: { ...chart, beats: chart.beats.slice(1) } },
      ].map(contentRevision)
      for (const other of changed) expect(other).not.toBe(rev)
      expect(new Set(changed).size).toBe(changed.length)
      // Every bundled song has its own.
      expect(new Set(BUILT_IN_SONGS.map(builtInRevision)).size).toBe(BUILT_IN_SONGS.length)
    })

    it('upgrades songs rendered by the string model once the recorded guitar is available, and never the other way', async () => {
      const rec = await builtInSongRecord('ode-to-joy')
      expect(rec.audioName).toBe(synthAudioName('ode-to-joy', null))
      const bank = await loadRealBank()
      setGuitarBankForTests(bank)
      try {
        expect(await refreshRenderedAudio()).toBe(1)
        const sampled = await db.songs.get(rec.id)
        expect(sampled?.audioName).toBe(synthAudioName('ode-to-joy', bank.version))
        expect(sampled?.audioData?.byteLength).not.toBe(rec.audioData?.byteLength === undefined ? -1 : 0)
        // Samples unavailable again (offline before they were cached): the sampled render stays.
        setGuitarBankForTests(null)
        expect(await refreshRenderedAudio()).toBe(0)
        expect((await db.songs.get(rec.id))?.audioName).toBe(synthAudioName('ode-to-joy', bank.version))
      } finally {
        setGuitarBankForTests(null)
      }
    }, 30_000)

    it('a song deleted while its audio renders is not brought back', async () => {
      const rec = await builtInSongRecord('ode-to-joy')
      await db.songs.update(rec.id, { audioName: 'ode-to-joy.wav' })
      const refreshing = refreshRenderedAudio()
      await db.songs.delete(rec.id)
      await refreshing
      expect(await db.songs.count()).toBe(0)
    }, 30_000)

    it('builtInSongRecord installs a single song', async () => {
      const rec = await builtInSongRecord('ode-to-joy')
      expect(rec.source).toBe('builtin')
      expect(rec.builtinId).toBe('ode-to-joy')
      expect(await db.songs.count()).toBe(1)
      expect((await builtInSongRecord('ode-to-joy')).id).toBe(rec.id)
    })
  })

  it('the scoring backing is the click track alone: same length as the song, no guitar in it', () => {
    const song = builtInSong('ode-to-joy')!
    const full = renderChartBacking(song.chart, { plucks: true, click: true, seed: 1000 })
    const backing = builtInBacking('ode-to-joy')!
    expect(backing.length).toBe(full.length)
    expect(backing).toEqual(renderDrums(song.chart))
    expect(builtInBacking('ode-to-joy')).toBe(backing)
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

describe('First Riff fingering', () => {
  it('shows the fingers lesson 10 teaches: index on fret 3, ring finger on fret 5', () => {
    const riff = builtInSong('first-riff')!
    const fingers = new Map<number, Set<number | undefined>>()
    for (const n of riff.chart.notes) fingers.set(n.fret, (fingers.get(n.fret) ?? new Set()).add(n.finger))
    expect([...(fingers.get(3) ?? [])]).toEqual([1])
    expect([...(fingers.get(5) ?? [])]).toEqual([3])
    expect([...(fingers.get(0) ?? [])]).toEqual([undefined])
  })
})

describe('bundled chord songs keep their chords whole at every level', () => {
  const chordSongs = BUILT_IN_SONGS.filter((s) => (s.chords?.length ?? 0) > 0)

  it('has chord songs to check', () => {
    expect(chordSongs.length).toBeGreaterThanOrEqual(5)
  })

  it.each(chordSongs.map((s) => [s.id, s] as const))('%s: every level shows each chord as the full shape, and only thins the strums', (_id, song) => {
    const full = new Map<number, number>()
    for (const n of song.chart.notes) full.set(n.chordId ?? -1, (full.get(n.chordId ?? -1) ?? 0) + 1)
    const levels = generateLevels(song.chart)
    let strumsBelow = 0
    for (const level of levels) {
      const shown = new Map<number, number>()
      for (const n of level.notes) shown.set(n.chordId ?? -1, (shown.get(n.chordId ?? -1) ?? 0) + 1)
      for (const [chord, count] of shown) expect(count, `strum ${chord}`).toBe(full.get(chord))
      expect(shown.size).toBeGreaterThanOrEqual(strumsBelow)
      strumsBelow = shown.size
    }
    // The easiest level is one strum per bar or so, not the whole song.
    expect(new Set(levels[0].notes.map((n) => n.chordId)).size).toBeLessThan(full.size)
    expect(distinctLevels(levels).length).toBeGreaterThanOrEqual(4)
  })

  it('a melody song is not affected', () => {
    const ode = builtInSong('ode-to-joy')!
    expect(ode.chart.wholeChords).toBeUndefined()
  })
})

describe('the songs to sing beside the guitar songs', () => {
  /**
   * The fingerprint of every guitar song as it was before the songs to sing were added. Singing changes
   * no guitar chart, tempo or name, so none of these may move because of it. A deliberate correction to a
   * guitar song changes its own line here and no other.
   */
  const GUITAR_REVISIONS: Record<string, string> = {
    'open-strings-groove': '1t3nwl81cmf3c9',
    'ode-to-joy': '1ga6q5g1w6oyx4',
    'happy-birthday': '091ooce14mtz26',
    'jingle-bells': '0p9qviw0zuhawo',
    'twinkle-twinkle': '0nzusde0a32rma',
    'em-groove': '1ugmnol11altue',
    'em-am-groove': '11q11990kzj626',
    'd-a-groove': '13nc9l00bhel87',
    'amazing-grace': '0p96wz20itfzrg',
    'tom-dooley': '1bozmkb1l01bn5',
    saints: '0uc583u0y8t3z0',
    'first-riff': '1gflm1f1a278bp',
  }

  /** The preview key that shows the singing side on a device before it is released. */
  const previewSinging = (on: boolean) => vi.stubGlobal('localStorage', { getItem: (key: string) => (on && key === 'gt.voice' ? '1' : null) })

  beforeEach(async () => {
    await db.songs.clear()
    await db.profile.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('the twelve guitar songs are what they were before singing was added', () => {
    expect(Object.fromEntries(BUILT_IN_SONGS.map((s) => [s.id, builtInRevision(s)]))).toEqual(GUITAR_REVISIONS)
  })

  it('the list of guitar songs holds no song to sing', () => {
    expect(BUILT_IN_SONGS).toHaveLength(12)
    for (const s of VOCAL_SONGS) expect(builtInSong(s.id)).toBeUndefined()
  })

  it('a song to sing never has stale audio: it has none, and is arranged when it is opened', async () => {
    const row = await vocalSongRecord('sing-hot-cross-buns')
    expect(hasStaleAudio(row)).toBe(false)
    // Also once the recorded guitar is there, which is when a guitar song made by the string model turns stale.
    const bank = await loadRealBank()
    setGuitarBankForTests(bank)
    try {
      expect(hasStaleAudio(row)).toBe(false)
      expect(hasStaleAudio({ ...row, builtinRev: undefined })).toBe(false)
    } finally {
      setGuitarBankForTests(null)
    }
    // It is the stamp that says so: the same row read as a guitar song would be rendered again at every launch.
    expect(hasStaleAudio({ ...row, instrument: undefined })).toBe(true)
  })

  it('the refresh at launch leaves the songs to sing exactly as they are', async () => {
    await installVocalSongs()
    const before = await db.songs.toArray()
    const update = vi.spyOn(db.songs, 'update')
    expect(await refreshRenderedAudio()).toBe(0)
    expect(update).not.toHaveBeenCalled()
    expect(await db.songs.toArray()).toEqual(before)
    for (const row of await db.songs.toArray()) expect('audioData' in row).toBe(false)
  })

  it('a stale guitar song next to them is still rendered again, and only that one', async () => {
    await installVocalSongs()
    const rec = await builtInSongRecord('ode-to-joy')
    await db.songs.update(rec.id, { audioName: 'ode-to-joy.v3.wav' })
    const sung = (await db.songs.toArray()).filter((r) => r.instrument === 'voice')
    expect(await refreshRenderedAudio()).toBe(1)
    expect((await db.songs.get(rec.id))?.audioName).toBe(synthAudioName('ode-to-joy', null))
    expect((await db.songs.toArray()).filter((r) => r.instrument === 'voice')).toEqual(sung)
  }, 30_000)

  it('installing the guitar songs and the songs to sing in either order gives each list its own rows', async () => {
    await installVocalSongs()
    await installBuiltInSongs()
    await installVocalSongs()
    const rows = await db.songs.toArray()
    expect(rows.filter((r) => r.instrument === 'voice').map((r) => r.builtinId).sort()).toEqual(VOCAL_SONGS.map((s) => s.id).sort())
    expect(rows.filter((r) => r.instrument === undefined).map((r) => r.builtinId).sort()).toEqual([...IDS].sort())
    for (const r of rows) expect(!!r.audioData, r.builtinId).toBe(r.instrument !== 'voice')
  }, 60_000)

  describe('at launch', () => {
    it('writes the songs to sing when there is a singing profile', async () => {
      previewSinging(true)
      await db.profile.put(defaultProfile(1, 'voice'))
      expect(await refreshRenderedAudio()).toBe(0)
      const rows = await db.songs.toArray()
      expect(rows.map((r) => r.builtinId).sort()).toEqual(VOCAL_SONGS.map((s) => s.id).sort())
      expect(rows.every((r) => r.instrument === 'voice')).toBe(true)
      // And again at the next launch: the same rows.
      expect(await refreshRenderedAudio()).toBe(0)
      expect(await db.songs.toArray()).toEqual(rows)
    })

    it('writes nothing for someone who only plays the guitar', async () => {
      previewSinging(true)
      await db.profile.put(defaultProfile(1, 'guitar'))
      expect(await refreshRenderedAudio()).toBe(0)
      expect(await db.songs.count()).toBe(0)
    })

    it('writes nothing while the singing side is switched off, whatever is stored', async () => {
      previewSinging(false)
      await db.profile.put(defaultProfile(1, 'voice'))
      expect(await refreshRenderedAudio()).toBe(0)
      expect(await db.songs.count()).toBe(0)
    })

    it('a failure there does not stop the guitar songs from being refreshed', async () => {
      previewSinging(true)
      await db.profile.put(defaultProfile(1, 'voice'))
      const rec = await builtInSongRecord('ode-to-joy')
      await db.songs.update(rec.id, { audioName: 'ode-to-joy.v3.wav' })
      vi.spyOn(db.songs, 'add').mockRejectedValue(new Error('disk full'))
      expect(await refreshRenderedAudio()).toBe(1)
      expect((await db.songs.get(rec.id))?.audioName).toBe(synthAudioName('ode-to-joy', null))
    }, 30_000)
  })
})
