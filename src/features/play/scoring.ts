import type { OctaveTolerance } from '../../app/settings'
import { groupNotes, type NoteGroup } from '../../chart/events'
import type { ChartNote } from '../../chart/types'

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

  get finished(): boolean {
    return this.cursor >= this.groups.length
  }
}
