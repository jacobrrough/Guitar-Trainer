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
export const SYNTH_VERSION = 3

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
  /** Wound bass strings are darker than plain ones; by default inferred from the pitch. */
  wound?: boolean
}

/**
 * Karplus–Strong pluck mixed into `out` from `startSample`.
 *
 * What makes it sound like a string rather than a loop: the excitation is the shape of a string
 * pulled at the pick point and released; the string is run in two polarisations, slightly detuned
 * and one dying faster, which gives the slow beat and two-stage decay of a real note; the loop has a
 * low-pass whose cutoff depends on the string and the stroke (the high partials die first), a
 * fractional delay (all-pass) so every note is in tune, a loss factor from a realistic 60 dB decay
 * time, and a touch of pitch sag after the attack; and the pick itself is heard as a short unpitched tick.
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
  const wound = options.wound ?? freq < 230
  const rand = lcg(seed)
  const pickPosition = clamp(options.pickPosition ?? 0.1 + 0.07 * rand(), 0.05, 0.5)
  const total = Math.min(out.length - startSample, Math.round(seconds * sampleRate))
  if (total <= 0) return
  const attack = Math.max(1, Math.round(0.003 * sampleRate))
  const fadeStart = total - Math.round(0.03 * sampleRate)

  // Loop low-pass: the string's own damping of its high partials, set by the stroke and the string but
  // never so low that it eats the fundamental of a high note (the loss factor below owns that decay).
  // Its delay is taken out of the loop length.
  const loopCutoff = Math.max((nylon ? 0.6 : 1) * (wound ? 0.6 : 1) * (2500 + 6500 * velocity), 30 * freq)
  const la = onePole(loopCutoff, sampleRate)
  const lpDelay = (1 - la) / la

  // Two polarisations: a slow beat of well under a hertz, the second one fading about twice as fast.
  const beat = 0.35 + 0.35 * rand()
  // 60 dB decay time: about nine seconds for the low E, four for the high E at the twelfth fret.
  const t60 = clamp((nylon ? 4.5 : 8) * (110 / freq) ** 0.35, 1.5, 10)
  const loops = [
    { f: freq + beat / 2, t60, gain: 1 / 1.7 },
    { f: freq - beat / 2, t60: t60 * 0.5, gain: 0.7 / 1.7 },
  ].map((l) => {
    const exact = sampleRate / l.f - lpDelay
    const n = Math.max(2, Math.floor(exact - 0.4))
    return { ...l, n, frac0: exact - n, rho: 10 ** (-3 / (l.f * l.t60)) }
  })
  const nMax = Math.max(...loops.map((l) => l.n))

  // Excitation: the string pulled into a triangle at the pick point and let go. The delay line carries
  // the slope of that shape (a two-level pulse), whose harmonics fall off like a real pluck's, with a
  // strong fundamental every time; a little noise is the pick scraping the string.
  const exc = new Float32Array(nMax)
  const pickSample = Math.max(1, Math.min(nMax - 1, Math.round(pickPosition * nMax)))
  const up = 1 / pickSample
  const down = 1 / (nMax - pickSample)
  const noise = 0.25 * velocity
  for (let i = 0; i < nMax; i++) exc[i] = (i < pickSample ? up : -down) * 0.5 * nMax * 0.1 + noise * (rand() * 2 - 1)
  const cutoff = (nylon ? 0.5 : 1) * (1500 + 6000 * velocity * velocity)
  const a = onePole(cutoff, sampleRate)
  let y = 0
  for (let i = 0; i < nMax; i++) {
    y += a * (exc[i] - y)
    exc[i] = y
  }
  let mean = 0
  for (let i = 0; i < nMax; i++) mean += exc[i]
  mean /= nMax
  let peak = 1e-9
  for (let i = 0; i < nMax; i++) {
    exc[i] -= mean
    peak = Math.max(peak, Math.abs(exc[i]))
  }
  const scale = (0.35 + 0.65 * velocity) / peak
  for (let i = 0; i < nMax; i++) exc[i] *= scale

  const glideK = Math.exp(-1 / (0.08 * sampleRate))
  for (const l of loops) {
    const n = l.n
    const buf = exc.slice(0, n)
    let idx = 0
    let apX1 = 0
    let apY1 = 0
    let lp = 0
    let glide = 0.3
    const g = amp * l.gain
    for (let i = 0; i < total; i++) {
      const cur = buf[idx]
      const nextIdx = idx + 1 === n ? 0 : idx + 1
      lp += la * (cur * l.rho - lp)
      // Plucked strings start a touch sharp (the extra tension of the pull) and settle within ~100 ms.
      const frac = l.frac0 - glide
      glide *= glideK
      const c = (1 - frac) / (1 + frac)
      const ap = c * (lp - apY1) + apX1
      apX1 = lp
      apY1 = ap
      buf[idx] = ap
      const env = i < attack ? i / attack : i > fadeStart ? (total - i) / Math.max(1, total - fadeStart) : 1
      out[startSample + i] += cur * g * env
      idx = nextIdx
    }
  }

  // The pick: a few milliseconds of unpitched tick, and on hard strokes a touch of body thump.
  const tick = Math.min(total, Math.round(0.006 * sampleRate))
  const hpK = Math.exp((-2 * Math.PI * 1800) / sampleRate)
  const lpA = onePole(6000, sampleRate)
  let hp = 0
  let prev = 0
  let tl = 0
  const tickAmp = 0.12 * velocity * amp
  for (let i = 0; i < tick; i++) {
    const x = rand() * 2 - 1
    hp = hpK * (hp + x - prev)
    prev = x
    tl += lpA * (hp - tl)
    out[startSample + i] += tl * tickAmp * Math.exp(-i / (0.0018 * sampleRate))
  }
  const thump = Math.min(total, Math.round(0.06 * sampleRate))
  const thumpAmp = 0.06 * velocity * velocity * amp
  for (let i = 0; i < thump; i++) {
    const t = i / sampleRate
    out[startSample + i] += Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t / 0.02) * thumpAmp
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
 * A small guitar body, in place: a dozen resonances of a steel-string box (air at ~100 Hz, the top's
 * modes above it, thinning out towards 2 kHz) added to the dry strings, the box's weak radiation
 * below about 105 Hz (which leaves the low strings' fundamentals under their harmonics, as a
 * microphone hears them), and a roll-off above 6.5 kHz so the attack does not fizz.
 */
export function guitarBody(samples: Float32Array, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const modes = [
    [98, 6, 0.45],
    [200, 6, 0.35],
    [260, 8, 0.2],
    [345, 8, 0.18],
    [420, 9, 0.15],
    [520, 10, 0.12],
    [640, 10, 0.1],
    [780, 12, 0.1],
    [960, 12, 0.08],
    [1180, 14, 0.07],
    [1500, 14, 0.06],
    [2100, 12, 0.05],
  ].map(([f, q, gain]) => ({ filter: Biquad.bandpass(f, q, sampleRate), gain }))
  const bottom = Biquad.highpass(105, 0.7, sampleRate)
  const top = Biquad.lowpass(6500, 0.6, sampleRate)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    let y = x
    for (const m of modes) y += m.gain * m.filter.process(x)
    samples[i] = top.process(bottom.process(y))
  }
  return samples
}

/** A hint of room, in place: four soft early reflections, low-passed, so the guitar is not bone dry. */
export function roomAir(samples: Float32Array, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const taps = [
    [0.011, 0.1],
    [0.017, 0.08],
    [0.023, 0.06],
    [0.031, 0.05],
  ].map(([t, gain]) => ({ delay: Math.round(t * sampleRate), gain }))
  const dry = samples.slice()
  const a = onePole(3000, sampleRate)
  let lp = 0
  for (let i = 0; i < samples.length; i++) {
    let wet = 0
    for (const tap of taps) if (i >= tap.delay) wet += tap.gain * dry[i - tap.delay]
    lp += a * (wet - lp)
    samples[i] += lp
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

/** Largest absolute sample. */
export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  return peak
}

/**
 * Scales `samples` by `gain`, then down again if `peak` (the mix's, by default the samples' own) would
 * pass `ceiling`. Never boosts beyond `gain`.
 */
export function applyGainLimited(samples: Float32Array, gain: number, ceiling = 0.95, peak = peakOf(samples)): Float32Array {
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

/** Seconds between the first strings of a strummed chord (a relaxed downstroke, which then speeds up). */
const STRUM_GAP = 0.017

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
  const human = lcg(seed + 99)
  notes.forEach((n, i) => {
    const group = chordOrder.get(n.chordId) ?? [n]
    const strumIndex = group.length > 1 ? group.findIndex((m) => m === n) : 0
    // A downstroke accelerates through the strings, and no two strings are hit exactly alike.
    let offset = 0
    for (let k = 0; k < strumIndex; k++) offset += Math.max(0.007, STRUM_GAP - 0.0015 * k)
    const start = Math.round((n.time + offset) * sampleRate)
    const cutOff = ringUntil.get(n) ?? Infinity
    const seconds = Math.max(0.05, Math.min(n.duration + 1.5, 4, cutOff - n.time))
    const amp = (group.length > 1 ? 0.32 : 0.5) * pluckGain
    const velocity = clamp(n.velocity * (0.9 + 0.2 * human()), 0.05, 1)
    pluck(strings, start, midiToFreq(n.midi), seconds, amp, seed + i * 17, sampleRate, {
      velocity: 0.45 + 0.55 * velocity,
      nylon: options.nylon,
      wound: n.string <= 3,
    })
  })
  guitarBody(strings, sampleRate)
  roomAir(strings, sampleRate)

  const drums = new Float32Array(length)
  chart.beats.forEach((b, i) => {
    const s = Math.round(b.time * sampleRate)
    hat(drums, s, b.isDownbeat ? 0.065 : 0.04, 0.03, 77 + i, sampleRate)
    if (b.isDownbeat || b.beatInBar % 2 === 0) kick(drums, s, b.isDownbeat ? 0.4 : 0.26, sampleRate)
  })

  // One gain for every stem, decided on the full mix, so the click track alone is exactly as loud as it is under the strings.
  const mix = new Float32Array(length)
  for (let i = 0; i < length; i++) mix[i] = strings[i] + drums[i]
  const gain = loudnessGain(mix, sampleRate)
  const mixPeak = peakOf(mix)

  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = (plucks ? strings[i] : 0) + (click ? drums[i] : 0)
  return applyGainLimited(out, gain, 0.95, mixPeak)
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
