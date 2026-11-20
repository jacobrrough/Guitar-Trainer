import { guitarVoice, loadGuitar } from '../audio/guitar'
import { isStaleRender } from '../audio/synth'
import { db } from '../db/db'
import { DEMO_AUDIO_BASE, renderDemoTrack } from '../features/library/demoSong'
import { hasStaleAudio, rerenderBuiltIn } from './index'

let running: Promise<number> | null = null

/**
 * Brings stored copies of the app's own songs up to date: a bundled song whose chart was corrected in
 * this build gets the new chart and audio rendered from it, and any bundled or demo song whose audio
 * came from an older renderer (or from the string model, now that the recorded guitar is available) is
 * rendered again. So a fix or a sound change reaches songs that are already in the library. Runs once
 * at a time; resolves to the number of songs refreshed.
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
        const { wav, audioName } = await renderDemoTrack()
        const audioData = await wav.arrayBuffer()
        // Skip quietly if the song was deleted while it rendered.
        if (await db.songs.update(song.id, { audioData, audio: undefined, audioType: 'audio/wav', audioName, updatedAt: Date.now() })) count++
      }
    }
    return count
  })().finally(() => {
    running = null
  })
  return running
}
