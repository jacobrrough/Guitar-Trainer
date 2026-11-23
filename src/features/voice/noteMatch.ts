/**
 * "Meet the note": the learner hears a note, then slides their voice until their dot sits on the bar
 * and holds it there. Three notes, nothing scored, nothing stored. It is the untimed way to find a
 * pitch that the scored exercises build on, so its rules are deliberately few:
 *
 * - the note is found after one second in tune, added up inside two and a half seconds, so a wobble
 *   does not start the count over;
 * - any octave counts, as it does everywhere a voice is listened to;
 * - listening opens only after the app's own note has ended, so the phone never finds the note itself;
 * - when time runs out the answer is "not yet", and the note can still be found after that. There is
 *   no state for having got it wrong.
 */
import { renderVoiceNotes } from '../../audio/voice'
import type { RangeAroundEasy } from '../../music/keys'
import { clamp } from '../../music/pitch'
import { centsFrom, octavesFrom, type Heard } from '../play/voice/voiceEar'

export const MATCH = {
  /** In tune is within this many cents, in any octave: the widest band a first exercise is scored with, so this tool is never the stricter of the two. */
  band: 80,
  /** Seconds in tune that find the note ... */
  inTune: 1,
  /** ... added up over the last this many seconds. */
  within: 2.5,
  /** Seconds of looking after which the screen says "not yet" and offers to go on. */
  timeout: 20,
  /** How long the app sings the note. */
  tone: 1.5,
  /** Listening opens this long after the app's note has ended: the tail of a speaker in a room, as the scorer allows for after a cue. */
  afterTone: 0.3,
  /** Notes in one go. */
  notes: 3,
  /** A voice last heard longer ago than this is no longer on the screen. */
  fresh: 0.5,
  /** Nothing heard for this long: the phone may be too far away to hear the learner. */
  quietHint: 6,
} as const

export type MatchStatus = 'listening' | 'found' | 'not-yet'

/** What the screen shows of one note. */
export interface MatchView {
  status: MatchStatus
  /** Where the voice is against the note right now, by the short way round the octave. */
  where: 'silent' | 'under' | 'on' | 'over'
  /** How much of the second in tune has been sung, 0 to 1. */
  held: number
  /** Once found: whole octaves from the note to where it was sung (-1 = an octave lower). */
  octave: number
  /** Seconds since a voice was last heard, or since listening opened. */
  quiet: number
}

/** Where a pitch belongs on a ladder that shows the note: in the octave around the note, as the pitch lanes fold the dot. */
export function foldNear(midi: number, target: number): number {
  return target + centsFrom(midi, target) / 100
}

/**
 * Three notes to meet, all inside the easy notes: the easy note itself, then one a little higher and
 * one a little lower (a whole tone where there is room, as the first exercise moves).
 */
export function matchNotes(range: RangeAroundEasy): number[] {
  const low = Math.ceil(range.low)
  const high = Math.floor(range.high)
  const easy = clamp(Math.round(range.easy), low, high)
  const notes = [easy]
  for (const step of [2, -2, 4, -4, 1, -1, 3, -3]) {
    const note = easy + step
    if (notes.length < MATCH.notes && note >= low && note <= high) notes.push(note)
  }
  return notes
}

interface Sung {
  time: number
  seconds: number
  cents: number
  octave: number
}

/**
 * Listens for one note. Feed it every frame's heard pitches with the frame's time (silence as an
 * empty list); `from` is the frame time at which listening opens, and nothing before it counts.
 */
export class NoteMatcher {
  readonly target: number
  readonly from: number
  private recent: Sung[] = []
  private now: number
  private lastVoice: number | null = null
  private foundOctave: number | null = null

  constructor(target: number, from: number) {
    this.target = target
    this.from = from
    this.now = from
  }

  listen(heard: readonly Heard[], time: number): void {
    this.now = Math.max(this.now, time)
    for (const h of heard) {
      // Before the opening it is the app's own note coming back through the microphone, or its tail.
      if (h.time < this.from) continue
      this.lastVoice = h.time
      this.recent.push({ time: h.time, seconds: h.seconds, cents: centsFrom(h.midi, this.target), octave: octavesFrom(h.midi, this.target) })
    }
    const oldest = this.now - MATCH.within
    while (this.recent.length > 0 && this.recent[0].time < oldest) this.recent.shift()
    if (this.foundOctave !== null) return
    const inTune = this.inTune()
    if (inTune.reduce((s, f) => s + f.seconds, 0) < MATCH.inTune) return
    const octaves = inTune.map((f) => f.octave).sort((a, b) => a - b)
    this.foundOctave = octaves[octaves.length >> 1]
  }

  private inTune(): Sung[] {
    return this.recent.filter((f) => Math.abs(f.cents) <= MATCH.band)
  }

  view(): MatchView {
    const found = this.foundOctave !== null
    const status: MatchStatus = found ? 'found' : this.now - this.from >= MATCH.timeout ? 'not-yet' : 'listening'
    const last = this.recent[this.recent.length - 1]
    const voice = last && this.now - last.time <= MATCH.fresh ? last : null
    const where = !voice ? 'silent' : voice.cents < -MATCH.band ? 'under' : voice.cents > MATCH.band ? 'over' : 'on'
    const seconds = this.inTune().reduce((s, f) => s + f.seconds, 0)
    return {
      status,
      where,
      held: found ? 1 : Math.min(1, seconds / MATCH.inTune),
      octave: this.foundOctave ?? 0,
      quiet: Math.max(0, this.now - (this.lastVoice ?? this.from)),
    }
  }
}

/**
 * Sings `midi` with the guide voice through `ctx`, starting now. Returns when the sound ends on the
 * clock of `ctx` (the clock the microphone frames are stamped with), and a way to cut it short.
 *
 * Always at A = 440, like every note the app sings: the reference pitch of the guitar side has no say here.
 */
export function playGuideNote(ctx: AudioContext, midi: number, seconds: number = MATCH.tone): { endsAt: number; stop(): void } {
  // A fresh array: an AudioBuffer only takes samples that own their memory.
  const samples = new Float32Array(renderVoiceNotes([{ time: 0, duration: seconds, midi }], { sampleRate: ctx.sampleRate }))
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
  buffer.copyToChannel(samples, 0)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return {
    endsAt: ctx.currentTime + seconds,
    stop() {
      try {
        source.stop()
      } catch {
        // It had already ended.
      }
    },
  }
}

/**
 * The app's own voice for a screen: one note at a time. A screen opens it when it appears and closes
 * it when it goes away; closed, it stays silent, so a note asked for a moment too late (the microphone
 * was still being opened when the learner left) is not sung into the next screen.
 */
export class GuidePlayer {
  private playing: { stop(): void } | null = null
  private closed = false

  open(): void {
    this.closed = false
  }

  close(): void {
    this.stop()
    this.closed = true
  }

  /** Sings the note, ending whatever was sounding. Returns when it ends, on the clock of `ctx` (now, when nothing is sung). */
  play(ctx: AudioContext, midi: number, seconds: number = MATCH.tone): number {
    this.stop()
    if (this.closed) return ctx.currentTime
    const note = playGuideNote(ctx, midi, seconds)
    this.playing = note
    return note.endsAt
  }

  stop(): void {
    this.playing?.stop()
    this.playing = null
  }
}

/** Everything the tool says. Kept here so one test can read every word. */
export const MATCH_COPY = {
  title: 'Meet the note',
  intro: 'You will hear a note. Then slide your voice up or down until your dot sits on the bar, and hold it there for a moment. Three notes. Nothing is scored.',
  start: 'Start',
  listen: 'Listen to the note.',
  turn: 'Now you. Slide until your dot meets the bar, then hold it.',
  under: 'Your dot is under the bar. Slide up a little.',
  over: 'Your dot is over the bar. Slide down a little.',
  on: 'You are on it. Hold it there.',
  found: 'That is the note. Well done.',
  octaveLower: 'You sang it an octave lower. That counts.',
  octaveHigher: 'You sang it an octave higher. That counts.',
  notYet: 'Not yet, and that is fine. Hear it once more, or go on to the next note.',
  silent: 'We cannot hear you yet. Move the phone a little closer.',
  again: 'Hear it again',
  next: 'Next note',
  finish: 'Finish',
  end: 'That is the whole idea: listen first, then find the note with your voice.',
  done: 'Done',
  once: 'Go again',
  skip: 'Skip this for now',
  micOff: 'The microphone is off. Tap Start and we will listen.',
  micTrouble: 'We could not use the microphone. Check that you allowed it in your browser, then try again. You can still listen to the notes.',
} as const

/** "Note 2 of 3": a count the learner can use. */
export function noteLabel(index: number): string {
  return `Note ${index + 1} of ${MATCH.notes}`
}

/** The one line under the ladder while a note is open. */
export function matchLine(view: MatchView): string {
  if (view.status === 'found') return view.octave < 0 ? MATCH_COPY.octaveLower : view.octave > 0 ? MATCH_COPY.octaveHigher : MATCH_COPY.found
  if (view.status === 'not-yet') return MATCH_COPY.notYet
  if (view.where === 'silent') return view.quiet >= MATCH.quietHint ? MATCH_COPY.silent : MATCH_COPY.turn
  return MATCH_COPY[view.where]
}
