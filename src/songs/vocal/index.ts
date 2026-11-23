/**
 * The songs to sing. Their own list on purpose: BUILT_IN_SONGS keeps meaning the guitar songs.
 *
 * This file is the songs as data and what is worked out from them (levels, arrangement, key). Nothing
 * here touches the database or makes a sound: the stored rows are in `install.ts`, the tracks in
 * `render.ts`, and what a screen needs for one run in `useVocalRun.ts`.
 */
import { VOCAL_TUNES } from './tunes'
import type { VocalSong } from './types'

export { VOCAL_TUNES as VOCAL_SONGS } from './tunes'
export type { Degree, VocalSong, VocalStep } from './types'
export { accompanimentChart, arrange, songKey, songSpan, vocalRevision, type ArrangeOptions } from './arrange'
export { levelDurations, levelIndex, VOICE_LEVELS, type VoiceLevel } from './levels'

/** The song to sing with this id (`sing-…`), or undefined: the id of a guitar song is not one. */
export function vocalSong(id: string): VocalSong | undefined {
  return VOCAL_TUNES.find((song) => song.id === id)
}
