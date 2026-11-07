import { useEffect, useState } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { freqToMidi, midiToName } from '../../music/pitch'

export interface TunerReading {
  freq: number
  /** Nearest chromatic MIDI note. */
  midi: number
  /** Fractional MIDI value. */
  midiFloat: number
  cents: number
  name: string
  octave: number
  clarity: number
  rms: number
  /** True when no clear pitch has been heard for a while; the last reading is shown faded. */
  stale: boolean
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Smoothed pitch reading from the shared audio engine; `null` until something is heard. */
export function useTuner(active: boolean, a4: number, clarityThreshold: number): { reading: TunerReading | null; level: number } {
  const [reading, setReading] = useState<TunerReading | null>(null)
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!active) return
    const history: number[] = []
    let lastValid = 0
    let lastUpdate = 0
    const unsubscribe = audioEngine.subscribe((frame) => {
      const now = performance.now()
      if (now - lastUpdate < 33) return
      lastUpdate = now
      setLevel(frame.rms)
      const valid = frame.freq > 0 && frame.clarity >= clarityThreshold && frame.rms > 0.003
      if (valid) {
        history.push(frame.freq)
        if (history.length > 5) history.shift()
        const freq = median(history)
        const midiFloat = freqToMidi(freq, a4)
        const midi = Math.round(midiFloat)
        lastValid = now
        setReading({
          freq,
          midi,
          midiFloat,
          cents: (midiFloat - midi) * 100,
          name: midiToName(midi, false),
          octave: Math.floor(midi / 12) - 1,
          clarity: frame.clarity,
          rms: frame.rms,
          stale: false,
        })
      } else {
        history.length = 0
        if (now - lastValid > 700) setReading((r) => (r && !r.stale ? { ...r, stale: true } : r))
      }
    })
    return unsubscribe
  }, [active, a4, clarityThreshold])

  return { reading, level }
}
