import type { PitchFrame } from '../../audio/AudioEngine'
import { freqToMidi } from '../../music/pitch'

export interface TrackedPitch {
  /** Fractional MIDI pitch, or null when nothing clear is heard. */
  midi: number | null
  /** A sudden level jump: the player plucked again. */
  isAttack: boolean
  rms: number
}

/** Median-smooths detector frames and flags attacks (new picks). */
export class PitchSmoother {
  private readonly history: number[] = []
  private envelope = 0

  reset(): void {
    this.history.length = 0
    this.envelope = 0
  }

  push(frame: PitchFrame, clarityThreshold: number, a4 = 440, minRms = 0.004): TrackedPitch {
    const isAttack = frame.rms > minRms * 1.5 && frame.rms > this.envelope * 1.8
    this.envelope = Math.max(frame.rms, this.envelope * 0.92)
    const valid = frame.freq > 0 && frame.clarity >= clarityThreshold && frame.rms >= minRms
    if (!valid) {
      this.history.length = 0
      return { midi: null, isAttack, rms: frame.rms }
    }
    this.history.push(freqToMidi(frame.freq, a4))
    if (this.history.length > 3) this.history.shift()
    const sorted = [...this.history].sort((x, y) => x - y)
    const midi = sorted[sorted.length >> 1]
    return { midi, isAttack, rms: frame.rms }
  }
}
