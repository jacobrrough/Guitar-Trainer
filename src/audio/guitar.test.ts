import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyChart, type Chart } from '../chart/types'
import { loadRealBank } from './instrument/realBank.testutil'
import { renderChartBacking } from './synth'

/** A tiny chart: two notes on the low strings. */
function chart(): Chart {
  return emptyChart({
    duration: 2,
    tuning: [40, 45, 50, 55, 59, 64],
    notes: [
      { id: 0, time: 0.2, duration: 0.6, midi: 40, string: 0, fret: 0, velocity: 0.8, chordId: 0 },
      { id: 1, time: 1.0, duration: 0.6, midi: 47, string: 1, fret: 2, velocity: 0.8, chordId: 1 },
    ],
  })
}

type Reply = 'answer' | 'error' | 'silence'

/** Stands in for the browser: a fetch, a decoder that hands back the real recordings, and a worker that behaves as told. */
async function fakeBrowser(options: { worker: Reply; fetchFails?: () => boolean }) {
  const bank = await loadRealBank()
  let fetches = 0
  vi.stubGlobal('fetch', async () => {
    fetches++
    if (options.fetchFails?.()) throw new Error('offline')
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }
  })
  vi.stubGlobal(
    'OfflineAudioContext',
    class {
      decodeAudioData(_bytes: ArrayBuffer, resolve: (b: unknown) => void) {
        // A fresh copy each time, as a decoder gives: the first one is handed to the worker.
        resolve({ sampleRate: bank.sampleRate, getChannelData: () => new Float32Array(bank.pcm) })
      }
    },
  )
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((e: { data: unknown }) => void) | null = null
      onerror: (() => void) | null = null
      postMessage(message: { type: string; id?: number }) {
        if (message.type === 'bank' || options.worker === 'silence') return
        const id = message.id
        queueMicrotask(() => this.onmessage?.({ data: options.worker === 'error' ? { id, error: 'out of memory' } : { id, samples: new Float32Array([0.25]) } }))
      }
      terminate() {}
    },
  )
  return { bank, fetchCount: () => fetches }
}

describe('the guitar voice when things go wrong', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders in the worker and reports the recorded voice when all is well', async () => {
    const { bank } = await fakeBrowser({ worker: 'answer' })
    const guitar = await import('./guitar')
    const out = await guitar.renderChartVoiced(chart(), { sampleRate: 44100, seed: 1 })
    expect(out.voice).toBe(bank.version)
    expect(Array.from(out.samples)).toEqual([0.25])
  })

  it('a worker that fails a render: the recordings are loaded again on this thread and still play', async () => {
    const { bank, fetchCount } = await fakeBrowser({ worker: 'error' })
    const guitar = await import('./guitar')
    const out = await guitar.renderChartVoiced(chart(), { sampleRate: 44100, seed: 1 })
    expect(fetchCount()).toBe(2)
    expect(out.voice).toBe(bank.version)
    expect(out.samples).toEqual(renderChartBacking(chart(), { sampleRate: 44100, seed: 1, bank }))
    expect(guitar.guitarVoice()).toBe(bank.version)
  })

  it('if they cannot be loaded again, the string model plays and the render says so', async () => {
    let calls = 0
    await fakeBrowser({ worker: 'error', fetchFails: () => ++calls > 1 })
    const guitar = await import('./guitar')
    const out = await guitar.renderChartVoiced(chart(), { sampleRate: 44100, seed: 1 })
    expect(out.voice).toBeNull()
    expect(out.samples).toEqual(renderChartBacking(chart(), { sampleRate: 44100, seed: 1, bank: null }))
  })

  it('a first load that fails is tried again later, and listeners hear when the recordings arrive', async () => {
    vi.useFakeTimers()
    let down = true
    const { bank } = await fakeBrowser({ worker: 'answer', fetchFails: () => down })
    const guitar = await import('./guitar')
    const heard = vi.fn()
    guitar.onGuitarVoice(heard)
    expect(await guitar.loadGuitar()).toBe(false)
    down = false
    // Straight away the failure still stands (no hammering the network)...
    expect(await guitar.loadGuitar()).toBe(false)
    await vi.advanceTimersByTimeAsync(16_000)
    // ...a little later the next call tries again.
    expect(await guitar.loadGuitar()).toBe(true)
    expect(guitar.guitarVoice()).toBe(bank.version)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('a worker that never answers does not leave the render waiting for ever', async () => {
    vi.useFakeTimers()
    const { bank } = await fakeBrowser({ worker: 'silence' })
    const guitar = await import('./guitar')
    const pending = guitar.renderChartVoiced(chart(), { sampleRate: 44100, seed: 1 })
    await vi.advanceTimersByTimeAsync(21_000)
    const out = await pending
    expect(out.voice).toBe(bank.version)
    expect(out.samples.length).toBeGreaterThan(1000)
  })

  it('a download that hangs does not hold a render: the string model plays, and the recordings take over when they arrive', async () => {
    vi.useFakeTimers()
    const { bank } = await fakeBrowser({ worker: 'answer' })
    let arrive: () => void = () => undefined
    vi.stubGlobal('fetch', () => new Promise((resolve) => (arrive = () => resolve({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }))))
    const guitar = await import('./guitar')
    const heard = vi.fn()
    guitar.onGuitarVoice(heard)
    let out: { voice: number | null } | null = null
    void guitar.renderChartVoiced(chart(), { sampleRate: 44100, seed: 1 }).then((r) => (out = r))
    await vi.advanceTimersByTimeAsync(14_000)
    expect(out).toBeNull()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(out).toEqual(expect.objectContaining({ voice: null }))
    expect(heard).not.toHaveBeenCalled()
    arrive()
    await vi.advanceTimersByTimeAsync(10)
    expect(guitar.guitarVoice()).toBe(bank.version)
    expect(heard).toHaveBeenCalledTimes(1)
    expect((await guitar.renderChartVoiced(chart(), { sampleRate: 44100, seed: 1 })).voice).toBe(bank.version)
  })

  it('a failed load is tried again when asked (the connection is back), but a working voice is left alone', async () => {
    vi.useFakeTimers()
    let down = true
    const { bank, fetchCount } = await fakeBrowser({ worker: 'answer', fetchFails: () => down })
    const guitar = await import('./guitar')
    expect(await guitar.loadGuitar()).toBe(false)
    expect(fetchCount()).toBe(1)
    down = false
    await vi.advanceTimersByTimeAsync(3_000)
    guitar.retryGuitar()
    await vi.advanceTimersByTimeAsync(10)
    expect(fetchCount()).toBe(2)
    expect(guitar.guitarVoice()).toBe(bank.version)
    guitar.retryGuitar()
    guitar.retryGuitar()
    await vi.advanceTimersByTimeAsync(10)
    expect(fetchCount()).toBe(2)
  })
})
