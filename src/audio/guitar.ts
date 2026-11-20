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
const voiceListeners = new Set<() => void>()

/** A worker that has not answered a job after this long is given up on (a phone renders a song in a second or two). */
const JOB_TIMEOUT_MS = 20_000
/** After a failed load of the recordings, the next render may try again once this much time has passed. */
const RETRY_LOAD_AFTER_MS = 15_000
/**
 * A render waits this long for the recordings and then goes ahead with the string model. On a very
 * slow or stalled first download no screen is left waiting; the download carries on, and what was
 * rendered in the meantime is made again when it arrives (see `onGuitarVoice`).
 */
const LOAD_WAIT_MS = 15_000
/** A load that failed, and when; null while none has, or once another try has begun. */
let failedAt: number | null = null

/** Calls `listener` each time the recorded guitar becomes available (at launch, or later after a failed first try). */
export function onGuitarVoice(listener: () => void): () => void {
  voiceListeners.add(listener)
  return () => {
    voiceListeners.delete(listener)
  }
}

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
    // A reply that never comes must not leave a screen waiting for ever: give the worker up, which
    // rejects every job in flight, and the callers render on this thread instead.
    const timer = setTimeout(() => pending.has(id) && failWorker(), JOB_TIMEOUT_MS)
    pending.set(id, {
      resolve: (samples) => {
        clearTimeout(timer)
        resolve(samples)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
    })
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
      failedAt = null
      for (const l of voiceListeners) l()
      return true
    } catch {
      localBank = null
      voice = null
      failedAt = Date.now()
      // Often a passing problem (no signal on the very first launch, before anything is cached): let a
      // later render try again instead of keeping the whole session on the string model.
      const failed = loading
      setTimeout(() => {
        if (loading === failed && voice === null) loading = null
      }, RETRY_LOAD_AFTER_MS)
      return false
    }
  })()
  return loading
}

/**
 * Tries for the recordings again now if the last try failed: for the moments when that is likely to
 * work at last (the connection is back, the app is opened again). Does nothing otherwise.
 */
export function retryGuitar(): void {
  if (voice !== null || failedAt === null || Date.now() - failedAt < 2000) return
  failedAt = null
  loading = null
  void loadGuitar()
}

/** Waits for the recordings, but not for ever (see LOAD_WAIT_MS): for anything a screen is waiting on. */
export function recordingsOrTimeout(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, LOAD_WAIT_MS)
    void loadGuitar().then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** The sample pack version that renders now, or null when the string model does (also before `loadGuitar` has finished). */
export function guitarVoice(): number | null {
  return voice
}

/** Tests: use this bank on the current thread (null restores the string model). */
export function setGuitarBankForTests(bank: SampleBank | null): void {
  failedAt = null
  localBank = bank
  voice = bank ? bank.version : null
  loading = Promise.resolve(bank !== null)
  workerHasBank = false
}

/**
 * After a worker job failed: the recordings went to the worker and are not on this thread, so a
 * render here would quietly use the string model. Give the worker up and load them again, onto this
 * thread this time.
 */
async function recoverOnThisThread(): Promise<void> {
  if (!localBank && voice !== null) failWorker()
  await loadGuitar()
}

/**
 * Renders a chart (guitar part and/or click track, see `BackingOptions`) and says which voice really
 * played it: the sample pack's version, or null for the string model. Stored audio is named after
 * that, so a render that had to fall back is recognised and made again later.
 * Runs in the worker when there is one, on this thread otherwise. Same output either way.
 */
export async function renderChartVoiced(chart: Chart, options: RenderOptions = {}): Promise<{ samples: Float32Array; voice: number | null }> {
  await recordingsOrTimeout()
  if (!localBank && (workerHasBank || voice === null)) {
    const used = workerHasBank ? voice : null
    const job = ask({ type: 'chart', chart, options })
    if (job) {
      try {
        return { samples: await job, voice: used }
      } catch {
        await recoverOnThisThread()
      }
    }
  }
  return { samples: renderChartBacking(chart, { ...options, bank: localBank }), voice: localBank ? localBank.version : null }
}

/** `renderChartVoiced` for callers that only need the sound. */
export async function renderChartAudio(chart: Chart, options: RenderOptions = {}): Promise<Float32Array> {
  return (await renderChartVoiced(chart, options)).samples
}

/** One guitar note of `seconds` at `sampleRate`, starting 10 ms into the buffer and peaking at 0.8. */
export async function renderNoteAudio(midi: number, seconds: number, sampleRate: number): Promise<Float32Array> {
  await recordingsOrTimeout()
  if (!localBank && workerHasBank) {
    const job = ask({ type: 'note', midi, seconds, sampleRate })
    if (job) {
      try {
        return await job
      } catch {
        await recoverOnThisThread()
      }
    }
  }
  return renderGuitarNote(localBank, midi, seconds, sampleRate)
}
