import type { IllustrationId } from '../../lessons/types'

export type Handedness = 'right' | 'left'

export interface IllustrationProps {
  id: IllustrationId
  handedness?: Handedness
  className?: string
}

export interface ChordBoxProps {
  /** Chord name as in music/chords.ts, e.g. "Em". */
  name: string
  handedness?: Handedness
  /** Width in px; height follows. */
  size?: number
  className?: string
}

export interface FretboardSpotProps {
  /** 0 = thickest string. */
  string: number
  fret: number
  finger?: 1 | 2 | 3 | 4
  handedness?: Handedness
  className?: string
}
