import type { Beat, ChartNote } from '../../chart/types'
import { simplestPosition } from '../../music/fretboard'
import { midiToName } from '../../music/pitch'
import { stringColor } from '../../music/strings'
import { getSettings } from '../../app/settings'
import type { GroupState, ScoreSummary } from './scoring'

export interface HighwayState {
  songTime: number
  duration: number
  /** Notes of the active difficulty level, sorted by time. */
  notes: ChartNote[]
  statusOf: (noteId: number) => GroupState | undefined
  beats: Beat[]
  tuning: number[]
  capo: number
  detectedMidi: number | null
  detectedMatches: boolean
  hud: ScoreSummary
  lastJudgement: { text: string; at: number } | null
  /** Seconds of song time visible to the right of the hit line. */
  visibleSeconds: number
  showNoteNames: boolean
  paused: boolean
}

export type Handedness = 'right' | 'left'

/**
 * Row of a string's lane counted from the top of the highway. Right-handed (today's order):
 * thickest string at the bottom. Left-handed: mirrored, thickest string at the top.
 */
export function laneIndex(string: number, stringCount: number, handedness: Handedness): number {
  return handedness === 'left' ? string : stringCount - 1 - string
}

/** Text on the pill: X for dead notes, the note name when requested, otherwise the fret number. */
export function pillLabel(note: Pick<ChartNote, 'fret' | 'midi' | 'tech'>, opts: { showNoteNames: boolean }): string {
  if (note.tech?.dead) return 'X'
  return opts.showNoteNames ? midiToName(note.midi, false) : String(note.fret)
}

/** Lane label such as "6 E" (thickest) … "1 E" (thinnest); string 0 is number `tuning.length`. */
export function laneLabel(string: number, tuning: number[], capo = 0): string {
  return `${tuning.length - string} ${midiToName(tuning[string] + capo, false)}`
}

const onsetScratch: number[] = []

/**
 * True when no beat-long window within [fromTime, toTime] holds more than 2 distinct onsets
 * (chords count once). `secondsPerBeat` defaults to 0.5 (120 bpm).
 */
export function isSparse(notes: ChartNote[], fromTime: number, toTime: number, secondsPerBeat = 0.5): boolean {
  onsetScratch.length = 0
  for (const n of notes) {
    if (n.time < fromTime) continue
    if (n.time > toTime) break
    const last = onsetScratch.length - 1
    if (last < 0 || n.time - onsetScratch[last] > 1e-4) onsetScratch.push(n.time)
  }
  const w = secondsPerBeat * 1.001
  for (let i = 2; i < onsetScratch.length; i++) if (onsetScratch[i] - onsetScratch[i - 2] < w) return false
  return true
}

const TECH_GLYPH: Array<[keyof NonNullable<ChartNote['tech']>, string]> = [
  ['hammerOn', 'h'],
  ['pullOff', 'p'],
  ['slideOut', '/'],
  ['slideIn', '/'],
  ['bend', 'b'],
  ['vibrato', '~'],
  ['palmMute', 'PM'],
  ['harmonic', '◇'],
]

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
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

function firstIndexAtOrAfter(notes: ChartNote[], time: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Canvas renderer for the scrolling note highway (strings as lanes, notes travel right to left). */
export class HighwayRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private cssWidth = 0
  private cssHeight = 0

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
    const dpr = window.devicePixelRatio || 1
    this.cssWidth = rect.width
    this.cssHeight = rect.height
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr))
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(s: HighwayState): void {
    const { ctx } = this
    const W = this.cssWidth
    const H = this.cssHeight
    if (W <= 0 || H <= 0) return
    const S = s.tuning.length
    const short = H < 420 // phone in landscape
    const narrow = W < 520 // phone in portrait
    const top = short ? 52 : 70
    const bottom = short ? 24 : 34
    const laneH = (H - top - bottom) / S
    const { handedness, showFingerNumbers } = getSettings()
    const yOf = (str: number) => top + (laneIndex(str, S, handedness) + 0.5) * laneH
    const hitX = Math.round(Math.min(W * 0.2, 180))
    const pps = (W - hitX - 12) / Math.max(0.5, s.visibleSeconds)
    const xOf = (t: number) => hitX + (t - s.songTime) * pps
    const leftTime = s.songTime - (hitX + 80) / pps
    const rightTime = s.songTime + (W - hitX) / pps + 0.2

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0b0f17')
    bg.addColorStop(1, '#121826')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    const spb = s.beats.length > 1 ? Math.max(0.1, s.beats[1].time - s.beats[0].time) : 0.5
    const sparse = isSparse(s.notes, leftTime, rightTime, spb)

    // Lanes
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (let str = 0; str < S; str++) {
      const y = yOf(str)
      ctx.strokeStyle = stringColor(str)
      ctx.globalAlpha = 0.45
      ctx.lineWidth = (sparse ? 2 : 1) + (S - 1 - str) * 0.3
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
      ctx.globalAlpha = 0.6
      ctx.fillStyle = stringColor(str)
      ctx.textAlign = 'left'
      ctx.fillText(laneLabel(str, s.tuning, s.capo), 8, y - 10)
    }
    ctx.globalAlpha = 1

    // Beat lines
    ctx.textAlign = 'center'
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    for (const b of s.beats) {
      if (b.time < leftTime) continue
      if (b.time > rightTime) break
      const x = xOf(b.time)
      ctx.strokeStyle = b.isDownbeat ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.09)'
      ctx.lineWidth = b.isDownbeat ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(x, top - 6)
      ctx.lineTo(x, H - bottom + 6)
      ctx.stroke()
      if (b.isDownbeat) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.fillText(String(b.bar + 1), x + 12, H - bottom / 2)
      }
    }

    const maxPill = sparse ? 52 : 44

    // Visible notes
    const start = firstIndexAtOrAfter(s.notes, leftTime - 8)
    const visible: ChartNote[] = []
    for (let i = start; i < s.notes.length; i++) {
      const n = s.notes[i]
      if (n.time > rightTime) break
      if (n.time + n.duration < leftTime) continue
      visible.push(n)
    }

    // Chord connectors + names
    const chords = new Map<number, ChartNote[]>()
    for (const n of visible) {
      const arr = chords.get(n.chordId)
      if (arr) arr.push(n)
      else chords.set(n.chordId, [n])
    }
    ctx.font = '700 14px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    for (const group of chords.values()) {
      const x = xOf(group[0].time)
      const state = s.statusOf(group[0].id)
      const alpha = state?.status === 'hit' ? Math.max(0, 1 - (s.songTime - (state.hitAt ?? group[0].time)) / 0.4) : 1
      if (alpha <= 0) continue
      if (group.length > 1) {
        const ys = group.map((n) => yOf(n.string))
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * alpha})`
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(x, Math.min(...ys))
        ctx.lineTo(x, Math.max(...ys))
        ctx.stroke()
      }
      const name = group.find((n) => n.chordName)?.chordName
      if (name) {
        const topY = Math.min(...group.map((n) => yOf(n.string)))
        ctx.fillStyle = `rgba(248,250,252,${0.9 * alpha})`
        ctx.fillText(name, x, topY - Math.min(maxPill, laneH * 0.74) / 2 - 12)
      }
    }

    // Notes
    const pillH = Math.min(maxPill, laneH * 0.74)
    for (const n of visible) {
      const x = xOf(n.time)
      const y = yOf(n.string)
      const color = stringColor(n.string)
      const state = s.statusOf(n.id)
      const status = state?.status ?? 'pending'
      let alpha = 1
      if (status === 'hit') {
        alpha = Math.max(0, 1 - (s.songTime - (state?.hitAt ?? n.time)) / 0.4)
        if (alpha <= 0) continue
      } else if (status === 'miss' || status === 'skipped') {
        alpha = 0.45
      }
      ctx.globalAlpha = alpha

      // Sustain tail
      const len = n.duration * pps
      if (len > 26) {
        const sustaining = status === 'hit' && s.songTime < n.time + n.duration
        ctx.fillStyle = color
        ctx.globalAlpha = alpha * (sustaining ? 0.75 : 0.3)
        roundRect(ctx, x, y - pillH * 0.22, len, pillH * 0.44, 6)
        ctx.fill()
        ctx.globalAlpha = alpha
      }

      // Pill
      const label = pillLabel(n, s)
      const wantFinger = showFingerNumbers && n.finger !== undefined && n.fret > 0 && !n.tech?.dead
      const tiny = pillH < 28
      const inside = wantFinger && tiny ? String(n.finger) : label
      const pillW = (label.length > 1 ? 44 : 36) * (sparse ? 1.15 : 1)
      roundRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2)
      ctx.fillStyle = status === 'miss' ? '#475569' : color
      ctx.fill()
      if (status === 'pending' && Math.abs(x - hitX) < 40) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (status === 'hit') {
        ctx.strokeStyle = state?.judgement === 'perfect' ? '#86efac' : '#fde68a'
        ctx.lineWidth = 3
        ctx.stroke()
      } else if (status === 'miss') {
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.fillStyle = '#0b0f17'
      ctx.font = `800 ${Math.round(pillH * 0.5)}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(inside, x, y + 1)

      if (wantFinger) {
        if (tiny) {
          ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'
          ctx.fillStyle = 'rgba(248,250,252,0.9)'
          ctx.fillText(label, x, y - pillH / 2 - 7)
        } else {
          const r = Math.max(8, pillH * 0.26)
          const bx = x - pillW / 2
          ctx.beginPath()
          ctx.arc(bx, y, r, 0, Math.PI * 2)
          ctx.fillStyle = '#0b0f17'
          ctx.fill()
          ctx.strokeStyle = '#f8fafc'
          ctx.lineWidth = 1.5
          ctx.stroke()
          ctx.fillStyle = '#f8fafc'
          ctx.font = `800 ${Math.round(r * 1.2)}px ui-sans-serif, system-ui, sans-serif`
          ctx.fillText(String(n.finger), bx, y + 1)
        }
      }

      if (n.tech) {
        const glyph = TECH_GLYPH.find(([k]) => n.tech?.[k])?.[1]
        if (glyph) {
          ctx.fillStyle = 'rgba(248,250,252,0.85)'
          ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif'
          ctx.fillText(glyph, x + pillW / 2 + 8, y - pillH / 2 + 4)
        }
      }
    }
    ctx.globalAlpha = 1

    // Hit line
    const glow = ctx.createLinearGradient(0, top, 0, H - bottom)
    glow.addColorStop(0, 'rgba(255,255,255,0.1)')
    glow.addColorStop(0.5, 'rgba(255,255,255,0.9)')
    glow.addColorStop(1, 'rgba(255,255,255,0.1)')
    ctx.strokeStyle = glow
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(hitX, top - 10)
    ctx.lineTo(hitX, H - bottom + 10)
    ctx.stroke()

    // Detected pitch marker
    if (s.detectedMidi !== null) {
      const rounded = Math.round(s.detectedMidi)
      const pos = simplestPosition(rounded - s.capo, s.tuning)
      if (pos) {
        const y = yOf(pos.string)
        ctx.strokeStyle = s.detectedMatches ? '#4ade80' : 'rgba(248,250,252,0.85)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(hitX, y, pillH / 2 + 5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = s.detectedMatches ? '#4ade80' : 'rgba(248,250,252,0.85)'
        ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(midiToName(rounded, false), hitX, y - pillH / 2 - 14)
      }
    }

    // Progress bar
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, 0, W, 4)
    ctx.fillStyle = '#f59e0b'
    ctx.fillRect(0, 0, W * Math.min(1, Math.max(0, s.songTime / Math.max(1e-3, s.duration))), 4)

    // HUD
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(139,150,173,0.9)'
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText('SCORE', 12, 24)
    const hudSize = narrow || short ? 20 : 26
    ctx.fillStyle = '#f8fafc'
    ctx.font = `800 ${hudSize}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillText(s.hud.score.toLocaleString(), 12, short ? 44 : 50)

    ctx.textAlign = 'center'
    ctx.fillStyle = s.hud.streak >= 10 ? '#fbbf24' : '#f8fafc'
    ctx.font = `800 ${hudSize - 2}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillText(`×${s.hud.multiplier}`, W / 2, short ? 36 : 42)
    ctx.fillStyle = 'rgba(139,150,173,0.9)'
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
    ctx.fillText(`${s.hud.streak} streak`, W / 2, short ? 50 : 58)

    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(139,150,173,0.9)'
    ctx.fillText('ACCURACY', W - 12, 24)
    ctx.fillStyle = '#f8fafc'
    ctx.font = `800 ${hudSize}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillText(s.hud.judged > 0 ? `${Math.round(s.hud.accuracy * 100)}%` : '–', W - 12, short ? 44 : 50)

    // Judgement popup
    if (s.lastJudgement) {
      const age = s.songTime - s.lastJudgement.at
      if (age >= 0 && age < 0.6) {
        const a = 1 - age / 0.6
        ctx.globalAlpha = a
        ctx.textAlign = 'left'
        ctx.font = '800 22px ui-sans-serif, system-ui, sans-serif'
        ctx.fillStyle = s.lastJudgement.text === 'Perfect!' ? '#86efac' : s.lastJudgement.text === 'Good' ? '#fde68a' : '#fca5a5'
        ctx.fillText(s.lastJudgement.text, hitX + 24, top + 26 - age * 20)
        ctx.globalAlpha = 1
      }
    }

    if (s.paused) {
      ctx.fillStyle = 'rgba(11,15,23,0.55)'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#f8fafc'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '800 32px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText('Paused', W / 2, H / 2)
    }
  }
}
