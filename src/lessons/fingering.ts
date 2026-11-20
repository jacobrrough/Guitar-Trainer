import type { ChartNote } from '../chart/types'
import { CHORD_SHAPES } from '../music/chords'

export type Finger = 1 | 2 | 3 | 4

/**
 * Which finger presses which string in each beginner chord (string index, 0 = thickest; 1 = index
 * finger … 4 = little finger). The chord boxes, the lesson text and the finger numbers on the notes
 * all read this one table, so they cannot tell the learner different things.
 *
 * These are the fingerings a first-week beginner is usually taught: no little finger, and G shares its
 * third finger on the thinnest string with D7 and D.
 */
export const CHORD_FINGERS: Record<string, Record<number, Finger>> = {
  Em: { 1: 2, 2: 3 },
  E: { 1: 2, 2: 3, 3: 1 },
  Am: { 2: 2, 3: 3, 4: 1 },
  A: { 2: 1, 3: 2, 4: 3 },
  D: { 3: 1, 4: 3, 5: 2 },
  Dm: { 3: 2, 4: 3, 5: 1 },
  G: { 0: 2, 1: 1, 5: 3 },
  C: { 1: 3, 2: 2, 4: 1 },
  D7: { 3: 2, 4: 1, 5: 3 },
  A7: { 2: 2, 4: 3 },
  E7: { 1: 2, 3: 1 },
  G7: { 0: 3, 1: 2, 5: 1 },
}

/** Finger per fretted string of a chord: the taught fingering, or a plain low-to-high guess for other shapes. */
export function chordFingers(name: string): Record<number, Finger> {
  const known = CHORD_FINGERS[name]
  if (known) return known
  const fretted = (CHORD_SHAPES[name]?.shape ?? []).filter(([, f]) => f > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const out: Record<number, Finger> = {}
  fretted.forEach(([s], i) => {
    out[s] = Math.min(i + 1, 4) as Finger
  })
  return out
}

/** "6th" for string index 0, "1st" for string index 5. */
export function stringOrdinal(string: number): string {
  return ['6th', '5th', '4th', '3rd', '2nd', '1st'][string] ?? `${6 - string}th`
}

/** One fretted string of a chord in words: "the 5th string at fret 2 with finger 2". */
export function pressPhrase(string: number, fret: number, finger: Finger): string {
  return `the ${stringOrdinal(string)} string at fret ${fret} with finger ${finger}`
}

/**
 * The sentence that tells the learner where the fingers of a chord go, thickest string first:
 * "Press the 5th string at fret 2 with finger 2, and the 4th string at fret 2 with finger 3."
 */
export function fingeringSentence(name: string): string {
  const def = CHORD_SHAPES[name]
  if (!def) throw new Error(`Unknown chord ${name}`)
  const fingers = chordFingers(name)
  const parts = def.shape.filter(([, f]) => f > 0).map(([s, f]) => pressPhrase(s, f, fingers[s]))
  if (parts.length === 1) return `Press ${parts[0]}.`
  return `Press ${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`
}

/** Puts the taught finger number on every fretted note of a named chord, so the note lanes agree with the chord box. */
export function withChordFingers(notes: ChartNote[]): ChartNote[] {
  return notes.map((n) => {
    if (!n.chordName || n.fret <= 0) return n
    const finger = CHORD_FINGERS[n.chordName]?.[n.string]
    return finger && CHORD_SHAPES[n.chordName]?.shape.some(([s, f]) => s === n.string && f === n.fret) ? { ...n, finger } : n
  })
}

export type Handedness = 'right' | 'left'

/**
 * Lesson text is written for a right-handed player, with every left or right that depends on how the
 * guitar is held marked as {left} or {right}. A left-handed player holds it the other way round (and
 * sees mirrored pictures), so for them the two words swap.
 */
export function forHand(text: string, handedness: Handedness): string {
  return text.replace(/\{(left|right)\}/g, (_match, side: string) => (handedness === 'right' ? side : side === 'left' ? 'right' : 'left'))
}
