/**
 * Chord shapes for standard tuning as [string, fret] pairs, lowest string = 0.
 * Only strings that are played are listed. Barre shapes are given at their
 * named position; `transposeShape` moves movable shapes.
 */
export type Shape = Array<[number, number]>

export interface ChordDef {
  name: string
  shape: Shape
  /** Movable barre/power shape (can be transposed with `transposeShape`). */
  movable?: boolean
  /** Difficulty hint 1–4 used by exercise generators. */
  difficulty: 1 | 2 | 3 | 4
}

export const CHORD_SHAPES: Record<string, ChordDef> = {
  E: { name: 'E', shape: [[0, 0], [1, 2], [2, 2], [3, 1], [4, 0], [5, 0]], difficulty: 1 },
  Em: { name: 'Em', shape: [[0, 0], [1, 2], [2, 2], [3, 0], [4, 0], [5, 0]], difficulty: 1 },
  A: { name: 'A', shape: [[1, 0], [2, 2], [3, 2], [4, 2], [5, 0]], difficulty: 1 },
  Am: { name: 'Am', shape: [[1, 0], [2, 2], [3, 2], [4, 1], [5, 0]], difficulty: 1 },
  D: { name: 'D', shape: [[2, 0], [3, 2], [4, 3], [5, 2]], difficulty: 1 },
  Dm: { name: 'Dm', shape: [[2, 0], [3, 2], [4, 3], [5, 1]], difficulty: 1 },
  G: { name: 'G', shape: [[0, 3], [1, 2], [2, 0], [3, 0], [4, 0], [5, 3]], difficulty: 2 },
  C: { name: 'C', shape: [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]], difficulty: 2 },
  E7: { name: 'E7', shape: [[0, 0], [1, 2], [2, 0], [3, 1], [4, 0], [5, 0]], difficulty: 2 },
  A7: { name: 'A7', shape: [[1, 0], [2, 2], [3, 0], [4, 2], [5, 0]], difficulty: 2 },
  D7: { name: 'D7', shape: [[2, 0], [3, 2], [4, 1], [5, 2]], difficulty: 2 },
  G7: { name: 'G7', shape: [[0, 3], [1, 2], [2, 0], [3, 0], [4, 0], [5, 1]], difficulty: 2 },
  C7: { name: 'C7', shape: [[1, 3], [2, 2], [3, 3], [4, 1], [5, 0]], difficulty: 3 },
  B7: { name: 'B7', shape: [[1, 2], [2, 1], [3, 2], [4, 0], [5, 2]], difficulty: 3 },
  Am7: { name: 'Am7', shape: [[1, 0], [2, 2], [3, 0], [4, 1], [5, 0]], difficulty: 2 },
  Em7: { name: 'Em7', shape: [[0, 0], [1, 2], [2, 0], [3, 0], [4, 0], [5, 0]], difficulty: 1 },
  Dm7: { name: 'Dm7', shape: [[2, 0], [3, 2], [4, 1], [5, 1]], difficulty: 2 },
  Cadd9: { name: 'Cadd9', shape: [[1, 3], [2, 2], [3, 0], [4, 3], [5, 3]], difficulty: 2 },
  Dsus4: { name: 'Dsus4', shape: [[2, 0], [3, 2], [4, 3], [5, 3]], difficulty: 1 },
  Asus2: { name: 'Asus2', shape: [[1, 0], [2, 2], [3, 2], [4, 0], [5, 0]], difficulty: 1 },
  F: { name: 'F', shape: [[0, 1], [1, 3], [2, 3], [3, 2], [4, 1], [5, 1]], movable: true, difficulty: 4 },
  Bm: { name: 'Bm', shape: [[1, 2], [2, 4], [3, 4], [4, 3], [5, 2]], movable: true, difficulty: 4 },
  Bb: { name: 'Bb', shape: [[1, 1], [2, 3], [3, 3], [4, 3], [5, 1]], movable: true, difficulty: 4 },
  Fm: { name: 'Fm', shape: [[0, 1], [1, 3], [2, 3], [3, 1], [4, 1], [5, 1]], movable: true, difficulty: 4 },
}

/** Two-note power chord (root + fifth) rooted on `string` at `fret`; add the octave with `threeNote`. */
export function powerChord(string: number, fret: number, threeNote = false): Shape {
  const shape: Shape = [
    [string, fret],
    [string + 1, fret + 2],
  ]
  if (threeNote) shape.push([string + 2, fret + 2])
  return shape
}

export function transposeShape(shape: Shape, semitones: number): Shape {
  return shape.map(([s, f]) => [s, f + semitones])
}

export const NOTE_INDEX: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }

/** Fret of pitch class `root` on `string` for a tuning, lowest fret ≥ minFret. */
export function rootFret(root: string, string: number, tuning: number[], minFret = 0): number {
  const pc = NOTE_INDEX[root]
  if (pc === undefined) throw new Error(`Unknown note ${root}`)
  const open = ((tuning[string] % 12) + 12) % 12
  let fret = (pc - open + 12) % 12
  while (fret < minFret) fret += 12
  return fret
}
