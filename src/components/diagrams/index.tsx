import type { IllustrationId } from '../../lessons/types'

export type Handedness = 'right' | 'left'

export interface IllustrationProps {
  id: IllustrationId
  handedness?: Handedness
  className?: string
}

/** Placeholder until the diagram set lands: a labelled box of the right shape. */
export function Illustration({ id, className }: IllustrationProps) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={id} className={className}>
      <rect x="1" y="1" width="318" height="198" rx="12" fill="none" stroke="currentColor" opacity="0.4" />
      <text x="160" y="105" textAnchor="middle" fill="currentColor" fontSize="14">
        {id}
      </text>
    </svg>
  )
}

export interface ChordBoxProps {
  /** Chord name as in music/chords.ts, e.g. "Em". */
  name: string
  handedness?: Handedness
  /** Width in px; height follows. */
  size?: number
  className?: string
}

export function ChordBox({ name, className }: ChordBoxProps) {
  return <Illustration id={`chord:${name}`} className={className} />
}

export interface FretboardSpotProps {
  /** 0 = thickest string. */
  string: number
  fret: number
  finger?: 1 | 2 | 3 | 4
  handedness?: Handedness
  className?: string
}

export function FretboardSpot({ string, fret, className }: FretboardSpotProps) {
  return <Illustration id={`spot:${string}:${fret}`} className={className} />
}
