/**
 * The modelled guitar: an extended Karplus–Strong string with a body resonator and a hint of room.
 * It is the fallback voice for when the recorded sample pack cannot be loaded, and a source of
 * synthetic guitar-like test signals. See `sampler.ts` for the voice the app normally uses.
 */
const MODEL_SAMPLE_RATE = 44100

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** One-pole low-pass coefficient for a cutoff in Hz. */
function onePole(cutoff: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
}

export interface PluckOptions {
  /** How hard the string is struck, 0..1. Harder is louder and brighter. */
  velocity?: number
  /** Picking point as a fraction of the string length from the bridge (0.5 is the middle, a pick sits near 0.15). */
  pickPosition?: number
  /** Nylon strings are darker and die away sooner than steel. */
  nylon?: boolean
  /** Wound bass strings are darker than plain ones; by default inferred from the pitch. */
  wound?: boolean
}

/**
 * Karplus–Strong pluck mixed into `out` from `startSample`.
 *
 * What makes it sound like a string rather than a loop: the excitation is the shape of a string
 * pulled at the pick point and released; the string is run in two polarisations, slightly detuned
 * and one dying faster, which gives the slow beat and two-stage decay of a real note; the loop has a
 * low-pass whose cutoff depends on the string and the stroke (the high partials die first), a
 * fractional delay (all-pass) so every note is in tune, a loss factor from a realistic 60 dB decay
 * time, and a touch of pitch sag after the attack; and the pick itself is heard as a short unpitched tick.
 */
export function pluck(
  out: Float32Array,
  startSample: number,
  freq: number,
  seconds: number,
  amp: number,
  seed: number,
  sampleRate = MODEL_SAMPLE_RATE,
  options: PluckOptions = {},
): void {
  if (startSample >= out.length || freq <= 0) return
  const velocity = clamp(options.velocity ?? 0.8, 0.05, 1)
  const nylon = options.nylon ?? false
  const wound = options.wound ?? freq < 230
  const rand = lcg(seed)
  const pickPosition = clamp(options.pickPosition ?? 0.1 + 0.07 * rand(), 0.05, 0.5)
  const total = Math.min(out.length - startSample, Math.round(seconds * sampleRate))
  if (total <= 0) return
  const attack = Math.max(1, Math.round(0.003 * sampleRate))
  const fadeStart = total - Math.round(0.03 * sampleRate)

  // Loop low-pass: the string's own damping of its high partials, set by the stroke and the string but
  // never so low that it eats the fundamental of a high note (the loss factor below owns that decay).
  // Its delay is taken out of the loop length.
  const loopCutoff = Math.max((nylon ? 0.6 : 1) * (wound ? 0.6 : 1) * (2500 + 6500 * velocity), 30 * freq)
  const la = onePole(loopCutoff, sampleRate)
  const lpDelay = (1 - la) / la

  // Two polarisations: a slow beat of well under a hertz, the second one fading about twice as fast.
  const beat = 0.35 + 0.35 * rand()
  // 60 dB decay time: about nine seconds for the low E, four for the high E at the twelfth fret.
  const t60 = clamp((nylon ? 4.5 : 8) * (110 / freq) ** 0.35, 1.5, 10)
  const loops = [
    { f: freq + beat / 2, t60, gain: 1 / 1.7 },
    { f: freq - beat / 2, t60: t60 * 0.5, gain: 0.7 / 1.7 },
  ].map((l) => {
    const exact = sampleRate / l.f - lpDelay
    const n = Math.max(2, Math.floor(exact - 0.4))
    return { ...l, n, frac0: exact - n, rho: 10 ** (-3 / (l.f * l.t60)) }
  })
  const nMax = Math.max(...loops.map((l) => l.n))

  // Excitation: the string pulled into a triangle at the pick point and let go. The delay line carries
  // the slope of that shape (a two-level pulse), whose harmonics fall off like a real pluck's, with a
  // strong fundamental every time; a little noise is the pick scraping the string.
  const exc = new Float32Array(nMax)
  const pickSample = Math.max(1, Math.min(nMax - 1, Math.round(pickPosition * nMax)))
  const up = 1 / pickSample
  const down = 1 / (nMax - pickSample)
  const noise = 0.25 * velocity
  for (let i = 0; i < nMax; i++) exc[i] = (i < pickSample ? up : -down) * 0.5 * nMax * 0.1 + noise * (rand() * 2 - 1)
  const cutoff = (nylon ? 0.5 : 1) * (1500 + 6000 * velocity * velocity)
  const a = onePole(cutoff, sampleRate)
  let y = 0
  for (let i = 0; i < nMax; i++) {
    y += a * (exc[i] - y)
    exc[i] = y
  }
  let mean = 0
  for (let i = 0; i < nMax; i++) mean += exc[i]
  mean /= nMax
  let peak = 1e-9
  for (let i = 0; i < nMax; i++) {
    exc[i] -= mean
    peak = Math.max(peak, Math.abs(exc[i]))
  }
  const scale = (0.35 + 0.65 * velocity) / peak
  for (let i = 0; i < nMax; i++) exc[i] *= scale

  const glideK = Math.exp(-1 / (0.08 * sampleRate))
  for (const l of loops) {
    const n = l.n
    const buf = exc.slice(0, n)
    let idx = 0
    let apX1 = 0
    let apY1 = 0
    let lp = 0
    let glide = 0.3
    const g = amp * l.gain
    for (let i = 0; i < total; i++) {
      const cur = buf[idx]
      const nextIdx = idx + 1 === n ? 0 : idx + 1
      lp += la * (cur * l.rho - lp)
      // Plucked strings start a touch sharp (the extra tension of the pull) and settle within ~100 ms.
      const frac = l.frac0 - glide
      glide *= glideK
      const c = (1 - frac) / (1 + frac)
      const ap = c * (lp - apY1) + apX1
      apX1 = lp
      apY1 = ap
      buf[idx] = ap
      const env = i < attack ? i / attack : i > fadeStart ? (total - i) / Math.max(1, total - fadeStart) : 1
      out[startSample + i] += cur * g * env
      idx = nextIdx
    }
  }

  // The pick: a few milliseconds of unpitched tick, and on hard strokes a touch of body thump.
  const tick = Math.min(total, Math.round(0.006 * sampleRate))
  const hpK = Math.exp((-2 * Math.PI * 1800) / sampleRate)
  const lpA = onePole(6000, sampleRate)
  let hp = 0
  let prev = 0
  let tl = 0
  const tickAmp = 0.12 * velocity * amp
  for (let i = 0; i < tick; i++) {
    const x = rand() * 2 - 1
    hp = hpK * (hp + x - prev)
    prev = x
    tl += lpA * (hp - tl)
    out[startSample + i] += tl * tickAmp * Math.exp(-i / (0.0018 * sampleRate))
  }
  const thump = Math.min(total, Math.round(0.06 * sampleRate))
  const thumpAmp = 0.06 * velocity * velocity * amp
  for (let i = 0; i < thump; i++) {
    const t = i / sampleRate
    out[startSample + i] += Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t / 0.02) * thumpAmp
  }
}

/** Direct-form biquad (RBJ cookbook). */
class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private z1 = 0
  private z2 = 0

  static bandpass(freq: number, q: number, sampleRate: number): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * freq) / sampleRate
    const alpha = Math.sin(w0) / (2 * q)
    const a0 = 1 + alpha
    f.b0 = alpha / a0
    f.b1 = 0
    f.b2 = -alpha / a0
    f.a1 = (-2 * Math.cos(w0)) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  static highpass(freq: number, q: number, sampleRate: number): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * freq) / sampleRate
    const alpha = Math.sin(w0) / (2 * q)
    const cos = Math.cos(w0)
    const a0 = 1 + alpha
    f.b0 = (1 + cos) / 2 / a0
    f.b1 = -(1 + cos) / a0
    f.b2 = (1 + cos) / 2 / a0
    f.a1 = (-2 * cos) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  static lowpass(freq: number, q: number, sampleRate: number): Biquad {
    const f = new Biquad()
    const w0 = (2 * Math.PI * freq) / sampleRate
    const alpha = Math.sin(w0) / (2 * q)
    const cos = Math.cos(w0)
    const a0 = 1 + alpha
    f.b0 = (1 - cos) / 2 / a0
    f.b1 = (1 - cos) / a0
    f.b2 = (1 - cos) / 2 / a0
    f.a1 = (-2 * cos) / a0
    f.a2 = (1 - alpha) / a0
    return f
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

/**
 * A small guitar body, in place: a dozen resonances of a steel-string box (air at ~100 Hz, the top's
 * modes above it, thinning out towards 2 kHz) added to the dry strings, the box's weak radiation
 * below about 105 Hz (which leaves the low strings' fundamentals under their harmonics, as a
 * microphone hears them), and a roll-off above 6.5 kHz so the attack does not fizz.
 */
export function guitarBody(samples: Float32Array, sampleRate = MODEL_SAMPLE_RATE): Float32Array {
  const modes = [
    [98, 6, 0.45],
    [200, 6, 0.35],
    [260, 8, 0.2],
    [345, 8, 0.18],
    [420, 9, 0.15],
    [520, 10, 0.12],
    [640, 10, 0.1],
    [780, 12, 0.1],
    [960, 12, 0.08],
    [1180, 14, 0.07],
    [1500, 14, 0.06],
    [2100, 12, 0.05],
  ].map(([f, q, gain]) => ({ filter: Biquad.bandpass(f, q, sampleRate), gain }))
  const bottom = Biquad.highpass(105, 0.7, sampleRate)
  const top = Biquad.lowpass(6500, 0.6, sampleRate)
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]
    let y = x
    for (const m of modes) y += m.gain * m.filter.process(x)
    samples[i] = top.process(bottom.process(y))
  }
  return samples
}

/** A hint of room, in place: four soft early reflections, low-passed, so the guitar is not bone dry. */
export function roomAir(samples: Float32Array, sampleRate = MODEL_SAMPLE_RATE): Float32Array {
  const taps = [
    [0.011, 0.1],
    [0.017, 0.08],
    [0.023, 0.06],
    [0.031, 0.05],
  ].map(([t, gain]) => ({ delay: Math.round(t * sampleRate), gain }))
  const dry = samples.slice()
  const a = onePole(3000, sampleRate)
  let lp = 0
  for (let i = 0; i < samples.length; i++) {
    let wet = 0
    for (const tap of taps) if (i >= tap.delay) wet += tap.gain * dry[i - tap.delay]
    lp += a * (wet - lp)
    samples[i] += lp
  }
  return samples
}
