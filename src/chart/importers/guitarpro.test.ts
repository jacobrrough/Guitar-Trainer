import { describe, expect, it } from 'vitest'
import * as alphaTab from '@coderline/alphatab'
import { pickDefaultTrack, scoreToChart, type LoadedScore } from './guitarpro'

function load(tex: string): LoadedScore {
  const settings = new alphaTab.Settings()
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings)
  const tracks = score.tracks.map((t) => {
    const staff = t.staves[0]
    let noteCount = 0
    for (const bar of staff.bars) for (const v of bar.voices) for (const b of v.beats) noteCount += b.notes.length
    return { index: t.index, name: t.name, strings: staff.tuning.length, program: t.playbackInfo.program, isPercussion: staff.isPercussion, noteCount, tuning: [...staff.tuning].reverse() }
  })
  return { score, title: score.title, artist: score.artist, tracks, defaultTrack: pickDefaultTrack(tracks) }
}

describe('scoreToChart (alphaTab)', () => {
  it('converts strings, frets, pitches and timing from a simple tab', async () => {
    const tex = `\\title "Riff" \\artist "Someone" \\tempo 120 . \\ts 4 4 0.6.4 3.6.4 2.5.4 0.4.4 | (0.6 2.5 2.4).2 r.2 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.title).toBe('Riff')
    expect(chart.artist).toBe('Someone')
    expect(chart.tuning).toEqual([40, 45, 50, 55, 59, 64])
    expect(chart.notes.length).toBe(7)
    const first = chart.notes[0]
    expect(first).toMatchObject({ time: 0, string: 0, fret: 0, midi: 40 })
    expect(chart.notes[1]).toMatchObject({ string: 0, fret: 3, midi: 43 })
    expect(chart.notes[1].time).toBeCloseTo(0.5)
    expect(chart.notes[2]).toMatchObject({ string: 1, fret: 2, midi: 47 })
    expect(chart.notes[3]).toMatchObject({ string: 2, fret: 0, midi: 50 })
    expect(chart.notes[3].time).toBeCloseTo(1.5)
    // chord in bar 2: three notes sharing a chordId at 2.0 s
    const chord = chart.notes.filter((n) => Math.abs(n.time - 2) < 1e-6)
    expect(chord.length).toBe(3)
    expect(new Set(chord.map((n) => n.chordId)).size).toBe(1)
    expect(chord.map((n) => n.midi).sort((a, b) => a - b)).toEqual([40, 47, 52])
    expect(chord[0].duration).toBeCloseTo(1)
    expect(chart.beats.filter((b) => b.isDownbeat).length).toBe(2)
    expect(chart.beats.length).toBe(8)
    expect(chart.duration).toBeCloseTo(4)
    expect(chart.tempos[0]).toEqual({ time: 0, bpm: 120 })
  })

  it('expands repeats and follows tempo changes', async () => {
    const tex = `\\tempo 120 . \\ro \\rc 2 0.6.4 0.6.4 0.6.4 0.6.4 | \\tempo 60 2.5.4 2.5.4 2.5.4 2.5.4 |`
    const chart = await scoreToChart(load(tex), 0)
    // first bar played twice (8 notes) + second bar (4 notes)
    expect(chart.notes.length).toBe(12)
    expect(chart.notes[4].time).toBeCloseTo(2)
    expect(chart.notes[8].time).toBeCloseTo(4)
    expect(chart.notes[9].time).toBeCloseTo(5)
    expect(chart.duration).toBeCloseTo(8)
    expect(chart.beats.filter((b) => b.isDownbeat).map((b) => b.time)).toEqual([0, 2, 4])
  })

  it('merges tied notes into one longer note', async () => {
    const tex = `\\tempo 120 . 3.4.2 -.4.2 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.length).toBe(1)
    expect(chart.notes[0].duration).toBeCloseTo(2)
  })

  it('applies a capo to sounding pitch while keeping displayed frets', async () => {
    const tex = `\\capo 2 . 0.6.4 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.capo).toBe(2)
    expect(chart.notes[0].fret).toBe(0)
    expect(chart.notes[0].midi).toBe(42)
  })
})
