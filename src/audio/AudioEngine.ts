import { keepAudioContextRunning, setAudioSessionType } from '../app/platform'
import pitchWorkletUrl from './pitch/pitch-processor.ts?worker&url'

export interface PitchFrame {
  freq: number
  clarity: number
  rms: number
  /** 12-bin pitch-class energy (C = 0), max-normalised; present only while chroma analysis is enabled. */
  chroma?: Float32Array
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
  /**
   * Let the OS cancel the song bleeding from the speaker into the mic.
   * Off by default (it colours the guitar signal); useful on a phone without headphones.
   */
  echoCancellation?: boolean
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
  private unlocked = false
  private chromaEnabled = false
  private lastMicOptions: MicOptions = {}

  get context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      // iOS "interrupted" state (phone call, Siri, app switch) never recovers by itself.
      keepAudioContextRunning(this.ctx, () => void this.recoverMic())
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.recoverMic()
      })
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

  /**
   * Call synchronously inside a tap/click handler. iOS Safari only starts audio
   * from a user gesture, and the gesture is spent once we await anything
   * (permissions, count-in timers), so the context is created, resumed and
   * primed with a silent buffer right here.
   */
  unlock(): void {
    const ctx = this.context
    if (ctx.state !== 'running') void ctx.resume()
    // Without a mic session iOS mutes Web Audio (metronome, count-in, ear trainer) when the ringer switch is on silent.
    if (!this._micActive) setAudioSessionType('playback')
    if (this.unlocked) return
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start(0)
      this.unlocked = true
    } catch {
      /* ignore */
    }
  }

  private ensureWorklet(): Promise<void> {
    if (!this.workletLoaded) {
      this.workletLoaded = this.loadWorkletModule().catch((err) => {
        this.workletLoaded = null
        throw err
      })
    }
    return this.workletLoaded
  }

  /**
   * In production the worklet is fetched with fetch() (always routed through the service worker, so it
   * works offline) and loaded from a blob URL; the bundle is a single file with no imports. If that fails
   * we fall back to the plain URL. In dev the module imports other files, so the URL is used directly.
   */
  private async loadWorkletModule(): Promise<void> {
    const worklet = this.context.audioWorklet
    if (import.meta.env.PROD) {
      try {
        const res = await fetch(pitchWorkletUrl)
        if (res.ok) {
          const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }))
          try {
            await worklet.addModule(blobUrl)
            return
          } finally {
            URL.revokeObjectURL(blobUrl)
          }
        }
      } catch {
        /* fall through to the direct URL */
      }
    }
    await worklet.addModule(pitchWorkletUrl)
  }

  private async openMicStream(options: MicOptions): Promise<MediaStream> {
    const base = { echoCancellation: options.echoCancellation ?? false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { ...base, deviceId: options.deviceId ? { exact: options.deviceId } : undefined },
        video: false,
      })
    } catch (err) {
      // A saved interface that was unplugged (or whose id iOS reset) must not lock the user out of the mic.
      if (options.deviceId && err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        return navigator.mediaDevices.getUserMedia({ audio: base, video: false })
      }
      throw err
    }
  }

  /** After backgrounding or a call iOS leaves the mic track muted/ended; reopen it. */
  private async recoverMic(): Promise<void> {
    if (!this._micActive) return
    const track = this.stream?.getAudioTracks()[0]
    if (track && track.readyState === 'live' && !track.muted) return
    try {
      await this.startMic(this.lastMicOptions)
    } catch {
      this._micActive = false
    }
  }

  async startMic(options: MicOptions = {}): Promise<void> {
    await this.resume()
    this.stopMic()
    const ctx = this.context
    this.lastMicOptions = options
    // iOS: ask for a session that records and plays through the speaker at full volume.
    setAudioSessionType('play-and-record')
    const stream = await this.openMicStream(options)
    await this.ensureWorklet()
    this.stream = stream
    this.source = ctx.createMediaStreamSource(stream)
    this.worklet = new AudioWorkletNode(ctx, 'pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: {
        windowSize: 2048,
        chromaWindow: 4096,
        hop: 512,
        minFreq: options.minFreq ?? 55,
        maxFreq: options.maxFreq ?? 1500,
        threshold: options.threshold ?? 0.93,
      },
    })
    this.worklet.port.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d?.type === 'pitch') {
        const frame: PitchFrame = { freq: d.freq, clarity: d.clarity, rms: d.rms, time: d.time, chroma: d.chroma }
        for (const l of this.listeners) l(frame)
      }
    }
    if (this.chromaEnabled) this.worklet.port.postMessage({ type: 'configure', chroma: true })
    // A silent sink guarantees the graph is pulled by the destination.
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    this.source.connect(this.worklet)
    this.worklet.connect(this.sink)
    this.sink.connect(ctx.destination)
    this._micActive = true
    stream.getAudioTracks()[0]?.addEventListener('unmute', () => void this.recoverMic())
    this._micDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? options.deviceId
  }

  configureDetector(opts: { minFreq?: number; maxFreq?: number; threshold?: number; chroma?: boolean }): void {
    if (opts.chroma !== undefined) this.chromaEnabled = opts.chroma
    this.worklet?.port.postMessage({ type: 'configure', ...opts })
  }

  /**
   * Turns per-frame chroma analysis on or off (used for chord scoring). The flag
   * survives mic restarts, so it can be set before `startMic`.
   */
  setChroma(enabled: boolean): void {
    if (this.chromaEnabled === enabled) return
    this.chromaEnabled = enabled
    this.worklet?.port.postMessage({ type: 'configure', chroma: enabled })
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
    if (this._micActive) setAudioSessionType('playback')
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
