import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import type { Chart, ChartNote } from '../../chart/types'
import type { SongRecord } from '../../db/db'
import { DEFAULT_RANGES } from '../../music/keys'
import { loadVoiceProfile } from '../../training/voiceProfile'
import { vocalRunFor } from './render'
import { VOCAL_TUNES } from './tunes'

/** What a screen shows while the tracks of a song are being made. */
export const GETTING_READY = 'Getting your song ready'

/** What the Player needs to run a song to sing. Both tracks exist: a run is not handed out before they do. */
export interface VocalRunView {
  /** Names this arrangement (song, key, level, line). A new one means a new chart and new sound: start the Player afresh. */
  key: string
  chart: Chart
  /** The notes that are scored: all of them, at every level. */
  notes: ChartNote[]
  /** What plays while the microphone scores: click and cues. */
  audio: Blob
  /** The track to listen to (and to sing along with on headphones). */
  guide: Blob
  /** Semitones the song is moved from where it is written, for "In your key". */
  shift: number
  /** False when the song is wider than the singer's range: show it, do not let it be sung. */
  fits: boolean
}

/**
 * Where a song is on its way to being sung:
 * - `none`: the record is not a song to sing; nothing will come.
 * - `preparing`: the singing profile is being read, or the tracks are being made. Show `GETTING_READY`.
 * - `failed`: the tracks could not be made (an old phone can run out of memory for them). Nothing is
 *   tried again until something else is asked for.
 * - `ready`: the run, with both tracks.
 */
export type VocalRunState = { status: 'none' } | { status: 'preparing' } | { status: 'failed' } | { status: 'ready'; run: VocalRunView }

/** How long a frame is waited for before the work starts without one (ms). A page in the background gets no frames at all. */
const FRAME_WAIT_MS = 250

/**
 * Runs `work` once the browser has had the chance to draw what was just rendered, and returns a way to
 * call it off.
 *
 * The trap: an effect is no promise of that. React runs the effects of a render that came from a tap
 * before the browser paints, so heavy work started straight from an effect still freezes the screen
 * the singer was looking at, not the one that says the song is on its way. A frame callback runs
 * before the paint as well. Only a task queued from inside the frame callback comes after it.
 */
export function afterPaint(work: () => void): () => void {
  let settled = false
  const run = () => {
    if (settled) return
    settled = true
    work()
  }
  const afterFrame = () => void setTimeout(run, 0)
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(afterFrame)
    // Whichever comes first runs the work; the other finds it settled.
    setTimeout(run, FRAME_WAIT_MS)
  } else {
    afterFrame()
  }
  return () => {
    settled = true
  }
}

/** One arrangement to make: which song, for which notes, at which level, whole or one line. */
interface Wanted {
  builtinId: string
  low: number
  high: number
  nudge: number
  level: number
  onlyLine: number | undefined
}

/**
 * Makes the run: the arrangement, the scored track and the guide voice on this thread (about a fifth
 * of a second on a laptop, a second or more on an old phone, so never inside a render), then the
 * chords from the guitar's own job, which runs in a worker where there is one. Resolves when both
 * tracks exist.
 */
function prepare(wanted: Wanted): Promise<VocalRunView> {
  const placed = vocalRunFor(wanted.builtinId, { range: { low: wanted.low, high: wanted.high }, nudge: wanted.nudge }, wanted.level, wanted.onlyLine)
  if (!placed) throw new Error(`Not a song to sing: ${wanted.builtinId}`)
  const { run, fits } = placed
  return run.guide.then((guide) => ({ key: run.key, chart: run.chart, notes: run.chart.notes, audio: run.audio, guide, shift: run.shift, fits }))
}

/**
 * A stored song to sing, made ready for one run: arranged for the singer's range and their own
 * "Lower" / "Higher" at `level` (index 0 to 5), with the scored track and the guide track. With
 * `onlyLine` it is that line alone ("Practise one line"), which is practice and not a result.
 *
 * Nothing is rendered inside a React render. The first answer is always `preparing`; the tracks are
 * made after the page has painted (`afterPaint`), and the run is handed out when both exist, so the
 * Player never mounts with half of its sound. Asking for something else in the meantime calls off
 * what was not started and ignores what arrives late.
 *
 * A singer without stored easy notes sings in the starting range of a lower voice, as the exercises
 * do, so a lesson's round and its song are never an octave apart.
 *
 * The profile is read live, so a new range or key gives a new arrangement (and `preparing` on the way
 * to it). A page that must not have the chart swapped under a run in progress holds the state still
 * for that long, as the guitar song page does with its record.
 */
export function useVocalRunState(record: Pick<SongRecord, 'builtinId'> | null | undefined, level: number, options: { onlyLine?: number } = {}): VocalRunState {
  const voice = useLiveQuery(loadVoiceProfile)
  const builtinId = record?.builtinId
  const known = voice !== undefined
  // Asked of the list, which costs nothing: a record that is no song to sing is told so at once.
  const songId = VOCAL_TUNES.some((song) => song.id === builtinId) ? builtinId : undefined
  // By the numbers the key depends on, not by the profile object: the profile row is written for other
  // reasons too (a streak, a tired day), and none of those may make a run again.
  const stored = voice?.range
  const low = stored ? stored.low : DEFAULT_RANGES.lower.low
  const high = stored ? stored.high : DEFAULT_RANGES.lower.high
  const nudge = (songId === undefined ? undefined : voice?.keyNudge?.[songId]) ?? 0
  const { onlyLine } = options
  // The arrangement that is wanted, by name: a made run is known as the one for it by this, and by nothing that could change while the run stays the same.
  const want = known && songId !== undefined ? [songId, low, high, nudge, level, onlyLine ?? 'whole'].join(':') : null
  const [made, setMade] = useState<{ want: string; run: VocalRunView | null } | null>(null)
  useEffect(() => {
    if (want === null || songId === undefined) return
    let asked = true
    // What was asked for and then left (another level, another key, the page itself) must not land on what is shown now.
    const settle = (run: VocalRunView | null) => {
      if (asked) setMade({ want, run })
    }
    const callOff = afterPaint(() => {
      try {
        prepare({ builtinId: songId, low, high, nudge, level, onlyLine }).then(settle, () => settle(null))
      } catch {
        settle(null)
      }
    })
    return () => {
      asked = false
      callOff()
    }
  }, [want, songId, low, high, nudge, level, onlyLine])
  // The same object until something in it changes, so a page can pass it on without restarting the Player.
  return useMemo((): VocalRunState => {
    if (songId === undefined) return { status: 'none' }
    if (want === null || made?.want !== want) return { status: 'preparing' }
    return made.run ? { status: 'ready', run: made.run } : { status: 'failed' }
  }, [songId, want, made])
}

/**
 * The run alone, for a screen that only waits for it: null until both tracks exist (show
 * `GETTING_READY`), and for a record that is not a song to sing. See `useVocalRunState`.
 */
export function useVocalRun(record: Pick<SongRecord, 'builtinId'> | null | undefined, level: number, options: { onlyLine?: number } = {}): VocalRunView | null {
  const state = useVocalRunState(record, level, options)
  return state.status === 'ready' ? state.run : null
}
