import { bankNote, type SampleBank } from './bank'

export interface SampledNoteOptions {
  /** How hard the string is struck, 0..1. Softer is quieter and a little darker. */
  velocity?: number
  /**
   * Which take to use for a repeated note: 0 is the note's own recording, 1 and 2 are the
   * neighbouring semitones retuned. Cycling through them keeps a run of the same note from sounding
   * like one recording fired over and over.
   */
  variant?: number
  /** Seconds of fade when the note is stopped before the recording ends (a finger damping the string). */
  release?: number
}

const VARIANT_SHIFT = [0, 1, -1]

/**
 * Mixes one recorded guitar note into `out` so that its onset lands on `startSample`. The recording is
 * resampled (4-point Hermite) to the wanted pitch and output rate, and faded out after `seconds`.
 */
export function renderSampledNote(
  out: Float32Array,
  startSample: number,
  bank: SampleBank,
  midi: number,
  seconds: number,
  amp: number,
  sampleRate: number,
  options: SampledNoteOptions = {},
): void {
  if (startSample >= out.length || seconds <= 0) return
  const velocity = Math.min(1, Math.max(0.05, options.velocity ?? 0.8))
  const first = bank.notes[0].midi
  const last = bank.notes[bank.notes.length - 1].midi
  let sourceMidi = Math.min(last, Math.max(first, Math.round(midi)))
  const shift = VARIANT_SHIFT[(options.variant ?? 0) % VARIANT_SHIFT.length]
  if (shift !== 0 && sourceMidi + shift >= first && sourceMidi + shift <= last && Math.round(midi) >= first && Math.round(midi) <= last) sourceMidi += shift
  const note = bankNote(bank, sourceMidi)
  const pcm = bank.pcm
  // Source samples consumed per output sample.
  const step = 2 ** ((midi - note.midi) / 12) * (bank.sampleRate / sampleRate)
  const gain = (amp * (0.35 + 0.65 * velocity)) / Math.max(note.peak, 1e-6)
  const preOut = Math.round(note.pre / step)
  const begin = startSample - preOut
  const available = Math.floor((note.frames - 2) / step)
  const total = Math.min(available, preOut + Math.round(seconds * sampleRate), out.length - begin)
  if (total <= 0) return
  const release = Math.max(1, Math.round((options.release ?? 0.06) * sampleRate))
  const fadeStart = total < available ? total - Math.min(release, total) : total
  // A soft stroke excites fewer high partials: one-pole low-pass, open at full velocity.
  const cutoff = 1500 + 14000 * velocity * velocity
  const a = velocity >= 0.9 ? 1 : 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
  let lp = 0
  const base = note.offset
  const end = note.offset + note.frames - 1
  for (let i = 0; i < total; i++) {
    const o = begin + i
    const pos = base + i * step
    const k = Math.floor(pos)
    const f = pos - k
    const y0 = pcm[k > base ? k - 1 : k]
    const y1 = pcm[k]
    const y2 = pcm[k + 1 <= end ? k + 1 : end]
    const y3 = pcm[k + 2 <= end ? k + 2 : end]
    const c1 = 0.5 * (y2 - y0)
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)
    let v = ((c3 * f + c2) * f + c1) * f + y1
    lp += a * (v - lp)
    v = lp
    if (o < 0) continue
    const env = i >= fadeStart ? (total - i) / (total - fadeStart) : 1
    out[o] += v * gain * env
  }
}
