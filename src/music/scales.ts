import { NOTE_INDEX } from './chords'

export type ScaleId = 'major' | 'natural-minor' | 'minor-pentatonic' | 'major-pentatonic' | 'blues'

export const SCALE_INTERVALS: Record<ScaleId, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  'major-pentatonic': [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
}

export interface ScaleNote {
  string: number
  fret: number
  midi: number
}

/** Pitch class 0–11 of a note name such as "A", "F#" or "Bb". */
export function pitchClassOf(note: string): number {
  const pc = NOTE_INDEX[note]
  if (pc === undefined) throw new Error(`Unknown note name: ${note}`)
  return pc
}

function sortNotes(notes: ScaleNote[]): ScaleNote[] {
  return notes.sort((a, b) => a.midi - b.midi || a.string - b.string)
}

/** Every scale tone playable with frets in [position, position + span], ascending by pitch. */
export function scalePositions(root: string, scale: ScaleId, position: number, tuning: number[], span = 4): ScaleNote[] {
  const rootPc = pitchClassOf(root)
  const pcs = new Set(SCALE_INTERVALS[scale].map((i) => (rootPc + i) % 12))
  const notes: ScaleNote[] = []
  const lo = Math.max(0, position)
  const hi = Math.min(24, position + span)
  for (let string = 0; string < tuning.length; string++) {
    for (let fret = lo; fret <= hi; fret++) {
      const midi = tuning[string] + fret
      if (pcs.has(midi % 12)) notes.push({ string, fret, midi })
    }
  }
  return sortNotes(notes)
}

/** Start of each box's fret window, relative to the root fret on the low string. */
const BOX_OFFSETS = [0, 2, 4, 7, 9]

/** The five standard minor-pentatonic boxes; box 1 has the root on string 0 under the index finger. */
export function pentatonicBox(root: string, box: 1 | 2 | 3 | 4 | 5, tuning: number[]): { position: number; notes: ScaleNote[] } {
  const rootPc = pitchClassOf(root)
  let rootFret = (((rootPc - tuning[0]) % 12) + 12) % 12
  if (rootFret === 0) rootFret = 12
  let position = rootFret + BOX_OFFSETS[box - 1]
  if (position + 3 > 24) position -= 12
  // Each box holds the two lowest scale tones at or above the position on every string.
  const pcs = new Set(SCALE_INTERVALS['minor-pentatonic'].map((i) => (rootPc + i) % 12))
  const notes: ScaleNote[] = []
  for (let string = 0; string < tuning.length; string++) {
    let found = 0
    for (let fret = position; fret <= 24 && found < 2; fret++) {
      const midi = tuning[string] + fret
      if (!pcs.has(midi % 12)) continue
      notes.push({ string, fret, midi })
      found++
    }
  }
  return { position, notes: sortNotes(notes) }
}
