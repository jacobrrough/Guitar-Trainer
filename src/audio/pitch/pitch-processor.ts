import { FrameAnalyzer, type FrameAnalyzerOptions } from './frameAnalyzer'

/**
 * Runs the pitch detector on the audio thread. Every `hop` samples it posts
 * `{ type: 'pitch', freq, clarity, rms, time }` (plus `peaks` and `flux` while a run is scored) to the main thread.
 * The framing itself lives in `FrameAnalyzer`, shared with the scoring simulation.
 */
class PitchProcessor extends AudioWorkletProcessor {
  private readonly analyzer: FrameAnalyzer

  constructor(options?: AudioWorkletNodeOptions) {
    super(options)
    this.analyzer = new FrameAnalyzer(sampleRate, (options?.processorOptions ?? {}) as FrameAnalyzerOptions)
    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string } & FrameAnalyzerOptions
      if (msg?.type === 'configure') this.analyzer.configure(msg)
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    const frame = this.analyzer.push(channel)
    if (frame) this.port.postMessage({ type: 'pitch', freq: frame.freq, clarity: frame.clarity, rms: frame.rms, time: currentTime, peaks: frame.peaks, flux: frame.flux, fluxBand: frame.fluxBand })
    return true
  }
}

registerProcessor('pitch-processor', PitchProcessor)
