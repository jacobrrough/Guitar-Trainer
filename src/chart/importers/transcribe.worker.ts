import * as tf from '@tensorflow/tfjs'
import { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'

export interface TranscribeRequest {
  type: 'transcribe'
  /** Mono audio at 22050 Hz. */
  audio: Float32Array
  modelUrl: string
  options: {
    onsetThreshold: number
    frameThreshold: number
    minNoteLengthFrames: number
    minFreq: number | null
    maxFreq: number | null
    backend?: 'webgl' | 'cpu' | 'auto'
  }
}

export interface TranscribedNote {
  startTimeSeconds: number
  durationSeconds: number
  pitchMidi: number
  amplitude: number
  pitchBends?: number[]
}

export type TranscribeResponse =
  | { type: 'progress'; value: number }
  | { type: 'done'; notes: TranscribedNote[]; backend: string }
  | { type: 'error'; message: string }

const scope = self as unknown as {
  postMessage(msg: TranscribeResponse): void
  onmessage: ((e: MessageEvent<TranscribeRequest>) => void) | null
}

async function pickBackend(preferred: TranscribeRequest['options']['backend']): Promise<string> {
  if (preferred && preferred !== 'auto') {
    try {
      await tf.setBackend(preferred)
      await tf.ready()
      return tf.getBackend()
    } catch {
      /* fall through */
    }
  }
  try {
    await tf.setBackend('webgl')
    await tf.ready()
    if (tf.getBackend() === 'webgl') return 'webgl'
  } catch {
    /* fall through */
  }
  await tf.setBackend('cpu')
  await tf.ready()
  return tf.getBackend()
}

scope.onmessage = async (e) => {
  const msg = e.data
  if (msg.type !== 'transcribe') return
  try {
    const backend = await pickBackend(msg.options.backend)
    const model = new BasicPitch(msg.modelUrl)
    const frames: number[][] = []
    const onsets: number[][] = []
    const contours: number[][] = []
    await model.evaluateModel(
      msg.audio,
      (f, o, c) => {
        frames.push(...f)
        onsets.push(...o)
        contours.push(...c)
      },
      (p) => scope.postMessage({ type: 'progress', value: p }),
    )
    const { onsetThreshold, frameThreshold, minNoteLengthFrames, maxFreq, minFreq } = msg.options
    const notes = noteFramesToTime(
      addPitchBendsToNoteEvents(
        contours,
        outputToNotesPoly(frames, onsets, onsetThreshold, frameThreshold, minNoteLengthFrames, true, maxFreq, minFreq),
      ),
    )
    scope.postMessage({ type: 'done', notes, backend })
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
