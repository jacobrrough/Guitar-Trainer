import type * as AlphaTabTypes from '@coderline/alphatab'
import { positionsFor } from '../../music/fretboard'
import { DEFAULT_TUNING } from '../../music/tunings'
import { beatsFromBars, TickTimeMap, type BarSpec, type TickTempo } from '../timing'
import type { Chart, ChartNote, NoteTechniques, TempoEvent, TimeSignatureEvent } from '../types'
import { notesFromPitchEvents } from './midi'

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

/** The staff to read: tablature if the track has any, else ordinary notation, and drums only as a last resort. */
function mainStaff(track: AlphaTabTypes.model.Track): Staff {
  return track.staves.find((s) => !s.isPercussion && s.tuning.length > 0) ?? track.staves.find((s) => !s.isPercussion) ?? track.staves[0]
}

/**
 * The pitch each open string really sounds, lowest string first. alphaTab lists
 * tunings highest string first, and a transposed staff sounds that many
 * semitones away from its written tuning.
 */
function openStrings(staff: Staff): number[] {
  return [...staff.tuning].reverse().map((midi) => midi - staff.transpositionPitch)
}

function countNotes(staff: Staff): number {
  let count = 0
  for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) count += beat.notes.length
  return count
}

export const GUITAR_PROGRAMS = { min: 24, max: 31 }
export const BASS_PROGRAMS = { min: 32, max: 39 }

export function pickDefaultTrack(tracks: ScoreTrackInfo[]): number {
  const pitched = tracks.filter((t) => !t.isPercussion && t.noteCount > 0)
  const playable = pitched.filter((t) => t.strings >= 4)
  const guitars = playable.filter((t) => t.program >= GUITAR_PROGRAMS.min && t.program <= GUITAR_PROGRAMS.max)
  // A part without tablature can still be put on the fretboard; a drum part never can.
  const pool = guitars.length ? guitars : playable.length ? playable : pitched.length ? pitched : tracks
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
      tuning: openStrings(staff),
    }
  })
  return { score, title: score.title, artist: score.artist, tracks, defaultTrack: pickDefaultTrack(tracks) }
}

function techniquesOf(at: AlphaTab, n: AlphaTabTypes.model.Note): NoteTechniques | undefined {
  const t: NoteTechniques = {}
  // Hammer-ons and pull-offs are moves along one string, so they need frets to compare.
  if (n.isHammerPullDestination && n.hammerPullOrigin && n.isStringed && n.hammerPullOrigin.isStringed) {
    if (n.fret > n.hammerPullOrigin.fret) t.hammerOn = true
    else t.pullOff = true
  }
  if (n.slideInType !== at.model.SlideInType.None) t.slideIn = true
  if (n.slideOutType !== at.model.SlideOutType.None) t.slideOut = true
  if (n.bendType !== at.model.BendType.None) t.bend = true
  if (n.isPalmMute) t.palmMute = true
  if (n.harmonicType !== at.model.HarmonicType.None) t.harmonic = true
  if (n.isLetRing) t.letRing = true
  if (n.vibrato !== at.model.VibratoType.None) t.vibrato = true
  return Object.keys(t).length ? t : undefined
}

/**
 * The pitch to listen for, with capo and transposition applied.
 *
 * A harmonic made by touching the string at a set point (natural, artificial, tapped) rings a known
 * pitch, an octave or more above the fretted one: that is what the player produces, so that is used.
 * A pinch, semi or feedback harmonic squeals at a pitch that depends on the player's hand; the older
 * Guitar Pro formats store none and alphaTab fills in an octave. Those keep the fretted pitch, which
 * is what a learner playing the tab as written will sound.
 */
function soundingPitch(at: AlphaTab, n: AlphaTabTypes.model.Note): number {
  const fretted = n.realValueWithoutHarmonic
  const H = at.model.HarmonicType
  if (n.harmonicType === H.Pinch || n.harmonicType === H.Semi || n.harmonicType === H.Feedback) return fretted
  // A harmonic never rings below the fretted note. When alphaTab does not know the touch point it
  // reports the open string, so fall back to the fretted pitch.
  return Math.max(n.realValue, fretted)
}

export const DRUM_TRACK_MESSAGE ='This track is a drum part, so it has no notes a guitar can play. Choose another track.'
export const OUT_OF_RANGE_MESSAGE = 'The notes in this track are too high or too low for the guitar. Choose another track.'

/** Highest fret a note may be placed on when the file gives a pitch but no string. */
const MAX_FRET = 24

/** One written note on its way to becoming a chart note. */
interface DraftNote {
  /** Absolute start in MIDI ticks, repeats expanded. */
  tick: number
  time: number
  duration: number
  /** Sounding pitch. */
  midi: number
  velocity: number
  /** Where the tab puts it; null when the file only gives a pitch. */
  position: { string: number; fret: number } | null
  chordName?: string
  tech?: NoteTechniques
}

/**
 * Converts one track of a loaded score into a chart. Uses alphaTab's MIDI
 * generator so repeats, alternate endings and tempo changes are expanded the
 * same way the song is actually played.
 *
 * A track with tablature keeps the strings, frets, tuning and capo of the file.
 * A track written as ordinary notation (most MusicXML files) has no strings, so
 * its pitches are placed on `fallbackTuning`, or on standard tuning.
 *
 * Every note sounds what its string and fret say (tuning + capo + fret), except
 * a harmonic with a known ringing pitch (see soundingPitch), which keeps the fret
 * to touch and carries the pitch that rings.
 * Muted (dead) notes are left out: they have no pitch to play or to listen for.
 */
export async function scoreToChart(loaded: LoadedScore, trackIndex: number, fallbackTuning?: number[]): Promise<Chart> {
  const at = await loadAlphaTab()
  const { score } = loaded
  const track = score.tracks[trackIndex] ?? score.tracks[0]
  const staff = mainStaff(track)
  if (staff.isPercussion) throw new Error(DRUM_TRACK_MESSAGE)
  const hasTab = staff.tuning.length > 0
  const tuning = hasTab ? openStrings(staff) : fallbackTuning?.length ? [...fallbackTuning] : [...DEFAULT_TUNING.strings]
  const capo = hasTab ? staff.capo : 0

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

  const drafts: DraftNote[] = []
  const tieMap = new Map<AlphaTabTypes.model.Note, DraftNote>()
  const seenBeats = new Set<string>()
  /** What is already sounding from each start tick, by string (tab) or by pitch (no tab). */
  const struck = new Map<string, DraftNote>()
  for (const mb of lookup.masterBars) {
    let bl = mb.firstBeat
    while (bl) {
      for (const item of bl.highlightedBeats) {
        const beat = item.beat
        if (beat.voice.bar.staff !== staff) continue
        if (beat.isRest || beat.notes.length === 0) continue
        const startTick = mb.start + item.playbackStart
        // alphaTab cuts a bar into slices wherever any track or voice starts a beat, and lists a beat
        // in every slice it is still ringing in. It is one beat: take it once. The start tick is part
        // of the key so a repeated bar is still taken again on its second pass.
        const beatKey = `${beat.id}@${startTick}`
        if (seenBeats.has(beatKey)) continue
        seenBeats.add(beatKey)
        const time = map.toSeconds(startTick)
        const end = map.toSeconds(startTick + beat.playbackDuration)
        const chordName = beat.hasChord ? (beat.chord?.name ?? undefined) : undefined
        // Notes the tab gives a string go first, so a note that still needs one cannot take theirs.
        const beatNotes = hasTab ? [...beat.notes].sort((a, b) => Number(b.isStringed) - Number(a.isStringed)) : beat.notes
        for (const n of beatNotes) {
          if (n.isTieDestination) {
            const origin = n.tieOrigin ? tieMap.get(n.tieOrigin) : undefined
            if (origin) {
              origin.duration = Math.max(origin.duration, end - origin.time)
              tieMap.set(n, origin)
            }
            continue
          }
          // A muted (dead) note is a click with no pitch. The scorer listens for pitches, so it could
          // only ever count one as missed: leave them out rather than ask for a note nobody can play.
          if (n.isDead) continue
          if (!n.isStringed && !n.isPiano) continue
          const midi = soundingPitch(at, n)
          if (!Number.isFinite(midi)) continue
          let position: DraftNote['position'] = null
          if (hasTab) {
            // alphaTab numbers strings from 1, lowest first.
            const string = n.isStringed ? n.string - 1 : -1
            if (string >= 0 && string < tuning.length && n.fret >= 0) {
              position = { string, fret: n.fret }
            } else {
              // A pitch with no string on a tab staff: put it on the lowest fret of a string that is free.
              const free = positionsFor(midi - capo, tuning, MAX_FRET).filter((p) => !struck.has(`${startTick}:${p.string}`))
              if (free.length === 0) continue
              position = free.reduce((best, p) => (p.fret < best.fret ? p : best), free[0])
            }
          }
          // Two voices can write the same string (or, without tab, the same pitch) at the same moment.
          // That is one sound: keep one note, lasting as long as the longer of the two.
          const struckKey = `${startTick}:${position ? position.string : `m${midi}`}`
          const same = struck.get(struckKey)
          if (same) {
            same.duration = Math.max(same.duration, end - time)
            tieMap.set(n, same)
            continue
          }
          const draft: DraftNote = {
            tick: startTick,
            time,
            duration: end - time,
            midi,
            velocity: Math.max(0.2, Math.min(1, 0.3 + 0.1 * (n.dynamics as number))),
            position,
            chordName,
            tech: techniquesOf(at, n),
          }
          drafts.push(draft)
          struck.set(struckKey, draft)
          tieMap.set(n, draft)
        }
      }
      bl = bl.nextBeat
    }
  }
  // A slice can list a beat that starts later before one that starts now (a voice that leaves a gap).
  drafts.sort((a, b) => a.tick - b.tick || (a.position?.string ?? 0) - (b.position?.string ?? 0))

  let notes: ChartNote[]
  if (hasTab) {
    // Everything that starts on the same tick is one stroke, whichever voice it was written in.
    let chordId = -1
    let chordTick = NaN
    notes = drafts.map((d, id) => {
      if (d.tick !== chordTick) {
        chordId++
        chordTick = d.tick
      }
      const { string, fret } = d.position!
      return { id, time: d.time, duration: Math.max(0.05, d.duration), midi: d.midi, string, fret, velocity: d.velocity, chordId, chordName: d.chordName, tech: d.tech }
    })
    const chordNames = new Map<number, string>()
    for (const n of notes) if (n.chordName) chordNames.set(n.chordId, n.chordName)
    for (const n of notes) n.chordName = chordNames.get(n.chordId)
  } else {
    const byOnset = new Map<string, DraftNote>()
    for (const d of drafts) byOnset.set(`${d.time}:${d.midi}`, d)
    notes = notesFromPitchEvents(
      drafts.map((d) => ({ time: d.time, duration: d.duration, midi: d.midi, velocity: d.velocity })),
      tuning,
    )
    if (drafts.length > 0 && notes.length === 0) throw new Error(OUT_OF_RANGE_MESSAGE)
    for (const n of notes) {
      const d = byOnset.get(`${n.time}:${n.midi}`)
      if (d?.chordName) n.chordName = d.chordName
      if (d?.tech) n.tech = d.tech
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
