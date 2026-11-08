import { ChromaAnalyzer } from './chroma'
import { McLeodDetector, type McLeodOptions } from './mpm'

interface ProcessorOptions extends McLeodOptions {
  windowSize?: number
  /** Longer window for chord analysis: two strings a fourth apart below 200 Hz only separate with ~90 ms of signal. */
  chromaWindow?: number
  hop?: number
  chroma?: boolean
}

/**
 * Runs the McLeod pitch detector on the audio thread. Every `hop` samples it
 * posts `{ type: 'pitch', freq, clarity, rms, time }` (plus `chroma` when enabled) to the main thread.
 * Pitch uses the last `windowSize` samples (short, for low latency on single notes); chroma uses the
 * last `chromaWindow` samples (longer, so the low strings of a chord resolve as separate peaks).
 */
class PitchProcessor extends AudioWorkletProcessor {
  private readonly windowSize: number
  private readonly chromaWindow: number
  private readonly ringSize: number
  private hop: number
  private readonly ring: Float32Array
  private readonly frame: Float32Array
  private readonly chromaFrame: Float32Array
  private writeIdx = 0
  private filled = 0
  private sinceLast = 0
  private detector: McLeodDetector
  private detectorOptions: McLeodOptions
  private readonly analyzer: ChromaAnalyzer
  private chromaOn = false

  constructor(options?: AudioWorkletNodeOptions) {
    super(options)
    const o = (options?.processorOptions ?? {}) as ProcessorOptions
    this.windowSize = o.windowSize ?? 2048
    this.chromaWindow = Math.max(this.windowSize, o.chromaWindow ?? 4096)
    this.ringSize = this.chromaWindow
    this.hop = o.hop ?? 512
    this.ring = new Float32Array(this.ringSize)
    this.frame = new Float32Array(this.windowSize)
    this.chromaFrame = new Float32Array(this.chromaWindow)
    this.detectorOptions = { minFreq: o.minFreq, maxFreq: o.maxFreq, threshold: o.threshold }
    this.detector = new McLeodDetector(this.windowSize, sampleRate, o)
    this.analyzer = new ChromaAnalyzer(this.chromaWindow, sampleRate)
    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string } & ProcessorOptions
      if (msg?.type === 'configure') {
        if (msg.minFreq !== undefined || msg.maxFreq !== undefined || msg.threshold !== undefined) {
          this.detectorOptions = {
            minFreq: msg.minFreq ?? this.detectorOptions.minFreq,
            maxFreq: msg.maxFreq ?? this.detectorOptions.maxFreq,
            threshold: msg.threshold ?? this.detectorOptions.threshold,
          }
          this.detector = new McLeodDetector(this.windowSize, sampleRate, this.detectorOptions)
        }
        if (msg.chroma !== undefined) this.chromaOn = msg.chroma
        if (msg.hop) this.hop = msg.hop
      }
    }
  }

  /** Copies the most recent `out.length` samples of the ring into `out`, oldest first. */
  private latest(out: Float32Array): void {
    const size = this.ringSize
    const start = (this.writeIdx - out.length + size) % size
    const firstPart = Math.min(out.length, size - start)
    out.set(this.ring.subarray(start, start + firstPart), 0)
    if (firstPart < out.length) out.set(this.ring.subarray(0, out.length - firstPart), firstPart)
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    const n = channel.length
    for (let i = 0; i < n; i++) {
      this.ring[this.writeIdx] = channel[i]
      this.writeIdx = (this.writeIdx + 1) % this.ringSize
    }
    this.filled = Math.min(this.ringSize, this.filled + n)
    this.sinceLast += n
    if (this.sinceLast >= this.hop && this.filled >= this.windowSize) {
      this.sinceLast = 0
      this.latest(this.frame)
      const r = this.detector.detect(this.frame)
      if (this.chromaOn && this.filled >= this.chromaWindow) {
        this.latest(this.chromaFrame)
        const chroma = this.analyzer.analyze(this.chromaFrame, new Float32Array(12))
        this.port.postMessage({ type: 'pitch', freq: r.freq, clarity: r.clarity, rms: r.rms, time: currentTime, chroma })
      } else {
        this.port.postMessage({ type: 'pitch', freq: r.freq, clarity: r.clarity, rms: r.rms, time: currentTime })
      }
    }
    return true
  }
}

registerProcessor('pitch-processor', PitchProcessor)

