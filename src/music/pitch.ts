/** Note names using sharps; index = pitch class. */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export const A4_MIDI = 69

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * 2 ** ((midi - A4_MIDI) / 12)
}

/** Fractional MIDI number for a frequency (69 = A4). */
export function freqToMidi(freq: number, a4 = 440): number {
  return A4_MIDI + 12 * Math.log2(freq / a4)
}

export function nearestMidi(freq: number, a4 = 440): number {
  return Math.round(freqToMidi(freq, a4))
}

/** Signed cents between a frequency and a MIDI note (positive = sharp). */
export function centsOff(freq: number, midi: number, a4 = 440): number {
  return 1200 * Math.log2(freq / midiToFreq(midi, a4))
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12
}

export function midiToName(midi: number, withOctave = true): string {
  const name = NOTE_NAMES[pitchClass(midi)]
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
