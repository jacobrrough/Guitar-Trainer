/**
 * Fallback resampler for browsers whose OfflineAudioContext refuses unusual
 * sample rates (older Safari only renders at 44.1–96 kHz). Box-filter
 * anti-aliasing followed by linear interpolation: plenty for a 22.05 kHz
 * transcription model input, not meant for listening.
 */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice()
  const ratio = fromRate / toRate
  const outLength = Math.max(1, Math.floor(input.length / ratio))
  let source = input
  if (ratio > 1) {
    // Moving average over `ratio` samples removes most energy above the new Nyquist.
    const width = Math.max(1, Math.round(ratio))
    const filtered = new Float32Array(input.length)
    let acc = 0
    for (let i = 0; i < input.length; i++) {
      acc += input[i]
      if (i >= width) acc -= input[i - width]
      filtered[i] = acc / Math.min(width, i + 1)
    }
    source = filtered
  }
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = source[idx] ?? 0
    const b = source[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}
