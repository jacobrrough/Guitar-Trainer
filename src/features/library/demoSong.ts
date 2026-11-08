import { constantBeatGrid } from '../../chart/timing'
import type { Chart, ChartNote } from '../../chart/types'
import type { NewSong } from '../../db/db'
import { encodeWav, renderChartBacking } from '../../audio/synth'

const TUNING = [40, 45, 50, 55, 59, 64]
const BPM = 90
const BEAT = 60 / BPM
const SAMPLE_RATE = 44100

interface Step {
  /** Absolute beat index from the start of the song. */
  beat: number
  /** Length in beats. */
  len: number
  /** [string, fret] pairs, lowest string first. */
  notes: [number, number][]
  chordName?: string
}

const EM: [number, number][] = [[0, 0], [1, 2], [2, 2], [3, 0], [4, 0], [5, 0]]
const G: [number, number][] = [[0, 3], [1, 2], [2, 0], [3, 0], [4, 0], [5, 3]]
const D: [number, number][] = [[1, 0], [2, 0], [3, 2], [4, 3], [5, 2]]
const C: [number, number][] = [[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]

const STEPS: Step[] = [
  // Bar 1–4: E minor pentatonic riff
  { beat: 0, len: 1, notes: [[0, 0]] }, { beat: 1, len: 1, notes: [[0, 3]] }, { beat: 2, len: 1, notes: [[1, 0]] }, { beat: 3, len: 1, notes: [[1, 2]] },
  { beat: 4, len: 0.5, notes: [[2, 0]] }, { beat: 4.5, len: 0.5, notes: [[2, 2]] }, { beat: 5, len: 1, notes: [[3, 0]] }, { beat: 6, len: 1, notes: [[2, 2]] }, { beat: 7, len: 1, notes: [[2, 0]] },
  { beat: 8, len: 1, notes: [[0, 0]] }, { beat: 9, len: 1, notes: [[0, 3]] }, { beat: 10, len: 2, notes: [[1, 0]] },
  { beat: 12, len: 1, notes: [[1, 2]] }, { beat: 13, len: 1, notes: [[1, 0]] }, { beat: 14, len: 1, notes: [[0, 3]] }, { beat: 15, len: 1, notes: [[0, 0]] },
  // Bar 5–8: open chords on beats 1 and 3
  { beat: 16, len: 2, notes: EM, chordName: 'Em' }, { beat: 18, len: 2, notes: EM, chordName: 'Em' },
  { beat: 20, len: 2, notes: G, chordName: 'G' }, { beat: 22, len: 2, notes: G, chordName: 'G' },
  { beat: 24, len: 2, notes: D, chordName: 'D' }, { beat: 26, len: 2, notes: D, chordName: 'D' },
  { beat: 28, len: 2, notes: C, chordName: 'C' }, { beat: 30, len: 2, notes: C, chordName: 'C' },
]

const TOTAL_BEATS = 32
const DURATION = TOTAL_BEATS * BEAT + 1.2

export function demoChart(): Chart {
  const notes: ChartNote[] = []
  STEPS.forEach((step, chordId) => {
    for (const [string, fret] of step.notes) {
      notes.push({
        id: notes.length,
        time: step.beat * BEAT,
        duration: step.len * BEAT * 0.95,
        midi: TUNING[string] + fret,
        string,
        fret,
        velocity: 0.8,
        chordId,
        chordName: step.chordName,
      })
    }
  })
  return {
    version: 1,
    title: 'Demo riff in E minor',
    artist: 'Guitar Trainer',
    source: 'demo',
    tuning: TUNING,
    capo: 0,
    duration: DURATION,
    notes,
    beats: constantBeatGrid(BPM, 0, DURATION, 4),
    tempos: [{ time: 0, bpm: BPM }],
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  }
}

export function renderDemoAudio(): Float32Array {
  return renderChartBacking(demoChart(), { sampleRate: SAMPLE_RATE, seed: 1000 })
}

export { encodeWav }

/** A short synthesised riff + chord progression, so the app is playable without any files. */
export function createDemoSong(): NewSong {
  const chart = demoChart()
  return {
    title: chart.title,
    artist: chart.artist,
    audio: encodeWav(renderDemoAudio()),
    audioType: 'audio/wav',
    audioName: 'demo-riff.wav',
    duration: DURATION,
    chart,
    source: 'demo',
    bpm: BPM,
  }
}
