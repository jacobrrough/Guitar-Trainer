import { encodeWav } from '../audio/synth'
import { songAudioBlob, type SongRecord } from '../db/db'
import { renderDemoBacking } from '../features/library/demoSong'
import { builtInBacking } from './index'

export interface SongPlayback {
  /** What plays while the microphone scores. */
  audio: Blob | null
  /** The same song with the guitar part audible (the app's own songs only): for listening, never for scoring on a speaker. */
  guide: Blob | null
  /** `audio` is the click track alone: nothing in it can be mistaken for the player's notes. */
  clickOnly: boolean
}

/**
 * The audio to play a song with. For the demo and the bundled songs the stored track contains the
 * guitar part itself, so while the microphone scores only the click track plays (a phone speaker
 * would otherwise play the part into the mic and score it) and the stored track is the listening
 * guide. Imported songs play as they are.
 */
export function songPlayback(song: SongRecord): SongPlayback {
  const stored = songAudioBlob(song)
  if (song.source === 'demo') return { audio: encodeWav(renderDemoBacking()), guide: stored, clickOnly: true }
  if (song.source === 'builtin' && song.builtinId) {
    const click = builtInBacking(song.builtinId)
    if (click) return { audio: encodeWav(click), guide: stored, clickOnly: true }
  }
  return { audio: stored, guide: null, clickOnly: false }
}
