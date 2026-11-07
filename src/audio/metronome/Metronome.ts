import { audioEngine } from '../AudioEngine'
import { scheduleWindow, type ClickEvent, type MetronomeSettings, type SchedulerState } from './scheduler-core'

export type BeatListener = (event: ClickEvent) => void

const CLICK_FREQ = { high: 1760, mid: 1175, low: 880 } as const

/** Synthesises a short click; shared by the metronome and the play-along count-in. */
export function playClick(ctx: AudioContext, destination: AudioNode, time: number, accent: ClickEvent['accent'], gainValue = 1): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = CLICK_FREQ[accent]
  const peak = (accent === 'high' ? 0.5 : accent === 'mid' ? 0.4 : 0.25) * gainValue
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + (accent === 'high' ? 0.08 : 0.05))
  osc.connect(gain).connect(destination)
  osc.start(time)
  osc.stop(time + 0.1)
}

export class Metronome {
  settings: MetronomeSettings = { bpm: 100, beatsPerBar: 4, subdivision: 1, accentFirst: true }
  volume = 0.8
  private state: SchedulerState | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private master: GainNode | null = null
  private readonly listeners = new Set<BeatListener>()
  private readonly uiTimers = new Set<ReturnType<typeof setTimeout>>()
  readonly lookaheadMs = 25
  readonly scheduleAheadSec = 0.12

  get running(): boolean {
    return this.timer !== null
  }

  onBeat(listener: BeatListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    if (this.timer) return
    await audioEngine.resume()
    const ctx = audioEngine.context
    if (!this.master) {
      this.master = ctx.createGain()
      this.master.connect(ctx.destination)
    }
    this.master.gain.value = this.volume
    this.state = { nextTime: ctx.currentTime + 0.05, beat: 0, sub: 0 }
    this.tick()
    this.timer = setInterval(() => this.tick(), this.lookaheadMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state = null
    for (const t of this.uiTimers) clearTimeout(t)
    this.uiTimers.clear()
  }

  setVolume(v: number): void {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  /** Changing settings while running restarts the bar from the next click. */
  update(partial: Partial<MetronomeSettings>): void {
    const wasRunning = this.running
    this.settings = { ...this.settings, ...partial }
    if (wasRunning && (partial.beatsPerBar !== undefined || partial.subdivision !== undefined)) {
      this.stop()
      void this.start()
    }
  }

  private tick(): void {
    if (!this.state || !this.master) return
    const ctx = audioEngine.context
    const { events, state } = scheduleWindow(this.state, this.settings, ctx.currentTime + this.scheduleAheadSec)
    this.state = state
    for (const ev of events) {
      playClick(ctx, this.master, ev.time, ev.accent)
      const delay = Math.max(0, (ev.time - ctx.currentTime) * 1000)
      const t = setTimeout(() => {
        this.uiTimers.delete(t)
        for (const l of this.listeners) l(ev)
      }, delay)
      this.uiTimers.add(t)
    }
  }
}

export const metronome = new Metronome()
