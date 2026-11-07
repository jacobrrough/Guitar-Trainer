import type { ChartNote } from './types'

export interface NoteGroup {
  time: number
  chordId: number
  notes: ChartNote[]
}

/** Groups notes by chordId (notes struck together), in time order. */
export function groupNotes(notes: ChartNote[]): NoteGroup[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.chordId - b.chordId || a.string - b.string)
  const groups: NoteGroup[] = []
  const byId = new Map<number, NoteGroup>()
  for (const n of sorted) {
    let g = byId.get(n.chordId)
    if (!g) {
      g = { time: n.time, chordId: n.chordId, notes: [] }
      byId.set(n.chordId, g)
      groups.push(g)
    }
    g.notes.push(n)
  }
  return groups
}

/** Assigns chordIds to time-sorted notes by onset proximity. Returns the same array. */
export function assignChordIdsByTime<T extends { time: number; chordId?: number }>(notes: T[], tolerance = 0.03): T[] {
  notes.sort((a, b) => a.time - b.time)
  let id = -1
  let groupStart = -Infinity
  for (const n of notes) {
    if (n.time - groupStart > tolerance) {
      id++
      groupStart = n.time
    }
    n.chordId = id
  }
  return notes
}
