import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { loadMidiFile, midiToChart, notesFromPitchEvents } from './midi'

const STD = [40, 45, 50, 55, 59, 64]

describe('notesFromPitchEvents', () => {
  it('clusters simultaneous onsets into chords and assigns frets', () => {
    const notes = notesFromPitchEvents(
      [
        { time: 0, duration: 1, midi: 40, velocity: 0.8 },
        { time: 0.01, duration: 1, midi: 47, velocity: 0.8 },
        { time: 0.02, duration: 1, midi: 52, velocity: 0.8 },
        { time: 1, duration: 0.5, midi: 45, velocity: 0.6 },
      ],
      STD,
    )
    expect(notes.length).toBe(4)
    expect(new Set(notes.slice(0, 3).map((n) => n.chordId)).size).toBe(1)
    expect(notes[3].chordId).not.toBe(notes[0].chordId)
    expect(notes.every((n) => STD[n.string] + n.fret === n.midi)).toBe(true)
  })
})

describe('midiToChart', () => {
  it('reads tempo, time signature and notes from a MIDI file', () => {
    const midi = new Midi()
    midi.header.setTempo(100)
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] })
    const track = midi.addTrack()
    track.name = 'Guitar'
    track.instrument.number = 27
    track.addNote({ midi: 52, time: 0, duration: 0.5, velocity: 0.9 })
    track.addNote({ midi: 55, time: 0.6, duration: 0.5, velocity: 0.9 })
    track.addNote({ midi: 59, time: 1.2, duration: 0.5, velocity: 0.9 })
    const drums = midi.addTrack()
    drums.channel = 9
    drums.addNote({ midi: 36, time: 0, duration: 0.1, velocity: 1 })

    const loaded = loadMidiFile(midi.toArray().buffer as ArrayBuffer)
    expect(loaded.tracks.length).toBe(2)
    expect(loaded.defaultTrack).toBe(0)
    expect(loaded.tracks[1].isPercussion).toBe(true)

    const chart = midiToChart(loaded, loaded.defaultTrack, STD, { title: 'T', artist: 'A' })
    expect(chart.notes.map((n) => n.midi)).toEqual([52, 55, 59])
    expect(chart.notes[1].time).toBeCloseTo(0.6)
    expect(chart.tempos[0].bpm).toBeCloseTo(100)
    expect(chart.timeSignatures[0]).toMatchObject({ numerator: 3, denominator: 4 })
    const firstBar = chart.beats.filter((b) => b.bar === 0)
    expect(firstBar.length).toBe(3)
    expect(firstBar[1].time).toBeCloseTo(0.6)
  })
})
