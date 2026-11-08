import type { IllustrationProps } from './types'
import { ChordBox } from './ChordBox'
import { FretboardSpot } from './FretboardSpot'
import {
  Anatomy,
  FrettingHand,
  PhonePlacement,
  PickGrip,
  Sitting,
  StrumDown,
  StringNames,
  TuningPegs,
} from './scenes'

export type { Handedness, IllustrationProps, ChordBoxProps, FretboardSpotProps } from './types'
export { ChordBox } from './ChordBox'
export { FretboardSpot } from './FretboardSpot'
export { ILLUSTRATION_LABELS } from './scenes'

function Placeholder({ id, className }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 320 200" width="100%" role="img" aria-label={`Illustration ${id}`} className={className}>
      <rect x="1" y="1" width="318" height="198" rx="12" fill="none" stroke="currentColor" opacity="0.4" />
      <text x="160" y="105" textAnchor="middle" fill="currentColor" fontSize="14">
        {id}
      </text>
    </svg>
  )
}

export function Illustration({ id, handedness = 'right', className }: IllustrationProps) {
  switch (id) {
    case 'sitting':
      return <Sitting handedness={handedness} className={className} />
    case 'pick-grip':
      return <PickGrip handedness={handedness} className={className} />
    case 'fretting-hand':
      return <FrettingHand handedness={handedness} className={className} />
    case 'anatomy':
      return <Anatomy handedness={handedness} className={className} />
    case 'string-names':
      return <StringNames className={className} />
    case 'tuning-pegs':
      return <TuningPegs className={className} />
    case 'strum-down':
      return <StrumDown handedness={handedness} className={className} />
    case 'phone-placement':
      return <PhonePlacement className={className} />
  }
  const chord = /^chord:(.+)$/.exec(id)
  if (chord) return <ChordBox name={chord[1]} handedness={handedness} className={className} />
  const spot = /^spot:(\d+):(\d+)$/.exec(id)
  if (spot) {
    return <FretboardSpot string={Number(spot[1])} fret={Number(spot[2])} handedness={handedness} className={className} />
  }
  return <Placeholder id={id} className={className} />
}

