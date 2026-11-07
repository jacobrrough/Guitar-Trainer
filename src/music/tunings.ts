import { midiToName } from './pitch'

export type Instrument = 'guitar' | 'bass' | 'ukulele'

export interface Tuning {
  id: string
  name: string
  /** Open-string MIDI numbers, lowest string first. */
  strings: number[]
  instrument: Instrument
}

export const TUNINGS: Tuning[] = [
  { id: 'standard', name: 'Standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64], instrument: 'guitar' },
  { id: 'drop-d', name: 'Drop D (D A D G B E)', strings: [38, 45, 50, 55, 59, 64], instrument: 'guitar' },
  { id: 'half-step-down', name: 'Half step down (Eb)', strings: [39, 44, 49, 54, 58, 63], instrument: 'guitar' },
  { id: 'd-standard', name: 'D standard', strings: [38, 43, 48, 53, 57, 62], instrument: 'guitar' },
  { id: 'drop-c', name: 'Drop C', strings: [36, 43, 48, 53, 57, 62], instrument: 'guitar' },
  { id: 'dadgad', name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62], instrument: 'guitar' },
  { id: 'open-g', name: 'Open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62], instrument: 'guitar' },
  { id: 'open-d', name: 'Open D (D A D F# A D)', strings: [38, 45, 50, 54, 57, 62], instrument: 'guitar' },
  { id: '7-string', name: '7-string standard (B E A D G B E)', strings: [35, 40, 45, 50, 55, 59, 64], instrument: 'guitar' },
  { id: 'bass-standard', name: 'Bass standard (E A D G)', strings: [28, 33, 38, 43], instrument: 'bass' },
  { id: 'bass-5', name: 'Bass 5-string (B E A D G)', strings: [23, 28, 33, 38, 43], instrument: 'bass' },
  { id: 'ukulele', name: 'Ukulele (G C E A)', strings: [67, 60, 64, 69], instrument: 'ukulele' },
]

export const DEFAULT_TUNING = TUNINGS[0]

export function getTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? DEFAULT_TUNING
}

/** Finds a preset whose open strings match exactly, if any. */
export function findTuningByStrings(strings: number[]): Tuning | undefined {
  return TUNINGS.find((t) => t.strings.length === strings.length && t.strings.every((s, i) => s === strings[i]))
}

/** "E2 A2 D3 G3 B3 E4" style label. */
export function describeTuning(strings: number[]): string {
  return strings.map((m) => midiToName(m)).join(' ')
}

/** Short label such as "Standard" or "E A D G B E" for unknown tunings. */
export function tuningLabel(strings: number[]): string {
  const preset = findTuningByStrings(strings)
  if (preset) return preset.name.replace(/\s*\(.*\)$/, '')
  return strings.map((m) => midiToName(m, false)).join(' ')
}
