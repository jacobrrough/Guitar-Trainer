import { describe, expect, it } from 'vitest'
import * as alphaTab from '@coderline/alphatab'
import type { Chart } from '../types'
import { DRUM_TRACK_MESSAGE, OUT_OF_RANGE_MESSAGE, loadScoreFile, pickDefaultTrack, scoreToChart, type LoadedScore } from './guitarpro'

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

/** True when the note sounds exactly what its string and fret say (the chart's basic promise). */
function onTheFretboard(chart: Chart): boolean {
  return chart.notes.every((n) => n.string >= 0 && n.string < chart.tuning.length && n.fret >= 0 && n.midi === chart.tuning[n.string] + chart.capo + n.fret)
}

const EIGHTHS = '0.6.8 0.6.8 0.6.8 0.6.8 0.6.8 0.6.8 0.6.8 0.6.8'

describe('scoreToChart with other tracks and voices playing', () => {
  it('imports a long note once while another track plays shorter notes under it', async () => {
    const tex = `\\tempo 120 . \\track "Guitar" 3.6.1 | \\track "Other" 0.6.4 0.6.4 0.6.4 0.6.4 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.length).toBe(1)
    expect(chart.notes[0]).toMatchObject({ time: 0, string: 0, fret: 3, midi: 43 })
    expect(chart.notes[0].duration).toBeCloseTo(2)
  })

  it('imports half notes once each against eighth notes in a second track', async () => {
    const tex = `\\tempo 120 . \\track "Guitar" 3.6.2 5.6.2 | 7.6.2 5.6.2 | \\track "Other" ${EIGHTHS} | ${EIGHTHS} |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.map((n) => n.midi)).toEqual([43, 45, 47, 45])
    expect(chart.notes.map((n) => n.time)).toEqual([0, 1, 2, 3])
    expect(new Set(chart.notes.map((n) => n.chordId)).size).toBe(4)
    // The other track is untouched by the fix: all sixteen of its notes are still there.
    expect((await scoreToChart(load(tex), 1)).notes.length).toBe(16)
  })

  it('imports a held bass note once under a melody in a second voice, struck together with the first melody note', async () => {
    const tex = `\\tempo 120 . \\voice 3.6.1 | \\voice 0.1.4 1.1.4 3.1.4 1.1.4 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.length).toBe(5)
    expect(chart.notes.filter((n) => n.string === 0).length).toBe(1)
    const atZero = chart.notes.filter((n) => n.time === 0)
    expect(atZero.map((n) => n.midi).sort((a, b) => a - b)).toEqual([43, 64])
    // Two voices that start on the same beat are one stroke for the player.
    expect(new Set(atZero.map((n) => n.chordId)).size).toBe(1)
    expect(new Set(chart.notes.map((n) => n.chordId)).size).toBe(4)
    expect(chart.notes.map((n) => n.id)).toEqual([0, 1, 2, 3, 4])
  })

  it('names every note of a stroke after its chord, whichever voice wrote the name', async () => {
    const tex = `\\tempo 120 . \\voice (0.6 2.5).2{ch "Em"} 3.6.2 | \\voice 0.1.2 0.1.2 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.filter((n) => n.time === 0).map((n) => [n.string, n.chordName])).toEqual([[0, 'Em'], [1, 'Em'], [5, 'Em']])
    expect(chart.notes.filter((n) => n.time === 1).map((n) => n.chordName)).toEqual([undefined, undefined])
  })

  it('keeps one note when two voices write the same string at the same moment', async () => {
    const tex = `\\tempo 120 . \\voice 3.6.2 3.6.2 | \\voice 3.6.4 0.1.4 r.2 |`
    const chart = await scoreToChart(load(tex), 0)
    const atZero = chart.notes.filter((n) => n.time === 0)
    expect(atZero.length).toBe(1)
    // The longer of the two written lengths wins: the string rings for the half note.
    expect(atZero[0].duration).toBeCloseTo(1)
    expect(chart.notes.length).toBe(3)
  })

  it('still plays a repeated bar twice when a second track splits its beats', async () => {
    const tex = `\\tempo 120 . \\track "Guitar" \\ro \\rc 2 3.6.2 5.6.2 | 7.6.1 | \\track "Other" ${EIGHTHS} | ${EIGHTHS} |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.map((n) => n.midi)).toEqual([43, 45, 43, 45, 47])
    expect(chart.notes.map((n) => n.time)).toEqual([0, 1, 2, 3, 4])
  })

  it('merges a tie into one note when another track splits the tied beats', async () => {
    const tex = `\\tempo 120 . \\track "Guitar" 3.4.2 -.4.2 | \\track "Other" ${EIGHTHS} |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.length).toBe(1)
    expect(chart.notes[0].duration).toBeCloseTo(2)
  })
})

describe('scoreToChart with muted notes and harmonics', () => {
  it('uses the pitch a natural harmonic really sounds, and keeps the string and fret to show', async () => {
    const tex = `\\tempo 120 . 7.6{nh}.4 5.1{nh}.4 12.3{nh}.4 3.6.4 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.length).toBe(4)
    // 7th fret on the low E string rings B3 (an octave and a fifth above the open string), not the fretted B2.
    expect(chart.notes[0]).toMatchObject({ string: 0, fret: 7, midi: 59, tech: { harmonic: true } })
    // 5th fret on the high E string rings two octaves above the open string.
    expect(chart.notes[1]).toMatchObject({ string: 5, fret: 5, midi: 88, tech: { harmonic: true } })
    // 12th fret: one octave above the open G string, the same pitch as the fretted note.
    expect(chart.notes[2]).toMatchObject({ string: 3, fret: 12, midi: 67, tech: { harmonic: true } })
    expect(chart.notes[3]).toMatchObject({ string: 0, fret: 3, midi: 43 })
    expect(chart.notes[3].tech).toBeUndefined()
  })

  it('uses the ringing pitch of a harmonic made by touching the string at a set point above the fret', async () => {
    const tex = `\\tempo 120 . 5.6{ah 12}.4 5.6{th 12}.4 5.6{ah 7}.4 3.6.4 |`
    const chart = await scoreToChart(load(tex), 0)
    // Touching 12 frets above the fretted A2 rings A3; 7 frets above rings E4.
    expect(chart.notes.map((n) => n.midi)).toEqual([57, 57, 64, 43])
    expect(chart.notes.slice(0, 3).every((n) => n.fret === 5 && n.tech?.harmonic)).toBe(true)
  })

  it('listens for the fretted note of a squealed (pinch, semi or feedback) harmonic, whose ringing pitch the file only guesses', async () => {
    const tex = `\\tempo 120 . 5.6{ph 12}.4 5.6{sh 12}.4 5.6{fh 12}.4 5.6{ph}.4 |`
    const chart = await scoreToChart(load(tex), 0)
    // The older Guitar Pro formats store no pitch for these and alphaTab fills in an octave. A learner
    // who plays the note as tabbed sounds A2, and that has to count.
    expect(chart.notes.map((n) => n.midi)).toEqual([45, 45, 45, 45])
    expect(chart.notes.every((n) => n.tech?.harmonic)).toBe(true)
    expect(onTheFretboard(chart)).toBe(true)
  })

  it('never puts a natural harmonic below its fretted note when the file does not say where the string is touched', async () => {
    const loaded = load(`\\tempo 120 . 12.6{nh}.4 7.6{nh}.4 11.6{nh}.4 7.6{nh}.4 |`)
    const beats = loaded.score.tracks[0].staves[0].bars[0].voices[0].beats
    // A Guitar Pro 6 or 7 note marked as a natural harmonic with no touch point: alphaTab then reports the open string.
    beats[0].notes[0].harmonicValue = 0
    beats[1].notes[0].harmonicValue = 0
    // A touch point that is not a real harmonic of the string, as a careless tab has it.
    beats[2].notes[0].harmonicValue = 11
    expect(beats[0].notes[0].realValue).toBe(40)
    const chart = await scoreToChart(loaded, 0)
    expect(chart.notes.map((n) => [n.fret, n.midi])).toEqual([[12, 52], [7, 47], [11, 51], [7, 59]])
  })

  it('leaves muted (dead) notes out, because a muted string has no pitch to listen for', async () => {
    const tex = `\\tempo 120 . x.6.4 x.6.4 3.6.4 (x.6 2.5 2.4).4 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.some((n) => n.tech?.dead)).toBe(false)
    expect(chart.notes.map((n) => n.midi)).toEqual([43, 47, 52])
    expect(chart.notes.map((n) => n.time)).toEqual([1, 1.5, 1.5])
    expect(chart.notes.map((n) => n.id)).toEqual([0, 1, 2])
    expect(onTheFretboard(chart)).toBe(true)
    // The bar keeps its full length and its beats, so the rest of the song stays in time.
    expect(chart.duration).toBeCloseTo(2)
    expect(chart.beats.length).toBe(4)
  })

  it('reads a transposed tab at the pitch the file plays', async () => {
    const tex = `\\tempo 120 \\transpose 2 . 0.6.4 3.6.4 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.map((n) => n.midi)).toEqual([42, 45])
    expect(chart.notes.map((n) => n.fret)).toEqual([0, 3])
    expect(onTheFretboard(chart)).toBe(true)
  })
})

const MELODY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`

describe('scoreToChart on a real Guitar Pro file', () => {
  it('reads a two-track .gp file with muted notes and a harmonic the same way', async () => {
    const tex = `\\tempo 120 . \\track "Guitar" 3.6.2 7.6{nh}.2 | x.6.4 x.6.4 5.6.2 | \\track "Bass" \\tuning (G2 D2 A1 E1) ${'0.4.8 '.repeat(8)} | ${'0.4.8 '.repeat(8)} |`
    const settings = new alphaTab.Settings()
    const bytes = new alphaTab.exporter.Gp7Exporter().export(alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings), settings)
    const loaded = await loadScoreFile(bytes)
    expect(loaded.tracks.map((t) => t.strings)).toEqual([6, 4])
    const chart = await scoreToChart(loaded, 0)
    expect(chart.notes.map((n) => [n.time, n.string, n.fret, n.midi])).toEqual([
      [0, 0, 3, 43],
      [1, 0, 7, 59],
      [3, 0, 5, 45],
    ])
    expect(chart.notes[1].tech).toEqual({ harmonic: true })
    const bass = await scoreToChart(loaded, 1)
    expect(bass.tuning).toEqual([28, 33, 38, 43])
    expect(bass.notes.length).toBe(16)
    expect(onTheFretboard(bass)).toBe(true)
  })
})

const PIANO = '\\track "Piano" \\staff {score} \\tuning piano \\instrument acousticgrandpiano'

describe('pickDefaultTrack', () => {
  const info = (index: number, over: Partial<LoadedScore['tracks'][number]>) => ({ index, name: `T${index}`, strings: 6, program: 25, isPercussion: false, noteCount: 10, tuning: [40, 45, 50, 55, 59, 64], ...over })

  it('prefers a part without tablature over a busier drum part', () => {
    const tracks = [info(0, { strings: 6, isPercussion: true, noteCount: 400, program: 0 }), info(1, { strings: 0, tuning: [], noteCount: 30, program: 0 })]
    expect(pickDefaultTrack(tracks)).toBe(1)
  })

  it('still prefers a guitar tab when there is one', () => {
    const tracks = [info(0, { strings: 0, tuning: [], noteCount: 300, program: 0 }), info(1, { noteCount: 20 }), info(2, { strings: 4, program: 33, noteCount: 200 })]
    expect(pickDefaultTrack(tracks)).toBe(1)
  })
})

describe('scoreToChart on a part written without tablature', () => {
  it('puts the notes of a plain MusicXML melody on a standard-tuned guitar', async () => {
    const loaded = await loadScoreFile(new TextEncoder().encode(MELODY_XML))
    const chart = await scoreToChart(loaded, loaded.defaultTrack)
    expect(chart.tuning).toEqual([40, 45, 50, 55, 59, 64])
    expect(chart.capo).toBe(0)
    expect(chart.notes.map((n) => n.midi)).toEqual([64, 65, 67, 72])
    expect(chart.notes.map((n) => n.time)).toEqual([0, 0.5, 1, 1.5])
    expect(chart.notes[0].duration).toBeCloseTo(0.5)
    expect(onTheFretboard(chart)).toBe(true)
    expect(chart.notes.map((n) => n.id)).toEqual([0, 1, 2, 3])
    expect(chart.beats.length).toBe(4)
  })

  it('uses the tuning it is given for such a part', async () => {
    const loaded = await loadScoreFile(new TextEncoder().encode(MELODY_XML))
    const dropD = [38, 45, 50, 55, 59, 64]
    const chart = await scoreToChart(loaded, loaded.defaultTrack, dropD)
    expect(chart.tuning).toEqual(dropD)
    expect(chart.notes.length).toBe(4)
    expect(onTheFretboard(chart)).toBe(true)
  })

  it('keeps chords, ties and chord names of a part with no tuning', async () => {
    const tex = `\\tempo 120 . ${PIANO} (c4 e4 g4).2{ch "C"} a3.4 a3{t}.4 | r.1 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.tuning).toEqual([40, 45, 50, 55, 59, 64])
    expect(chart.notes.length).toBe(4)
    const chord = chart.notes.filter((n) => n.time === 0)
    expect(chord.map((n) => n.midi).sort((a, b) => a - b)).toEqual([60, 64, 67])
    expect(new Set(chord.map((n) => n.chordId)).size).toBe(1)
    expect(new Set(chord.map((n) => n.string)).size).toBe(3)
    expect(chord.map((n) => n.chordName)).toEqual(['C', 'C', 'C'])
    const tied = chart.notes.find((n) => n.midi === 57)!
    expect(tied.time).toBeCloseTo(1)
    expect(tied.duration).toBeCloseTo(1)
    expect(tied.chordName).toBeUndefined()
    expect(onTheFretboard(chart)).toBe(true)
    expect(chart.duration).toBeCloseTo(4)
  })

  it('drops muted notes and notes no guitar string can reach, and keeps the rest', async () => {
    // c8 is far above the last fret and c1 far below the lowest string.
    const tex = `\\tempo 120 . ${PIANO} e4.4 a3{x}.4 c8.4 c1.4 | g3.1 |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.map((n) => n.midi)).toEqual([64, 55])
    expect(chart.notes.map((n) => n.time)).toEqual([0, 2])
    expect(onTheFretboard(chart)).toBe(true)
  })

  it('says so plainly when nothing in the part fits on a guitar', async () => {
    const tex = `\\tempo 120 . ${PIANO} c1.4 d1.4 c8.4 d8.4 |`
    await expect(scoreToChart(load(tex), 0)).rejects.toThrow(OUT_OF_RANGE_MESSAGE)
  })

  it('imports once per written note when a part with no tuning shares the file with another track', async () => {
    const tex = `\\tempo 120 . ${PIANO} e4.2 g4.2 | \\track "Other" ${EIGHTHS} |`
    const chart = await scoreToChart(load(tex), 0)
    expect(chart.notes.map((n) => n.midi)).toEqual([64, 67])
    expect(chart.notes.map((n) => n.duration)).toEqual([1, 1])
    expect(onTheFretboard(chart)).toBe(true)
  })

  it('finds a string for a note that has only a pitch on a tab staff', async () => {
    const loaded = load(`\\tempo 120 . (0.6 2.5).4 3.6.4 |`)
    // Turn the second note of the chord (B2 on the A string) into a bare pitch, as a file with gaps in its tab would have it.
    const bare = loaded.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.find((n) => n.realValue === 47)!
    bare.string = NaN
    bare.fret = NaN
    bare.octave = 3
    bare.tone = 11
    expect(bare.realValue).toBe(47)
    const chart = await scoreToChart(loaded, 0)
    expect(chart.notes.length).toBe(3)
    const chord = chart.notes.filter((n) => n.time === 0)
    expect(chord.map((n) => n.midi)).toEqual([40, 47])
    // The lowest fret that sounds B2 is fret 2 of the A string, and that string is free.
    expect(chord[1]).toMatchObject({ string: 1, fret: 2 })
    expect(new Set(chord.map((n) => n.chordId)).size).toBe(1)
    expect(onTheFretboard(chart)).toBe(true)
  })

  it('does not ignore the tuning written in a tab when one is passed in', async () => {
    const tex = `\\tempo 120 . 0.6.4 3.6.4 |`
    const chart = await scoreToChart(load(tex), 0, [38, 45, 50, 55, 59, 64])
    expect(chart.tuning).toEqual([40, 45, 50, 55, 59, 64])
    expect(chart.notes.map((n) => n.midi)).toEqual([40, 43])
  })

  it('refuses a drum track with a message a beginner can act on', async () => {
    const tex = `\\tempo 120 . \\track "Guitar" 3.6.4 | \\track "Drums" \\instrument percussion \\articulation defaults "Kick (Hit)".4 "Snare (Hit)".4 |`
    const loaded = load(tex)
    expect(loaded.tracks[1].isPercussion).toBe(true)
    await expect(scoreToChart(loaded, 1)).rejects.toThrow(DRUM_TRACK_MESSAGE)
    expect(DRUM_TRACK_MESSAGE).toMatch(/drum/i)
    // The guitar track of the same file still imports.
    expect((await scoreToChart(loaded, 0)).notes.length).toBe(1)
  })
})
