import type { OctaveTolerance } from '../../app/settings'
import { groupNotes, type NoteGroup } from '../../chart/events'
import type { Beat, ChartNote } from '../../chart/types'
import { findBeatIndex } from '../../chart/timing'
import { midiToFreq } from '../../music/pitch'
import { BEND_TOLERANCE_SEMIS, WEAK_BAR_ACCURACY } from '../../training/constants'
import type { AttemptResult } from '../../training/types'
import { HARMONIC_TOLERANCE_CENTS, RISE, freshNote, noteEvidence, peakNear, strongestPeak, type NoteEvidence } from './noteEvidence'

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
  /** Song time at which the group was recognised. */
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
  /** Groups that count (not skipped), over every pass of a loop. */
  total: number
  /** Groups resolved so far. */
  judged: number
  /** Hits / judged so far (0..1). */
  accuracy: number
}

export interface ScoreOptions {
  window?: Partial<HitWindow>
  octaveTolerance?: OctaveTolerance
  /** Reference pitch of A4 in Hz. */
  a4?: number
  /** Beat grid; enables per-bar statistics. */
  beats?: Beat[]
  /** Overrides of the recognition thresholds (for tuning and tests). */
  recognition?: Partial<Record<keyof typeof RECOGNITION, number>>
}

export function pitchMatches(detected: number, target: number, toleranceSemis: number, allowOctave: boolean): boolean {
  const d = detected - target
  if (Math.abs(d) <= toleranceSemis) return true
  return allowOctave && (Math.abs(d - 12) <= toleranceSemis || Math.abs(d + 12) <= toleranceSemis)
}

/**
 * How a note is recognised. All durations are real time; the tracker scales them by playback speed.
 * The values were tuned against the recorded guitar (see scoring.sim.test.ts): every lesson drill,
 * bundled song and exercise played exactly scores in full, and silence, the click track, strings
 * left ringing and wrong notes do not score.
 */
export const RECOGNITION = {
  /** Harmonics that must have risen for a single note (two above 700 Hz, where fewer fit under the analyser's top). */
  minRisen: 3,
  minRisenHigh: 2,
  /** Smallest combined rise that counts: quieter is noise. */
  minStrength: 0.002,
  /** Share of the rise that must sit on the fundamental, third or fifth harmonic; the octave above only raises the even ones. */
  oddShare: 0.12,
  /** ...and when a ringing string next to the fundamental hides it, the third and fifth harmonic alone must carry this share. */
  oddShareHidden: 0.05,
  /** A partial this close (Hz) to a note's fundamental cannot be told from it: the analysis window is too short. */
  unresolved: 24,
  /**
   * ...and only for notes below this frequency (Hz). Higher up the third and fifth harmonic are strong
   * enough for the usual share, and with the lower share the octave above got through: an open G
   * played an octave up while an A next to it rang scored (see "the octave above does not score").
   */
  hiddenBelow: 150,
  /** A rise at 0.5x, 1.5x, 2.5x the fundamental this large (relative to the note's own) means the octave below was played. */
  belowRatio: 0.3,
  /** Share of a chord's notes that must have been struck (and every pitch class at least once). */
  chordShare: 0.6,
  /** A chord note this much weaker than the chord's strongest is a stray peak, not a struck string. */
  chordFloor: 0.12,
  /**
   * More than this share of the stroke's energy outside the chord's own harmonics means another chord
   * was played. At 0.3 every open chord passes, also with one extra open string caught by the strum,
   * and its relative chord (A minor for C) does not.
   */
  foreign: 0.3,
  /** A strum takes up to 70 ms to cross the strings: a chord is judged this long after its first stroke. */
  settleChord: 0.15,
  /** ...and its look-back for the moment before the attack reaches further. */
  lookFromChord: 0.3,
  /** The moment before the attack is looked for between these many seconds ago. */
  lookFrom: 0.2,
  lookTo: 0.035,
  /** Consecutive frames that must agree. */
  confirm: 2,
  /**
   * Seconds after the attack before a note is accepted: until the new note fills enough of the
   * analysis window its partials cannot be placed to the semitone. Low notes need longest.
   */
  settleLow: 0.085,
  settleMid: 0.07,
  settleHigh: 0.045,
  /** How long after a note's window closes a late attack inside it can still be confirmed. */
  verifyFor: 0.25,
  /** Typical delay between an attack and the first frame that confirms it. */
  attackLag: 0.045,
  /** An attack shows as attack strength this many times its calm level, most of it gained in one hop. */
  fluxBump: 1.3,
  /** Two confirmations this close together are the same stroke. */
  sameAttack: 0.06,
  /** Without a visible stroke, a rise this deep from the moment before (a string struck again after dying down) still counts. */
  deepRise: 1.6,
  /** After a stroke, the same pitch is compared with frames at least this much later: by then the stroke fills the analysis window. */
  refill: 0.08,
  /** The attack-strength rise lags the stroke by about half an analysis hop. */
  onsetLag: 0.006,
  /** A frame counts as sound for coverage when its strongest partial reaches this amplitude. */
  heard: 0.003,
} as const

interface SpectralFrame {
  /** Song time of the frame. */
  t: number
  peaks: Float32Array
  /** Attack strength, wide-band and band-limited. */
  flux: number
  fluxBand: number
  strongest: number
  /** How far the song clock had slipped back in all (see `ScoreTracker.slip`) when this frame arrived. */
  slip: number
}

interface Tracked extends GroupState {
  freqs: number[]
  /** Consecutive frames that have confirmed this group, and when that run began (with the clock's slip then). */
  streak: number
  since: number
  sinceSlip: number
  midis: number[]
  /** Seconds a stroke needs before this group's pitches can be told to the semitone. */
  settle: number
  /** Notes that may arrive without a pick stroke at their own time (bends, slides, hammer-ons, pull-offs). */
  legato: boolean
  inRange: boolean
  /** The microphone picked up sound during this group's window. */
  heard: boolean
}

interface Carried {
  perfects: number
  goods: number
  misses: number
  score: number
  deltas: number[]
  passes: number
  /** Coverage counts of earlier passes. */
  heard: number
  resolved: number
}

const EMPTY_PEAKS = new Float32Array(0)
/** A rise without a visible stroke began about this long (seconds) before its first confirming frame. */
const STROKELESS_LEAD = 0.07
/** A ringing partial at least this strong (amplitude) hides a fundamental right next to it. */
const HIDING = 8e-4

/** What the sound was like before a possible stroke. */
interface Before {
  /** A note's harmonics then (null: nothing was sounding). */
  evidence(freq: number, cents: number): NoteEvidence | null
  /** Amplitude of the partial at `freq` then (within `cents` of it; the usual tolerance by default). */
  amp(freq: number, cents?: number): number
}

const SILENCE: Before = { evidence: () => null, amp: () => 0 }

function settleFor(lowestFreq: number): number {
  return lowestFreq < 150 ? RECOGNITION.settleLow : lowestFreq < 300 ? RECOGNITION.settleMid : RECOGNITION.settleHigh
}
const HISTORY_SECONDS = 0.6
/** A backward step of the song clock up to this long (seconds) is the clock slipping, not a jump to another place. */
const MAX_SLIP = 0.35

/**
 * Scores what the microphone hears against the notes of a chart.
 *
 * Every analysis frame carries the spectral peaks of the last ~90 ms and the attack strength of the
 * last hop. A note (or chord) is hit when its own harmonics have risen from where they were a moment
 * ago, which is what a fresh stroke does and what a string that is merely still ringing, a drum, or
 * a different note does not, and the hit is timed from the attack itself, not from when the pitch
 * became clear. That keeps timing accurate to a few milliseconds whatever the pitch and makes
 * recognition work while other strings ring.
 */
export class ScoreTracker {
  readonly groups: GroupState[]
  private readonly tracked: Tracked[]
  private readonly byNote = new Map<number, Tracked>()
  private readonly baseWindow: HitWindow
  private readonly octave: OctaveTolerance
  private readonly foreign: number
  private speed = 1
  private cursor = 0
  /** Bar index per group (parallel to groups); empty when no beats were given. */
  private readonly groupBars: number[] = []
  private readonly hasBeats: boolean
  private covCursor = 0
  private history: SpectralFrame[] = []
  /** Strokes that have scored a group, and the pitches they scored (a stroke scores a pitch once). */
  private usedAttacks: { t: number; midis: number[] }[] = []
  /** When each pitch (rounded MIDI) was last struck and scored. */
  private lastStruck = new Map<number, number>()
  private carried: Carried = { perfects: 0, goods: 0, misses: 0, score: 0, deltas: [], passes: 0, heard: 0, resolved: 0 }
  /** Notes at the very end of a loop pass that are still open after the wrap (see `nextPass`). */
  private tail: Tracked[] = []
  /**
   * Song time the clock has given back in small steps: it stalled while the sound went on, or was set
   * a little back when playback really began after the count-in. A stroke keeps the time it was heard
   * at: a first note played on the count-in's beat is on time, however late the song's audio started.
   */
  private slip = 0
  score = 0
  streak = 0
  maxStreak = 0
  perfects = 0
  goods = 0
  misses = 0

  constructor(notes: ChartNote[], opts: ScoreOptions = {}) {
    const a4 = opts.a4 ?? 440
    this.tracked = groupNotes(notes).map((group) => ({
      group,
      status: 'pending' as GroupStatus,
      freqs: group.notes.map((n) => midiToFreq(n.midi, a4)),
      streak: 0,
      since: 0,
      sinceSlip: 0,
      midis: group.notes.map((n) => Math.round(n.midi)),
      settle: group.notes.length > 1 ? RECOGNITION.settleChord : settleFor(Math.min(...group.notes.map((n) => midiToFreq(n.midi, a4)))),
      heard: false,
      legato: group.notes.some((n) => !!n.tech && (!!n.tech.bend || !!n.tech.slideIn || !!n.tech.hammerOn || !!n.tech.pullOff)),
      inRange: true,
    }))
    this.groups = this.tracked
    for (const g of this.tracked) for (const n of g.group.notes) this.byNote.set(n.id, g)
    this.baseWindow = { ...DEFAULT_WINDOW, ...opts.window }
    this.octave = opts.octaveTolerance ?? 'chords'
    this.foreign = opts.recognition?.foreign ?? RECOGNITION.foreign
    const beats = opts.beats
    this.hasBeats = !!beats && beats.length > 0
    if (beats && this.hasBeats) {
      for (const g of this.groups) {
        // A note written on a beat can come out a hair before the beat grid's own time for it (they are
        // added up differently): it still belongs to that beat's bar.
        const idx = findBeatIndex(beats, g.group.time + 1e-6)
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

  private clearPass(): void {
    for (const g of this.tracked) {
      g.status = g.inRange ? 'pending' : 'skipped'
      g.streak = 0
      g.heard = false
      delete g.judgement
      delete g.delta
      delete g.hitAt
    }
    this.cursor = 0
    this.covCursor = 0
    this.score = 0
    this.perfects = 0
    this.goods = 0
    this.misses = 0
  }

  /** Forgets what was heard so far (a new run: the sound of the last one has nothing to do with it). */
  private forget(): void {
    this.history = []
    this.usedAttacks = []
    this.lastStruck = new Map()
    this.tail = []
    this.slip = 0
  }

  reset(): void {
    for (const g of this.tracked) g.inRange = true
    this.clearPass()
    this.forget()
    this.carried = { perfects: 0, goods: 0, misses: 0, score: 0, deltas: [], passes: 0, heard: 0, resolved: 0 }
    this.streak = 0
    this.maxStreak = 0
  }

  /** Resets and marks everything before `songTime` as skipped (not counted). */
  seek(songTime: number): void {
    this.reset()
    while (this.cursor < this.tracked.length && this.tracked[this.cursor].group.time < songTime - this.window.late) {
      this.tracked[this.cursor].status = 'skipped'
      this.tracked[this.cursor].inRange = false
      this.cursor++
    }
  }

  /**
   * Restricts scoring to the groups that start in [from, to) of song time (a section loop): the rest
   * is skipped, not missed. Call after `reset` or `seek`.
   */
  setRange(from: number, to: number): void {
    for (const g of this.tracked) {
      g.inRange = g.group.time >= from - 1e-6 && g.group.time < to - 1e-6
      if (!g.inRange) g.status = 'skipped'
      else if (g.status === 'skipped') g.status = 'pending'
    }
  }

  /**
   * Starts another pass over the range (the loop wrapped); totals carry on. What was heard is kept:
   * the first note of the new pass is judged against the sound just before the wrap. Notes in the last
   * moments of the old pass stay open for as long as any note does, because their strokes may still be
   * on their way through the microphone; the rest of what is pending is missed.
   */
  nextPass(): void {
    const now = this.history.length ? this.history[this.history.length - 1].t : Number.NEGATIVE_INFINITY
    const limit = (this.baseWindow.late + RECOGNITION.verifyFor) * this.speed
    const open: Tracked[] = []
    for (let i = this.cursor; i < this.tracked.length; i++) {
      const g = this.tracked[i]
      if (g.status !== 'pending') continue
      // Everything from here to the end of the pass: with a long sound delay (Bluetooth) the frames
      // heard so far lag well behind the wrap, and the notes in between are still on their way too.
      if (this.history.length > 0 && g.group.time >= now - limit) {
        open.push({ ...g, group: { ...g.group } })
        // Kept out of this pass's count: it is settled once the open copy is.
        g.status = 'skipped'
      } else {
        g.status = 'miss'
        this.misses++
        this.streak = 0
      }
    }
    this.carried.perfects += this.perfects
    this.carried.goods += this.goods
    this.carried.misses += this.misses
    this.carried.score += this.score
    this.carried.deltas.push(...this.passDeltas())
    this.carried.passes++
    const [heard, resolved] = this.passCoverage()
    this.carried.heard += heard
    this.carried.resolved += resolved
    this.clearPass()
    this.tail.push(...open)
  }

  /** Marks the whole run as not scored (no microphone): nothing counts, so `summary().total` is 0. */
  markUnscored(): void {
    this.reset()
    for (const g of this.tracked) {
      g.inRange = false
      g.status = 'skipped'
    }
  }

  /** Resolves groups whose window, plus the time a late attack needs to be confirmed, has passed. Returns the newly missed groups. */
  advance(songTime: number): GroupState[] {
    const missed: GroupState[] = []
    const limit = (this.baseWindow.late + RECOGNITION.verifyFor) * this.speed
    while (this.cursor < this.tracked.length) {
      const g = this.tracked[this.cursor]
      if (g.group.time >= songTime - limit) break
      if (g.status === 'pending') {
        g.status = 'miss'
        this.misses++
        this.streak = 0
        missed.push(g)
      }
      this.cursor++
    }
    if (this.tail.length) {
      this.tail = this.tail.filter((g) => {
        if (g.status !== 'pending') return false
        if (g.group.time >= songTime - limit) return true
        g.status = 'miss'
        this.carried.misses++
        this.carried.resolved++
        if (g.heard) this.carried.heard++
        this.streak = 0
        missed.push(g)
        return false
      })
    }
    return missed
  }

  /** True when the detected pitch belongs to a pending note inside the window (used for the on-screen indicator only). */
  isUpcomingPitch(midi: number, songTime: number): boolean {
    const w = this.window
    for (let i = this.cursor; i < this.tracked.length; i++) {
      const g = this.tracked[i]
      if (g.group.time > songTime + w.early) break
      if (g.status !== 'pending' || songTime - g.group.time > w.late) continue
      const allowOctave = this.octave === 'all' || (this.octave === 'chords' && g.group.notes.length > 1)
      if (g.group.notes.some((n) => pitchMatches(midi, n.midi, n.tech?.bend ? BEND_TOLERANCE_SEMIS : 0.6, !n.tech?.bend && allowOctave))) return true
    }
    return false
  }

  private evidence(frame: SpectralFrame, freq: number, cents: number): NoteEvidence {
    return noteEvidence(frame.peaks, freq, frame.strongest, cents)
  }

  /** The frame in the look-back span where the group's notes were weakest: the moment before the attack. */
  private trough(g: Tracked, t: number): SpectralFrame | null | 'wait' {
    const s = this.speed
    // A pitch that was just struck and scored is only compared with frames from after that stroke had
    // filled the analysis window; otherwise the same stroke would look like a rise again.
    let from = t - (g.group.notes.length > 1 ? RECOGNITION.lookFromChord : RECOGNITION.lookFrom) * s
    let bounded = false
    for (const m of g.midis) {
      const last = this.lastStruck.get(m)
      if (last !== undefined && last + RECOGNITION.refill * s > from) {
        from = last + RECOGNITION.refill * s
        bounded = true
      }
    }
    let best: SpectralFrame | null = null
    let bestSal = Infinity
    for (let k = this.history.length - 2; k >= 0; k--) {
      const h = this.history[k]
      if (h.t > t - RECOGNITION.lookTo * s) continue
      if (h.t < from) break
      let sal = 0
      for (const f of g.freqs) sal += this.evidence(h, f, HARMONIC_TOLERANCE_CENTS).salience
      if (sal < bestSal) {
        bestSal = sal
        best = h
      }
    }
    return best === null && bounded ? 'wait' : best
  }

  /**
   * The strongest each harmonic of a note has been between 0.5 s and 0.2 s ago: the level a rise has to
   * clear to be more than partials of ringing strings beating against each other.
   */
  private crest(t: number, until = t - RECOGNITION.lookFrom * this.speed): Before {
    const s = this.speed
    const frames = this.history.filter((h) => h.t >= t - 0.5 * s && h.t <= until)
    return {
      evidence: (freq, cents) => {
        let out: NoteEvidence | null = null
        for (const h of frames) {
          const ev = this.evidence(h, freq, cents)
          if (!out) {
            out = { harmonics: [...ev.harmonics], salience: ev.salience, below: [...ev.below] }
            continue
          }
          const acc = out
          ev.harmonics.forEach((a, i) => (acc.harmonics[i] = Math.max(acc.harmonics[i], a)))
          ev.below.forEach((a, i) => (acc.below[i] = Math.max(acc.below[i], a)))
          acc.salience = Math.max(acc.salience, ev.salience)
        }
        return out
      },
      amp: (freq, cents) => frames.reduce((m, h) => Math.max(m, peakNear(h.peaks, freq, cents)), 0),
    }
  }

  private frameBefore(base: SpectralFrame | null): Before {
    return base ? { evidence: (f, c) => this.evidence(base, f, c), amp: (f, c) => peakNear(base.peaks, f, c) } : SILENCE
  }

  /** Did a fresh stroke of this single note show up between `before` and `now`? */
  private singleStruck(freq: number, cents: number, now: SpectralFrame, before: Before, factor: number): boolean {
    const fresh = freshNote(this.evidence(now, freq, cents), before.evidence(freq, cents), factor)
    if (fresh.risen < (freq > 700 ? RECOGNITION.minRisenHigh : RECOGNITION.minRisen) || fresh.strength < RECOGNITION.minStrength) return false
    // The octave above only raises the even harmonics. When a ringing string sits right next to the
    // fundamental (a bass note a whole tone away) the two cannot be told apart and the fundamental
    // shows no rise of its own: then the third and fifth harmonic, which the octave above does not
    // have at all, carry the proof alone, and they are weak on the low strings. Three harmonics still
    // have to rise, so the octave above needs one of them too. Only the low notes get this: higher up
    // a partial of some other ringing string is often found rising at the third or fifth harmonic.
    const beside = fresh.rises[0] === 0 && freq < RECOGNITION.hiddenBelow ? before.amp(freq, 1200 * Math.log2(1 + RECOGNITION.unresolved / freq)) : 0
    const hidden = beside >= HIDING && beside > before.amp(freq, cents)
    if (fresh.oddStrength < (hidden ? RECOGNITION.oddShareHidden : RECOGNITION.oddShare) * fresh.strength) return false
    return fresh.belowRise <= RECOGNITION.belowRatio * fresh.strength
  }

  private struck(g: Tracked, now: SpectralFrame, before: Before, factor: number = RISE): boolean {
    if (g.group.notes.length === 1) {
      const n = g.group.notes[0]
      const cents = n.tech?.bend ? BEND_TOLERANCE_SEMIS * 100 : HARMONIC_TOLERANCE_CENTS
      const f = g.freqs[0]
      if (this.singleStruck(f, cents, now, before, factor)) return true
      // With octave tolerance for single notes, the same note an octave up or down also counts.
      return this.octave === 'all' && !n.tech?.bend && (this.singleStruck(f * 2, cents, now, before, factor) || this.singleStruck(f / 2, cents, now, before, factor))
    }
    // A chord: enough of its notes were struck, and its pitch classes are there. A note counts by its
    // fundamental (below 150 Hz, where a small microphone hears little, by its second and third
    // harmonic instead), and only if that is not dwarfed by the rest of the chord: stray peaks are not notes.
    const cores = g.group.notes.map((_, i) => this.chordCore(g.freqs[i], now, before, factor))
    const strongest = Math.max(...cores)
    if (strongest < RECOGNITION.minStrength) return false
    const ok = cores.map((c) => c >= Math.max(RECOGNITION.minStrength, RECOGNITION.chordFloor * strongest))
    const struck = ok.filter(Boolean).length
    if (struck < Math.max(2, Math.ceil(RECOGNITION.chordShare * g.group.notes.length))) return false
    if (this.foreignShare(g, now, before, factor) > this.foreign) return false
    const classOf = (i: number) => ((Math.round(g.group.notes[i].midi) % 12) + 12) % 12
    const covered = new Set<number>()
    ok.forEach((v, i) => v && covered.add(classOf(i)))
    const silent = [...new Set(g.group.notes.map((_, i) => classOf(i)))].filter((pc) => !covered.has(pc))
    if (silent.length === 0) return true
    // One pitch class may be silent (a muted string), but not the bass note's, and not replaced: if the
    // note a fret away sounds instead, as loud as the chord's own notes, this is a different chord
    // (E for E minor).
    let lowest = 0
    g.freqs.forEach((f, i) => {
      if (f < g.freqs[lowest]) lowest = i
    })
    if (silent.length > 1 || silent[0] === classOf(lowest)) return false
    const sounding = cores.filter((_, i) => ok[i]).sort((x, y) => x - y)
    const typical = sounding[sounding.length >> 1]
    for (let i = 0; i < g.group.notes.length; i++) {
      if (classOf(i) !== silent[0]) continue
      for (const step of [-1, 1]) if (this.chordCore(g.freqs[i] * 2 ** (step / 12), now, before, factor) >= 0.4 * typical) return false
    }
    return true
  }

  /**
   * Of everything that rose with the stroke (70 Hz - 1.5 kHz), the share of energy that is not a
   * harmonic of any note of the chord, in any octave. A different chord can contain enough of this
   * one's notes to pass for it (G holds D and, as a harmonic, F sharp); what gives it away is all the
   * sound that does not belong.
   */
  private foreignShare(g: Tracked, now: SpectralFrame, before: Before, factor: number): number {
    const tolerance = 2 ** (HARMONIC_TOLERANCE_CENTS / 1200)
    let own = 0
    let foreign = 0
    for (let i = 0; i < now.peaks.length; i += 2) {
      const f = now.peaks[i]
      if (f < 70) continue
      if (f > 1500) break
      const a = now.peaks[i + 1]
      const was = before.amp(f)
      if (a < factor * was + 4e-4) continue
      const energy = (a - was) * (a - was)
      let belongs = false
      for (const f0 of g.freqs) {
        for (const octave of [0.5, 1, 2]) {
          const base = f0 * octave
          const h = Math.round(f / base)
          if (h >= 1 && h <= 8 && f <= base * h * tolerance && f >= (base * h) / tolerance) belongs = true
        }
        if (belongs) break
      }
      if (belongs) own += energy
      else foreign += energy
    }
    return own + foreign > 0 ? foreign / (own + foreign) : 0
  }

  /** How much a chord note's defining partial rose: the fundamental, or below 150 Hz the weaker of its second and third harmonic if that is more. */
  private chordCore(freq: number, now: SpectralFrame, before: Before, factor: number): number {
    const fresh = freshNote(this.evidence(now, freq, HARMONIC_TOLERANCE_CENTS), before.evidence(freq, HARMONIC_TOLERANCE_CENTS), factor)
    if (fresh.risen < 2) return 0
    const upper = Math.min(fresh.rises[1], fresh.rises[2])
    return freq < 150 ? Math.max(fresh.rises[0], upper) : fresh.rises[0]
  }

  /**
   * When the stroke behind a confirmation at `t` happened, read from the attack-strength curve: the
   * sharpest rise in the 160 ms before, favouring where a stroke confirmed now would be (a chord takes
   * the first rise of its strum; a legato note, which has no stroke of its own, may reach back to a
   * stroke inside its window). A stroke that already scored another note or chord is left out.
   * Without any rise the usual lag is assumed (`found` is then false).
   */
  private attackTime(g: Tracked, t: number): { time: number; found: boolean; slip: number } {
    const s = this.speed
    const chord = g.group.notes.length > 1
    const span = (chord ? 0.24 : 0.16) * s
    const w = this.window
    const expected = t - Math.max(RECOGNITION.attackLag, g.settle) * s
    // A stroke that has scored another note or chord is not this one's: in fast playing the strokes of
    // the neighbouring notes are all within reach. A strum goes on for a moment after its first stroke.
    const taken = (jt: number): boolean => {
      const at = jt - RECOGNITION.onsetLag * s
      for (const u of this.usedAttacks) {
        if (Math.abs(u.t - at) < 0.02 * s) return true
        if ((chord || u.midis.length > 1) && at > u.t && at - u.t < RECOGNITION.sameAttack * s) return true
      }
      return false
    }
    // Candidate strokes: the attack strength jumps in one hop, to well above its calm level. The wide-band
    // measure is the sharper one; in a noisy room only the band-limited one still shows the stroke.
    let jumps: { t: number; jump: number; slip: number }[] = []
    for (const key of ['flux', 'fluxBand'] as const) {
      const calm: number[] = []
      for (const h of this.history) if (h.t < t - span && h.t >= t - span - 0.18 * s) calm.push(h[key])
      calm.sort((a, b) => a - b)
      const level = calm.length ? calm[calm.length >> 1] : 0
      for (let k = 1; k < this.history.length; k++) {
        const h = this.history[k]
        if (h.t > t - 0.005 * s) break
        const inSpan = h.t >= t - span
        const inWindow = g.legato && h.t >= g.group.time - w.early && h.t <= g.group.time + w.late
        if (!inSpan && !inWindow) continue
        const jump = h[key] - this.history[k - 1][key]
        if (h[key] > RECOGNITION.fluxBump * level + 1e-5 && jump >= 0.3 * h[key] && !taken(h.t)) jumps.push({ t: h.t, jump, slip: h.slip })
      }
      if (jumps.length) break
      jumps = []
    }
    if (jumps.length === 0) return { time: expected - RECOGNITION.onsetLag * s, found: false, slip: this.slip }
    // A stroke from before the group's window is not passed over for one inside it: a chord that is
    // taken for sounding while another one rings is thrown out by exactly that earlier stroke.
    let pick = jumps[0]
    if (chord) {
      // The first real stroke of the strum: the earliest jump that is not dwarfed by the biggest.
      const biggest = Math.max(...jumps.map((j) => j.jump))
      pick = jumps.find((j) => j.jump >= 0.35 * biggest) ?? jumps[0]
    } else {
      // The sharpest jump near where the stroke should be: a ripple in a ringing string, or the click
      // track a moment earlier, must not pass for it.
      let bestScore = -1
      for (const j of jumps) {
        const far = (j.t - (g.legato && j.t < t - span ? g.group.time : expected)) / (0.04 * s)
        const score = j.jump * Math.exp(-far * far)
        if (score > bestScore) {
          bestScore = score
          pick = j
        }
      }
    }
    return { time: pick.t - RECOGNITION.onsetLag * s, found: true, slip: pick.slip }
  }

  /** Is there a later pending group with the same pitches whose time is nearer to `attack` than group `i`'s? */
  private nearerLater(g: Tracked, i: number, attack: number): boolean {
    const w = this.window
    const own = Math.abs(g.group.time - attack)
    // For a note left open from the pass before (i < 0) every note of the new pass is "later".
    for (let k = i < 0 ? this.cursor : i + 1; k < this.tracked.length; k++) {
      const other = this.tracked[k]
      if (other.group.time - w.early > attack) break
      if (other.status !== 'pending' || other.midis.length !== g.midis.length || !other.midis.every((m) => g.midis.includes(m))) continue
      if (Math.abs(other.group.time - attack) < own) return true
    }
    return false
  }

  /**
   * Feed one analysis frame: `songTime` is the latency-compensated song position of the frame, `peaks`
   * its spectral peaks ([freq, amp] pairs), `flux` and `fluxBand` its attack strength (wide-band and
   * band-limited). Returns the group this frame confirmed, if any.
   */
  onFrame(songTime: number, peaks: Float32Array | undefined, flux: number, fluxBand = 0): GroupState | null {
    const s = this.speed
    // The song position stepped back: a loop wrapped, or the clock was set as playback really began.
    // What was heard a moment ago is still what was heard a moment ago, so it is kept and re-timed.
    const last = this.history[this.history.length - 1]
    if (last && songTime < last.t) this.rebase(songTime - this.frameStep() - last.t)
    const frame: SpectralFrame = { t: songTime, peaks: peaks ?? EMPTY_PEAKS, flux, fluxBand, strongest: peaks ? strongestPeak(peaks) : 0, slip: this.slip }
    this.history.push(frame)
    while (this.history.length > 2 && this.history[0].t < songTime - HISTORY_SECONDS * s) this.history.shift()
    const w = this.window
    let result: GroupState | null = null
    for (const g of this.tail) if (g.status === 'pending' && this.consider(g, -1, frame)) result ??= g
    for (let i = this.cursor; i < this.tracked.length; i++) {
      const g = this.tracked[i]
      if (g.group.time > songTime + w.early) break
      if (g.status === 'pending' && this.consider(g, i, frame)) result ??= g
    }
    return result
  }

  /** Typical song time between two frames. */
  private frameStep(): number {
    const n = this.history.length
    const d = n >= 2 ? this.history[n - 1].t - this.history[n - 2].t : 0
    return d > 0 && d < 0.1 * this.speed ? d : 0.0116 * this.speed
  }

  /** Moves everything that records when something was heard by `delta` seconds of song time. */
  private rebase(delta: number): void {
    const w = this.window
    // A small step is the clock slipping; a large one is a jump to another place in the song.
    if (-delta <= MAX_SLIP * this.speed) this.slip -= delta
    const before = this.history[this.history.length - 1].t
    for (const h of this.history) h.t += delta
    for (const u of this.usedAttacks) u.t += delta
    for (const [m, t] of this.lastStruck) this.lastStruck.set(m, t + delta)
    for (const g of this.tail) {
      g.group.time += delta
      g.since += delta
    }
    // A confirmation in progress began at a moment of real time, too.
    for (let i = this.cursor; i < this.tracked.length && this.tracked[i].group.time <= before + w.early; i++) {
      if (this.tracked[i].streak > 0) this.tracked[i].since += delta
    }
  }

  /**
   * Checks one pending group against the newest frame and registers the hit when a fresh stroke of it
   * is confirmed. `index` is the group's place among the tracked groups, or -1 for a note left open
   * from the pass before.
   */
  private consider(g: Tracked, index: number, frame: SpectralFrame): boolean {
    const songTime = frame.t
    const s = this.speed
    const w = this.window
    const base = this.trough(g, songTime)
    if (base === 'wait' || !this.struck(g, frame, this.frameBefore(base))) {
      g.streak = 0
      return false
    }
    if (g.streak++ === 0) {
      g.since = songTime
      g.sinceSlip = this.slip
    }
    if (g.streak < RECOGNITION.confirm) return false
    // A note left open from the pass before lives on the history's timeline, which moves with every
    // step of the clock, slips included: nothing is to be added for it.
    const slipSince = (heard: number) => (index < 0 ? 0 : this.slip - heard)
    const stroke = this.attackTime(g, songTime)
    let attack = stroke.time
    let heardSlip = stroke.slip
    if (stroke.found) {
      // Too soon after the stroke to trust the pitches: look again on the next frame.
      if (songTime - attack < g.settle * s) return false
    } else {
      // No stroke to be seen (a soft touch, a noisy room, or a hammer-on, slide or bend). Then the rise
      // has to hold for a while and, unless the note is of that stroke-less kind, climb above
      // everything heard lately: partials of ringing strings beating against each other also rise.
      // "Lately" reaches up to the moment before this rise began, so that an earlier stroke, of this
      // note or of one that shares its harmonics, is part of what has to be beaten.
      if (songTime - g.since < (g.settle - 0.035) * s) return false
      const lately = this.crest(songTime, Math.max(songTime - RECOGNITION.lookFrom * s, g.since - STROKELESS_LEAD * s))
      if (!g.legato && !this.struck(g, frame, lately) && !this.struck(g, frame, this.frameBefore(base), RECOGNITION.deepRise)) return false
      attack = g.since - (RECOGNITION.attackLag + RECOGNITION.onsetLag) * s
      heardSlip = g.sinceSlip
    }
    // Where the stroke fell in the song as the player could know it: the clock's slips since it was heard do not count against it.
    const played = attack + slipSince(heardSlip)
    // The stroke belongs to the nearest note of this pitch: an earlier one that was skipped must not take it.
    if (this.nearerLater(g, index, played)) return false
    if (played < g.group.time - w.early || played > g.group.time + w.late) return false
    // One stroke scores a pitch once.
    if (this.usedAttacks.some((u) => Math.abs(u.t - attack) < RECOGNITION.sameAttack * s && u.midis.some((m) => g.midis.includes(m)))) return false
    this.usedAttacks.push({ t: attack, midis: g.midis })
    if (this.usedAttacks.length > 8) this.usedAttacks.shift()
    for (const m of g.midis) this.lastStruck.set(m, attack)
    this.registerHit(g, played - g.group.time, songTime, index < 0)
    return true
  }

  /** Marks a group hit and updates score, streak and counters. */
  private registerHit(g: Tracked, delta: number, songTime: number, earlierPass = false): void {
    const judgement: Judgement = Math.abs(delta) <= this.window.perfect ? 'perfect' : 'good'
    g.status = 'hit'
    g.judgement = judgement
    g.delta = delta
    g.hitAt = songTime
    const points = (judgement === 'perfect' ? 100 : 50) * this.multiplier
    this.streak++
    if (this.streak > this.maxStreak) this.maxStreak = this.streak
    if (earlierPass) {
      // A note left open from the pass before: it counts towards that pass's totals.
      this.carried.score += points
      if (judgement === 'perfect') this.carried.perfects++
      else this.carried.goods++
      this.carried.deltas.push(delta)
      this.carried.resolved++
      this.carried.heard++
      return
    }
    this.score += points
    if (judgement === 'perfect') this.perfects++
    else this.goods++
  }

  summary(): ScoreSummary {
    let inPass = 0
    for (const g of this.tracked) if (g.status !== 'skipped') inPass++
    const perfects = this.carried.perfects + this.perfects
    const goods = this.carried.goods + this.goods
    const misses = this.carried.misses + this.misses
    const hits = perfects + goods
    const judged = hits + misses
    return {
      score: this.carried.score + this.score,
      streak: this.streak,
      maxStreak: this.maxStreak,
      multiplier: this.multiplier,
      perfects,
      goods,
      misses,
      total: inPass * (this.carried.passes + 1),
      judged,
      accuracy: judged > 0 ? hits / judged : 0,
    }
  }

  private passDeltas(): number[] {
    const out: number[] = []
    for (const g of this.tracked) if (g.status === 'hit' && g.delta !== undefined) out.push(g.delta)
    return out
  }

  /** Signed timing errors (seconds) of all hit groups, earlier loop passes first. */
  hitDeltas(): number[] {
    return [...this.carried.deltas, ...this.passDeltas()]
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

  /** Call once per analysis frame; heard = the frame carried sound (see `RECOGNITION.heard`). */
  observe(songTime: number, heard: boolean): void {
    const w = this.window
    // Skip groups whose window has certainly ended (the cursor only blocks on long earlier groups, which is conservative).
    while (this.covCursor < this.tracked.length && this.groupEnd(this.tracked[this.covCursor], w) < songTime) this.covCursor++
    if (!heard) return
    for (let i = this.covCursor; i < this.tracked.length; i++) {
      const g = this.tracked[i]
      if (g.group.time - w.early > songTime) break
      if (songTime <= this.groupEnd(g, w)) g.heard = true
    }
  }

  private groupEnd(g: GroupState, w: HitWindow): number {
    let dur = 0
    for (const n of g.group.notes) if (n.duration > dur) dur = n.duration
    return g.group.time + Math.max(w.late, Math.min(dur, 1.0))
  }

  private passCoverage(): [number, number] {
    let heard = 0
    let resolved = 0
    for (const g of this.tracked) {
      if (g.status !== 'hit' && g.status !== 'miss') continue
      resolved++
      if (g.heard || g.status === 'hit') heard++
    }
    return [heard, resolved]
  }

  /**
   * Of the notes judged so far, the fraction during whose window the microphone heard any sound at
   * all; 1 when none were judged yet. Low coverage means the microphone is not picking the guitar
   * up, which is a different problem from wrong notes.
   */
  coverage(): number {
    const [heard, resolved] = this.passCoverage()
    const total = this.carried.resolved + resolved
    return total > 0 ? (this.carried.heard + heard) / total : 1
  }

  toAttemptResult(opts: { playedTempo: number; targetTempo: number; speed: number; durationSec: number }): AttemptResult {
    const { medianMs, stdevMs } = this.timingStats()
    const s = this.summary()
    const result: AttemptResult = {
      perfects: s.perfects,
      goods: s.goods,
      misses: s.misses,
      total: s.perfects + s.goods + s.misses,
      timingMedianMs: medianMs,
      timingStdevMs: stdevMs,
      coverage: this.coverage(),
      durationSec: opts.durationSec,
      playedTempo: opts.playedTempo,
      targetTempo: opts.targetTempo,
      speed: opts.speed,
      // Notes and chords are both verified against the spectrum, whatever else is ringing.
      chordScoring: 'chroma',
    }
    if (this.hasBeats) result.perBar = this.perBarAccuracy().map((a) => (a < 0 ? 1 : a))
    return result
  }

  get finished(): boolean {
    return this.cursor >= this.tracked.length
  }
}

/** True when any group of the chart is a chord (two or more notes struck together). */
export function hasChordGroups(notes: ChartNote[]): boolean {
  return groupNotes(notes).some((g) => g.notes.length > 1)
}
