import type * as AlphaTabTypes from '@coderline/alphatab'
import { beatsFromBars, TickTimeMap, type BarSpec, type TickTempo } from '../timing'
import type { Chart, ChartNote, NoteTechniques, TempoEvent, TimeSignatureEvent } from '../types'

type AlphaTab = typeof AlphaTabTypes
type Score = AlphaTabTypes.model.Score
type Staff = AlphaTabTypes.model.Staff

let alphaTabPromise: Promise<AlphaTab> | null = null

/** alphaTab is ~1 MB, so it is loaded on demand. */
export function loadAlphaTab(): Promise<AlphaTab> {
  alphaTabPromise ??= import('@coderline/alphatab')
  return alphaTabPromise
}

export interface ScoreTrackInfo {
  index: number
  name: string
  strings: number
  program: number
  isPercussion: boolean
  noteCount: number
  /** Lowest string first. */
  tuning: number[]
}

export interface LoadedScore {
  score: Score
  title: string
  artist: string
  tracks: ScoreTrackInfo[]
  defaultTrack: number
}

function mainStaff(track: AlphaTabTypes.model.Track): Staff {
  return track.staves.find((s) => !s.isPercussion && s.tuning.length > 0) ?? track.staves[0]
}

function countNotes(staff: Staff): number {
  let count = 0
  for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) count += beat.notes.length
  return count
}

export const GUITAR_PROGRAMS = { min: 24, max: 31 }
export const BASS_PROGRAMS = { min: 32, max: 39 }

export function pickDefaultTrack(tracks: ScoreTrackInfo[]): number {
  const playable = tracks.filter((t) => !t.isPercussion && t.strings >= 4 && t.noteCount > 0)
  const guitars = playable.filter((t) => t.program >= GUITAR_PROGRAMS.min && t.program <= GUITAR_PROGRAMS.max)
  const pool = guitars.length ? guitars : playable.length ? playable : tracks
  if (pool.length === 0) return 0
  return pool.reduce((best, t) => (t.noteCount > best.noteCount ? t : best), pool[0]).index
}

/** Loads Guitar Pro (gp3/gp4/gp5/gpx/gp), MusicXML (xml/musicxml/mxl) or CapXML bytes. */
export async function loadScoreFile(data: Uint8Array): Promise<LoadedScore> {
  const at = await loadAlphaTab()
  const settings = new at.Settings()
  const score = at.importer.ScoreLoader.loadScoreFromBytes(data, settings)
  const tracks: ScoreTrackInfo[] = score.tracks.map((track) => {
    const staff = mainStaff(track)
    return {
      index: track.index,
      name: track.name || `Track ${track.index + 1}`,
      strings: staff.tuning.length,
      program: track.playbackInfo.program,
      isPercussion: staff.isPercussion,
      noteCount: countNotes(staff),
      tuning: [...staff.tuning].reverse(),
    }
  })
  return { score, title: score.title, artist: score.artist, tracks, defaultTrack: pickDefaultTrack(tracks) }
}

function techniquesOf(at: AlphaTab, n: AlphaTabTypes.model.Note): NoteTechniques | undefined {
  const t: NoteTechniques = {}
  if (n.isHammerPullDestination && n.hammerPullOrigin) {
    if (n.fret > n.hammerPullOrigin.fret) t.hammerOn = true
    else t.pullOff = true
  }
  if (n.slideInType !== at.model.SlideInType.None) t.slideIn = true
  if (n.slideOutType !== at.model.SlideOutType.None) t.slideOut = true
  if (n.bendType !== at.model.BendType.None) t.bend = true
  if (n.isPalmMute) t.palmMute = true
  if (n.isDead) t.dead = true
  if (n.harmonicType !== at.model.HarmonicType.None) t.harmonic = true
  if (n.isLetRing) t.letRing = true
  if (n.vibrato !== at.model.VibratoType.None) t.vibrato = true
  return Object.keys(t).length ? t : undefined
}

/**
 * Converts one track of a loaded score into a chart. Uses alphaTab's MIDI
 * generator so repeats, alternate endings and tempo changes are expanded the
 * same way the song is actually played.
 */
export async function scoreToChart(loaded: LoadedScore, trackIndex: number): Promise<Chart> {
  const at = await loadAlphaTab()
  const { score } = loaded
  const track = score.tracks[trackIndex] ?? score.tracks[0]
  const staff = mainStaff(track)
  const strings = staff.tuning.length
  // alphaTab lists tunings highest string first and numbers strings 1 = lowest.
  const tuning = [...staff.tuning].reverse()
  const capo = staff.capo

  const settings = new at.Settings()
  const midiFile = new at.midi.MidiFile()
  const handler = new at.midi.AlphaSynthMidiFileHandler(midiFile)
  const generator = new at.midi.MidiFileGenerator(score, settings, handler)
  generator.generate()
  const tpq = midiFile.division || 960
  const lookup = generator.tickLookup

  const tempoChanges: TickTempo[] = []
  const bars: BarSpec[] = []
  for (const mb of lookup.masterBars) {
    for (const tc of mb.tempoChanges) tempoChanges.push({ tick: tc.tick, bpm: tc.tempo })
    bars.push({
      startTick: mb.start,
      endTick: mb.end,
      numerator: mb.masterBar.timeSignatureNumerator,
      denominator: mb.masterBar.timeSignatureDenominator,
    })
  }
  const map = new TickTimeMap(score.tempo, tempoChanges, tpq)

  const notes: ChartNote[] = []
  const tieMap = new Map<AlphaTabTypes.model.Note, ChartNote>()
  let chordCounter = 0
  for (const mb of lookup.masterBars) {
    let bl = mb.firstBeat
    while (bl) {
      for (const item of bl.highlightedBeats) {
        const beat = item.beat
        if (beat.voice.bar.staff !== staff) continue
        if (beat.isRest || beat.notes.length === 0) continue
        const startTick = mb.start + item.playbackStart
        const time = map.toSeconds(startTick)
        const end = map.toSeconds(startTick + beat.playbackDuration)
        const chordId = chordCounter++
        const chordName = beat.hasChord ? (beat.chord?.name ?? undefined) : undefined
        for (const n of beat.notes) {
          if (n.isTieDestination) {
            const origin = n.tieOrigin ? tieMap.get(n.tieOrigin) : undefined
            if (origin) {
              origin.duration = Math.max(origin.duration, end - origin.time)
              tieMap.set(n, origin)
            }
            continue
          }
          const stringIndex = n.isStringed ? n.string - 1 : 0
          const fret = n.isStringed ? n.fret : 0
          const midi = n.isStringed && stringIndex >= 0 && stringIndex < strings
            ? tuning[stringIndex] + fret + capo + staff.transpositionPitch
            : n.realValue
          const note: ChartNote = {
            id: notes.length,
            time,
            duration: Math.max(0.05, end - time),
            midi,
            string: Math.max(0, Math.min(strings - 1, stringIndex)),
            fret,
            velocity: Math.max(0.2, Math.min(1, 0.3 + 0.1 * (n.dynamics as number))),
            chordId,
            chordName,
            tech: techniquesOf(at, n),
          }
          notes.push(note)
          tieMap.set(n, note)
        }
      }
      bl = bl.nextBeat
    }
  }

  const tempos: TempoEvent[] = [{ time: 0, bpm: score.tempo }]
  for (const tc of tempoChanges) {
    const time = map.toSeconds(tc.tick)
    if (tc.tick === 0) tempos[0] = { time: 0, bpm: tc.bpm }
    else tempos.push({ time, bpm: tc.bpm })
  }
  const timeSignatures: TimeSignatureEvent[] = []
  for (const bar of bars) {
    const last = timeSignatures[timeSignatures.length - 1]
    if (!last || last.numerator !== bar.numerator || last.denominator !== bar.denominator) {
      timeSignatures.push({ time: map.toSeconds(bar.startTick), numerator: bar.numerator, denominator: bar.denominator })
    }
  }
  const lastBar = bars[bars.length - 1]
  const duration = lastBar ? map.toSeconds(lastBar.endTick) : notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)

  return {
    version: 1,
    title: score.title,
    artist: score.artist,
    source: 'guitarpro',
    sourceTrack: track.name,
    tuning,
    capo,
    duration,
    notes,
    beats: beatsFromBars(bars, map),
    tempos,
    timeSignatures,
  }
}
