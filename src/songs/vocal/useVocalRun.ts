import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import type { Chart, ChartNote } from '../../chart/types'
import type { SongRecord } from '../../db/db'
import { loadVoiceProfile } from '../../training/voiceProfile'
import { vocalRunFor, type VocalRun } from './render'

/** What the Player needs to run a song to sing. */
export interface VocalRunView {
  chart: Chart
  /** The notes that are scored: all of them, at every level. */
  notes: ChartNote[]
  /** What plays while the microphone scores: click and cues. */
  audio: Blob
  /** The track to listen to (and to sing along with on headphones); null until it has been rendered. */
  guide: Blob | null
  /** Semitones the song is moved from where it is written, for "In your key". */
  shift: number
  /** False when the song is wider than the singer's range: show it, do not let it be sung. */
  fits: boolean
}

/**
 * A stored song to sing, made ready for one run: arranged for the singer's range and their own
 * "Lower" / "Higher" at `level` (index 0 to 5), with the scored track at once and the guide track as
 * soon as it has been rendered. With `onlyLine` it is that line alone ("Practise one line").
 *
 * Null while the singing profile is being read, and for a record that is not a song to sing.
 *
 * The profile is read live, so a new range or key gives a new arrangement. A page that must not have
 * the chart swapped under a run in progress holds the result still for that long, as the guitar song
 * page does with its record.
 */
export function useVocalRun(record: Pick<SongRecord, 'builtinId'> | null | undefined, level: number, options: { onlyLine?: number } = {}): VocalRunView | null {
  const voice = useLiveQuery(loadVoiceProfile)
  const builtinId = record?.builtinId
  const known = voice !== undefined
  // By the numbers the key depends on, not by the profile object: the profile row is written for other
  // reasons too (a streak, a tired day), and none of those may rebuild a run.
  const low = voice?.range?.low
  const high = voice?.range?.high
  const nudge = builtinId === undefined ? undefined : voice?.keyNudge?.[builtinId]
  const { onlyLine } = options
  const placed = useMemo(() => {
    if (!known) return null
    const range = low === undefined || high === undefined ? undefined : { low, high }
    return vocalRunFor(builtinId, { range, nudge }, level, onlyLine)
  }, [known, builtinId, low, high, nudge, level, onlyLine])
  const run = placed?.run ?? null
  const [arrived, setArrived] = useState<{ run: VocalRun; guide: Blob } | null>(null)
  useEffect(() => {
    if (!run) return
    let wanted = true
    // The guide of a run that has been left for another must not land on the new one.
    void run.guide.then((guide) => {
      if (wanted) setArrived({ run, guide })
    })
    return () => {
      wanted = false
    }
  }, [run])
  const guide = run && arrived?.run === run ? arrived.guide : null
  const fits = placed?.fits ?? false
  // The same object until something in it changes, so a page can pass it on without restarting the Player.
  return useMemo(() => (run ? { chart: run.chart, notes: run.chart.notes, audio: run.audio, guide, shift: run.shift, fits } : null), [run, guide, fits])
}
