import type { PitchFrame } from '../../../audio/AudioEngine'
import type { NoteGroup } from '../../../chart/events'
import { findBeatIndex } from '../../../chart/timing'
import { chartBpm, type Chart, type ChartNote, type VoiceCue, type VoiceJudge } from '../../../chart/types'
import { freqToMidi } from '../../../music/pitch'
import type { AttemptResult } from '../../../training/types'
import type { RunTracker } from '../runTracker'
import type { FrameOutcome, FrameSettings } from '../scoreFrame'
import type { GroupStatus, Judgement, ScoreSummary } from '../scoring'
import { VOICE, frameSeconds, noteWindows, perfectCents, settleWait, voiceScore, windowCentre, type NoteWindows } from './judge'
import { LevelJump, RoomFloor, VoiceEar, centsFrom, isVoiced, octavesFrom, steadyMean, type Heard } from './voiceEar'

/**
 * Why a note came out as it did, for the tip on the result card (never for the score):
 * - `silent`: hardly a voice was heard during it;
 * - `low`, `high`: it was sung, under or over the note;
 * - `unsteady`: around the note, but not on it for long enough;
 * - `slid`: a note that counted, begun well under its pitch.
 */
export type NoteReason = 'silent' | 'low' | 'high' | 'unsteady' | 'slid'

/** One note of a sung run as the screen can show it. */
export interface NoteProgress {
  status: GroupStatus
  judgement?: Judgement
  /** Share (0..1) of the note's judged length sung in tune so far: how far its bar is filled. */
  share: number
  /** Once the note is settled: median distance from it in cents, any octave counting as the note (negative = under); null when nothing was heard. */
  cents: number | null
  /** Whole octaves from the written note to where it was sung (-1 = an octave lower); 0 until something counted. */
  octave: number
  reason?: NoteReason
}

/** What a whole run says about the singing; it travels with the summary (see `voiceFeedbackOf`). */
export interface VoiceFeedback {
  /** Notes settled so far, and how many of them counted. */
  notes: number
  hits: number
  /** How many notes carry each reason. */
  reasons: Record<NoteReason, number>
  /** The octave the notes that counted were mostly sung in, against the written one: -1 = an octave lower. */
  octave: number
  /** Median distance from the notes in cents (negative = under); null when nothing was heard. */
  medianCents: number | null
}

/** A sung run's summary carries the feedback along, so it reaches the result card the way the summary does. */
export type VoiceScoreSummary = ScoreSummary & { voice: VoiceFeedback }

/** The feedback of a sung run, from the summary the player hands on; undefined for a guitar run. */
export function voiceFeedbackOf(summary: ScoreSummary): VoiceFeedback | undefined {
  return (summary as Partial<VoiceScoreSummary>).voice
}

/**
 * A scored note as the tracker hands it out. It has the shape of the guitar tracker's `GroupState` (a
 * group of one note), so whatever draws or counts note states takes either.
 */
export interface VoiceNoteState {
  group: NoteGroup
  status: GroupStatus
  judgement?: Judgement
}

interface Tracked extends VoiceNoteState {
  note: ChartNote
  /** Place among the tracker's notes (for the per-note facts worked out once). */
  index: number
  /** The written span in song time. A note left open from the pass before lies one loop length earlier. */
  start: number
  end: number
  w: NoteWindows
  /** Song time from which nothing more can count for the note. */
  settleAt: number
  inRange: boolean
  /** Seconds in tune, of which `outside` came from before the note's start or after its end. */
  inTune: number
  outside: number
  /** Seconds outside the band that count if the note as a whole turns out to be on pitch: the far ends of a vibrato. */
  swing: number
  /** Seconds a voice was heard during the note, on any pitch. */
  voiced: number
  /** Distance from the note, in cents, of each frame that is the note's own. */
  errors: number[]
  /** Sum of the octaves the credited frames were sung in, and how many frames that is. */
  octaves: number
  credited: number
  /** Song time of the first and the last frame that counted. */
  first?: number
  last?: number
  /** Seconds near the start that were more than a semitone under the note. */
  under: number
  /** The note's own frames of the last moments, for the steady mean. */
  recent: Array<{ time: number; cents: number; seconds: number }>
  cents: number | null
  reason?: NoteReason
}

interface CueState {
  /** Someone was on the cue's pitch before it began. */
  before: boolean
  first?: number
  seconds: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const noReasons = (): Record<NoteReason, number> => ({ silent: 0, low: 0, high: 0, unsteady: 0, slid: 0 })

/**
 * Scores singing against the notes of a sung chart (`chart.voice`).
 *
 * A guitar note is an event: it is struck or it is not. A sung note is a stretch of time, so what is
 * measured is how much of each note was sung inside a band of cents around it, in any octave. Every
 * frame of the pitch detector is a few milliseconds of singing and is credited to one note at most:
 * the note being sung, else the note before it (the singer is late) or the note after it (early), and
 * what comes from outside a note's own span is capped below anything that makes a hit. That is what
 * keeps one held pitch from paying for two notes, and a flat singer from being credited through the
 * neighbouring notes.
 *
 * The app's own cues (the starting note, the guide's turn of an echo) are in the chart; whatever is
 * heard while one sounds is dropped, because on a bare phone that is the speaker.
 */
export class VoiceTracker implements RunTracker {
  /** Singing is scored from the single pitch alone. */
  readonly needsSpectrum = false
  private readonly notes: ChartNote[]
  private readonly judge: VoiceJudge
  private readonly cues: VoiceCue[]
  private readonly perfectWithin: number
  /** Per note: its bar, whether it lasts a beat or more, whether it lies at the top of the piece. */
  private readonly bars: number[] = []
  private readonly long: boolean[]
  private readonly top: boolean[]
  private readonly hasBeats: boolean
  /** The microphone's sample rate, asked for when the first frame arrives (see the constructor). */
  private sampleRate: number | (() => number)
  /**
   * Real seconds from the pitch a frame reports to its stamp, between two frames, and from the last
   * moment a frame can count for a note to the note's verdict. All three follow the sample rate.
   */
  private centre = 0
  private hop = 0
  private wait = 0
  private readonly ear: VoiceEar
  private readonly jump = new LevelJump()
  private readonly floor: RoomFloor
  private speed = 1
  /** The notes of the pass being sung, in order of time. */
  private pass: Tracked[] = []
  private byId = new Map<number, Tracked>()
  /** Notes of the pass before whose sound may still be on its way (see `nextPass`). */
  private tail: Tracked[] = []
  /** Everything a frame can count for, in order of time: the open notes of the pass before, then this pass. */
  private open: Tracked[] = []
  private cursor = 0
  private range: { from: number; to: number } | null = null
  /** Frames before this song time are the count-in: they tell what the room sounds like ... */
  private origin = 0
  /**
   * ... until the song has begun. From then on a frame that lands before the start again (after a loop
   * wrap, the frames of the old pass's end do) is singing, not the room.
   */
  private begun = false
  private lastSongTime: number | null = null
  private lastHeard: Heard | null = null
  private shown: number[] = []
  private announce: Judgement | null = null
  /** Notes a frame settled as missed, not yet handed out by `advance`. */
  private unreported: VoiceNoteState[] = []
  private cueHeard: CueState[] = []
  /** Cues that follow another one closely: what sounds before them is the cue before. */
  private cueJoined: boolean[] = []
  private passes = 0
  private perfects = 0
  private goods = 0
  private misses = 0
  private streak = 0
  private maxStreak = 0
  private starts: number[] = []
  private barHits: number[] = []
  private barResolved: number[] = []
  private resolved = 0
  private heardNotes = 0
  private topMissed = 0
  private noteCents: number[] = []
  private reasons = noReasons()
  private octaveSum = 0

  /**
   * `sampleRate` is the microphone's (the audio context's): the frames are timed with it. It may be
   * given as a function, which is called when the first frame arrives: the player builds its tracker
   * before there is an audio context to ask.
   */
  constructor(chart: Chart, notes: ChartNote[], opts: { sampleRate: number | (() => number) }) {
    const voice = chart.voice
    if (!voice) throw new Error('VoiceTracker: the chart is not a sung one')
    this.judge = voice.judge
    this.cues = [...voice.cues].sort((a, b) => a.time - b.time)
    this.perfectWithin = perfectCents(voice.judge)
    this.notes = [...notes].sort((a, b) => a.time - b.time || a.id - b.id)
    const beat = 60 / chartBpm(chart)
    const highest = this.notes.reduce((m, n) => Math.max(m, n.midi), Number.NEGATIVE_INFINITY)
    this.long = this.notes.map((n) => n.duration >= beat - 1e-6)
    this.top = this.notes.map((n) => n.midi > highest - VOICE.topSemitones)
    this.hasBeats = chart.beats.length > 0
    if (this.hasBeats) {
      for (const n of this.notes) {
        // A note written on a beat can come out a hair before the grid's own time for that beat.
        const i = findBeatIndex(chart.beats, n.time + 1e-6)
        this.bars.push(i < 0 ? 0 : chart.beats[i].bar)
      }
    }
    this.sampleRate = opts.sampleRate
    // Until the rate is known, the usual one. No frame has been timed with it by then.
    const rate = typeof opts.sampleRate === 'number' ? opts.sampleRate : 48000
    this.ear = new VoiceEar(rate)
    this.floor = new RoomFloor(frameSeconds(rate))
    this.timeWith(rate)
    this.reset()
  }

  /** How long a frame is, and what follows from that, at this sample rate. */
  private timeWith(rate: number): void {
    this.centre = windowCentre(rate)
    this.hop = frameSeconds(rate)
    this.wait = settleWait(rate)
    this.ear.hop = this.hop
    this.floor.hop = this.hop
  }

  /** Takes the sample rate from whoever knows it, once frames are arriving. */
  private timeFrames(): void {
    if (typeof this.sampleRate !== 'function') return
    const rate = this.sampleRate()
    if (!(rate > 0)) return
    this.sampleRate = rate
    this.timeWith(rate)
    // The notes were given their verdict times before the rate was known.
    for (const r of [...this.tail, ...this.pass]) this.fit(r)
  }

  /** Playback speed (1 = normal). The windows are real time, so in song time they shrink when playing slower. */
  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, speed)
    for (const r of [...this.tail, ...this.pass]) this.fit(r)
    this.joinCues()
  }

  private fit(r: Tracked): void {
    r.w = noteWindows(r.note.duration, this.judge, this.speed)
    r.settleAt = r.end + r.w.late + this.wait * this.speed
  }

  private fresh(note: ChartNote, index: number, inRange = true): Tracked {
    const r: Tracked = {
      group: { time: note.time, chordId: note.chordId, notes: [note] },
      note,
      index,
      start: note.time,
      end: note.time + note.duration,
      w: noteWindows(note.duration, this.judge, this.speed),
      settleAt: 0,
      status: inRange ? 'pending' : 'skipped',
      inRange,
      inTune: 0,
      outside: 0,
      swing: 0,
      voiced: 0,
      errors: [],
      octaves: 0,
      credited: 0,
      under: 0,
      recent: [],
      cents: null,
    }
    this.fit(r)
    return r
  }

  private newPass(inRange: (index: number) => boolean): void {
    this.pass = this.notes.map((n, i) => this.fresh(n, i, inRange(i)))
    this.byId = new Map(this.pass.map((r) => [r.note.id, r]))
    this.cursor = 0
    this.list()
  }

  private list(): void {
    this.open = [...this.tail, ...this.pass.filter((r) => r.inRange)]
  }

  private joinCues(): void {
    const quiet = VOICE.ownSoundQuiet * this.speed
    this.cueJoined = this.cues.map((c) => this.cues.some((o) => o !== c && o.time < c.time && o.time + o.duration > c.time - quiet))
  }

  reset(): void {
    this.tail = []
    this.range = null
    this.newPass(() => true)
    // The level heard a moment ago and the pitch on screen are not the run's: like the guitar side's
    // smoother they carry on, and start afresh only when the song's sound starts (`onPlaybackStart`).
    this.ear.reset()
    this.floor.reset()
    this.origin = 0
    this.begun = false
    this.lastSongTime = null
    this.lastHeard = null
    this.announce = null
    this.unreported = []
    this.cueHeard = this.cues.map(() => ({ before: false, seconds: 0 }))
    this.joinCues()
    this.passes = 0
    this.perfects = 0
    this.goods = 0
    this.misses = 0
    this.streak = 0
    this.maxStreak = 0
    this.starts = []
    this.barHits = []
    this.barResolved = []
    this.resolved = 0
    this.heardNotes = 0
    this.topMissed = 0
    this.noteCents = []
    this.reasons = noReasons()
    this.octaveSum = 0
  }

  /**
   * Resets, and leaves out (skipped, not missed) every note that began before `songTime`. What is
   * heard before `songTime` from now on is the count-in.
   */
  seek(songTime: number): void {
    this.reset()
    this.origin = songTime
    for (const r of this.pass) {
      if (r.start >= songTime - VOICE.early * this.speed) continue
      r.inRange = false
      r.status = 'skipped'
    }
    this.list()
  }

  /** Limits scoring to the notes that start in [from, to) of song time (a section loop). Call after `reset` or `seek`. */
  setRange(from: number, to: number): void {
    this.range = { from, to }
    for (const r of this.pass) {
      r.inRange = r.start >= from - 1e-6 && r.start < to - 1e-6
      if (!r.inRange) r.status = 'skipped'
      else if (r.status === 'skipped') r.status = 'pending'
    }
    this.list()
  }

  /**
   * The loop wrapped: another pass over the range, the totals carry on. A note at the end of the old
   * pass whose sound cannot all have arrived yet (the frames lag the clock by the sound delay) stays
   * open, moved one loop length back to where its frames will now come in.
   */
  nextPass(): void {
    const range = this.range
    const length = range ? range.to - range.from : 0
    for (const r of this.tail) if (r.status === 'pending') this.settle(r)
    const open: Tracked[] = []
    for (const r of this.pass) {
      if (r.status !== 'pending') continue
      // Without a section there is no loop length to move a note back by: the pass is simply over.
      if (range && this.lastSongTime !== null && this.lastSongTime < r.settleAt) {
        r.start -= length
        r.end -= length
        r.settleAt -= length
        // What it has heard so far moves with it.
        if (r.first !== undefined) r.first -= length
        if (r.last !== undefined) r.last -= length
        open.push(r)
      } else {
        this.settle(r)
      }
    }
    this.passes++
    this.tail = open
    const before = this.pass
    this.newPass((i) => before[i].inRange)
  }

  /** Marks the whole run as not scored (no microphone): nothing counts, so `summary().total` is 0. */
  markUnscored(): void {
    this.reset()
    for (const r of this.pass) {
      r.inRange = false
      r.status = 'skipped'
    }
    this.list()
  }

  /** Called when the song's sound starts after the count-in: the level and the pitch on screen start afresh, as on the guitar side. */
  onPlaybackStart(): void {
    this.jump.reset()
    this.shown = []
  }

  /**
   * Settles the notes nothing more can count for. Returns the ones that were missed since the last
   * call, whoever settled them: frames settle notes as well (see `frame`), and the player shows a miss
   * only when it is told of one here. `Infinity` closes the run.
   */
  advance(songTime: number): VoiceNoteState[] {
    if (songTime === Number.POSITIVE_INFINITY) for (const h of this.ear.flush()) this.credit(h)
    const missed = [...this.unreported, ...this.settleDue(songTime)]
    this.unreported = []
    return missed
  }

  private settleDue(songTime: number): VoiceNoteState[] {
    const missed: VoiceNoteState[] = []
    if (this.tail.length) {
      for (const r of this.tail) {
        if (r.status !== 'pending' || r.settleAt > songTime) continue
        if (!this.settle(r)) missed.push(r)
      }
      if (this.tail.every((r) => r.status !== 'pending')) {
        this.tail = []
        this.list()
      }
    }
    while (this.cursor < this.pass.length) {
      const r = this.pass[this.cursor]
      if (r.status === 'pending') {
        if (r.settleAt > songTime) break
        if (!this.settle(r)) missed.push(r)
      }
      this.cursor++
    }
    return missed
  }

  /** Gives a note its verdict and adds it to the totals. Returns whether it counted. */
  private settle(r: Tracked): boolean {
    const s = this.speed
    const band = this.judge.band
    r.cents = median(r.errors)
    // A swing around the note has the note in its middle. A steady offset that the mean let through for
    // a moment (right after a step, when the frames of two pitches share the window) has not.
    if (r.cents !== null && Math.abs(r.cents) <= band) r.inTune += r.swing
    r.swing = 0
    const heard = r.voiced >= VOICE.silentShare * r.w.judged
    if (r.inTune >= r.w.need - 1e-9) {
      r.status = 'hit'
      const share = Math.min(1, r.inTune / r.w.judged)
      const letGo = !!this.judge.sustain && this.long[r.index] && r.end - (r.last ?? Number.NEGATIVE_INFINITY) > VOICE.sustainGap * s
      const perfect = share >= VOICE.perfectShare && r.cents !== null && Math.abs(r.cents) <= this.perfectWithin && !letGo
      r.judgement = perfect ? 'perfect' : 'good'
      if (r.under >= VOICE.slideSeconds * s) r.reason = 'slid'
      if (perfect) this.perfects++
      else this.goods++
      this.streak++
      if (this.streak > this.maxStreak) this.maxStreak = this.streak
      this.announce = r.judgement
      if (r.first !== undefined) this.starts.push(r.first - r.start)
      this.octaveSum += r.credited ? Math.round(r.octaves / r.credited) : 0
    } else {
      r.status = 'miss'
      r.reason = !heard || r.cents === null ? 'silent' : r.cents < -band ? 'low' : r.cents > band ? 'high' : 'unsteady'
      this.misses++
      this.streak = 0
      if (this.top[r.index] && (r.reason === 'low' || r.reason === 'silent')) this.topMissed++
    }
    if (r.reason) this.reasons[r.reason]++
    if (r.cents !== null) this.noteCents.push(r.cents)
    this.resolved++
    if (heard || r.status === 'hit') this.heardNotes++
    if (this.hasBeats) {
      const bar = this.bars[r.index]
      this.barResolved[bar] = (this.barResolved[bar] ?? 0) + 1
      this.barHits[bar] = (this.barHits[bar] ?? 0) + (r.status === 'hit' ? 1 : 0)
    }
    return r.status === 'hit'
  }

  /** Index of the last open note that starts at or before `t`, or -1. */
  private indexAt(t: number): number {
    const open = this.open
    let lo = 0
    let hi = open.length - 1
    if (hi < 0 || open[0].start > t) return -1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (open[mid].start <= t) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Inside the guard of one of the app's own cues. */
  private muted(t: number): boolean {
    const s = this.speed
    for (const c of this.cues) {
      if (t >= c.time - VOICE.cueBefore * s && t <= c.time + c.duration + VOICE.cueAfter * s) return true
    }
    return false
  }

  /** Keeps track of whether each cue itself is coming back through the microphone. */
  private noteCue(h: Heard, seconds: number): void {
    const s = this.speed
    for (let i = 0; i < this.cues.length; i++) {
      const c = this.cues[i]
      if (h.at < c.time - VOICE.ownSoundQuiet * s) break
      if (h.at >= c.time + c.duration || Math.abs(centsFrom(h.midi, c.midi)) > VOICE.ownSoundCents) continue
      const state = this.cueHeard[i]
      if (h.at < c.time - VOICE.cueBefore * s) {
        if (!this.cueJoined[i]) state.before = true
      } else {
        state.first ??= h.at
        state.seconds += seconds
      }
    }
  }

  /**
   * True when one of the chart's cues was heard through the microphone as only a speaker plays it: on
   * its pitch, from its start. With the guide switched on that means the guide is being scored (the
   * player then does not count the run); with the guide off the cues are all there is to hear of the
   * app, and they are never credited, so the player has no reason to ask.
   */
  ownSoundHeard(): boolean {
    const s = this.speed
    return this.cues.some((c, i) => {
      const state = this.cueHeard[i]
      if (state.before || state.first === undefined) return false
      return state.first <= c.time + VOICE.ownSoundOnset * s && state.seconds >= Math.min(VOICE.ownSound * s, 0.6 * c.duration)
    })
  }

  /**
   * Outside the band, but swinging around the note: the mean of the note's own frames of the last
   * moments is inside it. Only frames sung during the note itself take part; what was credited from
   * before its start would turn a steady offset into a "swing" at every step of a semitone.
   */
  private swinging(r: Tracked, h: Heard, cents: number): boolean {
    if (Math.abs(cents) > VOICE.vibratoReach) return false
    const from = h.time - VOICE.vibratoMean
    const mean = steadyMean([...r.recent.filter((f) => f.time > from), { cents, seconds: h.seconds }])
    return mean !== null && Math.abs(mean) <= this.judge.band
  }

  private remember(r: Tracked, h: Heard, cents: number): void {
    r.recent.push({ time: h.time, cents, seconds: h.seconds })
    while (r.recent.length && r.recent[0].time <= h.time - VOICE.vibratoMean) r.recent.shift()
  }

  /** A frame that counts for a note: where it was sung, and when. */
  private counted(r: Tracked, h: Heard): true {
    r.octaves += octavesFrom(h.midi, r.note.midi)
    r.credited++
    r.first ??= h.at
    r.last = h.at
    return true
  }

  /**
   * Credit from before a note's start or after its end: lateness is not wrong pitch, but there is a
   * limit to it, and only what is inside the band itself counts.
   */
  private fromOutside(r: Tracked, h: Heard, seconds: number, inGap: boolean): boolean {
    if (r.outside >= r.w.outside || Math.abs(centsFrom(h.midi, r.note.midi)) > this.judge.band) return false
    const add = Math.min(seconds, r.w.outside - r.outside)
    r.inTune += add
    r.outside += add
    // In a rest there is no other note the frame was heard during.
    if (inGap) r.voiced += seconds
    return this.counted(r, h)
  }

  /**
   * Still on the pitch of the note before, within the time lateness is allowed: that note held over (a
   * late singer, or a phone whose sound sync is off), not a slide up to the next one. It reads the same
   * to the ear on a rising line, and "you slid up to the notes" would be untrue of it.
   */
  private heldOver(before: Tracked | undefined, h: Heard): boolean {
    return !!before && h.at <= before.end + VOICE.late * this.speed && Math.abs(centsFrom(h.midi, before.note.midi)) <= this.judge.band
  }

  /**
   * A voice holds its pitch from one frame to the next: a vibrato of 80 cents at 7 a second moves 42
   * cents in the 12 ms between two frames at 44.1 kHz. What moves faster is something else (the click's
   * kick drum, whose pitch falls) and is not listened to. How fast is a pace, in cents a second, over
   * the real time between the two frames: a frame is as long as the microphone's sample rate makes it,
   * and the frame before may be the one before a frame the detector dropped. Octaves do not count as a
   * jump: on a low voice the detector may flip between them.
   */
  private held(h: Heard): boolean {
    const last = this.lastHeard
    this.lastHeard = h
    if (!last) return false
    const since = h.time - last.time
    // More than one dropped frame apart, the two are not one held sound, however alike.
    return since > 0 && since <= 2.5 * this.hop && Math.abs(centsFrom(h.midi, last.midi)) <= VOICE.steadyRate * since
  }

  /** Gives one heard frame to the note it counts for, if any. Returns whether it counted. */
  private credit(h: Heard): boolean {
    if (!this.held(h)) return false
    const s = this.speed
    const t = h.at
    const seconds = h.seconds * s
    this.noteCue(h, seconds)
    // A frame that belongs to the end of the pass before is where that pass's cues were.
    const earlier = this.tail.length > 0 && this.range !== null && t < this.range.from
    if (this.muted(earlier && this.range ? t + this.range.to - this.range.from : t)) return false
    const i = this.indexAt(t)
    const here = i >= 0 ? this.open[i] : undefined
    const holder = here && t < here.end ? here : undefined
    const before = holder ? this.open[i - 1] : here
    const after = this.open[i + 1]
    const takes = (r: Tracked | undefined): r is Tracked => !!r && r.status === 'pending'
    const cents = takes(holder) ? centsFrom(h.midi, holder.note.midi) : 0
    if (takes(holder)) {
      holder.voiced += seconds
      if (cents < -VOICE.slideCents && t < holder.start + VOICE.slideWithin * s && !this.heldOver(before, h)) holder.under += seconds
      const onNote = Math.abs(cents) <= this.judge.band
      if (onNote || this.swinging(holder, h, cents)) {
        // What only the mean lets through is kept apart until the note is settled (see `settle`).
        if (onNote) holder.inTune += seconds
        else holder.swing += seconds
        holder.errors.push(cents)
        this.remember(holder, h, cents)
        return this.counted(holder, h)
      }
    }
    if (takes(before) && t <= before.end + before.w.late && this.fromOutside(before, h, seconds, !holder)) return true
    if (takes(after) && t >= after.start - after.w.early && this.fromOutside(after, h, seconds, !holder)) return true
    if (takes(holder)) {
      // Sung during the note and not on it: this is what "under the note" or "over the note" is read from.
      if (t >= holder.start + holder.w.onsetSkip) holder.errors.push(cents)
      this.remember(holder, h, cents)
    }
    return false
  }

  /** The pitch for the dot on screen: the middle one of the last three heard, as the guitar side smooths its indicator. */
  private show(midi: number | null): number | null {
    if (midi === null) {
      this.shown.length = 0
      return null
    }
    this.shown.push(midi)
    if (this.shown.length > 3) this.shown.shift()
    return [...this.shown].sort((a, b) => a - b)[this.shown.length >> 1]
  }

  /**
   * One detector frame. `songTime` is the latency-compensated song position of the frame's stamp while
   * a run plays or counts in, null otherwise (then only the pitch on screen and the attack flag are
   * worked out). The settings the player hands over are the guitar's and are not read: neither its
   * clarity threshold nor its reference pitch. A voice is read against `VOICE.a4`, where the app's own
   * notes are, for the score and for the dot alike.
   */
  frame(frame: PitchFrame, songTime: number | null, _settings: FrameSettings): FrameOutcome {
    this.timeFrames()
    const isAttack = this.jump.push(frame.rms)
    if (songTime !== null) {
      if (songTime >= this.origin) this.begun = true
      else if (!this.begun) this.floor.add(frame.rms)
    }
    this.ear.gate = this.floor.gate
    const midi = this.show(isVoiced(frame, this.ear.gate) ? freqToMidi(frame.freq, VOICE.a4) : null)
    if (songTime === null) return { midi, isAttack, matches: false, judgement: null }
    let matches = false
    // The pitch a frame reports is that of the middle of its window.
    for (const h of this.ear.listen(frame, songTime - this.centre * this.speed, VOICE.a4)) {
      if (this.credit(h)) matches = true
    }
    this.lastSongTime = songTime
    // The frames are what a verdict rests on, so they settle notes too; the clock may be held up.
    this.unreported.push(...this.settleDue(songTime))
    const judgement = this.announce
    this.announce = null
    return { midi, isAttack, matches, judgement }
  }

  stateOfNote(noteId: number): VoiceNoteState | undefined {
    return this.byId.get(noteId)
  }

  progressOf(noteId: number): NoteProgress | undefined {
    const r = this.byId.get(noteId)
    if (!r) return undefined
    return {
      status: r.status,
      judgement: r.judgement,
      share: Math.min(1, (r.inTune + r.swing) / r.w.judged),
      cents: r.cents,
      octave: r.credited ? Math.round(r.octaves / r.credited) + 0 : 0,
      reason: r.reason,
    }
  }

  private feedback(): VoiceFeedback {
    const hits = this.perfects + this.goods
    return {
      notes: hits + this.misses,
      hits,
      reasons: { ...this.reasons },
      octave: hits > 0 ? Math.round(this.octaveSum / hits) + 0 : 0,
      medianCents: median(this.noteCents),
    }
  }

  summary(): VoiceScoreSummary {
    let inPass = 0
    for (const r of this.pass) if (r.inRange) inPass++
    const hits = this.perfects + this.goods
    const judged = hits + this.misses
    return {
      score: voiceScore(this.perfects, this.goods),
      streak: this.streak,
      maxStreak: this.maxStreak,
      multiplier: 1,
      perfects: this.perfects,
      goods: this.goods,
      misses: this.misses,
      total: inPass * (this.passes + 1),
      judged,
      accuracy: judged > 0 ? hits / judged : 0,
      voice: this.feedback(),
    }
  }

  /** Accuracy per bar over every pass; a bar without a settled note reads 1. Empty without a beat grid. */
  private perBar(): number[] {
    const last = this.bars.reduce((m, b) => Math.max(m, b), 0)
    const out: number[] = []
    for (let b = 0; b <= last; b++) out.push(this.barResolved[b] ? (this.barHits[b] ?? 0) / this.barResolved[b] : 1)
    return out
  }

  toAttemptResult(opts: { playedTempo: number; targetTempo: number; speed: number; durationSec: number }): AttemptResult {
    const hits = this.perfects + this.goods
    // How long after its written start each note that counted was first on pitch. Reported as measured: it never fails a sung run.
    const start = hits >= 8 ? median(this.starts) : null
    const result: AttemptResult = {
      perfects: this.perfects,
      goods: this.goods,
      misses: this.misses,
      total: hits + this.misses,
      timingMedianMs: start === null ? null : start * 1000,
      timingStdevMs: null,
      coverage: this.resolved > 0 ? this.heardNotes / this.resolved : 1,
      durationSec: opts.durationSec,
      playedTempo: opts.playedTempo,
      targetTempo: opts.targetTempo,
      speed: opts.speed,
      voice: { medianCents: median(this.noteCents), topMissed: this.topMissed },
    }
    if (this.hasBeats && this.notes.length > 0) result.perBar = this.perBar()
    return result
  }
}
