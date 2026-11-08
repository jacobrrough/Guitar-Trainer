interface RatingChartProps {
  series: { at: number; rating: number }[]
  className?: string
}

const W = 320
const H = 120
const PAD = { l: 26, r: 8, t: 8, b: 16 }

export function RatingChart({ series, className }: RatingChartProps) {
  if (series.length < 2) {
    return <p className="text-xs text-muted">Not enough data yet</p>
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
      aria-label={`Rating over time, from ${Math.round(series[0].rating)} to ${Math.round(last.rating)}`}
    >
      {[50, 75, 90].map((g) => (
        <g key={g}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(g)} y2={y(g)} stroke="var(--color-line)" strokeDasharray="3 3" />
          <text x={PAD.l - 4} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">
            {g}
          </text>
        </g>
      ))}
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.at)} cy={y(last.rating)} r="3" fill="var(--color-accent-2)" />
      <text x={PAD.l} y={H - 3} fontSize="9" fill="var(--color-muted)">
        {fmt(t0)}
      </text>
      <text x={W - PAD.r} y={H - 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">
        {fmt(t1)}
      </text>
    </svg>
  )
}
