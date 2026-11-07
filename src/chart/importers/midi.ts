import { Midi } from '@tonejs/midi'
import { assignFrets } from '../../music/fretboard'
import { assignChordIdsByTime } from '../events'
import type { Beat, Chart, ChartNote, TempoEvent, TimeSignatureEvent } from '../types'

export interface MidiTrackInfo {
  index: number
  name: string
  instrument: string
  program: number
  isPercussion: boolean
  noteCount: number
}

export interface LoadedMidi {
  midi: Midi
  title: string
  tracks: MidiTrackInfo[]
  defaultTrack: number
}

export function loadMidiFile(data: ArrayBuffer): LoadedMidi {
  const midi = new Midi(data)
  const tracks: MidiTrackInfo[] = midi.tracks.map((t, index) => ({
    index,
    name: t.name || t.instrument.name || `Track ${index + 1}`,
    instrument: t.instrument.name,
    program: t.instrument.number,
    isPercussion: t.instrument.percussion || t.channel === 9,
    noteCount: t.notes.length,
  }))
  const playable = tracks.filter((t) => !t.isPercussion && t.noteCount > 0)
  const guitars = playable.filter((t) => t.program >= 24 && t.program <= 31)
  const pool = guitars.length ? guitars : playable
  const defaultTrack = pool.length ? pool.reduce((b, t) => (t.noteCount > b.noteCount ? t : b), pool[0]).index : 0
  return { midi, title: midi.name, tracks, defaultTrack }
}

interface PendingNote {
  time: number
  duration: number
  midi: number
  velocity: number
  chordId?: number
}

/**
 * Builds chart notes from pitch-only events: clusters simultaneous onsets into
 * chords, assigns string/fret positions and drops pitches the tuning cannot play.
 */
export function notesFromPitchEvents(events: PendingNote[], tuning: number[], maxPolyphony = 6): ChartNote[] {
  const clustered = assignChordIdsByTime(events, 0.03)
  const groups = new Map<number, PendingNote[]>()
  for (const n of clustered) {
    const g = groups.get(n.chordId!) ?? []
    g.push(n)
    groups.set(n.chordId!, g)
  }
  const ordered = [...groups.values()].map((g) => {
    g.sort((a, b) => b.velocity - a.velocity)
    const kept = g.slice(0, maxPolyphony)
    const seen = new Set<number>()
    return kept.filter((n) => (seen.has(n.midi) ? false : (seen.add(n.midi), true)))
  })
  const positions = assignFrets(
    ordered.map((g) => ({ time: g[0].time, midis: g.map((n) => n.midi) })),
    tuning,
  )
  const notes: ChartNote[] = []
  ordered.forEach((g, gi) => {
    g.forEach((n, ni) => {
      const pos = positions[gi][ni]
      if (!pos) return
      notes.push({
        id: notes.length,
        time: n.time,
        duration: Math.max(0.05, n.duration),
        midi: n.midi,
        string: pos.string,
        fret: pos.fret,
        velocity: n.velocity,
        chordId: gi,
      })
    })
  })
  notes.sort((a, b) => a.time - b.time || a.string - b.string)
  notes.forEach((n, i) => (n.id = i))
  return notes
}

export function midiToChart(loaded: LoadedMidi, trackIndex: number, tuning: number[], meta: { title: string; artist: string }): Chart {
  const { midi } = loaded
  const header = midi.header
  const track = midi.tracks[trackIndex] ?? midi.tracks[0]
  const events: PendingNote[] = track.notes.map((n) => ({ time: n.time, duration: n.duration, midi: n.midi, velocity: n.velocity }))
  const notes = notesFromPitchEvents(events, tuning)

  const endTicks = Math.max(header.ppq * 4, ...midi.tracks.flatMap((t) => t.notes.map((n) => n.ticks + n.durationTicks)))
  const tsEvents = [...header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
  const beats: Beat[] = []
  const timeSignatures: TimeSignatureEvent[] = []
  let tick = 0
  let bar = 0
  let tsIdx = 0
  let num = 4
  let den = 4
  if (tsEvents[0]?.ticks === 0) {
    num = tsEvents[0].timeSignature[0]
    den = tsEvents[0].timeSignature[1]
    tsIdx = 1
  }
  timeSignatures.push({ time: 0, numerator: num, denominator: den })
  while (tick < endTicks && bar < 10000) {
    while (tsIdx < tsEvents.length && tsEvents[tsIdx].ticks <= tick) {
      num = tsEvents[tsIdx].timeSignature[0]
      den = tsEvents[tsIdx].timeSignature[1]
      timeSignatures.push({ time: header.ticksToSeconds(tick), numerator: num, denominator: den })
      tsIdx++
    }
    const beatTicks = (header.ppq * 4) / den
    for (let b = 0; b < num; b++) {
      beats.push({ time: header.ticksToSeconds(tick + b * beatTicks), bar, beatInBar: b, isDownbeat: b === 0 })
    }
    tick += beatTicks * num
    bar++
  }
  const tempos: TempoEvent[] = header.tempos.length
    ? header.tempos.map((t) => ({ time: header.ticksToSeconds(t.ticks), bpm: t.bpm }))
    : [{ time: 0, bpm: 120 }]

  return {
    version: 1,
    title: meta.title || loaded.title,
    artist: meta.artist,
    source: 'midi',
    sourceTrack: track.name || track.instrument.name,
    tuning,
    capo: 0,
    duration: Math.max(header.ticksToSeconds(endTicks), midi.duration),
    notes,
    beats,
    tempos,
    timeSignatures,
  }
}
