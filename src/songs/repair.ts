import { repairImportedChart } from '../chart/repair'
import { db } from '../db/db'

const DONE_KEY = 'guitar-trainer.chart-repair.v1'

/**
 * One pass over the library, once per device: charts that an earlier importer stored wrongly (see
 * `repairImportedChart`) are corrected in place, so the songs do not have to be imported again.
 * Resolves to the number of songs changed.
 */
export async function repairStoredCharts(): Promise<number> {
  try {
    if (localStorage.getItem(DONE_KEY)) return 0
  } catch {
    return 0
  }
  let count = 0
  const ids = (await db.songs.toCollection().primaryKeys()) as number[]
  for (const id of ids) {
    const song = await db.songs.get(id)
    if (!song) continue
    const chart = repairImportedChart(song.chart)
    if (chart === song.chart) continue
    // Scores earned on the faulty chart counted notes that were never there: keep them, they can only be beaten.
    if (await db.songs.update(id, { chart, updatedAt: Date.now() })) count++
  }
  try {
    localStorage.setItem(DONE_KEY, String(Date.now()))
  } catch {
    /* the pass simply runs again next time; it changes nothing twice */
  }
  return count
}
