import { McLeodDetector, type McLeodOptions } from './mpm'

interface ProcessorOptions extends McLeodOptions {
  windowSize?: number
  hop?: number
}

/**
 * Runs the McLeod pitch detector on the audio thread. Every `hop` samples it
 * posts `{ type: 'pitch', freq, clarity, rms, time }` to the main thread.
 */
class PitchProcessor extends AudioWorkletProcessor {
  private readonly windowSize: number
  private hop: number
  private readonly ring: Float32Array
  private readonly frame: Float32Array
  private writeIdx = 0
  private filled = 0
  private sinceLast = 0
  private detector: McLeodDetector

  constructor(options?: AudioWorkletNodeOptions) {
    super(options)
    const o = (options?.processorOptions ?? {}) as ProcessorOptions
    this.windowSize = o.windowSize ?? 2048
    this.hop = o.hop ?? 512
    this.ring = new Float32Array(this.windowSize)
    this.frame = new Float32Array(this.windowSize)
    this.detector = new McLeodDetector(this.windowSize, sampleRate, o)
    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string } & ProcessorOptions
      if (msg?.type === 'configure') {
        this.detector = new McLeodDetector(this.windowSize, sampleRate, msg)
        if (msg.hop) this.hop = msg.hop
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    const n = channel.length
    for (let i = 0; i < n; i++) {
      this.ring[this.writeIdx] = channel[i]
      this.writeIdx = (this.writeIdx + 1) % this.windowSize
    }
    this.filled = Math.min(this.windowSize, this.filled + n)
    this.sinceLast += n
    if (this.sinceLast >= this.hop && this.filled >= this.windowSize) {
      this.sinceLast = 0
      const start = this.writeIdx
      this.frame.set(this.ring.subarray(start), 0)
      this.frame.set(this.ring.subarray(0, start), this.windowSize - start)
      const r = this.detector.detect(this.frame)
      this.port.postMessage({ type: 'pitch', freq: r.freq, clarity: r.clarity, rms: r.rms, time: currentTime })
    }
    return true
  }
}

registerProcessor('pitch-processor', PitchProcessor)

