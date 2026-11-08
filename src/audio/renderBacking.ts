import type { Chart } from '../chart/types'
import { renderChartBacking, type BackingOptions } from './synth'

interface Pending {
  resolve: (samples: Float32Array) => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, Pending>()

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
  worker.onerror = () => {
    // The worker could not load (old browser, blocked script): finish the current jobs inline and stop using it.
    workerBroken = true
    const jobs = [...pending.values()]
    pending.clear()
    worker?.terminate()
    worker = null
    for (const job of jobs) job.reject(new Error('worker unavailable'))
  }
  return worker
}

/**
 * `renderChartBacking` off the main thread when a Worker is available (a bundled song takes a few
 * hundred milliseconds on a phone, and the wizard installs twelve), inline otherwise (tests, very
 * old browsers). Same output either way.
 */
export function renderChartBackingAsync(chart: Chart, options: BackingOptions = {}): Promise<Float32Array> {
  const w = getWorker()
  if (!w) return Promise.resolve(renderChartBacking(chart, options))
  const id = nextId++
  return new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, chart, options })
  }).catch(() => renderChartBacking(chart, options))
}
