interface RatingChartProps {
  series: { at: number; rating: number }[]
  className?: string
  /**
   * Draw the same line with no number on it: no marks on the grid, words for the two ends of the
   * line, and a label for a screen reader that says in words which way the skill has gone. For a
   * singer in plain mode, where a rating is a number that stays off the screen. Left out, the chart is
   * the one it has always been.
   */
  plain?: boolean
}

const W = 320
const H = 120
const PAD = { l: 26, r: 8, t: 8, b: 16 }

/** Under the two ends of the plain line, where the other chart prints two dates. */
const PLAIN_ENDS = { first: 'Earlier', last: 'Latest' }

/**
 * Which way a skill has gone between the two ends of its line, for a screen reader. A whole point or
 * more is a move; less is none. Going down is said as what there is to do about it, never as a loss.
 */
function plainLabel(first: number, last: number): string {
  // The distance itself, not the two ends rounded one by one: 50.4 and 50.6 round a whole point apart.
  const moved = last - first
  const way = moved >= 1 ? 'It is stronger than it was.' : moved <= -1 ? 'It needs a little more practice to be where it was.' : 'It is about where it was.'
  return `How this skill has gone over time. ${way}`
}

export function RatingChart({ series, className, plain = false }: RatingChartProps) {
  if (series.length < 2) {
    // Without numbers there is nothing to say about how many are missing: the words above stand alone.
    return plain ? null : <p className="text-xs text-muted">Not enough data yet</p>
  }
  const t0 = series[0].at
  const t1 = series[series.length - 1].at
  const span = Math.max(1, t1 - t0)
  const x = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r)
  const y = (r: number) => PAD.t + (1 - Math.max(0, Math.min(100, r)) / 100) * (H - PAD.t - PAD.b)
  const points = series.map((p) => `${x(p.at).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ')
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  const last = series[series.length - 1]
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className ?? 'h-auto w-full'}
      role="img"
      aria-label={plain ? plainLabel(series[0].rating, last.rating) : `Rating over time, from ${Math.round(series[0].rating)} to ${Math.round(last.rating)}`}
    >
      {[50, 75, 90].map((g) => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--color-line)" strokeDasharray="3 3" />
          {!plain && (
            <text x={PAD.l - 4} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">
              {g}
            </text>
          )}
        </g>
      ))}
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.at)} cy={y(last.rating)} r="3" fill="var(--color-accent-2)" />
      <text x={PAD.l} y={H - 3} fontSize="9" fill="var(--color-muted)">
        {plain ? PLAIN_ENDS.first : fmt(t0)}
      </text>
      <text x={W - PAD.r} y={H - 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">
        {plain ? PLAIN_ENDS.last : fmt(t1)}
      </text>
    </svg>
  )
}
