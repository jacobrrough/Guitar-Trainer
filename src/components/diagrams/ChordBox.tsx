import { CHORD_SHAPES } from '../../music/chords'
import { stringColor } from '../../music/strings'
import type { ChordBoxProps } from './types'

/** Finger numbers (string index -> finger) for the beginner chords. */
const FINGERS: Record<string, Record<number, number>> = {
  Em: { 1: 2, 2: 3 },
  E: { 1: 2, 2: 3, 3: 1 },
  Am: { 2: 2, 3: 3, 4: 1 },
  A: { 2: 1, 3: 2, 4: 3 },
  D: { 3: 1, 5: 2, 4: 3 },
  Dm: { 3: 2, 4: 3, 5: 1 },
  G: { 0: 2, 1: 1, 5: 3 },
  C: { 1: 3, 2: 2, 4: 1 },
  D7: { 3: 2, 4: 1, 5: 3 },
  A7: { 2: 2, 4: 3 },
  E7: { 1: 2, 3: 1 },
  G7: { 0: 3, 1: 2, 5: 1 },
}

function fingersFor(name: string, shape: Array<[number, number]>): Record<number, number> {
  const known = FINGERS[name]
  if (known) return known
  const fretted = shape.filter(([, f]) => f > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const out: Record<number, number> = {}
  fretted.forEach(([s], i) => {
    out[s] = Math.min(i + 1, 4)
  })
  return out
}

const W = 160
const H = 200
const X0 = 30
const GAP = 20
const NUT_Y = 52
const FRET_H = 28
const FRETS = 5

export function ChordBox({ name, handedness = 'right', size = 160, className }: ChordBoxProps) {
  const def = CHORD_SHAPES[name]
  const left = handedness === 'left'
  const height = Math.round((size * H) / W)
  if (!def) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={size} height={height} role="img" aria-label={`${name} chord diagram`} className={className}>
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="currentColor" fontSize="16">
          {name}
        </text>
      </svg>
    )
  }
  const shape = def.shape
  const fretNums = shape.map(([, f]) => f).filter((f) => f > 0)
  const maxFret = fretNums.length ? Math.max(...fretNums) : 0
  const minFret = fretNums.length ? Math.min(...fretNums) : 0
  const base = maxFret <= FRETS || minFret <= 1 ? 1 : minFret
  const hasNut = base === 1
  const fingers = fingersFor(name, shape)
  const xs = (s: number) => X0 + GAP * (left ? 5 - s : s)
  const fretY = (row: number) => NUT_Y + FRET_H * row
  const played = new Map(shape)
  const bottom = fretY(FRETS)
  const strings = [0, 1, 2, 3, 4, 5]

  const muted = strings.filter((s) => !played.has(s)).map((s) => 6 - s)
  const open = strings.filter((s) => played.get(s) === 0).map((s) => 6 - s)
  const parts = [`${name} chord diagram.`]
  for (const [s, f] of shape) {
    if (f > 0) parts.push(`Finger ${fingers[s] ?? '?'} on string ${6 - s}, fret ${f}.`)
  }
  if (open.length) parts.push(`Open strings: ${open.join(', ')}.`)
  if (muted.length) parts.push(`Do not play strings: ${muted.join(', ')}.`)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={size} height={height} role="img" aria-label={parts.join(' ')} className={className}>
      <text x={W / 2} y={20} textAnchor="middle" fill="currentColor" fontSize="20" fontWeight="700">
        {name}
      </text>
      {/* frets */}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line
          key={i}
          x1={X0}
          x2={X0 + GAP * 5}
          y1={fretY(i)}
          y2={fretY(i)}
          stroke="currentColor"
          strokeWidth={i === 0 && hasNut ? 5 : 1.5}
          opacity={i === 0 && hasNut ? 1 : 0.55}
        />
      ))}
      {/* strings */}
      {strings.map((s) => (
        <line key={s} x1={xs(s)} x2={xs(s)} y1={NUT_Y} y2={bottom} stroke="currentColor" strokeWidth={1.6} opacity={0.7} />
      ))}
      {/* fret number */}
      {!hasNut && (
        <text
          x={left ? X0 + GAP * 5 + 14 : X0 - 14}
          y={fretY(0) + FRET_H / 2 + 5}
          textAnchor="middle"
          fill="currentColor"
          fontSize="14"
        >
          {base}
        </text>
      )}
      {/* X and O markers */}
      {strings.map((s) => {
        const f = played.get(s)
        if (f === undefined) {
          return (
            <text key={s} x={xs(s)} y={NUT_Y - 12} textAnchor="middle" fill="currentColor" fontSize="15" fontWeight="700">
              X
            </text>
          )
        }
        if (f === 0) {
          return (
            <text key={s} x={xs(s)} y={NUT_Y - 12} textAnchor="middle" fill="currentColor" fontSize="15">
              O
            </text>
          )
        }
        return null
      })}
      {/* dots */}
      {shape
        .filter(([, f]) => f > 0)
        .map(([s, f]) => {
          const cy = fretY(f - base) + FRET_H / 2
          return (
            <g key={s}>
              <circle data-string={s} data-fret={f} data-finger={fingers[s]} cx={xs(s)} cy={cy} r={10} fill={stringColor(s)} stroke="#0b0f14" strokeWidth={1} />
              <text x={xs(s)} y={cy + 5} textAnchor="middle" fill="#0b0f14" fontSize="14" fontWeight="700">
                {fingers[s]}
              </text>
            </g>
          )
        })}
    </svg>
  )
}
