/**
 * The guide voice: the app's own singing of a starting note, a call to be echoed, or a whole tune to
 * listen to first. Plain additive harmonics, no recordings, straight into a Float32Array like the
 * rest of the offline audio, so it runs in tests and workers without an AudioContext.
 *
 * It is one voice. A note sounds from its written start to its written end and not a sample longer:
 * the 40 ms it takes to come in and the 50 ms it takes to fade lie inside the note. The scorer relies
 * on that (it stops listening while a cue sounds, and a cue that rang on would be scored as singing),
 * and it is why a repeated note is heard as two notes.
 */
import { midiToFreq } from '../music/pitch'
import { SYNTH_SAMPLE_RATE } from './synth'

/** Bumped whenever the sound changes, so anything rendered by an older version and kept is rendered again. */
export const VOICE_SYNTH_VERSION = 1

/** What the voice sings: a `ChartNote` or a `VoiceCue` is one. */
export interface VoiceNote {
  /** Seconds. */
  time: number
  duration: number
  midi: number
}

export interface VoiceRenderOptions {
  sampleRate?: number
  /** Samples in the result, to lie under another track of the same chart (the click). Without it the result ends with the last note, plus `tail`. A note that runs past it is cut there. */
  length?: number
  /** Seconds of silence after the last note when no `length` is given. */
  tail?: number
  /** 1 = the fixed level every note is sung at. */
  gain?: number
  /** Tuning reference in Hz. */
  a4?: number
}

const ATTACK = 0.04
const RELEASE = 0.05
/** RMS of a held note: about the level of the guitar stem, clear over the click. */
const LEVEL = 0.14
/** Under this a note gets the octave above added: a phone speaker plays nothing that low, and with it the starting note can still be found. */
const OCTAVE_UNDER_HZ = 110
const OCTAVE_MIX = 0.5
/** No partial above this: the tone stays soft and far from the Nyquist frequency at any sample rate. */
const TOP_HZ = 5000
const FADE_FROM_HZ = 3500
/** Points in one stored period. Partials stop at 5 kHz, so reading it between points is exact to a few parts in a million. */
const CYCLE = 4096

/**
 * How strong a partial at `freq` is, apart from the 1/h of its place in the series. It depends on the
 * frequency, not on the harmonic number, the way a mouth shapes a voice: low notes come out with many
 * harmonics, high notes with few, and the colour does not jump from one note to the next. What a small
 * speaker cannot play (under about 200 Hz) is thinned, the top is rounded off from 1.2 kHz.
 */
function colour(freq: number): number {
  if (freq >= TOP_HZ) return 0
  const body = freq / Math.hypot(freq, 200)
  const mellow = 1 / Math.hypot(1, freq / 1200)
  const fade = freq <= FADE_FROM_HZ ? 1 : 0.5 * (1 + Math.cos((Math.PI * (freq - FADE_FROM_HZ)) / (TOP_HZ - FADE_FROM_HZ)))
  return body * mellow * fade
}

/** One period of a held note at `freq`, scaled so its RMS is 1. The last point repeats the first, for reading between points. */
function cycleOf(freq: number, sampleRate: number): Float32Array {
  const partials = Math.max(1, Math.floor(Math.min(TOP_HZ, 0.45 * sampleRate) / freq))
  const amps = new Float64Array(partials + 1)
  for (let h = 1; h <= partials; h++) amps[h] = colour(h * freq) / h
  // The octave above is the same voice on twice the frequency: it lands on the even harmonics.
  if (freq < OCTAVE_UNDER_HZ) for (let h = 1; 2 * h <= partials; h++) amps[2 * h] += (OCTAVE_MIX * colour(2 * h * freq)) / h
  let power = 0
  for (let h = 1; h <= partials; h++) power += (amps[h] * amps[h]) / 2
  const scale = power > 0 ? 1 / Math.sqrt(power) : 0
  const cycle = new Float32Array(CYCLE + 1)
  for (let k = 0; k < CYCLE; k++) {
    let v = 0
    for (let h = 1; h <= partials; h++) v += amps[h] * Math.sin((2 * Math.PI * h * k) / CYCLE)
    cycle[k] = v * scale
  }
  cycle[CYCLE] = cycle[0]
  return cycle
}

/**
 * Adds one note to `out`. Every sample is worked out from its own time, not from the sample before, so
 * a note sounds the same whatever the length of the track and wherever it is cut.
 */
function singNote(out: Float32Array, start: number, end: number, cycle: Float32Array, freq: number, amp: number, sampleRate: number): void {
  const seconds = end - start
  // A note too short for its fades keeps their proportion instead of losing its middle.
  const attack = Math.min(ATTACK, 0.3 * seconds)
  const release = Math.min(RELEASE, 0.4 * seconds)
  const first = Math.max(0, Math.ceil(start * sampleRate))
  const last = Math.min(out.length, Math.ceil(end * sampleRate))
  for (let i = first; i < last; i++) {
    // Never before the note's own start. Rounding can put the first sample a hair before it; that would be
    // read as the very end of a period, one point past the end of the stored one, and write a NaN.
    const t = Math.max(0, i / sampleRate - start)
    const left = seconds - t
    // Raised cosines: level and slope both start and end at nothing, which is what keeps a join free of clicks.
    const env = t < attack ? 0.5 * (1 - Math.cos((Math.PI * t) / attack)) : left < release ? 0.5 * (1 - Math.cos((Math.PI * left) / release)) : 1
    const turns = t * freq
    const at = (turns - Math.floor(turns)) * CYCLE
    const k = Math.floor(at)
    out[i] += amp * env * (cycle[k] + (at - k) * (cycle[k + 1] - cycle[k]))
  }
}

/**
 * The notes sung by the guide voice, at a fixed level, as mono PCM. Deterministic for identical input,
 * whatever the order of the notes.
 *
 * One note at a time: a note that starts while another still sounds takes over from it (the earlier
 * one fades out just before), and of notes written together only the highest is sung (of the same note
 * written twice, the longer). So the level never adds up and the peak stays well under full scale for
 * any input.
 */
export function renderVoiceNotes(notes: readonly VoiceNote[], options: VoiceRenderOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE
  const amp = LEVEL * (options.gain ?? 1)
  // Every field takes part in the order, so the result cannot depend on the order the notes came in.
  const sung = notes
    .filter((n) => Number.isFinite(n.time) && Number.isFinite(n.midi) && Number.isFinite(n.duration) && n.duration > 0)
    .sort((a, b) => a.time - b.time || a.midi - b.midi || a.duration - b.duration)
  const lastEnd = sung.reduce((m, n) => Math.max(m, n.time + n.duration), 0)
  const length = options.length === undefined ? Math.ceil((lastEnd + (options.tail ?? 0)) * sampleRate) : Math.max(0, Math.floor(options.length))
  const out = new Float32Array(length)
  // The same pitch comes back many times in a tune: its period is worked out once.
  const cycles = new Map<number, Float32Array>()
  sung.forEach((n, i) => {
    const next = sung[i + 1]
    const end = next ? Math.min(n.time + n.duration, next.time) : n.time + n.duration
    if (end - n.time < 1 / sampleRate) return
    const freq = midiToFreq(n.midi, options.a4)
    let cycle = cycles.get(freq)
    if (!cycle) {
      cycle = cycleOf(freq, sampleRate)
      cycles.set(freq, cycle)
    }
    singNote(out, n.time, end, cycle, freq, amp, sampleRate)
  })
  return out
}
