/**
 * Tiny offline synthesiser used for the demo song and generated exercises:
 * Karplus–Strong plucked strings over a click/kick pattern, rendered straight
 * into a Float32Array (no AudioContext needed, so it also runs in tests).
 */
import type { Chart } from '../chart/types'
import { midiToFreq } from '../music/pitch'

export const SYNTH_SAMPLE_RATE = 44100

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Karplus–Strong pluck mixed into `out` from `startSample`. */
export function pluck(out: Float32Array, startSample: number, freq: number, seconds: number, amp: number, seed: number, sampleRate = SYNTH_SAMPLE_RATE): void {
  if (startSample >= out.length || freq <= 0) return
  const period = Math.max(2, Math.round(sampleRate / freq))
  const buf = new Float32Array(period)
  const rand = lcg(seed)
  for (let i = 0; i < period; i++) buf[i] = rand() * 2 - 1
  for (let i = 1; i < period; i++) buf[i] = 0.5 * (buf[i] + buf[i - 1])
  const total = Math.min(out.length - startSample, Math.round(seconds * sampleRate))
  const fadeStart = total - Math.round(0.03 * sampleRate)
  let idx = 0
  for (let i = 0; i < total; i++) {
    const cur = buf[idx]
    const next = buf[(idx + 1) % period]
    buf[idx] = 0.5 * (cur + next) * 0.996
    const env = i > fadeStart ? (total - i) / Math.max(1, total - fadeStart) : 1
    out[startSample + i] += cur * amp * env
    idx = (idx + 1) % period
  }
}

/** Short noise burst (hi-hat style click). */
export function hat(out: Float32Array, startSample: number, amp: number, seconds: number, seed: number, sampleRate = SYNTH_SAMPLE_RATE): void {
  if (startSample >= out.length) return
  const rand = lcg(seed)
  const total = Math.min(out.length - startSample, Math.round(seconds * sampleRate))
  for (let i = 0; i < total; i++) out[startSample + i] += (rand() * 2 - 1) * amp * Math.exp((-6 * i) / Math.max(1, total))
}

/** Soft kick drum. */
export function kick(out: Float32Array, startSample: number, amp: number, sampleRate = SYNTH_SAMPLE_RATE): void {
  if (startSample >= out.length) return
  const total = Math.min(out.length - startSample, Math.round(0.18 * sampleRate))
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate
    const f = 120 * Math.exp(-t * 18) + 45
    out[startSample + i] += Math.sin(2 * Math.PI * f * t) * amp * Math.exp(-t * 14)
  }
}

export function normalize(out: Float32Array, peakTarget = 0.9): Float32Array {
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  const gain = peak > 0 ? peakTarget / peak : 1
  for (let i = 0; i < out.length; i++) out[i] *= gain
  return out
}

export interface BackingOptions {
  sampleRate?: number
  /** Render the chart's notes as plucked strings (reference track). */
  plucks?: boolean
  /** Click on every beat, accented kick on downbeats. */
  click?: boolean
  pluckGain?: number
  /** Extra seconds after the last note. */
  tail?: number
  seed?: number
}

/**
 * Renders a chart to mono PCM: plucked notes (optional) over a beat click.
 * Deterministic for identical input.
 */
export function renderChartBacking(chart: Chart, options: BackingOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE
  const tail = options.tail ?? 1
  const plucks = options.plucks ?? true
  const click = options.click ?? true
  const pluckGain = options.pluckGain ?? 1
  const seed = options.seed ?? 1000
  const lastNoteEnd = chart.notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)
  const duration = Math.max(chart.duration, lastNoteEnd + tail, 1)
  const out = new Float32Array(Math.ceil(duration * sampleRate))
  if (click) {
    chart.beats.forEach((b, i) => {
      const s = Math.round(b.time * sampleRate)
      hat(out, s, b.isDownbeat ? 0.11 : 0.07, 0.04, 77 + i, sampleRate)
      if (b.isDownbeat || b.beatInBar % 2 === 0) kick(out, s, b.isDownbeat ? 0.35 : 0.22, sampleRate)
    })
  }
  if (plucks) {
    const byChord = new Map<number, number>()
    chart.notes.forEach((n, i) => {
      const strumIndex = byChord.get(n.chordId) ?? 0
      byChord.set(n.chordId, strumIndex + 1)
      const start = Math.round((n.time + strumIndex * 0.012) * sampleRate)
      const chordSize = chart.notes.filter((m) => m.chordId === n.chordId).length
      const amp = (chordSize > 1 ? 0.22 : 0.4) * pluckGain * (0.6 + 0.4 * n.velocity)
      pluck(out, start, midiToFreq(n.midi), Math.min(n.duration + 0.6, 2.5), amp, seed + i * 17, sampleRate)
    })
  }
  return normalize(out)
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate = SYNTH_SAMPLE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let o = 44
  for (let i = 0; i < samples.length; i++, o += 2) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
