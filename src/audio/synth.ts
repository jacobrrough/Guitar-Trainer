/**
 * Offline audio for the demo song, the bundled songs, generated exercises and the ear trainer: the
 * guitar part played from real recordings (`instrument/sampler.ts`; the string model in
 * `instrument/stringModel.ts` is the fallback when the sample pack is not loaded) over a soft
 * kick-and-hat click track. Everything renders straight into a Float32Array, so it runs in tests and
 * workers without an AudioContext.
 */
import type { Chart, ChartNote } from '../chart/types'
import { midiToFreq } from '../music/pitch'
import type { SampleBank } from './instrument/bank'
import { renderSampledNote } from './instrument/sampler'
import { guitarBody, pluck, roomAir } from './instrument/stringModel'

export { guitarBody, pluck, roomAir, type PluckOptions } from './instrument/stringModel'

export const SYNTH_SAMPLE_RATE = 44100
/** Bumped whenever the sound changes, so audio rendered by an older version and stored in the library is rendered again. */
export const SYNTH_VERSION = 4

/**
 * File name for stored rendered audio. It carries the renderer version and the voice that played it
 * (`s<pack version>` for the recorded samples, `m` for the string model), so stale renders can be
 * found and a song rendered while the samples were unavailable is rendered again once they are.
 */
export function synthAudioName(base: string, samplePackVersion: number | null = null): string {
  return `${base}.v${SYNTH_VERSION}${samplePackVersion === null ? 'm' : `s${samplePackVersion}`}.wav`
}

/**
 * True when stored audio called `name` (for the song `base`) should be rendered again: it came from an
 * older renderer, or from the string model while the recorded samples (`voice` = pack version) are
 * available now, or from a different sample pack. A render made with samples is kept while they are
 * unavailable.
 */
export function isStaleRender(name: string, base: string, voice: number | null): boolean {
  if (!name.startsWith(`${base}.v`) || !name.endsWith('.wav')) return true
  const tag = /^(\d+)(m|s(\d+))$/.exec(name.slice(base.length + 2, -4))
  if (!tag || Number(tag[1]) !== SYNTH_VERSION) return true
  if (voice === null) return false
  return tag[2] === 'm' || Number(tag[3]) !== voice
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

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
 * Look-ahead peak limiter, in place: wherever the signal would pass `ceiling` the gain dips smoothly
 * around the peak (10 ms either side) and nowhere else, so one loud strum does not turn the whole
 * track down.
 */
export function limitPeaks(samples: Float32Array, sampleRate = SYNTH_SAMPLE_RATE, ceiling = 0.95): Float32Array {
  const n = samples.length
  let over = false
  for (let i = 0; i < n; i++) {
    if (Math.abs(samples[i]) > ceiling) {
      over = true
      break
    }
  }
  if (!over) return samples
  const L = Math.max(1, Math.round(0.01 * sampleRate))
  // Gain each sample needs, then its minimum over a centred window of 2L+1 (monotonic deque), then a moving average of the same width.
  const need = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i])
    need[i] = a > ceiling ? ceiling / a : 1
  }
  const lowest = new Float32Array(n)
  const deque = new Int32Array(n)
  let head = 0
  let tail = 0
  let next = 0
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + L)
    while (next <= hi) {
      while (tail > head && need[deque[tail - 1]] >= need[next]) tail--
      deque[tail++] = next++
    }
    while (deque[head] < i - L) head++
    lowest[i] = need[deque[head]]
  }
  let sum = 0
  let count = 0
  let right = -1
  let left = 0
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + L)
    const lo = Math.max(0, i - L)
    while (right < hi) {
      sum += lowest[++right]
      count++
    }
    while (left < lo) {
      sum -= lowest[left++]
      count--
    }
    samples[i] *= Math.min(need[i], sum / count)
  }
  return samples
}

export interface BackingOptions {
  sampleRate?: number
  /** Render the chart's notes on the guitar (reference track). */
  plucks?: boolean
  /** Click on every beat, accented kick on downbeats. */
  click?: boolean
  pluckGain?: number
  /** Extra seconds after the last note. */
  tail?: number
  seed?: number
  /** Nylon-string tone instead of steel (string model only). */
  nylon?: boolean
  /** Recorded guitar samples; without them the string model plays. */
  bank?: SampleBank | null
}

/** Seconds between the first strings of a strummed chord (a relaxed downstroke, which then speeds up). */
const STRUM_GAP = 0.017
/** Loudness of the guitar stem (RMS of its loud parts) and the fixed level of the click track under it. */
const STRINGS_TARGET = 0.15
const DRUM_GAIN = 1.2

function chartLength(chart: Chart, sampleRate: number, tail: number): number {
  const lastNoteEnd = chart.notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0)
  return Math.ceil(Math.max(chart.duration, lastNoteEnd + tail, 1) * sampleRate)
}

/**
 * The chart's notes played on the guitar, as a stem levelled to a fixed loudness. A new note on a
 * string stops the one before it, chords are strummed from the lowest string up, no two strokes are
 * equally hard, and repeated notes cycle through different takes. Deterministic for identical input.
 */
export function renderStrings(chart: Chart, options: BackingOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE
  const pluckGain = options.pluckGain ?? 1
  const seed = options.seed ?? 1000
  const bank = options.bank ?? null
  const strings = new Float32Array(chartLength(chart, sampleRate, options.tail ?? 1))
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
  const takes = new Map<number, number>()
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
    const velocity = 0.45 + 0.55 * clamp(n.velocity * (0.9 + 0.2 * human()), 0.05, 1)
    if (bank) {
      const key = Math.round(n.midi)
      const take = takes.get(key) ?? 0
      takes.set(key, take + 1)
      renderSampledNote(strings, start, bank, n.midi, seconds, amp, sampleRate, { velocity, variant: take })
    } else {
      pluck(strings, start, midiToFreq(n.midi), seconds, amp, seed + i * 17, sampleRate, { velocity, nylon: options.nylon, wound: n.string <= 3 })
    }
  })
  // The recordings were made in an anechoic room and already contain the guitar's body; the model needs one.
  if (!bank) guitarBody(strings, sampleRate)
  roomAir(strings, sampleRate)
  const gain = loudnessGain(strings, sampleRate, STRINGS_TARGET)
  for (let i = 0; i < strings.length; i++) strings[i] *= gain
  return strings
}

/** One guitar note of `seconds` at `sampleRate`, starting 10 ms into the buffer and peaking at 0.8 (the ear trainer's reference tone). */
export function renderGuitarNote(bank: SampleBank | null, midi: number, seconds: number, sampleRate: number): Float32Array {
  const lead = Math.round(0.01 * sampleRate)
  const out = new Float32Array(lead + Math.round(seconds * sampleRate))
  if (bank) {
    renderSampledNote(out, lead, bank, midi, seconds, 0.8, sampleRate, { velocity: 0.85 })
  } else {
    pluck(out, lead, midiToFreq(midi), seconds, 0.8, 7 + Math.round(midi), sampleRate)
    guitarBody(out, sampleRate)
  }
  return normalize(out, 0.8)
}

/** The click track: a soft hat on every beat and a kick on the strong ones, at a fixed level. Deterministic. */
export function renderDrums(chart: Chart, options: Pick<BackingOptions, 'sampleRate' | 'tail'> = {}): Float32Array {
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE
  const drums = new Float32Array(chartLength(chart, sampleRate, options.tail ?? 1))
  chart.beats.forEach((b, i) => {
    const s = Math.round(b.time * sampleRate)
    if (s < 0) return
    hat(drums, s, (b.isDownbeat ? 0.065 : 0.04) * DRUM_GAIN, 0.03, 77 + i, sampleRate)
    if (b.isDownbeat || b.beatInBar % 2 === 0) kick(drums, s, (b.isDownbeat ? 0.4 : 0.26) * DRUM_GAIN, sampleRate)
  })
  return drums
}

/**
 * Renders a chart to mono PCM: the guitar part (optional) over the click track (optional). The two
 * stems are levelled independently, so the click track alone is as loud as it is under the guitar,
 * and only stray peaks of the mix are limited. Deterministic for identical input.
 */
export function renderChartBacking(chart: Chart, options: BackingOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE
  const plucks = options.plucks ?? true
  const click = options.click ?? true
  if (!plucks) return click ? renderDrums(chart, options) : new Float32Array(chartLength(chart, sampleRate, options.tail ?? 1))
  const out = renderStrings(chart, options)
  if (click) {
    const drums = renderDrums(chart, options)
    for (let i = 0; i < out.length; i++) out[i] += drums[i]
  }
  return limitPeaks(out, sampleRate)
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
