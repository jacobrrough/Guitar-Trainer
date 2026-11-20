/**
 * The app's guitar voice. Loads the recorded sample pack once (fetch, decode on the main thread,
 * hand the PCM to a Web Worker) and renders charts and single notes with it, off the main thread
 * when a worker is available. If the pack cannot be loaded or decoded, everything still works with
 * the string model; `guitarVoice()` says which one is playing.
 */
import type { Chart } from '../chart/types'
import { GUITAR_PACK, buildBank, type SampleBank } from './instrument/bank'
import { renderChartBacking, renderGuitarNote, type BackingOptions } from './synth'

type RenderOptions = Omit<BackingOptions, 'bank'>

interface Pending {
  resolve: (samples: Float32Array) => void
  reject: (err: Error) => void
}

/** The bank when it lives on this thread (no worker); null while it lives in the worker or is not loaded. */
let localBank: SampleBank | null = null
/** Version of the sample pack in use, or null when the string model plays. */
let voice: number | null = null
let loading: Promise<boolean> | null = null
let worker: Worker | null = null
let workerBroken = false
let workerHasBank = false
let nextId = 1
const pending = new Map<number, Pending>()

function failWorker(): void {
  workerBroken = true
  workerHasBank = false
  const jobs = [...pending.values()]
  pending.clear()
  worker?.terminate()
  worker = null
  // The PCM went to the worker with it: load again, this time keeping the bank on this thread.
  if (voice !== null && !localBank) {
    voice = null
    loading = null
  }
  for (const job of jobs) job.reject(new Error('worker unavailable'))
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (e: MessageEvent<{ id: number; samples?: Float32Array; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.samples) p.resolve(e.data.samples)
    else p.reject(new Error(e.data.error ?? 'render failed'))
  }
  worker.onerror = failWorker
  return worker
}

function ask(message: Record<string, unknown>): Promise<Float32Array> | null {
  const w = getWorker()
  if (!w) return null
  const id = nextId++
  return new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ ...message, id })
  })
}

async function decodePack(): Promise<SampleBank> {
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ?? (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!Offline || typeof fetch === 'undefined') throw new Error('no audio decoder')
  const res = await fetch(`${import.meta.env.BASE_URL}${GUITAR_PACK.file}`)
  if (!res.ok) throw new Error(`sample pack: HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  const ctx = new Offline(1, 1, GUITAR_PACK.sampleRate)
  // The callback form as well as the promise: older WebKit only has the former.
  const audio = await new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined
    if (p && typeof p.catch === 'function') p.catch(reject)
  })
  return buildBank(GUITAR_PACK, new Float32Array(audio.getChannelData(0)), audio.sampleRate)
}

/**
 * Loads the recorded guitar once. Resolves true when the recordings are in use and false when the
 * app is on the string model (pack missing, offline before it was cached, or no decoder). Never rejects.
 */
export function loadGuitar(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const bank = await decodePack()
      const w = getWorker()
      if (w) {
        w.postMessage({ type: 'bank', bank }, [bank.pcm.buffer])
        workerHasBank = true
      } else {
        localBank = bank
      }
      voice = bank.version
      return true
    } catch {
      localBank = null
      voice = null
      return false
    }
  })()
  return loading
}

/** The sample pack version that renders now, or null when the string model does (also before `loadGuitar` has finished). */
export function guitarVoice(): number | null {
  return voice
}

/** Tests: use this bank on the current thread (null restores the string model). */
export function setGuitarBankForTests(bank: SampleBank | null): void {
  localBank = bank
  voice = bank ? bank.version : null
  loading = Promise.resolve(bank !== null)
  workerHasBank = false
}

/**
 * Renders a chart (guitar part and/or click track, see `BackingOptions`) with the current voice.
 * Runs in the worker when there is one, on this thread otherwise. Same output either way.
 */
export async function renderChartAudio(chart: Chart, options: RenderOptions = {}): Promise<Float32Array> {
  await loadGuitar()
  if (!localBank && (workerHasBank || voice === null)) {
    const job = ask({ type: 'chart', chart, options })
    if (job) {
      try {
        return await job
      } catch {
        // The worker died; fall through and render here (after reloading the samples onto this thread).
        await loadGuitar()
      }
    }
  }
  return renderChartBacking(chart, { ...options, bank: localBank })
}

/** One guitar note of `seconds` at `sampleRate`, starting 10 ms into the buffer and peaking at 0.8. */
export async function renderNoteAudio(midi: number, seconds: number, sampleRate: number): Promise<Float32Array> {
  await loadGuitar()
  if (!localBank && workerHasBank) {
    const job = ask({ type: 'note', midi, seconds, sampleRate })
    if (job) {
      try {
        return await job
      } catch {
        await loadGuitar()
      }
    }
  }
  return renderGuitarNote(localBank, midi, seconds, sampleRate)
}
