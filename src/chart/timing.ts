import type { Beat } from './types'

export interface TickTempo {
  tick: number
  bpm: number
}

/** Piecewise-constant tempo map from MIDI ticks to seconds. */
export class TickTimeMap {
  private readonly points: { tick: number; bpm: number; time: number }[] = []
  readonly ticksPerQuarter: number

  constructor(initialBpm: number, changes: TickTempo[], ticksPerQuarter: number) {
    this.ticksPerQuarter = ticksPerQuarter
    const byTick = new Map<number, number>()
    byTick.set(0, initialBpm > 0 ? initialBpm : 120)
    for (const c of changes) {
      if (c.bpm > 0 && c.tick >= 0) byTick.set(c.tick, c.bpm)
    }
    const ticks = [...byTick.keys()].sort((a, b) => a - b)
    let time = 0
    let prevTick = 0
    let prevBpm = byTick.get(0)!
    for (const tick of ticks) {
      time += ((tick - prevTick) / ticksPerQuarter) * (60 / prevBpm)
      const bpm = byTick.get(tick)!
      this.points.push({ tick, bpm, time })
      prevTick = tick
      prevBpm = bpm
    }
  }

  toSeconds(tick: number): number {
    const pts = this.points
    let lo = 0
    let hi = pts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pts[mid].tick <= tick) lo = mid
      else hi = mid - 1
    }
    const p = pts[lo]
    return p.time + ((tick - p.tick) / this.ticksPerQuarter) * (60 / p.bpm)
  }

  bpmAt(tick: number): number {
    let bpm = this.points[0].bpm
    for (const p of this.points) {
      if (p.tick <= tick) bpm = p.bpm
      else break
    }
    return bpm
  }
}

export interface BarSpec {
  startTick: number
  endTick: number
  numerator: number
  denominator: number
}

export function beatsFromBars(bars: BarSpec[], map: TickTimeMap): Beat[] {
  const beats: Beat[] = []
  bars.forEach((bar, barIndex) => {
    const beatTicks = (map.ticksPerQuarter * 4) / bar.denominator
    for (let b = 0; b < bar.numerator; b++) {
      const tick = bar.startTick + b * beatTicks
      if (tick >= bar.endTick - 1) break
      beats.push({ time: map.toSeconds(tick), bar: barIndex, beatInBar: b, isDownbeat: b === 0 })
    }
  })
  return beats
}

/** Constant-tempo grid anchored on a known downbeat time. */
export function constantBeatGrid(bpm: number, downbeatTime: number, duration: number, beatsPerBar = 4): Beat[] {
  const period = 60 / bpm
  // Step back whole bars until the grid covers the start of the song; the first
  // bar may be a partial pickup bar whose early beats fall before time zero.
  let first = downbeatTime
  while (first > 1e-6) first -= period * beatsPerBar
  const beats: Beat[] = []
  let bar = 0
  for (let t = first; t < duration; t += period * beatsPerBar, bar++) {
    for (let b = 0; b < beatsPerBar; b++) {
      const time = t + b * period
      if (time < -1e-6 || time >= duration) continue
      beats.push({ time: Math.max(0, time), bar, beatInBar: b, isDownbeat: b === 0 })
    }
  }
  return beats
}

/** Index of the last beat at or before `time`, or -1. */
export function findBeatIndex(beats: Beat[], time: number): number {
  let lo = 0
  let hi = beats.length - 1
  if (hi < 0 || beats[0].time > time) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (beats[mid].time <= time) lo = mid
    else hi = mid - 1
  }
  return lo
}
