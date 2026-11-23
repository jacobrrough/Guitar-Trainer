/**
 * Finding a singer's easy notes: a hum, two slides down and two slides up, each of which may be skipped.
 * Everything that decides something is here and is plain arithmetic on what the microphone heard, so it
 * can be proven without a screen: what counts as a hum, which note was "held", the range that follows,
 * the steps and what happens when one is skipped, the words on the screen. The screens (RangeFinder,
 * RangePage, NoteMatch, PitchLadder) only show what this file says.
 *
 * Frames come through `voiceEar`, so "a voice was heard" means here what it means in a sung run.
 *
 * Three readings of the design (docs/SINGING.md, section 5) are fixed here and written where they apply:
 * what "held 0.3 s" means on a slide, that the level limits apply to the held stretch as a whole, and
 * how a wide range is cut "around" the easy note.
 */
import { MIN_RANGE_SPAN, defaultRange, easyRange, type DEFAULT_RANGES, type RangeAroundEasy, type RangeEdges } from '../../music/keys'
import { clamp, midiToName } from '../../music/pitch'
import type { VoiceRange } from '../../training/types'
import { RoomFloor, VoiceEar, type EarFrame, type Heard } from '../play/voice/voiceEar'

export const RANGE = {
  /** A hum is listened to for this long from where the voice starts ... */
  humSeconds: 4,
  /** ... and gives an easy note when it holds this much voice. */
  humVoiced: 1.5,
  /** A note is "held" when the voice has stayed on it for this long without a break. */
  held: 0.3,
  /**
   * "Stayed on it": all but a tenth of that time at or under the note (at or over it, for a top note).
   * On a held note this is the note. On a slide that never stops it is the pitch the voice passed
   * 0.27 s before the end, so the reading errs towards the middle of the voice and never past what was
   * sung. The tenth is two or three detector frames: a stray reading does not cost a real hold, and a
   * dip or a squeak has to last a quarter of a second to be taken for a note.
   */
  heldShare: 0.9,
  /** A hole in the voice longer than this ends a stretch. Shorter ones are frames the detector lost on a voice near its edge. */
  gap: 0.05,
  /** A low note counts only at this share of the hum's level or more: under it, it is a croak. */
  croakLevel: 0.5,
  /** A top note counts only at this many times the hum's level or less: over it, it was forced. */
  pushLevel: 2,
  /** The comfortable range starts this far above the lowest note held and ends this far under the highest. */
  lowMargin: 2,
  highMargin: 3,
  /** An edge outside these was not a voice (MIDI numbers: C2 and D6). */
  lowestNote: 36,
  highestNote: 86,
  /** A wider comfortable range is cut to this many semitones, this many of them under the easy note. */
  widest: 14,
  underEasy: 6,
  /** A step that hears no voice for this long ends unheard. */
  wait: 10,
  /** This much voice is the start of a hum or a slide (a click or a knock is shorter). */
  onset: 0.1,
  /** A singer who has been quiet for this long has finished ... */
  quiet: 1,
  /** ... if a slide held at least this much voice (less was a cough, and the step starts over). */
  slideVoiced: 0.5,
  /** A slide is listened to for this long at most. */
  slideSeconds: 6,
  /** A voice heard this soon after a step opens was already sounding: nobody starts that fast ... */
  carried: 0.1,
  /** ... and it has stopped when this long has passed without it. */
  breath: 0.3,
  /**
   * Or it has become the slide: a carried voice this many semitones on from the note it was holding,
   * the way the step goes, is no longer the note before. More than a wavering hum, less than any slide.
   */
  leave: 2,
  /** No frame at all for this long: the microphone was away (frames come many times a second). */
  away: 0.5,
} as const

/** The detector while the range is being found: the whole of what a voice can do, as wide as a sung run ever sets it. */
export const RANGE_DETECTOR = { minFreq: 60, maxFreq: 1200, threshold: 0.9 } as const

/**
 * What the microphone is given back with: the audio engine's own defaults. The guitar tuner only moves
 * the lower edge when it takes a running microphone over, so a voice screen that left its narrow range
 * behind would leave the tuner deaf to the high E string.
 */
export const GUITAR_DETECTOR = { minFreq: 55, maxFreq: 1500, threshold: 0.93 } as const

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The easy note and how loud it was hummed: the level the slides are compared with. */
export interface Hum {
  /** Whole MIDI number. */
  easy: number
  /** Middle level (RMS) of the hum. */
  level: number
}

/**
 * The hum, from what was heard of it: the rounded middle pitch and the middle level. Null when there
 * was too little voice, or when the smallest range around the note would leave what a voice can do
 * (mains hum, a fan and a whistle all have a clear pitch).
 */
export function humOf(heard: readonly Heard[]): Hum | null {
  if (sum(heard.map((h) => h.seconds)) < RANGE.humVoiced) return null
  const easy = Math.round(median(heard.map((h) => h.midi)))
  const smallest = easyRange(easy)
  if (smallest.low < RANGE.lowestNote || smallest.high > RANGE.highestNote) return null
  return { easy, level: median(heard.map((h) => h.rms)) }
}

/**
 * The note of every stretch of `RANGE.held` seconds of unbroken voice: for `side` 'low' the pitch the
 * voice stayed at or under for all but a tenth of it, for 'high' at or over. With the stretch's middle level.
 */
function heldStretches(heard: readonly Heard[], side: 'low' | 'high'): Array<{ midi: number; level: number }> {
  const out: Array<{ midi: number; level: number }> = []
  let runStart = 0
  for (let i = 0; i < heard.length; i++) {
    if (i > 0 && heard[i].time - heard[i - 1].time > RANGE.gap) runStart = i
    // The shortest stretch that ends on this frame and is long enough.
    let seconds = 0
    let j = i
    for (; j >= runStart; j--) {
      seconds += heard[j].seconds
      if (seconds >= RANGE.held) break
    }
    if (j < runStart) continue
    const stretch = heard.slice(j, i + 1)
    const pitches = stretch.map((h) => h.midi).sort((a, b) => (side === 'low' ? a - b : b - a))
    out.push({ midi: pitches[Math.ceil(RANGE.heldShare * pitches.length) - 1], level: median(stretch.map((h) => h.rms)) })
  }
  return out
}

/**
 * The lowest note held, as a fractional MIDI number, or null when nothing was held. A stretch whose
 * middle level is under half the hum's is a croak and does not count. The level is asked of the
 * stretch, not of each frame: a voice's level ripples as it slides, and a frame-by-frame limit would
 * cut a steady slide into pieces too short to be held.
 */
export function lowestHeld(heard: readonly Heard[], humLevel: number): number | null {
  const notes = heldStretches(heard, 'low').filter((s) => s.level >= RANGE.croakLevel * humLevel)
  return notes.length > 0 ? Math.min(...notes.map((s) => s.midi)) : null
}

/** The highest note held, or null. A stretch at more than twice the hum's level was forced out and does not count; a light top note does. */
export function highestHeld(heard: readonly Heard[], humLevel: number): number | null {
  const notes = heldStretches(heard, 'high').filter((s) => s.level <= RANGE.pushLevel * humLevel)
  return notes.length > 0 ? Math.max(...notes.map((s) => s.midi)) : null
}

/**
 * A slide up that was sung with more voice than the hum from its first note to its last: notes were
 * held, and every one of them was over the limit. The singer was heard well, so asking them to come
 * closer would be the wrong thing to say: closer is stronger still.
 */
export function tooStrong(heard: readonly Heard[], humLevel: number): boolean {
  return heldStretches(heard, 'high').length > 0 && highestHeld(heard, humLevel) === null
}

export type StepKind = 'hum' | 'down' | 'up'

/** The walk: one hum, then each slide twice. */
export const STEPS: readonly StepKind[] = ['hum', 'down', 'down', 'up', 'up']

/** What the steps sung so far have given. */
export interface Measurement {
  hum: Hum | null
  /** The lowest note held in each slide down that was heard, fractional MIDI numbers. */
  lows: number[]
  highs: number[]
}

const NOTHING: Measurement = { hum: null, lows: [], highs: [] }

/**
 * The measurement with one more step in it. A step in which nothing could be used gives the same
 * object back, which is how the caller sees that it was not heard (for a hum: `hum` is null). A slide
 * without a hum has nothing to be compared with and is left out.
 */
export function measure(m: Measurement, kind: StepKind, heard: readonly Heard[]): Measurement {
  // The slides are judged against the hum's level, so a new hum starts the measurement over.
  if (kind === 'hum') return { hum: humOf(heard), lows: [], highs: [] }
  if (!m.hum) return m
  const note = kind === 'down' ? lowestHeld(heard, m.hum.level) : highestHeld(heard, m.hum.level)
  if (note === null) return m
  return kind === 'down' ? { ...m, lows: [...m.lows, note] } : { ...m, highs: [...m.highs, note] }
}

/**
 * The range to store, or null when there was no hum (the screen then offers the two starting ranges).
 *
 * The comfortable range starts two semitones above the lowest note held in either slide down and ends
 * three under the highest held in either slide up; a side that was skipped takes its edge from the
 * small range around the hum. When that leaves under eight notes, when an edge is not a note a voice
 * has, or when no slide was heard at all, the result is the small range around the hum (three under,
 * four over) and is marked as a default, so nobody takes it for a measurement.
 *
 * A wider range is cut to fourteen semitones "around" the easy note: six under it and eight over, the
 * proportion of the small range, moved as far as it has to be to stay inside the comfortable notes.
 * An easy note outside those (a hum at the very bottom of the voice) is moved onto their edge, as the
 * store would move it.
 */
export function rangeFrom(m: Measurement, at: number): VoiceRange | null {
  if (!m.hum) return null
  const plausible = (note: number) => note >= RANGE.lowestNote && note <= RANGE.highestNote
  const measuredLow = m.lows.length > 0 ? Math.round(Math.min(...m.lows)) : undefined
  const measuredHigh = m.highs.length > 0 ? Math.round(Math.max(...m.highs)) : undefined
  const around = easyRange(m.hum.easy)
  const comfortableLow = measuredLow === undefined ? around.low : measuredLow + RANGE.lowMargin
  const comfortableHigh = measuredHigh === undefined ? around.high : measuredHigh - RANGE.highMargin
  // Only what was a voice is kept as "heard".
  const heard = {
    ...(measuredLow !== undefined && plausible(measuredLow) ? { measuredLow } : {}),
    ...(measuredHigh !== undefined && plausible(measuredHigh) ? { measuredHigh } : {}),
  }
  const unheard = measuredLow === undefined && measuredHigh === undefined
  const notAVoice = (measuredLow !== undefined && !plausible(measuredLow)) || (measuredHigh !== undefined && !plausible(measuredHigh))
  if (unheard || notAVoice || comfortableHigh - comfortableLow < MIN_RANGE_SPAN) return { ...around, ...heard, source: 'default', at }
  const easy = clamp(m.hum.easy, comfortableLow, comfortableHigh)
  const wide = comfortableHigh - comfortableLow > RANGE.widest
  const low = wide ? clamp(easy - RANGE.underEasy, comfortableLow, comfortableHigh - RANGE.widest) : comfortableLow
  const high = wide ? low + RANGE.widest : comfortableHigh
  return { low, high, easy, ...heard, source: 'measured', at }
}

/**
 * "A bit lower", "a bit higher": every note one semitone down or up, marked as moved by hand. The range
 * is never made wider or narrower here. Null when it would leave what a voice can do.
 */
export function shiftRange(range: VoiceRange, by: 1 | -1, at: number): VoiceRange | null {
  if (range.low + by < RANGE.lowestNote || range.high + by > RANGE.highestNote) return null
  return { ...range, low: range.low + by, high: range.high + by, easy: range.easy + by, source: 'manual', at }
}

/** Whether two ranges ask for the same notes, wherever they came from. A new result that changed nothing leaves nothing to go back to. */
export function sameNotes(a: RangeAroundEasy, b: RangeAroundEasy): boolean {
  return a.low === b.low && a.high === b.high && a.easy === b.easy
}

/** The easy notes in words a beginner can use: "G3 to D4". Never a number of anything. */
export function rangeText(range: RangeEdges): string {
  return `${midiToName(range.low)} to ${midiToName(range.high)}`
}

/**
 * One listening step, fed with what the microphone heard, frame by frame (silence included, as an
 * empty list). It waits for a voice, listens for as long as its kind needs, and ends by itself, so
 * nobody has to tap while they sing.
 */
export class Take {
  readonly kind: StepKind
  /** What was heard of the voice, in order. */
  heard: Heard[] = []
  private began: number | null = null
  private voiceAt: number | null = null
  private lastVoice = 0
  private voiced = 0
  private now = 0
  /** A voice from the step before is still sounding (null: too early to tell, or no step came before). */
  private carried: boolean | null
  /** The first pitches of that voice (the note it was holding), how much of it they are, and for how long it has now been away from them. */
  private tailNote: number[] = []
  private tailHeard = 0
  private moved = 0

  /**
   * `afterAnother`: this step opens the moment another one ended, without a tap in between. The singer
   * may not have stopped yet (a hum that outlasts its four seconds, a slide that outlasts its six), and
   * that tail is not this step: it is left out until it has stopped. Without this a long hum would be
   * taken for the first slide down, and "the lowest note held" would be the hum.
   *
   * One tail does not stop. Asked to start the sigh on the easy note, a singer who is still humming it
   * lets the hum fall from where it is, in one breath. So a tail also ends when the voice has moved
   * away from its note in the direction of the step; left out, that sigh would be thrown away whole
   * and the screen would go on waiting for it.
   */
  constructor(kind: StepKind, afterAnother = false) {
    this.kind = kind
    this.carried = afterAnother ? null : false
  }

  /** True while the frame belongs to the step before. */
  private tail(heard: readonly Heard[], time: number, began: number): boolean {
    const voice = heard.length > 0
    if (this.carried === null) {
      if (voice) this.carried = true
      else if (time - began >= RANGE.carried) this.carried = false
    }
    if (!this.carried) return false
    if (voice) this.lastVoice = time
    // It has stopped, or it has become the slide: the step opens now, and its waiting starts now.
    if (voice ? this.left(heard) : time - this.lastVoice >= RANGE.breath) {
      this.carried = false
      this.began = time
    }
    return true
  }

  /**
   * Whether the carried voice has left the note it was holding, the way this step goes: down for a
   * sigh, up for a siren. For as long as a voice needs to be a voice (`onset`), so that a stray reading
   * or the dip at the end of a hum is not taken for a slide.
   */
  private left(heard: readonly Heard[]): boolean {
    const way = this.kind === 'down' ? -1 : this.kind === 'up' ? 1 : 0
    for (const h of heard) {
      if (this.tailHeard < RANGE.onset) {
        this.tailNote.push(h.midi)
        this.tailHeard += h.seconds
      } else if ((h.midi - median(this.tailNote)) * way >= RANGE.leave) this.moved += h.seconds
      else this.moved = 0
    }
    return this.moved >= RANGE.onset
  }

  /** Voice that makes the step worth ending when the singer goes quiet. */
  private get enough(): number {
    return this.kind === 'hum' ? RANGE.humVoiced : RANGE.slideVoiced
  }

  private get length(): number {
    return this.kind === 'hum' ? RANGE.humSeconds : RANGE.slideSeconds
  }

  /** Nothing heard so far belongs to the step: it opens at `time`, and its waiting starts there. */
  private startOver(time: number): void {
    this.heard = []
    this.voiced = 0
    this.voiceAt = null
    this.began = time
  }

  /** `heard` is what this frame settled (often nothing); `time` is the frame's own time. */
  add(heard: readonly Heard[], time: number): void {
    // The microphone was away (another screen closed it, a call came in) and is back. The clock ran on
    // meanwhile: without this the step would end the moment the first frame arrives, as "not heard".
    if (this.began !== null && time - this.now > RANGE.away) {
      this.startOver(time)
      this.carried = false
    }
    this.began ??= time
    this.now = time
    if (this.tail(heard, time, this.began)) return
    for (const h of heard) {
      this.heard.push(h)
      this.voiced += h.seconds
    }
    if (heard.length > 0) this.lastVoice = time
    if (this.voiceAt === null && this.voiced >= RANGE.onset) this.voiceAt = time
    // A cough, a word, the tail of the note before: a short sound and then silence was not the step.
    // Without this the clock of a slide would start on the cough and stop the slide half way.
    if (this.voiced > 0 && this.voiced < this.enough && time - this.lastVoice >= RANGE.quiet) this.startOver(time)
  }

  get status(): 'waiting' | 'hearing' | 'done' {
    if (this.began === null) return 'waiting'
    if (this.voiceAt === null) return this.now - this.began >= RANGE.wait ? 'done' : 'waiting'
    if (this.now - this.voiceAt >= this.length) return 'done'
    // Quiet after enough voice: the singer has finished. (Quiet after less than that never gets here: `add` starts the step over.)
    return this.now - this.lastVoice >= RANGE.quiet ? 'done' : 'hearing'
  }

  /** How much of the step's listening time has passed since the voice started, 0 to 1. */
  get progress(): number {
    return this.voiceAt === null ? 0 : Math.min(1, (this.now - this.voiceAt) / this.length)
  }
}

/**
 * The microphone as a voice tool hears it: the room first, then the voice above the room. A tool has
 * no count-in, so it calls `rest` for the frames that arrive while the learner reads what to do, and
 * `hear` while they sing; the level a voice has to reach is then taken from the room exactly as a
 * sung run takes it from its count-in.
 */
export class VoiceListener {
  private readonly ear: VoiceEar
  private readonly room: RoomFloor
  private hearing = false

  // No reference pitch comes in here, on purpose: a voice is always heard against A = 440, as every
  // sung run is, whatever the guitar side is tuned to.
  constructor(sampleRate: number) {
    this.ear = new VoiceEar(sampleRate)
    this.room = new RoomFloor(this.ear.hop)
  }

  /** A frame that belongs to nobody: the app itself is sounding. The next voice is not compared with the last one. */
  pause(): void {
    if (this.hearing) this.ear.reset()
    this.hearing = false
  }

  /** A frame of the room. */
  rest(frame: EarFrame): void {
    this.pause()
    this.room.add(frame.rms)
  }

  /** A frame while the learner is asked to sing: what it settles of the voice (see `VoiceEar.listen`). */
  hear(frame: EarFrame & { time: number }): Heard[] {
    if (!this.hearing) this.ear.gate = this.room.gate
    this.hearing = true
    return this.ear.listen(frame, frame.time)
  }
}

/** How many heard frames the dot is steadied over, and how long it stays after the voice stops (seconds). */
const DOT = { frames: 5, stale: 0.4 } as const

/** Where the voice is right now, for the dot on the ladder: the middle of the last few frames, gone soon after the voice stops. */
export class LiveDot {
  private recent: Heard[] = []

  add(heard: readonly Heard[]): void {
    for (const h of heard) this.recent.push(h)
    if (this.recent.length > DOT.frames) this.recent.splice(0, this.recent.length - DOT.frames)
  }

  /** Fractional MIDI number at frame time `time`, or null when no voice is heard. */
  at(time: number): number | null {
    const fresh = this.recent.filter((h) => time - h.time <= DOT.stale)
    return fresh.length > 0 ? median(fresh.map((h) => h.midi)) : null
  }
}

/** The notes a ladder shows, lowest and highest, both drawn. */
export interface LadderView {
  bottom: number
  top: number
}

/** The ladder for a range: its notes and two more at each end, as the pitch lanes of a song show them. */
export function ladderView(range: RangeEdges, margin = 2): LadderView {
  return { bottom: Math.floor(range.low) - margin, top: Math.ceil(range.high) + margin }
}

/**
 * Where a pitch sits on a ladder: `y` from 0 (top edge) to 1 (bottom edge), each note in the middle of
 * its own row. A pitch outside the ladder is kept at the edge, and `beyond` says which way it went.
 */
export function ladderSpot(midi: number, view: LadderView): { y: number; beyond: 'above' | 'below' | null } {
  if (midi > view.top + 0.5) return { y: 0, beyond: 'above' }
  if (midi < view.bottom - 0.5) return { y: 1, beyond: 'below' }
  return { y: (view.top + 0.5 - midi) / (view.top - view.bottom + 1), beyond: null }
}

/** How far the ladder reaches either side of the hum while the slides are sung: past anything the result can keep. */
const AROUND_HUM = 14
/** The ladder before there is a hum: from a low speaking voice to well above a high one (F2 to F5). */
const BEFORE_HUM: LadderView = { bottom: 41, top: 77 }

/** The ladder the range finder shows while it listens: the notes around the hum once there is one. */
export function finderView(hum: Hum | null): LadderView {
  return hum ? { bottom: hum.easy - AROUND_HUM, top: hum.easy + AROUND_HUM } : BEFORE_HUM
}

/** What a ladder shows, in words, for someone who cannot see it. Note names only. */
export function ladderLabel(shown: { range?: RangeEdges; target?: number; dot?: number | null }): string {
  const parts = ['A ladder of notes, higher towards the top.']
  if (shown.range) parts.push(`Your easy notes, ${rangeText(shown.range)}, are shaded.`)
  if (shown.target !== undefined) parts.push(`The note to sing is ${midiToName(shown.target)}.`)
  if (shown.dot !== null && shown.dot !== undefined) parts.push(`Your voice is on ${midiToName(Math.round(shown.dot))}.`)
  return parts.join(' ')
}

/** Where the range finder is. */
export interface FinderState {
  /**
   * intro: nothing sung yet. listen: step `step` is being sung. unheard: that step gave nothing, sing it
   * again or skip it. choose: no hum, so the two starting ranges are offered. result: `range` is set.
   */
  stage: 'intro' | 'listen' | 'unheard' | 'choose' | 'result'
  /** Index into `STEPS`. */
  step: number
  measured: Measurement
  range: VoiceRange | null
  /** Only in 'unheard': the step was a slide up, heard well, and stronger than the hum all the way (see `tooStrong`). */
  strong: boolean
}

export type FinderAction =
  | { type: 'start' }
  /** A step has ended with this heard. */
  | { type: 'heard'; heard: readonly Heard[]; at: number }
  | { type: 'again' }
  /** Skip the step that is open. Skipping the hum (or everything, from the intro) leads to the two starting ranges. */
  | { type: 'skip'; at: number }
  | { type: 'choose'; voice: keyof typeof DEFAULT_RANGES; at: number }
  | { type: 'restart' }

export function newFinder(): FinderState {
  return { stage: 'intro', step: 0, measured: NOTHING, range: null, strong: false }
}

/** On to the next step, or to the result when that was the last one. */
function onward(state: FinderState, at: number): FinderState {
  if (state.step + 1 < STEPS.length) return { ...state, stage: 'listen', step: state.step + 1, strong: false }
  const range = rangeFrom(state.measured, at)
  return range ? { ...state, stage: 'result', range, strong: false } : { ...state, stage: 'choose', range: null, strong: false }
}

/** The steps of the range finder. Times (`at`, ms since epoch) come in with the actions, so this stays pure. */
export function finderReducer(state: FinderState, action: FinderAction): FinderState {
  const open = state.stage === 'listen' || state.stage === 'unheard'
  switch (action.type) {
    case 'start':
      return { ...newFinder(), stage: 'listen' }
    case 'heard': {
      if (state.stage !== 'listen') return state
      const kind = STEPS[state.step]
      const measured = measure(state.measured, kind, action.heard)
      const heard = kind === 'hum' ? measured.hum !== null : measured !== state.measured
      if (heard) return onward({ ...state, measured }, action.at)
      const strong = kind === 'up' && state.measured.hum !== null && tooStrong(action.heard, state.measured.hum.level)
      return { ...state, stage: 'unheard', strong }
    }
    case 'again':
      return state.stage === 'unheard' ? { ...state, stage: 'listen', strong: false } : state
    case 'skip':
      // Without a hum there is no easy note and no level to compare a slide with: nothing can be measured.
      if (state.stage === 'intro' || (open && STEPS[state.step] === 'hum')) return { ...newFinder(), stage: 'choose' }
      return open ? onward(state, action.at) : state
    case 'choose':
      return { ...newFinder(), stage: 'result', range: defaultRange(action.voice, action.at) }
    case 'restart':
      return newFinder()
  }
}

/** Everything the range screens say. Kept here so one test can read every word. */
export const RANGE_COPY = {
  title: 'Find your easy notes',
  intro: 'Five short steps, under a minute. You hum one note, then slide your voice down twice and up twice. We listen and find the notes that are easy for you.',
  start: 'Start',
  care: 'Stop while it is easy. This is not a test of how high you can go.',
  hurt: 'Singing should never hurt. If your throat feels sore, scratchy or tired, stop for today.',
  steps: {
    hum: { title: 'Hum any note that feels easy', hint: 'Lips closed, like saying "mm". Keep it going for a few seconds.' },
    // The slides are hummed too. They are judged against the level of the hum (half of it is a croak,
    // twice is forced), and a sound through an open mouth is stronger at the microphone than a hum sung
    // just as gently behind closed lips. Asked for an open sigh or siren after a closed hum, a careful
    // singer would be over the limit from the first note. Not tried on a real voice yet: the virtual
    // singer cannot close its lips. With its hum at 0.4 of the level of its slides, both sirens were refused.
    down: { title: 'Slide down gently, like a sigh, and stop when it starts to croak', hint: 'Lips closed again. Start on your easy note, as soft as your hum.' },
    up: { title: 'Slide up quietly, like a small siren', hint: 'Lips closed again. Start on your easy note, as soft as your hum. Stop as soon as it feels tight.' },
  },
  again: 'Once more, the same way.',
  waiting: 'Listening. Start when you are ready.',
  hearing: 'We can hear you. Keep going.',
  unheard: 'We could not hear that clearly. Move the phone a little closer and try once more, or skip this step.',
  strong: 'That came out stronger than your hum. Try once more, lips closed and just as soft as the hum, or skip this step.',
  tryAgain: 'Try again',
  skipStep: 'Skip this step',
  skipAll: 'Skip and pick a starting point',
  notNow: 'Not now',
  micOff: 'The microphone is off. Tap Start and we will listen again.',
  micTrouble: 'We could not use the microphone. Check that you allowed it in your browser, then try again, or pick a starting point instead.',
  choose: {
    title: 'Pick a starting point',
    text: 'Tap each one to hear a note. Pick the one that sits closer to your speaking voice. You can change it whenever you like.',
    lower: 'Lower voice',
    higher: 'Higher voice',
    use: 'Use these notes',
    listen: 'Use the microphone instead',
  },
  result: {
    title: 'Your easy notes',
    measured: 'These are the notes we will use for your exercises and songs.',
    aroundEasy: 'We could not get a clear reading of how low and how high your voice goes, so we picked a small set of notes around the note you hummed. You can find them again whenever you like.',
    chosen: 'These are starting notes. You can find your own whenever you like.',
    done: 'Done',
    again: 'Find them again',
    keep: 'Keep the notes I had',
    notSaved: 'We could not save your easy notes. Please try once more.',
  },
  lower: 'A bit lower',
  higher: 'A bit higher',
  lowest: 'These are the lowest notes the app can follow.',
  highest: 'These are the highest notes the app can follow.',
  findAgain: 'Find my range again',
  page: {
    title: 'My voice',
    about: 'The notes that are easy for you, and where your voice is right now.',
    none: 'We do not know your easy notes yet.',
    see: 'See your note',
    stop: 'Stop listening',
    watch: 'Sing or hum any note and watch the dot.',
    above: 'That note is above your easy notes.',
    below: 'That note is below your easy notes.',
    inside: 'That note is one of your easy notes.',
    micTrouble: 'We could not use the microphone. Check that you allowed it in your browser, then try again. Everything else on this page works without it.',
  },
} as const

/** "Step 2 of 5": a count the learner can use. */
export function stepLabel(step: number): string {
  return `Step ${step + 1} of ${STEPS.length}`
}

/** The line under the ladder of "My voice": where the note being sung lies against the easy notes. */
export function voiceLine(dot: number | null, range: RangeEdges): string {
  if (dot === null) return RANGE_COPY.page.watch
  const note = Math.round(dot)
  return note > range.high ? RANGE_COPY.page.above : note < range.low ? RANGE_COPY.page.below : RANGE_COPY.page.inside
}

/** What the screen says about a step that gave nothing: come closer, unless the singer was heard and was simply too strong. */
export function unheardLine(state: FinderState): string {
  return state.strong ? RANGE_COPY.strong : RANGE_COPY.unheard
}

/** The line under "A bit lower" and "A bit higher" when one of them has nowhere left to go; null while both can move. */
export function edgeLine(range: VoiceRange): string | null {
  if (!shiftRange(range, -1, 0)) return RANGE_COPY.lowest
  if (!shiftRange(range, 1, 0)) return RANGE_COPY.highest
  return null
}

/** The sentence under "Your easy notes": where the range came from, said plainly. */
export function resultLine(state: FinderState): string {
  if (state.range?.source === 'measured') return RANGE_COPY.result.measured
  return state.measured.hum ? RANGE_COPY.result.aroundEasy : RANGE_COPY.result.chosen
}
