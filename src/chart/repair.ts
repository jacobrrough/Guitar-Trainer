import type { Chart, ChartNote } from './types'

/**
 * Repairs charts that an earlier version of the Guitar Pro / MusicXML importer stored wrongly, so a
 * song does not have to be imported again:
 * - a note that rings while another track or voice starts a beat was stored once per such beat (exact
 *   copies at the same time on the same string and fret): the copies are dropped;
 * - muted ("dead") notes were stored as ordinary notes with a pitch nobody can play: they are dropped.
 * Returns the chart itself when there is nothing to repair.
 */
export function repairImportedChart(chart: Chart): Chart {
  if (chart.source !== 'guitarpro' && chart.source !== 'musicxml') return chart
  const seen = new Set<string>()
  const notes: ChartNote[] = []
  for (const note of chart.notes) {
    if (note.tech?.dead) continue
    const key = `${Math.round(note.time * 1000)}:${note.string}:${note.fret}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push(note)
  }
  return notes.length === chart.notes.length ? chart : { ...chart, notes }
}
