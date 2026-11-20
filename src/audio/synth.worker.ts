/// <reference lib="webworker" />
import type { Chart } from '../chart/types'
import type { SampleBank } from './instrument/bank'
import { renderChartBacking, renderGuitarNote, type BackingOptions } from './synth'

/** Renders guitar audio off the main thread; see `guitar.ts`. The sample bank arrives once and stays here. */
type Request =
  | { type: 'bank'; bank: SampleBank }
  | { type: 'chart'; id: number; chart: Chart; options?: Omit<BackingOptions, 'bank'> }
  | { type: 'note'; id: number; midi: number; seconds: number; sampleRate: number }

let bank: SampleBank | null = null
const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

self.onmessage = (e: MessageEvent<Request>) => {
  const msg = e.data
  if (msg.type === 'bank') {
    bank = msg.bank
    return
  }
  try {
    const samples = msg.type === 'chart' ? renderChartBacking(msg.chart, { ...msg.options, bank }) : renderGuitarNote(bank, msg.midi, msg.seconds, msg.sampleRate)
    post({ id: msg.id, samples }, [samples.buffer])
  } catch (err) {
    post({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
  }
}
