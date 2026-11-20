import type { PitchFrame } from '../../audio/AudioEngine'
import { PitchSmoother } from '../play/pitchTracker'
import { feedbackText, judgeCents, judgePrompt, stablePitch, type EarJudgement } from './earTrainer'

/** Frames in a row without a clear pitch (about 55 ms) after which whatever was ringing has stopped. */
const QUIET_FRAMES = 5
/** A pitch further than this from the ringing note (octaves aside) is a different note. */
const NEW_NOTE_SEMITONES = 0.7
/** Frames in a row a different pitch must last before it counts as a new note without a pluck being heard. */
const NEW_NOTE_FRAMES = 3
/** A note that is close gets this long to settle onto the pitch before it is judged: a hard pluck starts sharp. */
const GOOD_GRACE_MS = 350
/** An old note must last this many frames into the turn (about half a second) to be reported as "still ringing": the end of the reference from the speaker is shorter. */
const RINGING_FRAMES = 45
const RANK: Record<EarJudgement, number> = { perfect: 0, good: 1, miss: 2 }

export interface EarAnswer {
  judgement: EarJudgement
  /** The note that was judged (fractional MIDI), or null when no steady note was heard. */
  played: number | null
  /** Whether the player made any sound with a pitch during the turn. */
  heard: boolean
  /** Nothing new was played, but a note from before the turn was still sounding. */
  ringing: boolean
}

export interface EarListenerOptions {
  /** How long the player has to answer. */
  responseMs: number
  /** Pause after a replayed reference before listening again (the speaker is still fading). */
  settleMs?: number
}

/** The line shown after a turn: how far off the answer was, or that nothing (clear) was heard. `name` is the note that was asked for. */
export function answerText(answer: EarAnswer, name: string, targetMidi: number): string {
  if (answer.played === null) {
    if (answer.heard) return `We could not make out a clear note. It was ${name}.`
    if (answer.ringing) return `No new note heard, only a string that was already ringing. It was ${name}.`
    return `No note heard. It was ${name}.`
  }
  const { cents, octaves } = judgeCents(answer.played, targetMidi)
  return `${feedbackText(cents, octaves)} (${name})`
}

/** Distance between two pitches in semitones, ignoring which octave they are in. */
function pitchClassDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 12
  return Math.min(d, 12 - d)
}

/**
 * Decides what the player answered in one ear-training turn, from the microphone frames.
 *
 * - A turn opens deaf. It starts collecting only when a new note begins: a pluck is heard, the room
 *   has gone quiet first, or the pitch moves away from what was ringing. A string still sounding from
 *   the answer before (or the tail of the reference from the speaker) is never taken as the answer.
 *   That also holds when the old note drops out for a moment and comes back: until a pluck is heard
 *   it only counts if it is the very note asked for.
 * - The turn ends early only on a match. A wrong note is remembered, and the player can keep looking
 *   until the time is up; then the closest steady note heard is the answer.
 * - Playing the reference again pauses listening while it sounds and gives the full time again.
 *
 * Feed it every frame, also between turns: it needs the level before a turn to tell a new pluck from
 * an old note fading.
 */
export class EarListener {
  private readonly smoother = new PitchSmoother()
  private readonly responseMs: number
  private readonly settleMs: number
  private target: number | null = null
  private listenFrom = 0
  private deadlineMs = 0
  private armed = false
  private ringing: number | null = null
  private quiet = 0
  private moved = 0
  private history: number[] = []
  private best: { played: number; judgement: EarJudgement } | null = null
  private settleBy: number | null = null
  private heardPitch = false
  private ringingFrames = 0
  private plucked = false

  constructor(options: EarListenerOptions) {
    this.responseMs = options.responseMs
    this.settleMs = options.settleMs ?? 150
  }

  /** True while a turn is open and undecided. */
  get listening(): boolean {
    return this.target !== null
  }

  /** When the open turn runs out of time (same clock as the `nowMs` passed in). */
  get deadline(): number {
    return this.deadlineMs
  }

  /** The player's turn starts: the reference has just finished. */
  open(targetMidi: number, nowMs: number): void {
    this.target = targetMidi
    this.best = null
    this.settleBy = null
    this.heardPitch = false
    this.ringingFrames = 0
    this.listenFrom = nowMs
    this.deadlineMs = nowMs + this.responseMs
    this.disarm()
  }

  /** The reference is played again for `referenceMs`: nothing is judged while it sounds, then the full time starts again. */
  replay(nowMs: number, referenceMs: number): void {
    if (this.target === null) return
    this.listenFrom = nowMs + referenceMs + this.settleMs
    this.deadlineMs = this.listenFrom + this.responseMs
    this.settleBy = null
    this.disarm()
  }

  /** Stops the turn without an answer (the screen is going away or starting over). */
  close(): void {
    this.target = null
  }

  /** Time is up: the closest steady note heard, or nothing. Ends the turn. */
  expire(): EarAnswer {
    const answer: EarAnswer = this.best
      ? { judgement: this.best.judgement, played: this.best.played, heard: true, ringing: false }
      : { judgement: 'miss', played: null, heard: this.heardPitch, ringing: !this.heardPitch && this.ringingFrames >= RINGING_FRAMES }
    this.target = null
    return answer
  }

  /** Takes one microphone frame. Returns the answer when this frame decides the turn, else null. */
  frame(frame: PitchFrame, nowMs: number, clarityThreshold: number): EarAnswer | null {
    const { midi, isAttack } = this.smoother.push(frame, clarityThreshold)
    const target = this.target
    if (target === null) return null
    if (nowMs >= this.deadlineMs) return this.expire()
    if (nowMs < this.listenFrom) return null

    if (isAttack) this.plucked = true
    if (!this.armed) {
      if (isAttack) this.armed = true
      else if (midi === null) {
        this.moved = 0
        if (++this.quiet >= QUIET_FRAMES) this.armed = true
        return null
      } else {
        this.quiet = 0
        if (this.ringing !== null && pitchClassDistance(midi, this.ringing) > NEW_NOTE_SEMITONES) {
          if (++this.moved >= NEW_NOTE_FRAMES) this.armed = true
        } else {
          this.moved = 0
          this.ringing = midi
          this.ringingFrames++
        }
      }
      if (!this.armed) return null
    } else if (isAttack) {
      // A new pluck: its pitch is not mixed with the note before.
      this.history = []
    }

    if (midi !== null) {
      // The note that was sounding when the turn opened, and no pluck since: a fading string drops out and comes back.
      const old = !this.plucked && this.ringing !== null && pitchClassDistance(midi, this.ringing) <= NEW_NOTE_SEMITONES
      if (old) this.ringingFrames++
      else this.heardPitch = true
      this.history.push(midi)
      if (this.history.length > 16) this.history.shift()
      const stable = stablePitch(this.history)
      if (stable !== null) {
        const judgement = judgePrompt(stable, target)
        // An old note is only an answer when it is the note asked for, in the right octave: then it was played
        // softly as the reference faded. A wrong note or another octave is the string from before.
        const answered = !old || (judgement !== 'miss' && judgeCents(stable, target).octaves === 0)
        if (answered) {
          this.heardPitch = true
          this.consider(stable, judgement, target)
          if (judgement === 'perfect') return this.expire()
          if (judgement === 'good' && this.settleBy === null) this.settleBy = nowMs + GOOD_GRACE_MS
        }
      }
    }
    if (this.settleBy !== null && nowMs >= this.settleBy) return this.expire()
    return null
  }

  private disarm(): void {
    this.armed = false
    this.plucked = false
    this.ringing = null
    this.quiet = 0
    this.moved = 0
    this.history = []
  }

  private consider(played: number, judgement: EarJudgement, target: number): void {
    const score = (p: number, j: EarJudgement): number => {
      const { cents, octaves } = judgeCents(p, target)
      return RANK[j] * 1e6 + Math.abs(cents) * 10 + Math.abs(octaves)
    }
    if (!this.best || score(played, judgement) < score(this.best.played, this.best.judgement)) this.best = { played, judgement }
  }
}

/**
 * Lets work that finishes late (the microphone starting, a timer) find out whether the run it was
 * started for is still the one on screen. Leaving the screen or starting over ends the run.
 */
export class RunGuard {
  private id = 0

  /** Starts a run; the returned check is true until the run is ended or another one begins. */
  begin(): () => boolean {
    const mine = ++this.id
    return () => mine === this.id
  }

  end(): void {
    this.id++
  }
}

/**
 * Gets a run ready (microphone, then anything else) and says whether it should still begin: false
 * when the player left or started over while waiting, so nothing is played and no timer is set.
 */
export async function prepareRun(alive: () => boolean, startMic: () => Promise<void>, prepare: () => Promise<void>): Promise<boolean> {
  await startMic()
  if (!alive()) return false
  await prepare()
  return alive()
}
