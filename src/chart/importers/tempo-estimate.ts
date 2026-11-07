/**
 * Lightweight tempo + downbeat estimation from note onsets: an autocorrelation
 * with a log-normal tempo prior picks a coarse tempo (Ellis 2007 style), then a
 * fine comb-filter search over tempo and phase locks a constant grid onto the
 * onsets. Good enough to lay a beat grid under an audio transcription; the user
 * can still correct BPM and offset.
 */
export interface TempoEstimate {
  bpm: number
  /** Time of the first downbeat (seconds, >= 0). */
  downbeat: number
  beatsPerBar: number
  confidence: number
}

const FS = 200 // onset-strength frames per second

export function estimateTempo(
  onsets: { time: number; weight: number }[],
  duration: number,
  opts: { minBpm?: number; maxBpm?: number; priorBpm?: number } = {},
): TempoEstimate {
  const minBpm = opts.minBpm ?? 60
  const maxBpm = opts.maxBpm ?? 190
  const priorBpm = opts.priorBpm ?? 115
  const length = Math.max(FS * 2, Math.ceil(duration * FS) + 1)
  const strength = new Float32Array(length)
  for (const o of onsets) {
    const i = Math.round(o.time * FS)
    if (i < 0 || i >= length) continue
    const w = Math.max(0, o.weight)
    for (let k = -3; k <= 3; k++) {
      const j = i + k
      if (j >= 0 && j < length) strength[j] += w * Math.exp(-(k * k) / 3)
    }
  }
  if (onsets.length < 4) return { bpm: 120, downbeat: onsets[0]?.time ?? 0, beatsPerBar: 4, confidence: 0 }

  const sampleAt = (t: number): number => {
    const x = t * FS
    const i = Math.floor(x)
    if (i < 0 || i + 1 >= length) return 0
    const f = x - i
    return strength[i] * (1 - f) + strength[i + 1] * f
  }

  // Coarse tempo from the autocorrelation of the onset-strength signal.
  const minLag = Math.floor((60 * FS) / maxBpm)
  const maxLag = Math.ceil((60 * FS) / minBpm)
  let bestLag = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0
    for (let i = 0; i + lag < length; i++) acc += strength[i] * strength[i + lag]
    const bpm = (60 * FS) / lag
    const prior = Math.exp(-0.5 * (Math.log2(bpm / priorBpm) / 0.9) ** 2)
    const score = (acc / (length - lag)) * prior
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  const coarseBpm = (60 * FS) / bestLag

  // Fine search: which (tempo, phase) comb collects the most onset energy?
  const combScore = (period: number, phase: number): number => {
    let acc = 0
    for (let t = phase; t < duration; t += period) acc += sampleAt(t)
    return acc
  }
  let bestBpm = coarseBpm
  let bestPhase = 0
  let bestComb = -Infinity
  const phaseSteps = 64
  for (let bpm = coarseBpm * 0.96; bpm <= coarseBpm * 1.04; bpm += coarseBpm * 0.0004) {
    const period = 60 / bpm
    for (let s = 0; s < phaseSteps; s++) {
      const phase = (s / phaseSteps) * period
      const score = combScore(period, phase)
      if (score > bestComb) {
        bestComb = score
        bestBpm = bpm
        bestPhase = phase
      }
    }
  }
  // Polish the phase at finer resolution.
  const period = 60 / bestBpm
  for (let d = -period / phaseSteps; d <= period / phaseSteps; d += period / (phaseSteps * 8)) {
    const phase = bestPhase + d
    if (phase < 0) continue
    const score = combScore(period, phase)
    if (score > bestComb) {
      bestComb = score
      bestPhase = phase
    }
  }

  // Downbeat: which of the 4 beat phases carries the most energy.
  let bestBar = 0
  let bestBarScore = -Infinity
  for (let k = 0; k < 4; k++) {
    let acc = 0
    for (let t = bestPhase + k * period; t < duration; t += 4 * period) acc += sampleAt(t)
    if (acc > bestBarScore) {
      bestBarScore = acc
      bestBar = k
    }
  }
  const total = strength.reduce((a, b) => a + b, 0) || 1
  const confidence = Math.min(1, (bestComb / total) * 1.5)
  return { bpm: Math.round(bestBpm * 10) / 10, downbeat: bestPhase + bestBar * period, beatsPerBar: 4, confidence }
}
