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
 * simplify chords to their root, then two strings next to each other, then
 * three, then the full shape (see `reduceChord`).
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
/** Seconds: far below any real note spacing, far above floating-point rounding. */
const BEAT_SNAP = 1e-6

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
    // Note times and beat times are worked out in different ways and can differ by a rounding error.
    // A note a hair before its beat belongs to that beat, not to the end of the one before.
    const idx = findBeatIndex(beats, g.time + BEAT_SNAP)
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

const MODES: ChordMode[] = ['root', 'power', 'triad', 'full']

/**
 * Thins a chord for the easier levels. Each mode contains the one before it (root, then two strings,
 * then three, then the whole shape), so moving up a level only ever adds notes to a chord.
 */
export function reduceChord(notes: ChartNote[], mode: ChordMode): ChartNote[] {
  if (notes.length <= 1 || mode === 'full') return notes
  const sorted = [...notes].sort((a, b) => a.midi - b.midi)
  const root = sorted[0]
  if (mode === 'root') return [root]
  // Two strings that can be strummed together: the root and the chord's note on the string next to it.
  // The fifth of an open G or C lies two strings away, and the string between would ring too, so the
  // neighbour is taken whatever note it is; a root with no neighbour in the shape stays alone.
  const neighbour = sorted.find((n) => n.string === root.string + 1) ?? sorted.find((n) => n.string === root.string - 1)
  const pair = sorted.length === 2 ? sorted : neighbour ? [root, neighbour] : [root]
  if (mode === 'power') return pair
  const lowestOfRest = sorted.filter((n) => !pair.includes(n)).slice(0, 3 - pair.length)
  return sorted.filter((n) => pair.includes(n) || lowestOfRest.includes(n))
}

const isFullLevel = (def: LevelDef) => def.keep >= 1 && def.chordMode === 'full' && def.minGapBeats === 0

/** The lowest level: the most important groups, one anchor in every bar, never two closer than the spacing. */
function baseGroups(scored: SalientGroup[], ranked: SalientGroup[], def: LevelDef): SalientGroup[] {
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
  return kept
}

/** Where `time` belongs in the time-ordered `kept`. */
function insertionIndex(kept: SalientGroup[], time: number): number {
  let lo = 0
  let hi = kept.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (kept[mid].time <= time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * A level above the lowest: everything the level below keeps, plus the next most important groups.
 * It adds its usual share of whatever the level below left out. A share of the whole chart is not
 * enough: in a short tune the one-per-bar anchors are already more than the lower shares, and the
 * levels would come out identical. `levelsAbove` groups are left for the levels still to come, so a
 * short tune does not use its last notes early and repeat itself at the top.
 */
function addGroups(ranked: SalientGroup[], def: LevelDef, below: SalientGroup[], belowKeep: number, levelsAbove: number): SalientGroup[] {
  const kept = [...below]
  const have = new Set(below)
  const left = ranked.length - kept.length
  const share = belowKeep < 1 ? Math.min(1, Math.max(0, (def.keep - belowKeep) / (1 - belowKeep))) : 1
  const wanted = Math.max(Math.ceil(def.keep * ranked.length), kept.length + Math.ceil(share * left - 1e-9))
  const target = Math.min(wanted, Math.max(kept.length + 1, ranked.length - levelsAbove))
  for (const g of ranked) {
    if (kept.length >= target) break
    if (have.has(g)) continue
    if (def.minGapBeats <= 0) {
      kept.push(g)
      continue
    }
    // Keep the spacing on both sides, measured the same way as for the lowest level.
    const at = insertionIndex(kept, g.time)
    const before = kept[at - 1]
    const after = kept[at]
    if (before && g.time - before.time < def.minGapBeats * g.beatLength - 1e-6) continue
    if (after && after.time - g.time < def.minGapBeats * after.beatLength - 1e-6) continue
    kept.splice(at, 0, g)
  }
  return def.minGapBeats <= 0 ? kept.sort((a, b) => a.time - b.time) : kept
}

function levelNotes(groups: SalientGroup[], mode: ChordMode): ChartNote[] {
  const notes: ChartNote[] = []
  for (const g of groups) {
    for (const n of reduceChord(g.notes, mode)) notes.push(n)
  }
  return notes.sort((a, b) => a.time - b.time || a.string - b.string)
}

/** What the next level up builds on. */
interface BuiltLevel {
  groups: SalientGroup[]
  /** Index into MODES of the chord mode used. */
  mode: number
  keep: number
  /** Number of notes shown. */
  count: number
}

/**
 * Builds the levels in `defs` (easiest first) so that each one contains the one below it and, while the
 * chart still has notes the level below does not show, adds at least one of them.
 */
function buildLevels(chart: Chart, defs: LevelDef[], scored: SalientGroup[]): Chart[] {
  const ranked = [...scored].sort((a, b) => b.salience - a.salience || a.time - b.time)
  const out: Chart[] = []
  let below: BuiltLevel | null = null
  for (const [i, def] of defs.entries()) {
    if (isFullLevel(def) || (below && below.count >= chart.notes.length)) {
      out.push(chart)
      below = { groups: scored, mode: MODES.length - 1, keep: 1, count: chart.notes.length }
      continue
    }
    let groups: SalientGroup[] = below ? addGroups(ranked, def, below.groups, below.keep, defs.length - 1 - i) : baseGroups(scored, ranked, def)
    // A level never shows less of a chord than the one below. A song strummed with chords its player
    // has been taught (`wholeChords`) shows them whole at every level: only the strums are thinned.
    let mode: number = chart.wholeChords ? MODES.length - 1 : Math.max(MODES.indexOf(def.chordMode), below?.mode ?? 0)
    let notes = levelNotes(groups, MODES[mode])
    if (below && notes.length <= below.count) {
      // The usual rules added nothing (every group left is too close to one already kept, or none is
      // left). Show more of the chords instead; in a tune without chords, take the best group left
      // even though it is close.
      for (let fuller = mode + 1; fuller < MODES.length && notes.length <= below.count; fuller++) {
        const tried = levelNotes(groups, MODES[fuller])
        if (tried.length > below.count) {
          mode = fuller
          notes = tried
        }
      }
      const next = notes.length <= below.count ? ranked.find((g) => !groups.includes(g)) : undefined
      if (next) {
        groups = [...groups, next].sort((a, b) => a.time - b.time)
        notes = levelNotes(groups, MODES[mode])
      }
    }
    // When everything is in, hand back the chart itself, as the full level does.
    out.push(notes.length >= chart.notes.length ? chart : { ...chart, notes })
    below = { groups, mode, keep: def.keep, count: notes.length }
  }
  return out
}

/** One level of the chart: `def` in its place among LEVELS, so it contains the levels below it and matches `generateLevels`. */
export function generateLevel(chart: Chart, def: LevelDef, scored: SalientGroup[] = scoreGroups(chart)): Chart {
  if (isFullLevel(def)) return chart
  const lower = LEVELS.filter((d) => d.level < def.level)
  return buildLevels(chart, [...lower, def, ...LEVELS.filter((d) => d.level > def.level)], scored)[lower.length]
}

/**
 * The chart at every level in LEVELS, easiest first. Each level contains the one below and adds to it
 * for as long as the chart has more notes to give; once a level shows the whole chart, the levels above
 * are that same chart again (see `distinctLevels`).
 */
export function generateLevels(chart: Chart): Chart[] {
  return buildLevels(chart, LEVELS, scoreGroups(chart))
}

/**
 * Indexes of the levels worth offering: the first, and every level that has more notes than the one
 * below it. A short tune runs out of notes before it runs out of levels, and the levels left over are
 * copies of the full chart; a level picker or a "move up a level" step can skip them with this.
 */
export function distinctLevels(levels: Chart[]): number[] {
  const distinct: number[] = []
  levels.forEach((level, i) => {
    if (i === 0 || level.notes.length !== levels[i - 1].notes.length || level.notes.some((n, j) => n.id !== levels[i - 1].notes[j].id)) distinct.push(i)
  })
  return distinct
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
