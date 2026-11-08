import type { OctaveTolerance } from '../../app/settings'
import { groupNotes, type NoteGroup } from '../../chart/events'
import type { Beat, ChartNote } from '../../chart/types'
import { findBeatIndex } from '../../chart/timing'
import { WEAK_BAR_ACCURACY } from '../../training/constants'
import type { AttemptResult } from '../../training/types'

/** Timing windows in seconds of real time (scaled by playback speed into song time). */
export interface HitWindow {
  perfect: number
  good: number
  /** How early a note may be played. */
  early: number
  /** How late a note may be played before it counts as missed. */
  late: number
}

export const DEFAULT_WINDOW: HitWindow = { perfect: 0.045, good: 0.1, early: 0.13, late: 0.17 }

export type GroupStatus = 'pending' | 'hit' | 'miss' | 'skipped'
export type Judgement = 'perfect' | 'good'

export interface GroupState {
  group: NoteGroup
  status: GroupStatus
  judgement?: Judgement
  /** Signed timing error in seconds (positive = late). */
  delta?: number
  /** Song time at which the group was hit. */
  hitAt?: number
}

export interface ScoreSummary {
  score: number
  streak: number
  maxStreak: number
  multiplier: number
  perfects: number
  goods: number
  misses: number
  /** Groups that count (not skipped). */
  total: number
  /** Groups resolved so far. */
  judged: number
  /** Hits / judged so far (0..1). */
  accuracy: number
}

export interface ScoreOptions {
  window?: Partial<HitWindow>
  octaveTolerance?: OctaveTolerance
  /** Pitch tolerance in cents. */
  centsTolerance?: number
  /** Beat grid; enables per-bar statistics. */
  beats?: Beat[]
}

export function pitchMatches(detected: number, target: number, toleranceSemis: number, allowOctave: boolean): boolean {
  const d = detected - target
  if (Math.abs(d) <= toleranceSemis) return true
  return allowOctave && (Math.abs(d - 12) <= toleranceSemis || Math.abs(d + 12) <= toleranceSemis)
}

export class ScoreTracker {
  readonly groups: GroupState[]
  private readonly byNote = new Map<number, GroupState>()
  private readonly baseWindow: HitWindow
  private readonly octave: OctaveTolerance
  private readonly tolerance: number
  private speed = 1
  private cursor = 0
  /** Bar index per group (parallel to groups); empty when no beats were given. */
  private readonly groupBars: number[] = []
  private readonly hasBeats: boolean
  private covCursor = 0
  private expectedFrames = 0
  private heardFrames = 0
  private lastHit: { midi: number; time: number } | null = null
  /** True once a new pick (attack), silence or a different pitch has been heard since the last hit. */
  private armed = true
  score = 0
  streak = 0
  maxStreak = 0
  perfects = 0
  goods = 0
  misses = 0

  constructor(notes: ChartNote[], opts: ScoreOptions = {}) {
    this.groups = groupNotes(notes).map((group) => ({ group, status: 'pending' as GroupStatus }))
    for (const g of this.groups) for (const n of g.group.notes) this.byNote.set(n.id, g)
    this.baseWindow = { ...DEFAULT_WINDOW, ...opts.window }
    this.octave = opts.octaveTolerance ?? 'chords'
    this.tolerance = (opts.centsTolerance ?? 60) / 100
    const beats = opts.beats
    this.hasBeats = !!beats && beats.length > 0
    if (beats && this.hasBeats) {
      for (const g of this.groups) {
        const idx = findBeatIndex(beats, g.group.time)
        this.groupBars.push(idx < 0 ? 0 : beats[idx].bar)
      }
    }
  }

  /** Playback speed (1 = normal). Windows shrink in song time when playing slower. */
  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, speed)
  }

  get window(): HitWindow {
    const s = this.speed
    return { perfect: this.baseWindow.perfect * s, good: this.baseWindow.good * s, early: this.baseWindow.early * s, late: this.baseWindow.late * s }
  }

  get multiplier(): number {
    return 1 + Math.min(3, Math.floor(this.streak / 10))
  }

  stateOfNote(noteId: number): GroupState | undefined {
    return this.byNote.get(noteId)
  }

  reset(): void {
    for (const g of this.groups) {
      g.status = 'pending'
      delete g.judgement
      delete g.delta
      delete g.hitAt
    }
    this.cursor = 0
    this.covCursor = 0
    this.expectedFrames = 0
    this.heardFrames = 0
    this.lastHit = null
    this.armed = true
    this.score = 0
    this.streak = 0
    this.maxStreak = 0
    this.perfects = 0
    this.goods = 0
    this.misses = 0
  }

  /** Resets and marks everything before `songTime` as skipped (not counted). */
  seek(songTime: number): void {
    this.reset()
    while (this.cursor < this.groups.length && this.groups[this.cursor].group.time < songTime - this.window.late) {
      this.groups[this.cursor].status = 'skipped'
      this.cursor++
    }
  }

  /** Resolves groups whose window has closed. Returns the newly missed groups. */
  advance(songTime: number): GroupState[] {
    const missed: GroupState[] = []
    const late = this.window.late
    while (this.cursor < this.groups.length) {
      const g = this.groups[this.cursor]
      if (g.group.time >= songTime - late) break
      if (g.status === 'pending') {
        g.status = 'miss'
        this.misses++
        this.streak = 0
        missed.push(g)
      }
      this.cursor++
    }
    return missed
  }

  /** True when the detected pitch belongs to a pending note inside the window (used for feedback only). */
  isUpcomingPitch(midi: number, songTime: number): boolean {
    const w = this.window
    for (let i = this.cursor; i < this.groups.length; i++) {
      const g = this.groups[i]
      if (g.group.time > songTime + w.early) break
      if (g.status !== 'pending' || songTime - g.group.time > w.late) continue
      if (this.matches(g, midi)) return true
    }
    return false
  }

  private matches(g: GroupState, midi: number): boolean {
    const isChord = g.group.notes.length > 1
    const allowOctave = this.octave === 'all' || (this.octave === 'chords' && isChord)
    return g.group.notes.some((n) => pitchMatches(midi, n.midi, this.tolerance, allowOctave))
  }

  /** Call when the detector hears nothing: the next note of the same pitch counts as a fresh pick. */
  release(): void {
    this.armed = true
  }

  /**
   * Feed a detected pitch (fractional MIDI). `isAttack` marks a fresh pick so a
   * sustained note cannot silently satisfy a run of repeated notes: after a hit,
   * the same pitch is ignored until an attack, silence or a different pitch occurs.
   */
  onPitch(midi: number, songTime: number, isAttack: boolean): GroupState | null {
    if (isAttack || (this.lastHit && Math.abs(this.lastHit.midi - midi) >= 0.6)) this.armed = true
    const w = this.window
    for (let i = this.cursor; i < this.groups.length; i++) {
      const g = this.groups[i]
      if (g.group.time > songTime + w.early) break
      if (g.status !== 'pending') continue
      if (songTime - g.group.time > w.late) continue
      if (!this.matches(g, midi)) continue
      if (!this.armed && this.lastHit && Math.abs(this.lastHit.midi - midi) < 0.6) continue
      const delta = songTime - g.group.time
      const judgement: Judgement = Math.abs(delta) <= w.perfect ? 'perfect' : 'good'
      g.status = 'hit'
      g.judgement = judgement
      g.delta = delta
      g.hitAt = songTime
      this.score += (judgement === 'perfect' ? 100 : 50) * this.multiplier
      this.streak++
      if (this.streak > this.maxStreak) this.maxStreak = this.streak
      if (judgement === 'perfect') this.perfects++
      else this.goods++
      this.lastHit = { midi, time: songTime }
      this.armed = false
      return g
    }
    return null
  }

  summary(): ScoreSummary {
    let total = 0
    for (const g of this.groups) if (g.status !== 'skipped') total++
    const hits = this.perfects + this.goods
    const judged = hits + this.misses
    return {
      score: this.score,
      streak: this.streak,
      maxStreak: this.maxStreak,
      multiplier: this.multiplier,
      perfects: this.perfects,
      goods: this.goods,
      misses: this.misses,
      total,
      judged,
      accuracy: judged > 0 ? hits / judged : 0,
    }
  }

  /** Signed timing errors (seconds) of all hit groups, in time order. */
  hitDeltas(): number[] {
    const out: number[] = []
    for (const g of this.groups) if (g.status === 'hit' && g.delta !== undefined) out.push(g.delta)
    return out
  }

  /** Median of hit deltas (ms) and population stdev of (delta - median) (ms); null with fewer than 8 hits. */
  timingStats(): { medianMs: number | null; stdevMs: number | null } {
    const d = this.hitDeltas()
    if (d.length < 8) return { medianMs: null, stdevMs: null }
    const sorted = d.map((x) => x * 1000).sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    let sq = 0
    for (const x of sorted) sq += (x - median) ** 2
    return { medianMs: median, stdevMs: Math.sqrt(sq / sorted.length) }
  }

  /** Accuracy per bar (hits / resolved); -1 where a bar has no resolved groups. Empty without beats. */
  perBarAccuracy(): number[] {
    if (!this.hasBeats || this.groups.length === 0) return []
    const hits: number[] = []
    const resolved: number[] = []
    this.groups.forEach((g, i) => {
      if (g.status !== 'hit' && g.status !== 'miss') return
      const bar = this.groupBars[i]
      while (resolved.length <= bar) {
        hits.push(0)
        resolved.push(0)
      }
      resolved[bar]++
      if (g.status === 'hit') hits[bar]++
    })
    let last = 0
    for (let i = 0; i < this.groupBars.length; i++) last = Math.max(last, this.groupBars[i])
    const out: number[] = []
    for (let b = 0; b <= last; b++) out.push(resolved[b] ? hits[b] / resolved[b] : -1)
    return out
  }

  /** Bar indices with accuracy in [0, threshold). */
  weakBars(threshold = WEAK_BAR_ACCURACY): number[] {
    const out: number[] = []
    this.perBarAccuracy().forEach((a, b) => {
      if (a >= 0 && a < threshold) out.push(b)
    })
    return out
  }

  /** Call once per detector frame; heard = a clear pitch was reported. */
  observe(songTime: number, heard: boolean): void {
    const w = this.window
    // Skip groups whose window has certainly ended (cursor only blocks on long earlier groups, which is conservative).
    while (this.covCursor < this.groups.length && this.groupEnd(this.groups[this.covCursor], w) < songTime) this.covCursor++
    for (let i = this.covCursor; i < this.groups.length; i++) {
      const g = this.groups[i]
      if (g.group.time - w.early > songTime) break
      if (g.status === 'skipped') continue
      if (songTime <= this.groupEnd(g, w)) {
        this.expectedFrames++
        if (heard) this.heardFrames++
        return
      }
    }
  }

  private groupEnd(g: GroupState, w: HitWindow): number {
    let dur = 0
    for (const n of g.group.notes) if (n.duration > dur) dur = n.duration
    return g.group.time + Math.max(w.late, Math.min(dur, 1.0))
  }

  /** Fraction of expected frames in which a pitch was heard; 1 when none were expected yet. */
  coverage(): number {
    return this.expectedFrames > 0 ? this.heardFrames / this.expectedFrames : 1
  }

  toAttemptResult(opts: { playedTempo: number; targetTempo: number; speed: number; durationSec: number }): AttemptResult {
    const { medianMs, stdevMs } = this.timingStats()
    const result: AttemptResult = {
      perfects: this.perfects,
      goods: this.goods,
      misses: this.misses,
      total: this.perfects + this.goods + this.misses,
      timingMedianMs: medianMs,
      timingStdevMs: stdevMs,
      coverage: this.coverage(),
      durationSec: opts.durationSec,
      playedTempo: opts.playedTempo,
      targetTempo: opts.targetTempo,
      speed: opts.speed,
    }
    if (this.hasBeats) result.perBar = this.perBarAccuracy().map((a) => (a < 0 ? 1 : a))
    return result
  }

  get finished(): boolean {
    return this.cursor >= this.groups.length
  }
}
