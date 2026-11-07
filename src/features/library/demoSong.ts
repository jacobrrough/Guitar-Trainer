import { constantBeatGrid } from '../../chart/timing'
import type { Chart, ChartNote } from '../../chart/types'
import type { NewSong } from '../../db/db'
import { midiToFreq } from '../../music/pitch'

const TUNING = [40, 45, 50, 55, 59, 64]
const BPM = 90
const BEAT = 60 / BPM
const SAMPLE_RATE = 44100

interface Step {
  /** Absolute beat index from the start of the song. */
  beat: number
  /** Length in beats. */
  len: number
  /** [string, fret] pairs, lowest string first. */
  notes: [number, number][]
  chordName?: string
}

const EM: [number, number][] = [[0, 0], [1, 2], [2, 2], [3, 0], [4, 0], [5, 0]]
const G: [number, number][] = [[0, 3], [1, 2], [2, 0], [3, 0], [4, 0], [5, 3]]
const D: [number, number][] = [[1, 0], [2, 0], [3, 2], [4, 3], [5, 2]]
const C: [number, number][] = [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]

const STEPS: Step[] = [
  // Bar 1–4: E minor pentatonic riff
  { beat: 0, len: 1, notes: [[0, 0]] }, { beat: 1, len: 1, notes: [[0, 3]] }, { beat: 2, len: 1, notes: [[1, 0]] }, { beat: 3, len: 1, notes: [[1, 2]] },
  { beat: 4, len: 0.5, notes: [[2, 0]] }, { beat: 4.5, len: 0.5, notes: [[2, 2]] }, { beat: 5, len: 1, notes: [[3, 0]] }, { beat: 6, len: 1, notes: [[2, 2]] }, { beat: 7, len: 1, notes: [[2, 0]] },
  { beat: 8, len: 1, notes: [[0, 0]] }, { beat: 9, len: 1, notes: [[0, 3]] }, { beat: 10, len: 2, notes: [[1, 0]] },
  { beat: 12, len: 1, notes: [[1, 2]] }, { beat: 13, len: 1, notes: [[1, 0]] }, { beat: 14, len: 1, notes: [[0, 3]] }, { beat: 15, len: 1, notes: [[0, 0]] },
  // Bar 5–8: open chords on beats 1 and 3
  { beat: 16, len: 2, notes: EM, chordName: 'Em' }, { beat: 18, len: 2, notes: EM, chordName: 'Em' },
  { beat: 20, len: 2, notes: G, chordName: 'G' }, { beat: 22, len: 2, notes: G, chordName: 'G' },
  { beat: 24, len: 2, notes: D, chordName: 'D' }, { beat: 26, len: 2, notes: D, chordName: 'D' },
  { beat: 28, len: 2, notes: C, chordName: 'C' }, { beat: 30, len: 2, notes: C, chordName: 'C' },
]

const TOTAL_BEATS = 32
const DURATION = TOTAL_BEATS * BEAT + 1.2

export function demoChart(): Chart {
  const notes: ChartNote[] = []
  STEPS.forEach((step, chordId) => {
    for (const [string, fret] of step.notes) {
      notes.push({
        id: notes.length,
        time: step.beat * BEAT,
        duration: step.len * BEAT * 0.95,
        midi: TUNING[string] + fret,
        string,
        fret,
        velocity: 0.8,
        chordId,
        chordName: step.chordName,
      })
    }
  })
  return {
    version: 1,
    title: 'Demo riff in E minor',
    artist: 'Guitar Trainer',
    source: 'demo',
    tuning: TUNING,
    capo: 0,
    duration: DURATION,
    notes,
    beats: constantBeatGrid(BPM, 0, DURATION, 4),
    tempos: [{ time: 0, bpm: BPM }],
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  }
}

/** Karplus–Strong plucked string, mixed into `out` starting at `startSample`. */
function pluck(out: Float32Array, startSample: number, freq: number, seconds: number, amp: number, seed: number): void {
  const period = Math.max(2, Math.round(SAMPLE_RATE / freq))
  const buf = new Float32Array(period)
  let rng = seed >>> 0
  for (let i = 0; i < period; i++) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0
    buf[i] = (rng / 4294967296) * 2 - 1
  }
  for (let i = 1; i < period; i++) buf[i] = 0.5 * (buf[i] + buf[i - 1])
  const total = Math.min(out.length - startSample, Math.round(seconds * SAMPLE_RATE))
  const fadeStart = total - Math.round(0.03 * SAMPLE_RATE)
  let idx = 0
  for (let i = 0; i < total; i++) {
    const cur = buf[idx]
    const next = buf[(idx + 1) % period]
    buf[idx] = 0.5 * (cur + next) * 0.996
    const env = i > fadeStart ? (total - i) / (total - fadeStart) : 1
    out[startSample + i] += cur * amp * env
    idx = (idx + 1) % period
  }
}

function hat(out: Float32Array, startSample: number, amp: number, seconds: number, seed: number): void {
  let rng = seed >>> 0
  const total = Math.min(out.length - startSample, Math.round(seconds * SAMPLE_RATE))
  for (let i = 0; i < total; i++) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0
    const noise = (rng / 4294967296) * 2 - 1
    out[startSample + i] += noise * amp * Math.exp((-6 * i) / total)
  }
}

function kick(out: Float32Array, startSample: number, amp: number): void {
  const total = Math.min(out.length - startSample, Math.round(0.18 * SAMPLE_RATE))
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE
    const f = 120 * Math.exp(-t * 18) + 45
    out[startSample + i] += Math.sin(2 * Math.PI * f * t) * amp * Math.exp(-t * 14)
  }
}

export function renderDemoAudio(): Float32Array {
  const out = new Float32Array(Math.ceil(DURATION * SAMPLE_RATE))
  for (let b = 0; b < TOTAL_BEATS; b++) {
    const s = Math.round(b * BEAT * SAMPLE_RATE)
    hat(out, s, b % 4 === 0 ? 0.11 : 0.07, 0.04, 77 + b)
    if (b % 2 === 0) kick(out, s, 0.35)
  }
  STEPS.forEach((step, si) => {
    step.notes.forEach(([string, fret], ni) => {
      const start = Math.round((step.beat * BEAT + ni * 0.012) * SAMPLE_RATE)
      const amp = step.notes.length > 1 ? 0.22 : 0.4
      pluck(out, start, midiToFreq(TUNING[string] + fret), Math.min(step.len * BEAT + 0.6, 2.5), amp, 1000 + si * 17 + ni)
    })
  })
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  const gain = peak > 0 ? 0.9 / peak : 1
  for (let i = 0; i < out.length; i++) out[i] *= gain
  return out
}

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
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

/** A short synthesised riff + chord progression, so the app is playable without any files. */
export function createDemoSong(): NewSong {
  const chart = demoChart()
  return {
    title: chart.title,
    artist: chart.artist,
    audio: encodeWav(renderDemoAudio()),
    audioType: 'audio/wav',
    audioName: 'demo-riff.wav',
    duration: DURATION,
    chart,
    source: 'demo',
    bpm: BPM,
  }
}
