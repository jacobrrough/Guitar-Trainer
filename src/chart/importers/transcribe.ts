import { audioEngine } from '../../audio/AudioEngine'
import { resampleLinear } from '../../audio/resample'
import { midiToFreq } from '../../music/pitch'
import { constantBeatGrid } from '../timing'
import type { Chart } from '../types'
import { notesFromPitchEvents } from './midi'
import { estimateTempo } from './tempo-estimate'
import type { TranscribeRequest, TranscribeResponse, TranscribedNote } from './transcribe.worker'

export const MODEL_SAMPLE_RATE = 22050

export interface TranscribeOptions {
  /** Open strings of the target tuning; limits the pitch range. */
  tuning: number[]
  onsetThreshold?: number
  frameThreshold?: number
  minNoteLengthMs?: number
  backend?: 'webgl' | 'cpu' | 'auto'
}

export type ProgressCallback = (fraction: number, stage: 'decoding' | 'resampling' | 'analysing' | 'building') => void

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const data = await blob.arrayBuffer()
  return audioEngine.context.decodeAudioData(data)
}

async function renderMono(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * sampleRate)
  const offline = new OfflineAudioContext(1, length, sampleRate)
  const src = offline.createBufferSource()
  src.buffer = buffer
  src.connect(offline.destination)
  src.start(0)
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0).slice()
}

/**
 * Mixes down to mono and resamples to the model's 22050 Hz. Uses the native
 * OfflineAudioContext; Safari versions that only render at 44.1–96 kHz fall
 * back to a mono render at the source rate plus a JS resample.
 */
export async function resampleForModel(buffer: AudioBuffer): Promise<Float32Array> {
  try {
    return await renderMono(buffer, MODEL_SAMPLE_RATE)
  } catch {
    const mono = await renderMono(buffer, buffer.sampleRate)
    return resampleLinear(mono, buffer.sampleRate, MODEL_SAMPLE_RATE)
  }
}

export function modelUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, window.location.href).href
}

export function runTranscriptionWorker(
  audio: Float32Array,
  options: TranscribeOptions,
  onProgress?: (fraction: number) => void,
): Promise<{ notes: TranscribedNote[]; backend: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
    const lowest = Math.min(...options.tuning)
    const highest = Math.max(...options.tuning) + 24
    const req: TranscribeRequest = {
      type: 'transcribe',
      audio,
      modelUrl: modelUrl(),
      options: {
        onsetThreshold: options.onsetThreshold ?? 0.5,
        frameThreshold: options.frameThreshold ?? 0.3,
        minNoteLengthFrames: Math.max(1, Math.round(((options.minNoteLengthMs ?? 100) / 1000) * (MODEL_SAMPLE_RATE / 256))),
        minFreq: midiToFreq(lowest) * 0.97,
        maxFreq: midiToFreq(highest) * 1.03,
        backend: options.backend ?? 'auto',
      },
    }
    worker.onmessage = (e: MessageEvent<TranscribeResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') onProgress?.(msg.value)
      else if (msg.type === 'done') {
        worker.terminate()
        resolve({ notes: msg.notes, backend: msg.backend })
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (ev) => {
      worker.terminate()
      reject(new Error(ev.message || 'Transcription worker failed'))
    }
    worker.postMessage(req, [audio.buffer])
  })
}

/** Turns raw transcription notes into a chart with a beat grid and fret positions. */
export function transcriptionToChart(
  notes: TranscribedNote[],
  meta: { title: string; artist: string; tuning: number[]; duration: number },
): Chart {
  const { tuning } = meta
  const lowest = Math.min(...tuning)
  const highest = Math.max(...tuning) + 22
  const usable = notes.filter(
    (n) => n.amplitude >= 0.15 && n.durationSeconds >= 0.06 && n.pitchMidi >= lowest && n.pitchMidi <= highest,
  )
  const chartNotes = notesFromPitchEvents(
    usable.map((n) => ({ time: n.startTimeSeconds, duration: n.durationSeconds, midi: n.pitchMidi, velocity: Math.min(1, n.amplitude) })),
    tuning,
  )
  const onsetMap = new Map<number, number>()
  for (const n of chartNotes) onsetMap.set(n.chordId, (onsetMap.get(n.chordId) ?? 0) + n.velocity)
  const onsets = [...onsetMap.entries()].map(([chordId, weight]) => ({
    time: chartNotes.find((n) => n.chordId === chordId)!.time,
    weight,
  }))
  const duration = Math.max(meta.duration, ...chartNotes.map((n) => n.time + n.duration))
  const tempo = estimateTempo(onsets, duration)
  return {
    version: 1,
    title: meta.title,
    artist: meta.artist,
    source: 'transcription',
    tuning,
    capo: 0,
    duration,
    notes: chartNotes,
    beats: constantBeatGrid(tempo.bpm, tempo.downbeat, duration, tempo.beatsPerBar),
    tempos: [{ time: 0, bpm: tempo.bpm }],
    timeSignatures: [{ time: 0, numerator: tempo.beatsPerBar, denominator: 4 }],
  }
}

/** Full pipeline: audio blob → chart. */
export async function transcribeToChart(
  blob: Blob,
  meta: { title: string; artist: string },
  options: TranscribeOptions,
  onProgress?: ProgressCallback,
): Promise<{ chart: Chart; duration: number; backend: string }> {
  onProgress?.(0, 'decoding')
  const buffer = await decodeAudio(blob)
  onProgress?.(0, 'resampling')
  const mono = await resampleForModel(buffer)
  onProgress?.(0, 'analysing')
  const { notes, backend } = await runTranscriptionWorker(mono, options, (p) => onProgress?.(p, 'analysing'))
  onProgress?.(1, 'building')
  const chart = transcriptionToChart(notes, { ...meta, tuning: options.tuning, duration: buffer.duration })
  return { chart, duration: buffer.duration, backend }
}
