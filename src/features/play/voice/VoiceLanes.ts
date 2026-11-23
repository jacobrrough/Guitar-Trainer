/**
 * The pitch lanes: what a sung chart is drawn with, where a guitar chart has the highway.
 *
 * Height is pitch and length is time. Every note is a bar as long as it lasts, moving from right to
 * left to the same line the guitar notes move to; a dot on the line is the singer's voice, and the part
 * of a bar that was sung in tune fills in. It is the picture of the lesson card "voice-lanes"
 * (src/components/diagrams/voiceScenes.tsx): bars, a line near the left, a yellow dot on it, the sung
 * part yellow.
 *
 * The layout is plain arithmetic in exported functions, tested without a canvas; the renderer below
 * only strokes and fills what they return. It has the surface of `HighwayRenderer` (`resize`, `draw`,
 * `width`), so the player holds either without knowing which.
 */
import type { Beat, Chart, ChartNote, VoiceChart, VoiceCue } from '../../../chart/types'
import { clamp } from '../../../music/pitch'
import { stringColor } from '../../../music/strings'
import type { GroupStatus, ScoreSummary } from '../scoring'
import { VOICE } from './judge'
import type { NoteProgress } from './voiceTracker'

/** Semitones of room shown under the lowest note of the chart and over the highest. */
export const LANE_MARGIN = 2
/** Seconds of the singer's pitch that stay on screen behind the dot. */
export const TRAIL_SECONDS = 1.5
/** Drawn before each line: the place to breathe (a raised comma, as in printed music). */
export const BREATH_MARK = '’'

/** The yellow of the dot and of the sung part, as in the lesson drawing (keep in step with voiceScenes.tsx). */
const ACCENT = stringColor(1)
const INK = '#0b0f14'
const LIGHT = 'rgba(248,250,252,0.92)'
const MUTED = 'rgba(203,213,225,0.8)'
const BAR_FILL = 'rgba(226,232,240,0.26)'
const BAR_STROKE = 'rgba(226,232,240,0.75)'
const FONT = 'ui-sans-serif, system-ui, sans-serif'

/** Room right of the last visible moment, as on the highway. */
const RIGHT_PAD = 12
/** A beat is drawn about this wide; a narrow screen shows fewer beats, never under `MIN_BEATS`. */
const BEAT_PIXELS = 70
const MIN_BEATS = 5
const MAX_BEATS = 10
/** No sung note is longer than this (seconds): how far back to look for a bar that is still on screen. */
const LONGEST_NOTE = 16
const EPS = 1e-6

/** The pitches at the bottom and the top edge of the lanes, as MIDI numbers. */
export interface PitchWindow {
  bottom: number
  top: number
}

/** What the lanes show of a chart: its notes with two semitones of room either side. */
export function pitchWindow(voice: Pick<VoiceChart, 'low' | 'high'>): PitchWindow {
  return { bottom: voice.low - LANE_MARGIN, top: voice.high + LANE_MARGIN }
}

/** The y of a pitch (a fraction of a semitone counts: the dot is never rounded to a note). Higher notes are higher up. */
export function pitchToY(midi: number, win: PitchWindow, area: { top: number; bottom: number }): number {
  const span = Math.max(EPS, win.top - win.bottom)
  return area.bottom - ((midi - win.bottom) / span) * (area.bottom - area.top)
}

/** Where the line is: the same place as the hit line of the highway. */
export function lineX(width: number): number {
  return Math.round(Math.min(width * 0.2, 180))
}

/**
 * Seconds of the song shown right of the line.
 *
 * The highway shows a fixed number of seconds, which suits picked notes. Sung notes last a beat or
 * several, and a singer has to see the next note while holding this one, so the lanes show a number
 * of beats instead: more seconds of a slow song, fewer of a quick one, and a beat is about as wide at
 * every tempo. `preference` is the learner's "seconds visible" setting (3 unless changed) and stretches
 * the view in proportion.
 */
export function lanesVisibleSeconds(bpm: number, width: number, preference = 3): number {
  const usable = Math.max(1, width - lineX(width) - RIGHT_PAD)
  const beats = clamp(usable / BEAT_PIXELS, MIN_BEATS, MAX_BEATS)
  const stretch = preference > 0 ? preference / 3 : 1
  return (beats * stretch * 60) / Math.max(20, bpm)
}

export interface LaneLayout {
  /** x of the line the bars move to. */
  lineX: number
  /** Pixels per second of song time. */
  pps: number
  /** Top and bottom of the area the pitches are spread over. */
  top: number
  bottom: number
  win: PitchWindow
  barHeight: number
}

/** The geometry of the lanes on a canvas of this size. */
export function laneLayout(width: number, height: number, voice: Pick<VoiceChart, 'low' | 'high'>, visibleSeconds: number): LaneLayout {
  const short = height < 420 // phone in landscape
  // Above: the count of notes and whose turn it is. Below: the word under the lowest bar.
  const top = Math.min(short ? 58 : 78, height * 0.35)
  const bottom = Math.max(top + 1, height - (short ? 30 : 40))
  const win = pitchWindow(voice)
  const x = lineX(width)
  const semitone = (bottom - top) / Math.max(1, win.top - win.bottom)
  return {
    lineX: x,
    pps: Math.max(1, width - x - RIGHT_PAD) / Math.max(0.5, visibleSeconds),
    top,
    bottom,
    win,
    barHeight: clamp(semitone * 0.8, 6, 26),
  }
}

export interface BarBox {
  x: number
  y: number
  w: number
  h: number
}

/** The bar of a note or a cue at `songTime`: its left end is on the line at the moment the note is due. */
export function barBox(item: { time: number; duration: number; midi: number }, songTime: number, l: LaneLayout): BarBox {
  return {
    x: l.lineX + (item.time - songTime) * l.pps,
    y: pitchToY(item.midi, l.win, l) - l.barHeight / 2,
    w: item.duration * l.pps,
    h: l.barHeight,
  }
}

/**
 * How much of a bar is filled, from its start: the share of the note sung in tune.
 *
 * While the note is still being sung the fill stops at the line. The share is counted against the part
 * of a note that has to be sung (its length without the way in and the way out), and a note begun a
 * little early is credited before it is due; without the stop, the bar would fill ahead of the voice.
 */
export function fillFraction(note: { time: number; duration: number }, progress: Pick<NoteProgress, 'status' | 'share'> | undefined, songTime: number): number {
  if (!progress || !Number.isFinite(progress.share)) return 0
  const share = clamp(progress.share, 0, 1)
  if (progress.status !== 'pending') return share
  const passed = note.duration > 0 ? (songTime - note.time) / note.duration : 1
  return clamp(Math.min(share, passed), 0, 1)
}

/**
 * A voice within this many semitones of the note is drawn in the octave it was last drawn in (see
 * `octaveShift`). More than a sixth, so the jumps a tune makes are covered with room for a note held a
 * little flat; less than an octave by enough that a voice which really is an octave away, and a tone
 * out on top of that, is still seen for what it is.
 */
export const SAME_OCTAVE_REACH = 10

/**
 * By how many whole octaves a sung pitch is moved before it is drawn, so that it lies by `near` (the
 * note being sung). Any octave counts when a note is scored, so a low voice singing a high tune must
 * see its dot on the bars, not an octave under them.
 *
 * `kept` is the answer for the frame before. It stays as long as the voice is within reach of the
 * note, and only a voice heard for the first time, or one that has changed octave, is given the
 * octave nearest the note. Without that the dot leaps at every jump of a fifth or more in the tune:
 * what the microphone hears reaches the screen a moment after the bar does (and a singer is seldom
 * early), so for that moment the note before is heard against the new one. C against the G above it
 * is seven under, and the nearest octave of C is five over: the dot would flash above the bar and
 * come back down, on every such jump, for as long as the sound delay of the phone.
 */
export function octaveShift(midi: number, near: number, kept?: number | null): number {
  if (kept !== undefined && kept !== null && Math.abs(midi + 12 * kept - near) <= SAME_OCTAVE_REACH) return kept
  return Math.round((near - midi) / 12) + 0
}

/**
 * Where the dot goes for a sung pitch: moved by whole octaves to lie by `near` (the note being sung;
 * the middle of the lanes when there is none), then kept inside the lanes. `kept` is the octave the
 * dot was last moved by, if it has been drawn before (see `octaveShift`).
 *
 * Folding towards the note, and not towards the middle of the screen, matters on lanes taller than an
 * octave: there the octave below a high note is on screen too, and the dot belongs on the bar.
 * A voice that is off the top or the bottom stays at the edge, which still says "over" or "under".
 */
export function foldIntoWindow(midi: number, win: PitchWindow, near: number = (win.bottom + win.top) / 2, kept?: number | null): number {
  return clamp(midi + 12 * octaveShift(midi, near, kept), win.bottom, win.top)
}

/** One moment of the singer's pitch as it was drawn; `midi` null = nothing was heard. */
export interface TrailPoint {
  time: number
  midi: number | null
}

/**
 * Adds the pitch at `time` to the trail (in place) and drops what is older than `keep` seconds.
 * A clock that stands still (ready, paused) does not grow the trail, and one that jumps back (restart,
 * a loop wrapping) starts it again: what was sung after this moment is not behind it.
 */
export function extendTrail(trail: TrailPoint[], time: number, midi: number | null, keep = TRAIL_SECONDS): TrailPoint[] {
  const last = trail[trail.length - 1]
  if (last && time < last.time - 1e-3) trail.length = 0
  const end = trail[trail.length - 1]
  if (end && time - end.time < 1e-4) end.midi = midi
  else trail.push({ time, midi })
  while (trail.length > 0 && trail[0].time < time - keep) trail.shift()
  return trail
}

/**
 * Whether a note is drawn where it is. On an echo by ear (`hideAnswers`) the notes to sing stay out
 * of sight until each has been judged: the point is to hear the tune, not to read it.
 */
export function answerShown(voice: Pick<VoiceChart, 'hideAnswers'>, status: GroupStatus | undefined): boolean {
  return !voice.hideAnswers || status === 'hit' || status === 'miss'
}

/**
 * Whether one of the app's own notes is sounding at `t`, as the microphone hears it: from just before
 * a cue to a moment after it, the stretch in which the tracker gives no credit either (`VOICE.cueBefore`,
 * `VOICE.cueAfter`).
 *
 * On an echo by ear the pitch that is heard is not drawn in that stretch (see `draw`). On a bare phone
 * the microphone hears the call from the speaker, and the dot with its trail would write out, note by
 * note, the tune whose bars are kept out of sight.
 *
 * `lag` is how far what is heard is behind the clock (the sound-delay setting, in song time): the end
 * of a call reaches the screen that much later. The start is not moved: early is the safe side.
 */
export function callSounding(cues: readonly VoiceCue[], t: number, lag = 0): boolean {
  return cues.some((c) => t >= c.time - VOICE.cueBefore && t <= c.time + c.duration + VOICE.cueAfter + Math.max(0, lag))
}

/**
 * What is written at a bar. A trailing hyphen stays (the word goes on with the next note). An empty
 * syllable is not "no word": it is the syllable before, still being sung on a new pitch, so the bar is
 * joined to the one before instead of getting a label.
 */
export function barLabel(lyric: string | undefined): { text: string; carried: boolean } {
  return { text: lyric ?? '', carried: lyric === '' }
}

/**
 * The arrow at a note that did not count: where the note is from where it was sung. Sung under, the
 * arrow points up. A note that was not heard, or was around the note without staying on it, gets none:
 * there is no direction to give.
 */
export function missArrow(progress: Pick<NoteProgress, 'status' | 'reason'> | undefined): 'up' | 'down' | null {
  if (!progress || progress.status !== 'miss') return null
  return progress.reason === 'low' ? 'up' : progress.reason === 'high' ? 'down' : null
}

export interface TurnCaption {
  /** From the first note of the turn to the end of its last one (for "Your turn": of its first line). */
  time: number
  end: number
  text: 'Listen' | 'Your turn'
}

/**
 * Whose turn it is, for the words over the bars. Cues with nothing to sing between them are one call
 * ("Listen"); the notes that follow a call are the singer's ("Your turn"). "Your turn" stands over the
 * first line only: once the singer is singing, nothing needs saying. A chart without cues has no turns.
 */
export function turnCaptions(notes: readonly ChartNote[], cues: readonly VoiceCue[], lineStarts: readonly number[]): TurnCaption[] {
  const calls = [...cues].sort((a, b) => a.time - b.time)
  const captions: TurnCaption[] = []
  let i = 0
  while (i < calls.length) {
    const from = calls[i].time
    let end = from + calls[i].duration
    let j = i + 1
    while (j < calls.length && !notes.some((n) => n.time >= end - EPS && n.time < calls[j].time)) {
      end = Math.max(end, calls[j].time + calls[j].duration)
      j++
    }
    captions.push({ time: from, end, text: 'Listen' })
    const nextCall = j < calls.length ? calls[j].time : Number.POSITIVE_INFINITY
    const answer = notes.filter((n) => n.time >= end - EPS && n.time < nextCall)
    if (answer.length > 0) {
      const start = answer.reduce((m, n) => Math.min(m, n.time), Number.POSITIVE_INFINITY)
      const nextLine = lineStarts.reduce((m, t) => (t > start + EPS && t < m ? t : m), Number.POSITIVE_INFINITY)
      const until = answer.reduce((m, n) => (n.time < nextLine - EPS ? Math.max(m, n.time + n.duration) : m), start)
      captions.push({ time: start, end: until, text: 'Your turn' })
    }
    i = j
  }
  return captions
}

/**
 * Whether a line begins after `a` and no later than `b`: the singer breathes between the two, so
 * nothing is drawn from one to the other.
 */
export function breaksLine(a: { time: number }, b: { time: number }, lineStarts: readonly number[]): boolean {
  return lineStarts.some((t) => t > a.time + EPS && t <= b.time + EPS)
}

/**
 * The pairs of notes a glide is drawn between (slides): each note and the next, except across the
 * start of a line. `items` in order of time.
 */
export function glidePairs<T extends { time: number }>(items: readonly T[], lineStarts: readonly number[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = []
  for (let i = 1; i < items.length; i++) {
    if (!breaksLine(items[i - 1], items[i], lineStarts)) pairs.push([items[i - 1], items[i]])
  }
  return pairs
}

/** The corner of the screen: notes in tune so far out of all there are. No score, no multiplier, no streak. */
export function notesReadout(hud: Pick<ScoreSummary, 'perfects' | 'goods' | 'total'>): string {
  return `${hud.perfects + hud.goods} of ${hud.total} ${hud.total === 1 ? 'note' : 'notes'}`
}

/** Seconds from `t` to a note or cue: 0 while it sounds. */
function distanceInTime(item: { time: number; duration: number }, t: number): number {
  if (t < item.time) return item.time - t
  return Math.max(0, t - (item.time + item.duration))
}

function firstIndexAtOrAfter(notes: readonly ChartNote[], time: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The pitch the dot is folded towards at `t`: of the note or cue that sounds then, else of the one
 * nearest in time. Undefined on a chart with nothing in it. `notes` in order of time.
 */
export function foldTarget(notes: readonly ChartNote[], cues: readonly VoiceCue[], t: number): number | undefined {
  let best: { midi: number } | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  const consider = (item: { time: number; duration: number; midi: number } | undefined) => {
    if (!item) return
    const d = distanceInTime(item, t)
    if (d < bestDistance) {
      best = item
      bestDistance = d
    }
  }
  const i = firstIndexAtOrAfter(notes, t)
  consider(notes[i - 1])
  consider(notes[i])
  for (const c of cues) consider(c)
  return best?.midi
}

export interface VoiceLanesState {
  songTime: number
  duration: number
  /** The notes that are scored, in order of time. */
  notes: ChartNote[]
  /** The sung chart: its range, its cues and its lines are read from `chart.voice`. */
  chart: Chart
  beats: Beat[]
  /** The pitch heard now as a fractional MIDI number, or null. */
  detectedMidi: number | null
  /** That pitch has just counted for a note. */
  detectedMatches: boolean
  hud: ScoreSummary
  lastJudgement: { text: string; at: number } | null
  /** Seconds of song time right of the line (see `lanesVisibleSeconds`). */
  visibleSeconds: number
  paused: boolean
  /** How far each note is filled and what became of it (`RunTracker.progressOf`). */
  progressOf: (noteId: number) => NoteProgress | undefined
  /** The song's sound is running (not before the start, in the count-in or in a pause). Taken as running when left out. */
  playing?: boolean
  /** Seconds of song time by which what the microphone hears is behind `songTime` (the sound-delay setting); none when left out. */
  lag?: number
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

/** What is worked out once for a chart and its notes, not on every frame. */
interface ChartFacts {
  chart: Chart
  notes: ChartNote[]
  cues: VoiceCue[]
  captions: TurnCaption[]
  /** Per cue (in order of time): which call it belongs to. */
  call: number[]
  /** Slides: the ids of the notes a glide is drawn to from the note before. */
  glideTo: Set<number>
}

function factsOf(chart: Chart, notes: ChartNote[], voice: VoiceChart): ChartFacts {
  const cues = [...voice.cues].sort((a, b) => a.time - b.time)
  const captions = turnCaptions(notes, cues, voice.lineStarts)
  const calls = captions.filter((c) => c.text === 'Listen')
  const call = cues.map((c) => calls.findIndex((k) => c.time >= k.time - EPS && c.time < k.end))
  const glideTo = new Set(voice.glide ? glidePairs(notes, voice.lineStarts).map(([, to]) => to.id) : [])
  return { chart, notes, cues, captions, call, glideTo }
}

/** Canvas renderer for a sung chart: pitch as height, notes as bars that move right to left, the voice as a dot on the line. */
export class VoiceLanesRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private cssWidth = 0
  private cssHeight = 0
  private facts: ChartFacts | null = null
  private readonly trail: TrailPoint[] = []
  /** Whole octaves the dot was last moved by (see `octaveShift`); null until a voice is heard. */
  private octave: number | null = null
  /** Song time of the frame before, to notice the song starting again. */
  private lastTime = 0

  /** CSS pixel width of the last layout. */
  get width(): number {
    return this.cssWidth
  }

  get height(): number {
    return this.cssHeight
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = globalThis.devicePixelRatio || 1
    this.cssWidth = rect.width
    this.cssHeight = rect.height
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(s: VoiceLanesState): void {
    const { ctx } = this
    const W = this.cssWidth
    const H = this.cssHeight
    const voice = s.chart.voice
    if (W <= 0 || H <= 0 || !voice) return
    if (!this.facts || this.facts.chart !== s.chart || this.facts.notes !== s.notes) {
      this.facts = factsOf(s.chart, s.notes, voice)
      this.octave = null
    }
    // The song went back (a restart, a loop coming round): whoever sings next is heard afresh.
    if (s.songTime < this.lastTime - 1e-3) this.octave = null
    this.lastTime = s.songTime
    const { cues, captions, call, glideTo } = this.facts
    const l = laneLayout(W, H, voice, s.visibleSeconds)
    const short = H < 420
    const narrow = W < 520
    const xOf = (t: number) => l.lineX + (t - s.songTime) * l.pps
    const leftTime = s.songTime - (l.lineX + 80) / l.pps
    const rightTime = s.songTime + (W - l.lineX) / l.pps + 0.2
    const onScreen = (item: { time: number; duration: number }) => item.time <= rightTime && item.time + item.duration >= leftTime
    const labelSize = short || narrow ? 12 : 14

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0b0f17')
    bg.addColorStop(1, '#121826')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // A faint line for every note of the range: the lanes. (Every semitone, not only the notes of the
    // chart, so an echo by ear is not given away by its lines.)
    if (voice.high - voice.low <= 36) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      for (let m = voice.low; m <= voice.high; m++) {
        const y = pitchToY(m, l.win, l)
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }
    }

    // Beat lines
    for (const b of s.beats) {
      if (b.time < leftTime) continue
      if (b.time > rightTime) break
      const x = xOf(b.time)
      ctx.strokeStyle = b.isDownbeat ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'
      ctx.lineWidth = b.isDownbeat ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(x, l.top - 6)
      ctx.lineTo(x, l.bottom + 6)
      ctx.stroke()
    }

    // The notes on screen, each with what has become of it.
    const first = firstIndexAtOrAfter(s.notes, leftTime - LONGEST_NOTE)
    const shown: Array<{ note: ChartNote; index: number; progress: NoteProgress | undefined; visible: boolean }> = []
    for (let i = first; i < s.notes.length; i++) {
      const note = s.notes[i]
      if (note.time > rightTime) break
      if (!onScreen(note)) continue
      const progress = s.progressOf(note.id)
      shown.push({ note, index: i, progress, visible: answerShown(voice, progress?.status) })
    }

    // A curve from the end of one bar to the start of the next: the glide of a slide, or a syllable carried on to a new pitch.
    const join = (a: { time: number; duration: number; midi: number }, b: { time: number; duration: number; midi: number }, glide: boolean, dashed: boolean) => {
      const from = barBox(a, s.songTime, l)
      const to = barBox(b, s.songTime, l)
      // Two notes with nothing between them: start a little inside each bar, so the join has some length.
      const tight = to.x - (from.x + from.w) < 12
      const x0 = from.x + from.w - (tight ? Math.min(10, from.w / 2) : 0)
      const x1 = to.x + (tight ? Math.min(10, to.w / 2) : 0)
      const y0 = from.y + from.h / 2
      const y1 = to.y + to.h / 2
      const mid = (x0 + x1) / 2
      ctx.strokeStyle = 'rgba(226,232,240,0.5)'
      ctx.lineWidth = glide ? Math.max(2, l.barHeight * 0.22) : 1.5
      ctx.setLineDash(dashed ? [4, 4] : [])
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.bezierCurveTo(mid, y0, mid, y1, x1, y1)
      ctx.stroke()
      ctx.setLineDash([])
    }
    for (const { note, index, visible } of shown) {
      const before = s.notes[index - 1]
      if (!before || !visible || !answerShown(voice, s.progressOf(before.id)?.status)) continue
      const glide = glideTo.has(note.id)
      if (glide || barLabel(note.lyric).carried) join(before, note, glide, false)
    }
    if (!voice.hideAnswers) {
      for (let i = 1; i < cues.length; i++) {
        if (call[i] < 0 || call[i] !== call[i - 1] || !(onScreen(cues[i - 1]) || onScreen(cues[i]))) continue
        if (voice.glide || barLabel(cues[i].lyric).carried) join(cues[i - 1], cues[i], !!voice.glide, true)
      }
    }

    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'

    // The app's own notes: hollow bars, to listen to.
    for (const c of cues) {
      if (!onScreen(c)) continue
      const box = barBox(c, s.songTime, l)
      const w = Math.max(3, box.w - 2)
      ctx.strokeStyle = 'rgba(226,232,240,0.6)'
      ctx.lineWidth = 1.5
      if (voice.hideAnswers) {
        // An echo by ear: when the app sings is shown, what it sings is not.
        ctx.setLineDash([4, 4])
        roundRect(ctx, box.x, l.top, w, l.bottom - l.top, 6)
        ctx.stroke()
        ctx.setLineDash([])
        continue
      }
      roundRect(ctx, box.x, box.y, w, box.h, box.h / 2)
      ctx.stroke()
      const label = barLabel(c.lyric)
      if (label.text) {
        ctx.font = `600 ${labelSize}px ${FONT}`
        ctx.fillStyle = MUTED
        ctx.fillText(label.text, box.x + 1, box.y + box.h + labelSize)
      }
    }

    // The notes to sing: solid bars; the sung part filled; the outline says how each went.
    for (const { note, progress, visible } of shown) {
      const status = progress?.status ?? 'pending'
      const box = barBox(note, s.songTime, l)
      const w = Math.max(3, box.w - 2)
      if (!visible) {
        // Not shown yet: when to sing, without where. What is sung in tune still fills in, so the
        // singer is told "that is it" while singing, and sees the note itself once it is judged.
        roundRect(ctx, box.x, l.top, w, l.bottom - l.top, 6)
        ctx.fillStyle = 'rgba(226,232,240,0.07)'
        ctx.fill()
        const sungSoFar = fillFraction(note, progress, s.songTime)
        if (sungSoFar > 0) {
          ctx.save()
          ctx.beginPath()
          ctx.rect(box.x, l.top, box.w * sungSoFar, l.bottom - l.top)
          ctx.clip()
          roundRect(ctx, box.x, l.top, w, l.bottom - l.top, 6)
          ctx.globalAlpha = 0.22
          ctx.fillStyle = ACCENT
          ctx.fill()
          ctx.restore()
        }
        roundRect(ctx, box.x, l.top, w, l.bottom - l.top, 6)
        ctx.strokeStyle = 'rgba(226,232,240,0.3)'
        ctx.lineWidth = 1
        ctx.stroke()
        continue
      }
      const due = status === 'pending' && s.songTime >= note.time && s.songTime <= note.time + note.duration
      ctx.globalAlpha = status === 'miss' || status === 'skipped' ? 0.5 : 1
      roundRect(ctx, box.x, box.y, w, box.h, box.h / 2)
      ctx.fillStyle = BAR_FILL
      ctx.fill()
      const filled = fillFraction(note, progress, s.songTime)
      if (filled > 0) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(box.x, box.y - 1, box.w * filled, box.h + 2)
        ctx.clip()
        roundRect(ctx, box.x, box.y, w, box.h, box.h / 2)
        ctx.fillStyle = ACCENT
        ctx.fill()
        ctx.restore()
      }
      roundRect(ctx, box.x, box.y, w, box.h, box.h / 2)
      if (status === 'hit') {
        ctx.strokeStyle = progress?.judgement === 'perfect' ? '#86efac' : '#fde68a'
        ctx.lineWidth = 2.5
      } else {
        ctx.strokeStyle = due ? '#f8fafc' : BAR_STROKE
        ctx.lineWidth = due ? 2 : 1.5
      }
      ctx.stroke()
      const label = barLabel(note.lyric)
      if (label.text) {
        ctx.font = `600 ${labelSize}px ${FONT}`
        ctx.fillStyle = LIGHT
        ctx.fillText(label.text, box.x + 1, box.y + box.h + labelSize)
      }
      ctx.globalAlpha = 1
      const arrow = missArrow(progress)
      if (arrow) {
        ctx.font = `800 ${labelSize + 4}px ${FONT}`
        ctx.fillStyle = '#fbbf24'
        ctx.textAlign = 'center'
        // At the end of the bar: a note is judged just after it has passed the line, and its end is what is still in view.
        ctx.fillText(arrow === 'up' ? '↑' : '↓', box.x + w - Math.min(w / 2, 16), box.y - 4)
        ctx.textAlign = 'left'
      }
    }

    // A breath before each line.
    ctx.font = `700 ${short ? 20 : 24}px ${FONT}`
    ctx.fillStyle = MUTED
    for (const t of voice.lineStarts) {
      if (t < leftTime || t > rightTime) continue
      ctx.fillText(BREATH_MARK, xOf(t) - 12, l.top + (short ? 16 : 20))
    }

    // Whose turn it is. A caption comes in with its first note, waits by the line while the turn lasts and leaves with its last note.
    ctx.font = `700 13px ${FONT}`
    for (const c of captions) {
      const width = ctx.measureText(c.text).width
      const x = Math.max(xOf(c.time), Math.min(l.lineX + 8, xOf(c.end) - width))
      if (x + width < 0 || x > W) continue
      ctx.fillStyle = c.text === 'Your turn' ? ACCENT : MUTED
      ctx.fillText(c.text, x, l.top - 10)
    }

    // The line
    ctx.strokeStyle = LIGHT
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(l.lineX, l.top - 8)
    ctx.lineTo(l.lineX, l.bottom + 8)
    ctx.stroke()

    // The voice: a dot on the line, and where it has been. On an echo by ear nothing is drawn while
    // the app sings its call: what a bare phone hears then is its own speaker (see `callSounding`).
    const hushed = !!voice.hideAnswers && s.playing !== false && callSounding(cues, s.songTime, s.lag)
    const heard = hushed ? null : s.detectedMidi
    const target = foldTarget(s.notes, cues, s.songTime) ?? (l.win.bottom + l.win.top) / 2
    if (heard !== null) this.octave = octaveShift(heard, target, this.octave)
    const sung = heard === null ? null : foldIntoWindow(heard, l.win, target, this.octave)
    extendTrail(this.trail, s.songTime, sung)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 3
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1]
      const b = this.trail[i]
      if (a.midi === null || b.midi === null || b.time - a.time > 0.2) continue
      ctx.globalAlpha = 0.75 * Math.max(0, 1 - (s.songTime - b.time) / TRAIL_SECONDS)
      ctx.beginPath()
      ctx.moveTo(xOf(a.time), pitchToY(a.midi, l.win, l))
      ctx.lineTo(xOf(b.time), pitchToY(b.midi, l.win, l))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'
    if (sung !== null) {
      ctx.beginPath()
      ctx.arc(l.lineX, pitchToY(sung, l.win, l), clamp(l.barHeight * 0.5, 5, 9), 0, Math.PI * 2)
      ctx.fillStyle = ACCENT
      ctx.fill()
      ctx.strokeStyle = s.detectedMatches ? '#f8fafc' : INK
      ctx.lineWidth = s.detectedMatches ? 2.5 : 1.5
      ctx.stroke()
    }

    // Progress bar
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, 0, W, 4)
    ctx.fillStyle = '#f59e0b'
    ctx.fillRect(0, 0, W * Math.min(1, Math.max(0, s.songTime / Math.max(1e-3, s.duration))), 4)

    // The corner: notes in tune so far.
    ctx.fillStyle = '#f8fafc'
    ctx.font = `800 ${narrow || short ? 18 : 22}px ${FONT}`
    ctx.fillText(notesReadout(s.hud), 12, short ? 30 : 36)

    // A word when a note has just counted. Nothing is flashed for one that did not: its bar says it.
    if (s.lastJudgement && s.lastJudgement.text !== 'Miss') {
      const age = s.songTime - s.lastJudgement.at
      if (age >= 0 && age < 0.6) {
        ctx.globalAlpha = 1 - age / 0.6
        ctx.font = `800 ${short ? 16 : 20}px ${FONT}`
        ctx.fillStyle = s.lastJudgement.text === 'Perfect!' ? '#86efac' : '#fde68a'
        ctx.fillText(s.lastJudgement.text, l.lineX + 12, l.bottom + (short ? 24 : 30) - age * 8)
        ctx.globalAlpha = 1
      }
    }

    if (s.paused) {
      ctx.fillStyle = 'rgba(11,15,23,0.55)'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#f8fafc'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `800 32px ${FONT}`
      ctx.fillText('Paused', W / 2, H / 2)
    }
  }
}
