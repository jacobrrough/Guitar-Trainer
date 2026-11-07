import { groupNotes, type NoteGroup } from './events'
import { findBeatIndex } from './timing'
import { chartBpm, type Chart, type ChartNote } from './types'

export type ChordMode = 'root' | 'power' | 'triad' | 'full'

export interface LevelDef {
  level: number
  label: string
  /** Fraction of note groups to keep (by salience). */
  keep: number
  chordMode: ChordMode
  /** Minimum spacing between kept groups, in beats. */
  minGapBeats: number
}

/**
 * Yousician/Rocksmith-style progression: lower levels keep only the most
 * structurally important notes (downbeats, long notes, phrase starts) and
 * simplify chords to their root, then power chords, then full voicings.
 */
export const LEVELS: LevelDef[] = [
  { level: 1, label: 'Level 1', keep: 0.15, chordMode: 'root', minGapBeats: 0.5 },
  { level: 2, label: 'Level 2', keep: 0.3, chordMode: 'root', minGapBeats: 0.5 },
  { level: 3, label: 'Level 3', keep: 0.5, chordMode: 'power', minGapBeats: 0.25 },
  { level: 4, label: 'Level 4', keep: 0.7, chordMode: 'triad', minGapBeats: 0 },
  { level: 5, label: 'Level 5', keep: 0.85, chordMode: 'full', minGapBeats: 0 },
  { level: 6, label: 'Full', keep: 1, chordMode: 'full', minGapBeats: 0 },
]

export interface SalientGroup extends NoteGroup {
  salience: number
  bar: number
  beatLength: number
}

const TOL = 0.1

function beatStrength(frac: number, isDownbeat: boolean, beatInBar: number, beatsInBar: number): number {
  if (frac < TOL || frac > 1 - TOL) {
    if (isDownbeat) return 1
    if (beatsInBar >= 4 && beatInBar === Math.floor(beatsInBar / 2)) return 0.85
    return 0.7
  }
  if (Math.abs(frac - 0.5) < TOL) return 0.5
  if (Math.abs(frac - 1 / 3) < TOL || Math.abs(frac - 2 / 3) < TOL) return 0.35
  if (Math.abs(frac - 0.25) < TOL || Math.abs(frac - 0.75) < TOL) return 0.3
  return 0.2
}

/** Scores every note group of the chart by how important it is to the song's skeleton. */
export function scoreGroups(chart: Chart): SalientGroup[] {
  const groups = groupNotes(chart.notes)
  const beats = chart.beats
  const defaultBeat = 60 / chartBpm(chart)
  let lastEnd = -Infinity
  return groups.map((g) => {
    const idx = findBeatIndex(beats, g.time)
    let strength = 0.5
    let beatLength = defaultBeat
    let bar = 0
    if (idx >= 0) {
      const beat = beats[idx]
      const next = beats[idx + 1]
      beatLength = next ? Math.max(1e-3, next.time - beat.time) : beatLength
      const frac = (g.time - beat.time) / beatLength
      let beatsInBar = 4
      for (let j = idx; j < beats.length && beats[j].bar === beat.bar; j++) beatsInBar = beats[j].beatInBar + 1
      for (let j = idx; j >= 0 && beats[j].bar === beat.bar; j--) beatsInBar = Math.max(beatsInBar, beats[j].beatInBar + 1)
      strength = beatStrength(frac, beat.isDownbeat, beat.beatInBar, beatsInBar)
      bar = beat.bar
    } else {
      bar = Math.floor(g.time / (beatLength * 4))
    }
    let bonus = 0
    const longest = Math.max(...g.notes.map((n) => n.duration))
    if (longest >= 2 * beatLength) bonus += 0.25
    else if (longest >= beatLength) bonus += 0.15
    if (g.time - lastEnd >= beatLength) bonus += 0.1
    if (g.notes.length >= 3) bonus += 0.05
    if (Math.max(...g.notes.map((n) => n.velocity)) > 0.85) bonus += 0.05
    lastEnd = Math.max(lastEnd, g.time + longest)
    return { ...g, salience: Math.min(1.5, strength + bonus), bar, beatLength }
  })
}

export function reduceChord(notes: ChartNote[], mode: ChordMode): ChartNote[] {
  if (notes.length <= 1 || mode === 'full') return notes
  const sorted = [...notes].sort((a, b) => a.midi - b.midi)
  switch (mode) {
    case 'root':
      return [sorted[0]]
    case 'power': {
      if (sorted.length === 2) return sorted
      const root = sorted[0]
      const pick = (interval: number) => sorted.find((n) => n !== root && (n.midi - root.midi) % 12 === interval)
      const fifth = pick(7) ?? pick(0) ?? pick(5)
      return fifth ? [root, fifth] : [root]
    }
    case 'triad':
      return sorted.slice(0, 3)
  }
}

export function generateLevel(chart: Chart, def: LevelDef, scored: SalientGroup[] = scoreGroups(chart)): Chart {
  if (def.keep >= 1 && def.chordMode === 'full' && def.minGapBeats === 0) return chart

  const ranked = [...scored].sort((a, b) => b.salience - a.salience || a.time - b.time)
  const target = Math.max(1, Math.ceil(def.keep * ranked.length))
  const selected = new Set<SalientGroup>(ranked.slice(0, target))

  // Every bar keeps its most important group so the player always has an anchor.
  const bestInBar = new Map<number, SalientGroup>()
  for (const g of scored) {
    const cur = bestInBar.get(g.bar)
    if (!cur || g.salience > cur.salience) bestInBar.set(g.bar, g)
  }
  for (const g of bestInBar.values()) selected.add(g)

  // Enforce minimum spacing, keeping the more salient of two close groups.
  const inTime = [...selected].sort((a, b) => a.time - b.time)
  const kept: SalientGroup[] = []
  for (const g of inTime) {
    const last = kept[kept.length - 1]
    if (last && g.time - last.time < def.minGapBeats * g.beatLength - 1e-6) {
      if (g.salience > last.salience) {
        kept.pop()
        kept.push(g)
      }
      continue
    }
    kept.push(g)
  }

  const notes: ChartNote[] = []
  for (const g of kept) {
    for (const n of reduceChord(g.notes, def.chordMode)) notes.push(n)
  }
  notes.sort((a, b) => a.time - b.time || a.string - b.string)
  return { ...chart, notes }
}

export function generateLevels(chart: Chart): Chart[] {
  const scored = scoreGroups(chart)
  return LEVELS.map((def) => generateLevel(chart, def, scored))
}

/** Suggests a starting level from the chart's density (notes per second). */
export function suggestedLevel(chart: Chart): number {
  if (chart.duration <= 0) return 1
  const nps = chart.notes.length / chart.duration
  if (nps < 1) return 4
  if (nps < 2) return 3
  if (nps < 3.5) return 2
  return 1
}
