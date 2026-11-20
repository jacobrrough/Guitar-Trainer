import type { Chart, NoteTechniques } from '../chart/types'

/** What a stored copy of a bundled song takes from the app: its name, tempo and chart. */
export interface RevisedContent {
  title: string
  artist: string
  bpm: number
  chart: Chart
}

// Whole microseconds, so a time prints the same way however it was worked out.
const us = (seconds: number) => Math.round(seconds * 1e6)

function techniques(tech: NoteTechniques | undefined): string {
  if (!tech) return ''
  return (Object.keys(tech) as (keyof NoteTechniques)[]).filter((k) => tech[k]).sort().join('+')
}

/** Two 32-bit running hashes mixed together: small, the same in every browser, and good for telling two charts apart. */
function hash(text: string): string {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (b >>> 0).toString(36).padStart(7, '0') + (a >>> 0).toString(36).padStart(7, '0')
}

/**
 * A short fingerprint of a bundled song's content. It changes whenever a note, a beat, the tempo, the
 * length or the name changes, and only then, so nobody has to remember to bump a number when a chart is
 * corrected. Fields are written out one by one, in a fixed order, so the way the chart object happens to
 * be built does not matter.
 */
export function contentRevision({ title, artist, bpm, chart }: RevisedContent): string {
  const parts: (string | number)[] = [title, artist, bpm, chart.title, chart.artist, chart.capo, us(chart.duration), chart.tuning.join(','), chart.wholeChords ? 'whole' : '']
  for (const t of chart.tempos) parts.push('t', us(t.time), t.bpm)
  for (const s of chart.timeSignatures) parts.push('s', us(s.time), s.numerator, s.denominator)
  for (const b of chart.beats) parts.push('b', us(b.time), b.bar, b.beatInBar, b.isDownbeat ? 1 : 0)
  for (const n of chart.notes) {
    parts.push('n', us(n.time), us(n.duration), n.string, n.fret, n.midi, Math.round(n.velocity * 1000), n.chordId, n.chordName ?? '', n.finger ?? 0, techniques(n.tech))
  }
  return hash(JSON.stringify(parts))
}
