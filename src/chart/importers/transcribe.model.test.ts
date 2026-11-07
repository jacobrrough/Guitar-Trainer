/**
 * Runs the real Basic Pitch model (CPU backend, Node) on a synthetic signal.
 * Guards the model files in public/ and the TensorFlow.js integration that the
 * transcription worker relies on.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as tf from '@tensorflow/tfjs'
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import { describe, expect, it } from 'vitest'
import { transcriptionToChart } from './transcribe'

const MODEL_DIR = path.resolve(__dirname, '../../../public/models/basic-pitch')
const SR = 22050

function synth(notes: { midi: number; seconds: number }[]): Float32Array {
  const total = notes.reduce((a, n) => a + n.seconds, 0) + 0.5
  const out = new Float32Array(Math.ceil(total * SR))
  let cursor = 0
  for (const n of notes) {
    const f = 440 * 2 ** ((n.midi - 69) / 12)
    const len = Math.round(n.seconds * SR)
    for (let i = 0; i < len; i++) {
      const t = i / SR
      const env = Math.exp(-t * 2)
      out[cursor + i] = env * 0.5 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t))
    }
    cursor += len
  }
  return out
}

async function loadModel(): Promise<tf.GraphModel> {
  const modelJson = JSON.parse(readFileSync(path.join(MODEL_DIR, 'model.json'), 'utf8'))
  const manifest = modelJson.weightsManifest[0]
  const weightData = readFileSync(path.join(MODEL_DIR, manifest.paths[0]))
  const buffer = weightData.buffer.slice(weightData.byteOffset, weightData.byteOffset + weightData.byteLength) as ArrayBuffer
  return tf.loadGraphModel(tf.io.fromMemory({ modelTopology: modelJson.modelTopology, weightSpecs: manifest.weights, weightData: buffer }))
}

describe('Basic Pitch transcription (model integration)', () => {
  it('transcribes a sequence of plucked notes into the right pitches', { timeout: 120000 }, async () => {
    await tf.setBackend('cpu')
    await tf.ready()
    const expected = [40, 45, 50, 55]
    const audio = synth(expected.map((midi) => ({ midi, seconds: 1.2 })))
    const model = new BasicPitch(loadModel())
    const frames: number[][] = []
    const onsets: number[][] = []
    const contours: number[][] = []
    let lastProgress = 0
    await model.evaluateModel(
      audio,
      (f, o, c) => {
        frames.push(...f)
        onsets.push(...o)
        contours.push(...c)
      },
      (p) => {
        lastProgress = p
      },
    )
    expect(lastProgress).toBeGreaterThan(0.9)
    const notes = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.5, 0.3, 8, true, 1400, 70)))
    expect(notes.length).toBeGreaterThanOrEqual(4)
    const pitches = new Set(notes.map((n) => n.pitchMidi))
    const found = expected.filter((m) => pitches.has(m))
    expect(found.length).toBeGreaterThanOrEqual(3)

    const chart = transcriptionToChart(notes, { title: 't', artist: 'a', tuning: [40, 45, 50, 55, 59, 64], duration: audio.length / SR })
    expect(chart.notes.length).toBeGreaterThanOrEqual(3)
    expect(chart.notes.every((n) => chart.tuning[n.string] + n.fret === n.midi)).toBe(true)
    expect(chart.beats.length).toBeGreaterThan(0)
    expect(chart.notes[0].midi).toBe(40)
  })
})
