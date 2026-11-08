export function Gauge({
  cents,
  active,
  inTune,
}: {
  cents: number;
  active: boolean;
  inTune: boolean;
}) {
  const clamped = Math.max(-50, Math.min(50, cents));
  const angle = (clamped / 50) * 70; // degrees from vertical
  const ticks = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
  return (
    <svg viewBox="0 0 320 190" className="w-full max-w-md">
      <defs>
        <linearGradient id="arc" x1="0" x2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#22c55e" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path
        d="M 30 170 A 130 130 0 0 1 290 170"
        fill="none"
        stroke="#27314a"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d="M 30 170 A 130 130 0 0 1 290 170"
        fill="none"
        stroke="url(#arc)"
        strokeWidth="14"
        strokeLinecap="round"
        opacity={active ? 0.9 : 0.35}
      />
      {ticks.map((t) => {
        const a = ((t / 50) * 70 - 90) * (Math.PI / 180);
        const r1 = 108;
        const r2 = t % 50 === 0 || t === 0 ? 92 : 98;
        return (
          <g key={t}>
            <line
              x1={160 + r1 * Math.cos(a)}
              y1={170 + r1 * Math.sin(a)}
              x2={160 + r2 * Math.cos(a)}
              y2={170 + r2 * Math.sin(a)}
              stroke="#64748b"
              strokeWidth={t === 0 ? 3 : 1.5}
            />
            {t % 25 === 0 && (
              <text
                x={160 + 80 * Math.cos(a)}
                y={170 + 80 * Math.sin(a)}
                fill="#8b96ad"
                fontSize="11"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {t > 0 ? `+${t}` : t}
              </text>
            )}
          </g>
        );
      })}
      <g
        transform={`rotate(${active ? angle : 0} 160 170)`}
        style={{ transition: "transform 90ms linear" }}
      >
        <line
          x1="160"
          y1="170"
          x2="160"
          y2="52"
          stroke={inTune && active ? "#22c55e" : "#f8fafc"}
          strokeWidth="4"
          strokeLinecap="round"
          opacity={active ? 1 : 0.3}
        />
      </g>
      <circle
        cx="160"
        cy="170"
        r="9"
        fill="#f8fafc"
        opacity={active ? 1 : 0.3}
      />
    </svg>
  );
}
