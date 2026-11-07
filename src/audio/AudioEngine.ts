import pitchWorkletUrl from './pitch/pitch-processor.ts?worker&url'

export interface PitchFrame {
  freq: number
  clarity: number
  rms: number
  /** AudioContext time at which the frame was analysed. */
  time: number
}

export type PitchListener = (frame: PitchFrame) => void

export interface MicOptions {
  deviceId?: string
  /** Detector settings forwarded to the worklet. */
  minFreq?: number
  maxFreq?: number
  threshold?: number
}

/**
 * Owns the single AudioContext, the microphone stream and the pitch-detection
 * worklet. Both the tuner and the play-along scorer subscribe to its frames.
 */
class AudioEngine {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private workletLoaded: Promise<void> | null = null
  private readonly listeners = new Set<PitchListener>()
  private _micActive = false
  private _micDeviceId: string | undefined

  get context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
    }
    return this.ctx
  }

  get micActive(): boolean {
    return this._micActive
  }

  get micDeviceId(): string | undefined {
    return this._micDeviceId
  }

  /** Output latency estimate in seconds (what the user hears vs. the clock). */
  get outputLatency(): number {
    const ctx = this.ctx
    if (!ctx) return 0
    return (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0
  }

  async resume(): Promise<void> {
    const ctx = this.context
    if (ctx.state !== 'running') await ctx.resume()
  }

  private ensureWorklet(): Promise<void> {
    if (!this.workletLoaded) {
      this.workletLoaded = this.context.audioWorklet.addModule(pitchWorkletUrl).catch((err) => {
        this.workletLoaded = null
        throw err
      })
    }
    return this.workletLoaded
  }

  async startMic(options: MicOptions = {}): Promise<void> {
    await this.resume()
    this.stopMic()
    const ctx = this.context
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    })
    await this.ensureWorklet()
    this.stream = stream
    this.source = ctx.createMediaStreamSource(stream)
    this.worklet = new AudioWorkletNode(ctx, 'pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: {
        windowSize: 2048,
        hop: 512,
        minFreq: options.minFreq ?? 55,
        maxFreq: options.maxFreq ?? 1500,
        threshold: options.threshold ?? 0.93,
      },
    })
    this.worklet.port.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d?.type === 'pitch') {
        const frame: PitchFrame = { freq: d.freq, clarity: d.clarity, rms: d.rms, time: d.time }
        for (const l of this.listeners) l(frame)
      }
    }
    // A silent sink guarantees the graph is pulled by the destination.
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    this.source.connect(this.worklet)
    this.worklet.connect(this.sink)
    this.sink.connect(ctx.destination)
    this._micActive = true
    this._micDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? options.deviceId
  }

  configureDetector(opts: { minFreq?: number; maxFreq?: number; threshold?: number }): void {
    this.worklet?.port.postMessage({ type: 'configure', ...opts })
  }

  stopMic(): void {
    this.worklet?.port.close()
    this.worklet?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.worklet = null
    this.source = null
    this.sink = null
    this.stream = null
    this._micActive = false
  }

  subscribe(listener: PitchListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async listInputs(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'audioinput')
  }
}

export const audioEngine = new AudioEngine()
