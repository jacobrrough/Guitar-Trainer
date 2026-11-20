import { guitarVoice, loadGuitar } from '../audio/guitar'
import { encodeWav, isStaleRender, synthAudioName } from '../audio/synth'
import { db } from '../db/db'
import { DEMO_AUDIO_BASE, renderDemoAudioAsync } from '../features/library/demoSong'
import { hasStaleAudio, rerenderBuiltIn } from './index'

let running: Promise<number> | null = null

/**
 * Renders again any bundled or demo song whose stored audio came from an older renderer (or from the
 * string model, now that the recorded guitar is available), so a sound change reaches songs that are
 * already in the library. Runs once at a time; resolves to the number of songs refreshed.
 */
export function refreshRenderedAudio(): Promise<number> {
  if (running) return running
  running = (async () => {
    await loadGuitar()
    let count = 0
    const songs = await db.songs.filter((s) => s.source === 'builtin' || s.source === 'demo').toArray()
    for (const song of songs) {
      if (song.source === 'builtin' && hasStaleAudio(song)) {
        await rerenderBuiltIn(song)
        count++
      } else if (song.source === 'demo' && isStaleRender(song.audioName, DEMO_AUDIO_BASE, guitarVoice())) {
        const voice = guitarVoice()
        const audioData = await encodeWav(await renderDemoAudioAsync()).arrayBuffer()
        // Skip quietly if the song was deleted while it rendered.
        if (await db.songs.update(song.id, { audioData, audio: undefined, audioType: 'audio/wav', audioName: synthAudioName(DEMO_AUDIO_BASE, voice), updatedAt: Date.now() })) count++
      }
    }
    return count
  })().finally(() => {
    running = null
  })
  return running
}
