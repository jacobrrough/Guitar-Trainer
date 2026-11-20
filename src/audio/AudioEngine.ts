import { keepAudioContextRunning, setAudioSessionType } from '../app/platform'
import pitchWorkletUrl from './pitch/pitch-processor.ts?worker&url'

export interface PitchFrame {
  freq: number
  clarity: number
  rms: number
  /** Spectral peaks of the last ~90 ms as [freq, amp, ...] pairs; present only while spectrum analysis is enabled (a run is being scored). */
  peaks?: Float32Array
  /** Attack strength of the last hop, wide-band and in the 600 Hz - 4 kHz band (see FrameAnalyzer); present only while spectrum analysis is enabled. */
  flux?: number
  fluxBand?: number
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
  private spectrumEnabled = false
  private lastMicOptions: MicOptions = {}
  /** Bumped by every startMic and stopMic: a start that was overtaken while it awaited gives its stream back. */
  private micGeneration = 0
  private micStarts = 0
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private readonly micListeners = new Set<() => void>()

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
    if (!this._micActive || this.micStarts > 0) return
    const track = this.stream?.getAudioTracks()[0]
    if (track && track.readyState === 'live' && !track.muted) return
    try {
      await this.startMic(this.lastMicOptions)
    } catch {
      // Could not be reopened: say so, so the screens stop showing a microphone that is not there.
      this.teardownMic()
      this.setMicActive(false)
    }
  }

  /**
   * Opens the microphone and starts the detector. Calls are safe to overlap (a second tap while the
   * permission prompt is up, a recovery racing a start): the latest call wins and an overtaken one
   * closes the stream it opened, so no microphone is ever left running without an owner.
   */
  async startMic(options: MicOptions = {}): Promise<void> {
    const generation = ++this.micGeneration
    const overtaken = () => generation !== this.micGeneration
    this.cancelRelease()
    this.micStarts++
    let stream: MediaStream | null = null
    try {
      await this.resume()
      if (overtaken()) return
      this.teardownMic()
      this.lastMicOptions = options
      // iOS: ask for a session that records and plays through the speaker at full volume.
      setAudioSessionType('play-and-record')
      stream = await this.openMicStream(options)
      if (!overtaken()) await this.ensureWorklet()
      if (overtaken()) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      this.installMic(stream, options)
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop())
      if (!overtaken()) {
        this.teardownMic()
        setAudioSessionType('playback')
      }
      throw err
    } finally {
      this.micStarts--
    }
  }

  private installMic(stream: MediaStream, options: MicOptions): void {
    const ctx = this.context
    this.stream = stream
    this.source = ctx.createMediaStreamSource(stream)
    this.worklet = new AudioWorkletNode(ctx, 'pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: {
        windowSize: 2048,
        spectrumWindow: 4096,
        hop: 512,
        minFreq: options.minFreq ?? 55,
        maxFreq: options.maxFreq ?? 1500,
        threshold: options.threshold ?? 0.93,
      },
    })
    this.worklet.port.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d?.type === 'pitch') {
        const frame: PitchFrame = { freq: d.freq, clarity: d.clarity, rms: d.rms, time: d.time, peaks: d.peaks, flux: d.flux, fluxBand: d.fluxBand }
        for (const l of this.listeners) l(frame)
      }
    }
    if (this.spectrumEnabled) this.worklet.port.postMessage({ type: 'configure', spectrum: true })
    // A silent sink guarantees the graph is pulled by the destination.
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    this.source.connect(this.worklet)
    this.worklet.connect(this.sink)
    this.sink.connect(ctx.destination)
    const track = stream.getAudioTracks()[0]
    track?.addEventListener('unmute', () => void this.recoverMic())
    // The input went away while the page stayed open (headphones back in their case, an interface
    // unplugged): reopen whatever microphone is there now, or report that there is none.
    track?.addEventListener('ended', () => {
      if (this.stream === stream) void this.recoverMic()
    })
    this._micDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? options.deviceId
    this.setMicActive(true)
  }

  private setMicActive(active: boolean): void {
    if (this._micActive === active) return
    this._micActive = active
    for (const l of this.micListeners) l()
  }

  /** Calls `listener` whenever the microphone goes on or off (for `useSyncExternalStore`). */
  subscribeMic(listener: () => void): () => void {
    this.micListeners.add(listener)
    return () => {
      this.micListeners.delete(listener)
    }
  }

  configureDetector(opts: { minFreq?: number; maxFreq?: number; threshold?: number }): void {
    // Remembered, so a microphone that is reopened after an interruption comes back with this range.
    this.lastMicOptions = { ...this.lastMicOptions, ...opts }
    this.worklet?.port.postMessage({ type: 'configure', ...opts })
  }

  /**
   * Turns per-frame spectrum analysis on or off (the scorer needs it; the tuner does not). The flag
   * survives mic restarts, so it can be set before `startMic`.
   */
  setSpectrum(enabled: boolean): void {
    if (this.spectrumEnabled === enabled) return
    this.spectrumEnabled = enabled
    this.worklet?.port.postMessage({ type: 'configure', spectrum: enabled })
  }

  private teardownMic(): void {
    this.worklet?.port.close()
    this.worklet?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.worklet = null
    this.source = null
    this.sink = null
    this.stream = null
  }

  private cancelRelease(): void {
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer)
    this.releaseTimer = null
  }

  /** Closes the microphone now (and cancels a start that is still under way). */
  stopMic(): void {
    this.micGeneration++
    this.cancelRelease()
    this.teardownMic()
    if (this._micActive) setAudioSessionType('playback')
    this.setMicActive(false)
  }

  /**
   * For a screen that is going away: closes the microphone in a moment, unless the screen replacing
   * it claims it first (`claimMic`) or starts it again. Stopping at once would cut the microphone from
   * under the next screen, whose own start then races the stop.
   */
  releaseMic(): void {
    this.cancelRelease()
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null
      this.stopMic()
    }, 250)
  }

  /** Takes over a running microphone from the screen before (cancelling its `releaseMic`). Returns whether one is running. */
  claimMic(): boolean {
    if (!this._micActive) return false
    this.cancelRelease()
    return true
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
