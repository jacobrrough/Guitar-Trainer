import { stringColor } from '../../music/strings'
import type { FretboardSpotProps } from './types'

const W = 320
const H = 190
const NUT = 62
const FRET_W = 50
const TOP = 24
const GAP = 22
const NAMES = ['E', 'A', 'D', 'G', 'B', 'E']

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  const last = n % 10
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`
}

function spotCaption(string: number, fret: number, finger?: number): string {
  const s = `${ordinal(6 - string)} string`
  const f = fret === 0 ? 'open' : `${ordinal(fret)} fret`
  return finger ? `${s} · ${f} · finger ${finger}` : `${s} · ${f}`
}

export function FretboardSpot({ string, fret, finger, handedness = 'right', className }: FretboardSpotProps) {
  const left = handedness === 'left'
  const mx = (x: number) => (left ? W - x : x)
  // High E at the top, like tab; row r = 5 - string index.
  const rowY = (s: number) => TOP + GAP * (5 - s)
  const bottom = rowY(0)
  const shownFret = Math.max(0, Math.min(5, fret))
  const cx = shownFret === 0 ? mx(NUT - 16) : mx(NUT + FRET_W * (shownFret - 1) + FRET_W / 2)
  const cy = rowY(string)
  const caption = spotCaption(string, fret, finger)
  const label = `Fretboard: ${caption}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className={className}>
      {/* neck */}
      <rect x={Math.min(mx(NUT), mx(NUT + FRET_W * 5))} y={TOP - 8} width={FRET_W * 5} height={bottom - TOP + 16} fill="currentColor" opacity={0.08} />
      {/* frets */}
      {Array.from({ length: 6 }, (_, i) => (
        <line
          key={i}
          x1={mx(NUT + FRET_W * i)}
          x2={mx(NUT + FRET_W * i)}
          y1={TOP - 8}
          y2={bottom + 8}
          stroke="currentColor"
          strokeWidth={i === 0 ? 6 : 1.5}
          opacity={i === 0 ? 1 : 0.5}
        />
      ))}
      {[1, 2, 3, 4, 5].map((n) => (
        <text key={n} x={mx(NUT + FRET_W * (n - 1) + FRET_W / 2)} y={bottom + 28} textAnchor="middle" fill="currentColor" fontSize="12" opacity={0.7}>
          {n}
        </text>
      ))}
      {/* strings */}
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <g key={s}>
          <line
            x1={mx(NUT)}
            x2={mx(NUT + FRET_W * 5)}
            y1={rowY(s)}
            y2={rowY(s)}
            stroke={stringColor(s)}
            strokeWidth={1.2 + (5 - s) * 0.5}
            opacity={s === string ? 1 : 0.7}
          />
          <text x={mx(NUT - 36)} y={rowY(s) + 4} textAnchor="middle" fill="currentColor" fontSize="12" opacity={0.7}>
            {6 - s}
          </text>
          <text x={mx(NUT - 16)} y={rowY(s) + 4} textAnchor="middle" fill={stringColor(s)} fontSize="13" fontWeight="700">
            {NAMES[s]}
          </text>
        </g>
      ))}
      {/* the spot */}
      <circle
        data-spot={`${string}-${fret}`}
        cx={cx}
        cy={cy}
        r={10}
        fill={fret === 0 ? 'none' : stringColor(string)}
        stroke={fret === 0 ? stringColor(string) : '#0b0f14'}
        strokeWidth={fret === 0 ? 3 : 1}
      />
      {finger && fret > 0 && (
        <text x={cx} y={cy + 5} textAnchor="middle" fill="#0b0f14" fontSize="14" fontWeight="700">
          {finger}
        </text>
      )}
      <text x={W / 2} y={H - 8} textAnchor="middle" fill="currentColor" fontSize="15" fontWeight="600">
        {caption}
      </text>
    </svg>
  )
}
