import { voiceEnabled } from '../app/features'
import { guitarVoice, loadGuitar } from '../audio/guitar'
import { isStaleRender } from '../audio/synth'
import { db } from '../db/db'
import { DEMO_AUDIO_BASE, renderDemoTrack } from '../features/library/demoSong'
import { instrumentOf, profileIdFor } from '../training/instruments'
import { hasStaleAudio, rerenderBuiltIn } from './index'
import { installVocalSongs } from './vocal/install'

let running: Promise<number> | null = null

/**
 * The songs to sing, for a device that sings: whoever has a singing profile gets the rows of every song
 * (a song added in this build, or all of them after a restore, since a backup holds no songs). Nothing is
 * written for a guitar-only device, or while the singing side is switched off. The rows hold no audio, so
 * this does not wait for the guitar and is never counted as a refreshed song.
 */
async function installSongsToSing(): Promise<void> {
  if (!voiceEnabled()) return
  if (await db.profile.get(profileIdFor('voice'))) await installVocalSongs()
}

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
    // Whatever goes wrong there must not keep the guitar songs from being refreshed; the next launch tries again.
    await installSongsToSing().catch(() => {})
    await loadGuitar()
    let count = 0
    const songs = await db.songs.filter((s) => s.source === 'builtin' || s.source === 'demo').toArray()
    for (const song of songs) {
      // A song to sing has no audio to bring up to date.
      if (instrumentOf(song) === 'voice') continue
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
