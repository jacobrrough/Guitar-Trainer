/// <reference lib="webworker" />
import type { Chart } from '../chart/types'
import { renderChartBacking, type BackingOptions } from './synth'

/** Renders a chart off the main thread; see `renderBacking.ts`. */
interface RenderRequest {
  id: number
  chart: Chart
  options?: BackingOptions
}

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const { id, chart, options } = e.data
  try {
    const samples = renderChartBacking(chart, options)
    ;(self as unknown as Worker).postMessage({ id, samples }, [samples.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
