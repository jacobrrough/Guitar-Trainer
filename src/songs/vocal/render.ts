/**
 * The sound of a song to sing. Nothing is stored: a song is arranged for the singer's key and rendered
 * when it is opened, and the last few results are kept in memory.
 *
 * Two tracks, and the difference between them is the whole speaker policy:
 *
 * - The scored track plays while the microphone listens. It holds the click and the app's cues (the
 *   starting note, the guide's turns on the echo levels) and nothing the singer is scored on, so a phone
 *   on a table cannot sing the song into its own microphone. The tracker stops listening around a cue.
 * - The guide track is for listening first, and for headphones: the same click and cues, the singer's
 *   own line sung by the guide voice on the first four levels, and the chords strummed on the guitar.
 */
import { renderChartVoiced } from '../../audio/guitar'
import { encodeWav, limitPeaks, renderDrums, SYNTH_SAMPLE_RATE } from '../../audio/synth'
import { renderVoiceNotes, VOICE_SYNTH_VERSION } from '../../audio/voice'
import type { Chart } from '../../chart/types'
import type { RangeEdges } from '../../music/keys'
import { accompanimentChart, arrange, songKey, vocalRevision, wholeShift, type ArrangeOptions } from './arrange'
import { levelIndex, lineIndex, VOICE_LEVELS } from './levels'
import { VOCAL_TUNES } from './tunes'
import type { VocalSong } from './types'

/**
 * Level of the chord stem against the guide voice. The stem comes back at about the loudness of a sung
 * note; at half of that the tune stays in front. Chosen by the numbers, not yet by ear.
 */
const CHORD_GAIN = 0.5

/** What plays while the microphone scores: the click and the cues of the chart. */
export function renderScoredTrack(chart: Chart, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const track = renderDrums(chart, { sampleRate })
  const cues = renderVoiceNotes(chart.voice?.cues ?? [], { sampleRate, length: track.length })
  for (let i = 0; i < track.length; i++) track[i] += cues[i]
  return track
}

/** Adds the notes to sing, sung by the guide voice, on the levels where the guide doubles the singer. In place. */
function withMelody(track: Float32Array, chart: Chart, level: number, sampleRate: number): Float32Array {
  if (!VOICE_LEVELS[levelIndex(level)].doubled) return track
  // Cues and scored notes never sound together, so the one voice sings both without one cutting the other.
  const melody = renderVoiceNotes(chart.notes, { sampleRate, length: track.length })
  for (let i = 0; i < track.length; i++) track[i] += melody[i]
  return track
}

/**
 * Adds the strummed chords, in place. They are rendered by the guitar's own job (off the main thread
 * where there is a worker). If that fails the track comes back as it was: voice and click alone are
 * still enough to listen to.
 */
async function withChords(track: Float32Array, song: VocalSong, options: ArrangeOptions, sampleRate: number): Promise<Float32Array> {
  let chords: Float32Array
  try {
    // No click from the job: the scored track already holds it, and two clicks would be twice as loud.
    chords = (await renderChartVoiced(accompanimentChart(song, options.shift, options.level, options.onlyLine), { sampleRate, plucks: true, click: false })).samples
  } catch {
    return track
  }
  const shared = Math.min(track.length, chords.length)
  for (let i = 0; i < shared; i++) track[i] += CHORD_GAIN * chords[i]
  return limitPeaks(track, sampleRate)
}

/**
 * The guide without its chords: the scored track, and on the levels where the guide doubles the singer
 * (`VOICE_LEVELS[level].doubled`) the notes to sing as well. It is what the guide falls back to when
 * the chords cannot be made.
 */
export function renderGuideVoice(chart: Chart, level: number, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  return withMelody(renderScoredTrack(chart, sampleRate), chart, level, sampleRate)
}

/** The guide track: `renderGuideVoice` with the chords strummed under it. A failed chord render does not reject it. */
export function renderGuideTrack(song: VocalSong, options: ArrangeOptions, sampleRate = SYNTH_SAMPLE_RATE): Promise<Float32Array> {
  return withChords(renderGuideVoice(arrange(song, options), options.level, sampleRate), song, options, sampleRate)
}

/** Everything a screen needs to run one song at one level in one key. */
export interface VocalRun {
  /** `${id}:${revision}:${shift}:${level}:${VOICE_SYNTH_VERSION}`, with `:line${n}` after it for one line alone. */
  key: string
  song: VocalSong
  shift: number
  level: number
  onlyLine?: number
  chart: Chart
  /** The scored track as a WAV, ready at once. */
  audio: Blob
  /** The guide track as a WAV, when it is ready. Never rejects: without its chords it is voice and click. */
  guide: Promise<Blob>
}

/** How many runs are kept: the level being sung, and the ones just left for another level or key. */
const KEPT_RUNS = 3
/** Most recently used last. */
const kept: VocalRun[] = []

function runKey(song: VocalSong, shift: number, level: number, onlyLine: number | undefined): string {
  const key = `${song.id}:${vocalRevision(song)}:${shift}:${level}:${VOICE_SYNTH_VERSION}`
  return onlyLine === undefined ? key : `${key}:line${onlyLine}`
}

/**
 * The arrangement and its two tracks for one run, from memory when the same run was opened a moment
 * ago. The same object comes back for the same song, key, level and line, so a screen that asks again
 * on every render does not restart the Player. The scored track is made at once; the guide is started
 * here and arrives later.
 */
export function vocalRun(song: VocalSong, options: ArrangeOptions): VocalRun {
  // As the arrangement reads them: what was asked for may be out of range or not a whole number.
  const shift = wholeShift(options.shift)
  const level = levelIndex(options.level)
  const onlyLine = options.onlyLine === undefined ? undefined : lineIndex(song, options.onlyLine)
  const key = runKey(song, shift, level, onlyLine)
  const found = kept.findIndex((run) => run.key === key)
  if (found >= 0) {
    const [run] = kept.splice(found, 1)
    kept.push(run)
    return run
  }
  const exact: ArrangeOptions = { shift, level, onlyLine }
  const chart = arrange(song, exact)
  const scored = renderScoredTrack(chart)
  const audio = encodeWav(scored, SYNTH_SAMPLE_RATE)
  // The guide starts from a copy of the scored track, so the click and the cues are rendered once.
  const guide = withChords(withMelody(scored.slice(), chart, level, SYNTH_SAMPLE_RATE), song, exact, SYNTH_SAMPLE_RATE)
    .then((pcm) => encodeWav(pcm, SYNTH_SAMPLE_RATE))
    // Whatever went wrong, a screen waiting for the guide gets something to play: the click and the cues.
    .catch(() => audio)
  const run: VocalRun = { key, song, shift, level, ...(onlyLine === undefined ? {} : { onlyLine }), chart, audio, guide }
  kept.push(run)
  if (kept.length > KEPT_RUNS) kept.shift()
  return run
}

/** What places a song for one singer: their range, and their own "Lower" or "Higher" for this song. */
export interface SingerKey {
  /** Absent before the range has been found: the song then stays where it is written. */
  range?: RangeEdges
  /** Semitones, -3 to 3; absent = the key chosen for the range. */
  nudge?: number
}

/**
 * The run of a stored song for one singer, by the bundled id of the song. `fits` is false when the song
 * is wider than the range; the run is then where the song would sit most evenly, for a screen that
 * shows it, and must not be sung. Null for an id that is not a song to sing.
 */
export function vocalRunFor(builtinId: string | undefined, singer: SingerKey, level: number, onlyLine?: number): { run: VocalRun; fits: boolean } | null {
  const song = VOCAL_TUNES.find((s) => s.id === builtinId)
  if (!song) return null
  const { shift, fits } = songKey(song, singer.range, singer.nudge)
  return { run: vocalRun(song, { shift, level, onlyLine }), fits }
}
