/**
 * String/fret assignment for notes that only have a pitch (MIDI files, audio
 * transcriptions). A Viterbi search over per-event voicings minimises a
 * fingering cost: stay in low positions, keep chords within a hand span and
 * avoid big jumps between notes that are close in time.
 */

export interface FretPosition {
  /** 0 = lowest string. */
  string: number
  fret: number
}

export interface FretAssignOptions {
  maxFret?: number
  /** Maximum fret span for fretted notes within one chord. */
  maxSpan?: number
  /** Maximum voicings considered per chord. */
  maxVoicings?: number
}

export interface FretEvent {
  time: number
  midis: number[]
}

export function positionsFor(midi: number, tuning: number[], maxFret: number): FretPosition[] {
  const out: FretPosition[] = []
  for (let s = 0; s < tuning.length; s++) {
    const fret = midi - tuning[s]
    if (fret >= 0 && fret <= maxFret) out.push({ string: s, fret })
  }
  return out
}

function voicingCost(v: FretPosition[]): number {
  const fretted = v.filter((p) => p.fret > 0)
  if (fretted.length === 0) return 0
  let lo = Infinity
  let hi = -Infinity
  let sum = 0
  for (const p of fretted) {
    if (p.fret < lo) lo = p.fret
    if (p.fret > hi) hi = p.fret
    sum += p.fret
  }
  const mean = sum / fretted.length
  let cost = 0.03 * mean
  if (mean > 12) cost += 0.2 + (0.15 * (mean - 12)) / 12
  if (hi - lo > 3) cost += 0.25 * (hi - lo - 3)
  const opens = v.length - fretted.length
  if (opens > 0 && mean > 5) cost += 0.4
  return cost
}

function voicingPosition(v: FretPosition[]): number | null {
  let sum = 0
  let n = 0
  for (const p of v) {
    if (p.fret > 0) {
      sum += p.fret
      n++
    }
  }
  return n === 0 ? null : sum / n
}

function transitionCost(prev: FretPosition[], next: FretPosition[], dt: number): number {
  let cost = 0
  const a = voicingPosition(prev)
  const b = voicingPosition(next)
  if (a !== null && b !== null) {
    const w = dt < 0.12 ? 0.3 : dt < 0.3 ? 0.2 : dt < 1 ? 0.1 : 0.03
    cost += Math.abs(a - b) * w
  }
  if (dt < 0.25 && prev.length === 1 && next.length === 1) {
    cost += 0.02 * Math.abs(prev[0].string - next[0].string)
  }
  return cost
}

/**
 * Enumerates playable voicings for a set of pitches (ascending pitch on
 * ascending strings, distinct strings, fretted notes within `maxSpan`).
 * Returns voicings aligned with the *sorted unique* input pitches; when a set
 * cannot be voiced, the highest pitches are dropped until it can (those
 * positions are `null`).
 */
export function chordVoicings(
  midis: number[],
  tuning: number[],
  opts: Required<FretAssignOptions>,
): { pitches: number[]; voicings: (FretPosition | null)[][] } {
  const sorted = [...new Set(midis)].sort((a, b) => a - b)
  // Pitches outside the instrument's range can never be placed; search over the rest.
  const playable = sorted.filter((m) => positionsFor(m, tuning, opts.maxFret).length > 0)
  const expand = (v: FretPosition[], dropped: number): (FretPosition | null)[] => {
    const kept = [...v, ...new Array<null>(dropped).fill(null)]
    let k = 0
    return sorted.map((m) => (positionsFor(m, tuning, opts.maxFret).length > 0 ? kept[k++] : null))
  }
  let keep = playable.length
  while (keep > 0) {
    const subset = playable.slice(0, keep)
    const found: FretPosition[][] = []
    const current: FretPosition[] = []
    const search = (idx: number, minString: number) => {
      if (found.length >= opts.maxVoicings * 6) return
      if (idx === subset.length) {
        found.push([...current])
        return
      }
      for (const p of positionsFor(subset[idx], tuning, opts.maxFret)) {
        if (p.string < minString) continue
        if (p.fret > 0) {
          let lo = p.fret
          let hi = p.fret
          for (const c of current) {
            if (c.fret > 0) {
              if (c.fret < lo) lo = c.fret
              if (c.fret > hi) hi = c.fret
            }
          }
          if (hi - lo > opts.maxSpan) continue
        }
        current.push(p)
        search(idx + 1, p.string + 1)
        current.pop()
      }
    }
    search(0, 0)
    if (found.length > 0) {
      found.sort((x, y) => voicingCost(x) - voicingCost(y))
      const dropped = playable.length - keep
      const voicings = found.slice(0, opts.maxVoicings).map((v) => expand(v, dropped))
      return { pitches: sorted, voicings }
    }
    keep--
  }
  return { pitches: sorted, voicings: [new Array<null>(sorted.length).fill(null)] }
}

/**
 * Assigns string/fret to every pitch of every event. The result is aligned
 * with each event's `midis` array; `null` means the pitch is unplayable in
 * this tuning and should be dropped.
 */
export function assignFrets(events: FretEvent[], tuning: number[], options: FretAssignOptions = {}): (FretPosition | null)[][] {
  const opts: Required<FretAssignOptions> = {
    maxFret: options.maxFret ?? 22,
    maxSpan: options.maxSpan ?? 4,
    maxVoicings: options.maxVoicings ?? 16,
  }
  if (events.length === 0) return []

  // Candidate voicings per event, aligned to sorted unique pitches.
  const candidates = events.map((ev) => chordVoicings(ev.midis, tuning, opts))

  // Viterbi over events.
  let prevCosts = candidates[0].voicings.map((v) => voicingCost(v.filter((p): p is FretPosition => p !== null)))
  const back: Int32Array[] = [new Int32Array(prevCosts.length)]
  for (let i = 1; i < events.length; i++) {
    const dt = Math.max(0, events[i].time - events[i - 1].time)
    const cur = candidates[i].voicings
    const prev = candidates[i - 1].voicings
    const costs = new Array<number>(cur.length)
    const bp = new Int32Array(cur.length)
    for (let k = 0; k < cur.length; k++) {
      const curV = cur[k].filter((p): p is FretPosition => p !== null)
      const emission = voicingCost(curV)
      let best = Infinity
      let bestJ = 0
      for (let j = 0; j < prev.length; j++) {
        const prevV = prev[j].filter((p): p is FretPosition => p !== null)
        const c = prevCosts[j] + transitionCost(prevV, curV, dt)
        if (c < best) {
          best = c
          bestJ = j
        }
      }
      costs[k] = best + emission
      bp[k] = bestJ
    }
    back.push(bp)
    prevCosts = costs
  }

  // Backtrack.
  const chosen = new Int32Array(events.length)
  let bestK = 0
  for (let k = 1; k < prevCosts.length; k++) if (prevCosts[k] < prevCosts[bestK]) bestK = k
  chosen[events.length - 1] = bestK
  for (let i = events.length - 1; i > 0; i--) chosen[i - 1] = back[i][chosen[i]]

  // Map back to the original (unsorted, possibly duplicated) pitch order.
  return events.map((ev, i) => {
    const { pitches, voicings } = candidates[i]
    const v = voicings[chosen[i]]
    return ev.midis.map((m) => {
      const idx = pitches.indexOf(m)
      return idx >= 0 ? v[idx] : null
    })
  })
}

/** Lowest-fret position for a single pitch (used for display hints). */
export function simplestPosition(midi: number, tuning: number[], maxFret = 22): FretPosition | null {
  let best: FretPosition | null = null
  for (const p of positionsFor(midi, tuning, maxFret)) {
    if (!best || p.fret < best.fret) best = p
  }
  return best
}
