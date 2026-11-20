import { useSyncExternalStore } from 'react'
import { audioEngine } from './AudioEngine'

const subscribe = (listener: () => void) => audioEngine.subscribeMic(listener)
const snapshot = () => audioEngine.micActive

/** Whether the microphone is open right now, kept in step with the audio engine. */
export function useMicActive(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
