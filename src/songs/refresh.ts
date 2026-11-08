import { encodeWav } from '../audio/synth'
import { db, updateSong } from '../db/db'
import { DEMO_AUDIO_NAME, renderDemoAudio } from '../features/library/demoSong'
import { hasStaleAudio, rerenderBuiltIn } from './index'

let running: Promise<number> | null = null

/**
 * Renders again any bundled or demo song whose stored audio came from an older synth, so a sound
 * change reaches songs that are already in the library. Runs once at a time; resolves to the
 * number of songs refreshed.
 */
export function refreshSynthesisedAudio(): Promise<number> {
  if (running) return running
  running = (async () => {
    let count = 0
    const songs = await db.songs.filter((s) => s.source === 'builtin' || s.source === 'demo').toArray()
    for (const song of songs) {
      if (song.source === 'builtin' && hasStaleAudio(song)) {
        await rerenderBuiltIn(song)
        count++
      } else if (song.source === 'demo' && song.audioName !== DEMO_AUDIO_NAME) {
        const audioData = await encodeWav(renderDemoAudio()).arrayBuffer()
        await updateSong(song.id, { audioData, audio: undefined, audioType: 'audio/wav', audioName: DEMO_AUDIO_NAME })
        count++
      }
    }
    return count
  })().finally(() => {
    running = null
  })
  return running
}
