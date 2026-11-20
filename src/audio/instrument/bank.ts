/**
 * The sampled guitar: real recordings of a steel-string acoustic guitar (University of Iowa Musical
 * Instrument Samples, as edited in nbrosowsky/tonejs-instruments, CC BY 3.0), one per semitone from
 * D2 to D5, packed into one audio file by scripts/build-guitar-samples.mjs. This module turns the
 * decoded file into a bank of notes; it has no browser or Node dependencies.
 */
import manifestJson from './guitarSteel.json'

export interface PackNote {
  midi: number
  /** Seconds from the start of the file to the note's onset. */
  start: number
  /** Seconds from the onset to the end of the note. */
  length: number
  peak: number
  /** How far the recording is from equal temperament, in cents. */
  cents: number
}

export interface SamplePack {
  id: string
  version: number
  /** Path of the audio file under the app's base URL. */
  file: string
  sampleRate: number
  duration: number
  /** The onset is where the signal first reaches this fraction of the note's peak. */
  onsetFraction: number
  /** Seconds kept before the onset. */
  preRoll: number
  source: string
  licence: string
  notes: PackNote[]
}

export const GUITAR_PACK: SamplePack = manifestJson

export interface BankNote {
  midi: number
  /** Index in `pcm` of the first kept sample (the onset minus the pre-roll). */
  offset: number
  /** Samples from `offset` to the end of the note. */
  frames: number
  /** Samples between `offset` and the onset. */
  pre: number
  peak: number
}

export interface SampleBank {
  id: string
  version: number
  sampleRate: number
  /** The whole decoded pack, mono. */
  pcm: Float32Array
  /** Sorted by pitch, one per semitone without gaps. */
  notes: BankNote[]
}

/**
 * Locates every note of `pack` in the decoded audio. Decoders differ in how much silence they leave
 * at the start of an MP3, so each note is found by its onset (the same rule the build script used)
 * within 80 ms of where the manifest expects it. Throws when the audio does not match the manifest.
 */
export function buildBank(pack: SamplePack, pcm: Float32Array, sampleRate: number): SampleBank {
  if (Math.abs(sampleRate - pack.sampleRate) > 1) throw new Error(`sample pack decoded at ${sampleRate} Hz, expected ${pack.sampleRate}`)
  const slack = Math.round(0.08 * sampleRate)
  const notes: BankNote[] = []
  for (const n of pack.notes) {
    const expected = Math.round(n.start * sampleRate)
    const from = Math.max(0, expected - slack)
    const to = Math.min(pcm.length, expected + Math.round(0.15 * sampleRate))
    let peak = 0
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(pcm[i]))
    if (peak < 0.05) throw new Error(`sample pack: note ${n.midi} is missing`)
    let onset = -1
    for (let i = from; i < to; i++) {
      if (Math.abs(pcm[i]) >= pack.onsetFraction * peak) {
        onset = i
        break
      }
    }
    if (onset < 0 || Math.abs(onset - expected) > slack) throw new Error(`sample pack: note ${n.midi} is out of place`)
    const pre = Math.min(onset, Math.round(pack.preRoll * sampleRate))
    const frames = Math.min(pcm.length - (onset - pre), pre + Math.round(n.length * sampleRate))
    let notePeak = 0
    for (let i = onset - pre; i < onset - pre + frames; i++) notePeak = Math.max(notePeak, Math.abs(pcm[i]))
    notes.push({ midi: n.midi, offset: onset - pre, frames, pre, peak: notePeak })
  }
  notes.sort((a, b) => a.midi - b.midi)
  for (let i = 1; i < notes.length; i++) if (notes[i].midi !== notes[i - 1].midi + 1) throw new Error('sample pack: notes are not contiguous')
  if (notes.length === 0) throw new Error('sample pack: empty')
  return { id: pack.id, version: pack.version, sampleRate, pcm, notes }
}

/** The recording for `midi`, or the nearest one when the pitch is outside the recorded range. */
export function bankNote(bank: SampleBank, midi: number): BankNote {
  const first = bank.notes[0].midi
  const index = Math.min(bank.notes.length - 1, Math.max(0, Math.round(midi) - first))
  return bank.notes[index]
}
