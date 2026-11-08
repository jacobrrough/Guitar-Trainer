/**
 * Offline guitar synthesiser for the demo song, the bundled songs, generated exercises and the ear
 * trainer. Each note is an extended Karplus–Strong string (Jaffe & Smith): a noise burst shaped by
 * where and how hard the string is picked, circulating through a delay line tuned to the exact
 * period, losing energy the way a real string does. The strings go through a small guitar-body
 * resonator, over a soft kick-and-hat click track, and the mix is levelled by loudness. Everything
 * renders straight into a Float32Array, so it runs in tests and workers without an AudioContext.
 */
import type { Chart, ChartNote } from '../chart/types'
import { midiToFreq } from '../music/pitch'

export const SYNTH_SAMPLE_RATE = 44100
/** Bumped whenever the sound changes, so audio rendered by an older synth and stored in the library is rendered again. */
export const SYNTH_VERSION = 2

/** File name for stored synthesised audio; carries the synth version so stale renders can be found. */
export function synthAudioName(base: string): string {
  return `${base}.v${SYNTH_VERSION}.wav`
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** One-pole low-pass coefficient for a cutoff in Hz. */
function onePole(cutoff: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
}

export interface PluckOptions {
  /** How hard the string is struck, 0..1. Harder is louder and brighter. */
  velocity?: number
  /** Picking point as a fraction of the string length from the bridge (0.5 is the middle, a pick sits near 0.15). */
  pickPosition?: number
  /** Nylon strings are darker and die away sooner than steel. */
  nylon?: boolean
}

/**
 * Karplus–Strong pluck mixed into `out` from `startSample`.
 *
 * The loop is a ring buffer, a two-point average (the string's frequency-dependent loss), a loss
 * factor set from a realistic 60 dB decay time, and a first-order all-pass that supplies the
 * fractional part of the period so every note is in tune rather than rounded to whole samples.
 */
export function pluck(
  out: Float32Array,
  startSample: number,
  freq: number,
  seconds: number,
  amp: number,
  seed: number,
  sampleRate = SYNTH_SAMPLE_RATE,
  options: PluckOptions = {},
): void {
  if (startSample >= out.length || freq <= 0) return
  const velocity = clamp(options.velocity ?? 0.8, 0.05, 1)
  const nylon = options.nylon ?? false
  const rand = lcg(seed)
  const pickPosition = clamp(options.pickPosition ?? 0.1 + 0.07 * rand(), 0.05, 0.5)

  // Loop delay. The ring buffer of n samples plus the average gives n - 0.5; the all-pass adds `frac`.
  const exact = sampleRate / freq + 0.5
  const n = Math.max(2, Math.floor(exact - 0.1))
  const frac = exact - n
  const apC = (1 - frac) / (1 + frac)

  // Excitation: the string pulled into a triangle at the pick point and let go. The delay line carries
  // the slope of that shape (a two-level pulse), whose harmonics fall off like a real pluck's, with a
  // strong fundamental every time; a little noise is the pick scraping the string.
  const buf = new Float32Array(n)
  const pickSample = Math.max(1, Math.min(n - 1, Math.round(pickPosition * n)))
  const up = 1 / pickSample
  const down = 1 / (n - pickSample)
  const noise = 0.25 * velocity
  for (let i = 0; i < n; i++) buf[i] = (i < pickSample ? up : -down) * 0.5 * n * 0.1 + noise * (rand() * 2 - 1)
  const cutoff = (nylon ? 0.5 : 1) * (1500 + 6000 * velocity * velocity)
  const a = onePole(cutoff, sampleRate)
  let y = 0
  for (let i = 0; i < n; i++) {
    y += a * (buf[i] - y)
    buf[i] = y
  }
  let mean = 0
  for (let i = 0; i < n; i++) mean += buf[i]
  mean /= n
  let peak = 1e-9
  for (let i = 0; i < n; i++) {
    buf[i] -= mean
    peak = Math.max(peak, Math.abs(buf[i]))
  }
  const scale = (0.35 + 0.65 * velocity) / peak
  for (let i = 0; i < n; i++) buf[i] *= scale

  // Loss per period from a 60 dB decay time: low strings ring for seconds, high ones die sooner.
  const t60 = clamp((nylon ? 3.5 : 6.5) * Math.sqrt(110 / freq), 1.2, 9)
  const rho = 10 ** (-3 / (freq * t60))

  const total = Math.min(out.length - startSample, Math.round(seconds * sampleRate))
  const fadeStart = total - Math.round(0.03 * sampleRate)
  let idx = 0
  let apX1 = 0
  let apY1 = 0
  for (let i = 0; i < total; i++) {
    const cur = buf[idx]
    const nextIdx = idx + 1 === n ? 0 : idx + 1
    const avg = 0.5 * (cur + buf[nextIdx]) * rho
    const ap = apC * (avg - apY1) + apX1
    apX1 = avg
    apY1 = ap
    buf[idx] = ap
    const env = i > fadeStart ? (total - i) / Math.max(1, total - fadeStart) : 1
    out[startSample + i] += cur * amp * env
    idx = nextIdx
  }
}

/** Direct-form biquad (RBJ cookbook). */
class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private z1 = 0
  private z2 = 0

  static bandpass(freq: number, q: number, sampleRate: number): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * freq) / sampleRate
    const alpha = Math.sin(w0) / (2 * q)
    const a0 = 1 + alpha
    f.b0 = alpha / a0
    f.b1 = 0
    f.b2 = -alpha / a0
    f.a1 = (-2 * Math.cos(w0)) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  static highpass(freq: number, q: number, sampleRate: number): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * freq) / sampleRate
    const alpha = Math.sin(w0) / (2 * q)
    const cos = Math.cos(w0)
    const a0 = 1 + alpha
    f.b0 = (1 + cos) / 2 / a0
    f.b1 = -(1 + cos) / a0
    f.b2 = (1 + cos) / 2 / a0
    f.a1 = (-2 * cos) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  static lowpass(freq: number, q: number, sampleRate: number): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * freq) / sampleRate
    const alpha = Math.sin(w0) / (2 * q)
    const cos = Math.cos(w0)
    const a0 = 1 + alpha
    f.b0 = (1 - cos) / 2 / a0
    f.b1 = (1 - cos) / a0
    f.b2 = (1 - cos) / 2 / a0
    f.a1 = (-2 * cos) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

/**
 * A small guitar body, in place: the main air and top resonances of a steel-string box added to the
 * dry strings, the box's weak radiation below about 120 Hz (which leaves the low strings' fundamentals
 * under their harmonics, as a microphone hears them), and a gentle roll-off above 5 kHz so the attack
 * does not fizz.
 */
export function guitarBody(samples: Float32Array, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const modes = [
    { filter: Biquad.bandpass(105, 4, sampleRate), gain: 0.4 },
    { filter: Biquad.bandpass(210, 3, sampleRate), gain: 0.35 },
    { filter: Biquad.bandpass(420, 2.5, sampleRate), gain: 0.25 },
  ]
  const bottom = Biquad.highpass(120, 0.7, sampleRate)
  const top = Biquad.lowpass(5000, 0.6, sampleRate)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    let y = x
    for (const m of modes) y += m.gain * m.filter.process(x)
    samples[i] = top.process(bottom.process(y))
  }
  return samples
}

/** Short high-passed noise burst: a closed hi-hat tick. */
export function hat(out: Float32Array, startSample: number, amp: number, seconds: number, seed: number, sampleRate = SYNTH_SAMPLE_RATE): void {
  if (startSample >= out.length) return
  const rand = lcg(seed)
  const total = Math.min(out.length - startSample, Math.round(seconds * sampleRate))
  const k = Math.exp((-2 * Math.PI * 6000) / sampleRate)
  let hp = 0
  let prev = 0
  for (let i = 0; i < total; i++) {
    const x = rand() * 2 - 1
    hp = k * (hp + x - prev)
    prev = x
    out[startSample + i] += hp * amp * Math.exp((-6 * i) / Math.max(1, total))
  }
}

/** Soft kick drum: a pitch sweep with a tiny click on the front. */
export function kick(out: Float32Array, startSample: number, amp: number, sampleRate = SYNTH_SAMPLE_RATE): void {
  if (startSample >= out.length) return
  const total = Math.min(out.length - startSample, Math.round(0.2 * sampleRate))
  const rand = lcg(startSample + 5)
  let phase = 0
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate
    const f = 150 * Math.exp(-t * 22) + 48
    phase += (2 * Math.PI * f) / sampleRate
    let v = Math.sin(phase) * Math.exp(-t * 11)
    if (i < 80) v += (rand() * 2 - 1) * 0.35 * Math.exp(-i / 25)
    out[startSample + i] += v * amp
  }
}

export function normalize(out: Float32Array, peakTarget = 0.9): Float32Array {
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  const gain = peak > 0 ? peakTarget / peak : 1
  for (let i = 0; i < out.length; i++) out[i] *= gain
  return out
}

/** Gain that brings the loud parts of `samples` (90th percentile of 50 ms RMS blocks) to `target` RMS. */
export function loudnessGain(samples: Float32Array, sampleRate = SYNTH_SAMPLE_RATE, target = 0.16): number {
  const block = Math.max(1, Math.round(0.05 * sampleRate))
  const levels: number[] = []
  for (let start = 0; start + block <= samples.length; start += block) {
    let e = 0
    for (let i = start; i < start + block; i++) e += samples[i] * samples[i]
    const rms = Math.sqrt(e / block)
    if (rms > 1e-4) levels.push(rms)
  }
  if (levels.length === 0) return 1
  levels.sort((a, b) => a - b)
  const loud = levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.9))]
  return clamp(target / loud, 0.3, 6)
}

/** Scales `samples` by `gain`, then down again if the peak would pass `ceiling`. Never boosts beyond `gain`. */
export function applyGainLimited(samples: Float32Array, gain: number, ceiling = 0.95): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  const g = peak * gain > ceiling ? ceiling / peak : gain
  for (let i = 0; i < samples.length; i++) samples[i] *= g
  return samples
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
  /** Nylon-string tone instead of steel. */
  nylon?: boolean
}

/** Seconds between the strings of a strummed chord (a relaxed downstroke). */
const STRUM_GAP = 0.014

/**
 * Renders a chart to mono PCM: plucked strings (optional) over a beat click. The strings are
 * rendered either way so the click track comes out at exactly the level it has under the strings,
 * and the two stems can be swapped without a jump in loudness. Deterministic for identical input.
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
  const length = Math.ceil(duration * sampleRate)

  const strings = new Float32Array(length)
  const notes = [...chart.notes].sort((a, b) => a.time - b.time || a.midi - b.midi)
  // A new note on the same string stops the one before it, as a fretting hand would.
  const ringUntil = new Map<ChartNote, number>()
  const lastOnString = new Map<number, ChartNote>()
  for (const n of notes) {
    const prev = lastOnString.get(n.string)
    if (prev && n.time > prev.time) ringUntil.set(prev, n.time)
    lastOnString.set(n.string, n)
  }
  // Strums run from the lowest string to the highest.
  const chordOrder = new Map<number, ChartNote[]>()
  for (const n of notes) {
    const group = chordOrder.get(n.chordId) ?? []
    group.push(n)
    chordOrder.set(n.chordId, group)
  }
  notes.forEach((n, i) => {
    const group = chordOrder.get(n.chordId) ?? [n]
    const strumIndex = group.length > 1 ? group.findIndex((m) => m === n) : 0
    const start = Math.round((n.time + strumIndex * STRUM_GAP) * sampleRate)
    const cutOff = ringUntil.get(n) ?? Infinity
    const seconds = Math.max(0.05, Math.min(n.duration + 1.5, 4, cutOff - n.time))
    const amp = (group.length > 1 ? 0.32 : 0.5) * pluckGain
    pluck(strings, start, midiToFreq(n.midi), seconds, amp, seed + i * 17, sampleRate, { velocity: 0.45 + 0.55 * n.velocity, nylon: options.nylon })
  })
  guitarBody(strings, sampleRate)

  const drums = new Float32Array(length)
  chart.beats.forEach((b, i) => {
    const s = Math.round(b.time * sampleRate)
    hat(drums, s, b.isDownbeat ? 0.065 : 0.04, 0.03, 77 + i, sampleRate)
    if (b.isDownbeat || b.beatInBar % 2 === 0) kick(drums, s, b.isDownbeat ? 0.4 : 0.26, sampleRate)
  })

  const mix = new Float32Array(length)
  for (let i = 0; i < length; i++) mix[i] = strings[i] + drums[i]
  const gain = loudnessGain(mix, sampleRate)

  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = (plucks ? strings[i] : 0) + (click ? drums[i] : 0)
  return applyGainLimited(out, gain)
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
