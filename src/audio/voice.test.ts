import { describe, expect, it } from 'vitest'
import { centsOff, midiToFreq } from '../music/pitch'
import { FrameAnalyzer, type FrameAnalyzerOptions } from './pitch/frameAnalyzer'
import { SYNTH_SAMPLE_RATE } from './synth'
import { VOICE_SYNTH_VERSION, renderVoiceNotes, type VoiceNote } from './voice'

const RATES = [44100, 48000]
const WINDOW = 2048

/** The detector as the tuner runs it, and as a sung run sets it (the widest range a voice chart can ask for). */
const DETECTORS: Array<{ name: string; options: FrameAnalyzerOptions }> = [
  { name: 'default detector', options: {} },
  { name: 'voice detector', options: { minFreq: 60, maxFreq: 1200, threshold: 0.9 } },
]

interface Heard {
  /** Seconds at which the analysed window starts and ends. */
  from: number
  to: number
  freq: number
  clarity: number
  rms: number
}

/** The samples through the real analyser, in render quanta as the worklet feeds it. */
function hear(samples: Float32Array, sampleRate: number, options: FrameAnalyzerOptions = {}): Heard[] {
  const analyzer = new FrameAnalyzer(sampleRate, { windowSize: WINDOW, hop: 512, ...options })
  const frames: Heard[] = []
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    const frame = analyzer.push(samples.subarray(i, i + 128))
    if (frame) frames.push({ from: (i + 128 - WINDOW) / sampleRate, to: (i + 128) / sampleRate, freq: frame.freq, clarity: frame.clarity, rms: frame.rms })
  }
  return frames
}

/**
 * Where two tracks first differ (in length, or in a sample), or -1 when they are the same. Compared
 * here and not with `toEqual`: a failed comparison of a hundred thousand samples takes minutes to print.
 */
function firstDifference(a: Float32Array, b: Float32Array): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : shared
}

function peak(samples: Float32Array, from = 0, to = samples.length): number {
  let p = 0
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i++) p = Math.max(p, Math.abs(samples[i]))
  return p
}

function rms(samples: Float32Array, from: number, to: number): number {
  let e = 0
  for (let i = from; i < to; i++) e += samples[i] * samples[i]
  return Math.sqrt(e / Math.max(1, to - from))
}

/** The largest jump from one sample to the next: a click is a jump far larger than the tone itself makes. */
function steepest(samples: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = Math.max(1, from); i < Math.min(samples.length, to); i++) s = Math.max(s, Math.abs(samples[i] - samples[i - 1]))
  return s
}

/** Amplitude of one frequency in a stretch of samples (a single-bin Fourier sum over whole periods). */
function partial(samples: Float32Array, sampleRate: number, freq: number, from: number, seconds: number): number {
  const periods = Math.floor(seconds * freq)
  const n = Math.round((periods / freq) * sampleRate)
  const start = Math.round(from * sampleRate)
  let re = 0
  let im = 0
  for (let i = 0; i < n; i++) {
    const phase = (2 * Math.PI * freq * i) / sampleRate
    re += samples[start + i] * Math.cos(phase)
    im += samples[start + i] * Math.sin(phase)
  }
  return (2 * Math.hypot(re, im)) / n
}

/** The harmonics of a held note up to 5 kHz, as amplitudes (index 0 = the fundamental). */
function harmonics(midi: number, sampleRate: number): number[] {
  const freq = midiToFreq(midi)
  const out = renderVoiceNotes([{ time: 0, duration: 1, midi }], { sampleRate })
  const amps: number[] = []
  for (let h = 1; h * freq < 5000; h++) amps.push(partial(out, sampleRate, h * freq, 0.2, 0.6))
  return amps
}

const energy = (amps: number[]) => amps.reduce((s, a) => s + a * a, 0)

describe('the guide voice', () => {
  it('reads back as the written note from C2 to D6 at both sample rates', () => {
    for (const sampleRate of RATES) {
      for (const { name, options } of DETECTORS) {
        // As far as the range finder believes a voice (MIDI 36 to 86), so wider than any range the app stores.
        for (let midi = 36; midi <= 86; midi++) {
          const out = renderVoiceNotes([{ time: 0.1, duration: 0.7, midi }], { sampleRate })
          // Frames whose whole window lies in the held part: after the attack, before the release.
          const held = hear(out, sampleRate, options).filter((f) => f.from >= 0.1 + 0.04 && f.to <= 0.8 - 0.05)
          expect(held.length).toBeGreaterThanOrEqual(40)
          for (const f of held) {
            const label = `midi ${midi} at ${sampleRate}, ${name}, ${f.to.toFixed(3)} s`
            expect(f.freq, label).toBeGreaterThan(0)
            expect(Math.abs(centsOff(f.freq, midi)), label).toBeLessThanOrEqual(5)
            expect(f.clarity, label).toBeGreaterThanOrEqual(0.9)
          }
        }
      }
    }
  })

  it('follows the tuning reference', () => {
    const out = renderVoiceNotes([{ time: 0, duration: 0.8, midi: 69 }], { sampleRate: 48000, a4: 432 })
    const held = hear(out, 48000).filter((f) => f.from >= 0.05 && f.to <= 0.7)
    for (const f of held) expect(Math.abs(1200 * Math.log2(f.freq / 432))).toBeLessThanOrEqual(5)
  })

  it('gives identical output for identical input, whatever the order of the notes', () => {
    const notes: VoiceNote[] = [
      { time: 0.2, duration: 0.5, midi: 55 },
      { time: 0.7, duration: 0.5, midi: 59 },
      { time: 1.5, duration: 1, midi: 62 },
    ]
    const frozen = JSON.stringify(notes)
    for (const sampleRate of RATES) {
      const a = renderVoiceNotes(notes, { sampleRate })
      const b = renderVoiceNotes(notes, { sampleRate })
      expect(firstDifference(b, a)).toBe(-1)
      expect(firstDifference(renderVoiceNotes([notes[2], notes[0], notes[1]], { sampleRate }), a)).toBe(-1)
      expect(peak(a)).toBeGreaterThan(0)
    }
    expect(JSON.stringify(notes)).toBe(frozen)
    expect(renderVoiceNotes(notes).length).toBe(renderVoiceNotes(notes, { sampleRate: SYNTH_SAMPLE_RATE }).length)
  })

  it('has no clicks where notes join, start or stop', () => {
    for (const sampleRate of RATES) {
      // Back to back with no gap: a step, a repeated note, a leap down, a note too short for its full fades, a low note.
      const notes: VoiceNote[] = [
        { time: 0.1, duration: 0.4, midi: 60 },
        { time: 0.5, duration: 0.4, midi: 62 },
        { time: 0.9, duration: 0.4, midi: 62 },
        { time: 1.3, duration: 0.4, midi: 50 },
        { time: 1.7, duration: 0.05, midi: 62 },
        { time: 1.75, duration: 0.5, midi: 41 },
      ]
      const out = renderVoiceNotes(notes, { sampleRate, tail: 0.2 })
      const at = (seconds: number) => Math.round(seconds * sampleRate)
      // The tone itself, in the held part of the long notes, sets what a normal step between samples is.
      let normal = 0
      for (const n of notes) {
        if (n.duration >= 0.2) normal = Math.max(normal, steepest(out, at(n.time + 0.06), at(n.time + n.duration - 0.07)))
      }
      expect(normal).toBeGreaterThan(0)
      // To the millisecond: 1.3 + 0.4 is not quite 1.7 in floating point, and it is the same join.
      const edges = [...new Set(notes.flatMap((n) => [n.time, n.time + n.duration]).map((t) => Math.round(t * 1000) / 1000))]
      expect(edges).toHaveLength(7)
      for (const edge of edges) {
        const label = `edge at ${edge} s at ${sampleRate}`
        // A note cut off at full level jumps by more than the tone ever does; a faded one barely moves near its edge.
        expect(steepest(out, at(edge - 0.01), at(edge + 0.01)), label).toBeLessThanOrEqual(normal)
        expect(steepest(out, at(edge - 0.003), at(edge + 0.003)), label).toBeLessThan(0.25 * normal)
        // Nothing sounds at the join itself: a repeated note is heard as two notes.
        expect(peak(out, at(edge) - 2, at(edge) + 3), label).toBeLessThan(0.004)
      }
      // The short note is sung, not skipped.
      expect(peak(out, at(1.7), at(1.75))).toBeGreaterThan(0.05)
    }
  })

  it('comes in over 40 ms, fades over the last 50 ms, and is silent outside the written note', () => {
    for (const sampleRate of RATES) {
      const start = 0.25
      const end = 1.25
      const out = renderVoiceNotes([{ time: start, duration: end - start, midi: 69 }], { sampleRate, tail: 0.5 })
      const at = (seconds: number) => Math.round(seconds * sampleRate)
      const level = (from: number, to: number) => peak(out, at(from), at(to))
      const held = level(0.6, 0.9)
      expect(held).toBeGreaterThan(0.1)
      // Attack: next to nothing at the start, half way after 20 ms, all there after 40 ms.
      expect(level(start, start + 0.007)).toBeLessThan(0.1 * held)
      expect(level(start + 0.016, start + 0.024)).toBeGreaterThan(0.3 * held)
      expect(level(start + 0.016, start + 0.024)).toBeLessThan(0.75 * held)
      expect(level(start + 0.04, start + 0.05)).toBeGreaterThan(0.9 * held)
      // Release: still all there 50 ms before the end, half way 25 ms before, next to nothing at the end.
      expect(level(end - 0.06, end - 0.05)).toBeGreaterThan(0.9 * held)
      expect(level(end - 0.029, end - 0.021)).toBeGreaterThan(0.3 * held)
      expect(level(end - 0.029, end - 0.021)).toBeLessThan(0.75 * held)
      expect(level(end - 0.007, end)).toBeLessThan(0.1 * held)
      // A rest is a rest: not one sample before the note or from its written end on.
      expect(peak(out, 0, at(start))).toBe(0)
      expect(peak(out, at(end) + 1)).toBe(0)
      expect(out.length).toBe(Math.ceil((end + 0.5) * sampleRate))
    }
  })

  it('stays under 0.95 and is as loud on every note', () => {
    for (const sampleRate of RATES) {
      const levels: number[] = []
      for (let midi = 36; midi <= 86; midi++) {
        const out = renderVoiceNotes([{ time: 0, duration: 1, midi }], { sampleRate })
        expect(peak(out), `midi ${midi} at ${sampleRate}`).toBeLessThan(0.95)
        // Whole periods, so the level of a low note is not a matter of where the window ends.
        const period = sampleRate / midiToFreq(midi)
        const from = Math.round(0.2 * sampleRate)
        levels.push(rms(out, from, from + Math.round(Math.floor((0.6 * sampleRate) / period) * period)))
      }
      const quietest = Math.min(...levels)
      const loudest = Math.max(...levels)
      // Loud enough to sing to over the click, and within a decibel from the lowest note to the highest.
      expect(quietest).toBeGreaterThan(0.08)
      expect(loudest).toBeLessThan(0.3)
      expect(20 * Math.log10(loudest / quietest)).toBeLessThan(1)
    }
  })

  it('is one voice: a note that starts while another sounds takes over, so the level never adds up', () => {
    const sampleRate = 44100
    const at = (seconds: number) => Math.round(seconds * sampleRate)
    const later: VoiceNote = { time: 0.5, duration: 1, midi: 64 }
    const top: VoiceNote = { time: 2, duration: 1, midi: 67 }
    // The second note starts half way through the first; then three notes written as a chord.
    const out = renderVoiceNotes([{ time: 0, duration: 1, midi: 57 }, later, { time: 2, duration: 1, midi: 60 }, top, { time: 2, duration: 1, midi: 64 }], { sampleRate })
    expect(peak(out)).toBeLessThan(0.95)
    // From the join on there is only the later note, sample for sample; of a chord, only its top note.
    expect(firstDifference(out.subarray(at(0.5), at(1.5)), renderVoiceNotes([later], { sampleRate }).subarray(at(0.5), at(1.5)))).toBe(-1)
    expect(firstDifference(out.subarray(at(2), at(3)), renderVoiceNotes([top], { sampleRate }).subarray(at(2), at(3)))).toBe(-1)
    // Up to the join the first note is the one heard, and it fades out there: no click where it is cut.
    const before = hear(out, sampleRate).filter((f) => f.from >= 0.05 && f.to <= 0.44)
    expect(before.length).toBeGreaterThan(20)
    for (const f of before) expect(Math.abs(centsOff(f.freq, 57)), `${f.to.toFixed(3)} s`).toBeLessThanOrEqual(5)
    expect(peak(out, at(0.5) - 2, at(0.5) + 3)).toBeLessThan(0.004)
    expect(peak(out, at(0.3), at(0.4))).toBeGreaterThan(0.1)
  })

  it('writes a number into every sample, also when a note starts a hair after a sample instant', () => {
    // The trap: the first sample of such a note falls a rounding error before the note's own start. Read as
    // "just before the end of the period before", it looked one point past the end of the stored period.
    for (const sampleRate of RATES) {
      for (let i = 1; i <= 200; i++) {
        for (const start of [i / sampleRate, (i / sampleRate) * (1 + Number.EPSILON), (i / sampleRate) * (1 + 2 * Number.EPSILON)]) {
          const out = renderVoiceNotes([{ time: start, duration: 0.05, midi: 45 }], { sampleRate })
          const broken = out.findIndex((v) => !Number.isFinite(v))
          expect(broken, `a note at ${start} s at ${sampleRate}`).toBe(-1)
        }
      }
    }
  })

  it('stays one voice under 0.95 for any tune: overlaps, chords, notes too short to hear, a start before zero', () => {
    let s = 20240
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    for (let round = 0; round < 12; round++) {
      const sampleRate = RATES[round % 2]
      const notes: VoiceNote[] = Array.from({ length: 40 }, () => ({
        time: rand() * 8 - 0.2,
        duration: rand() < 0.2 ? rand() * 0.02 : rand() * 1.5,
        midi: 36 + Math.floor(rand() * 51),
      }))
      // A chord, and the same note written twice with two lengths: neither may add up.
      notes.push({ time: 3, duration: 1, midi: 60 }, { time: 3, duration: 1, midi: 64 }, { time: 5, duration: 0.3, midi: 55 }, { time: 5, duration: 0.9, midi: 55 })
      const out = renderVoiceNotes(notes, { sampleRate })
      expect(out.findIndex((v) => !Number.isFinite(v)), `round ${round}`).toBe(-1)
      expect(peak(out), `round ${round}`).toBeLessThan(0.95)
      // Whatever order they are handed over in, it is the same singing.
      expect(firstDifference(renderVoiceNotes([...notes].reverse(), { sampleRate }), out), `round ${round}`).toBe(-1)
      // Where nothing is written, nothing sounds.
      const written = new Uint8Array(out.length)
      for (const n of notes) written.fill(1, Math.max(0, Math.floor(n.time * sampleRate)), Math.max(0, Math.min(out.length, Math.ceil((n.time + n.duration) * sampleRate) + 1)))
      let stray = -1
      for (let i = 0; i < out.length && stray < 0; i++) if (!written[i] && out[i] !== 0) stray = i
      expect(stray, `round ${round}`).toBe(-1)
    }
  })

  it('leaves out a note that cannot be sung, and sings the rest', () => {
    const good: VoiceNote = { time: 0.3, duration: 0.6, midi: 57 }
    const alone = renderVoiceNotes([good], { sampleRate: 44100 })
    const broken: VoiceNote[] = [
      { time: NaN, duration: 1, midi: 60 },
      { time: 0.1, duration: 3, midi: NaN },
      { time: 0.2, duration: 0, midi: 60 },
      { time: 0.2, duration: -1, midi: 60 },
      { time: 0.2, duration: NaN, midi: 60 },
      { time: 5, duration: Infinity, midi: 60 },
    ]
    // Neither the sound nor the length of the track follows a note that was left out.
    for (const one of broken) expect(firstDifference(renderVoiceNotes([one, good], { sampleRate: 44100 }), alone), JSON.stringify(one)).toBe(-1)
    expect(firstDifference(renderVoiceNotes([...broken, good], { sampleRate: 44100 }), alone)).toBe(-1)
    expect(alone.length).toBe(Math.ceil(0.9 * 44100))
  })

  it('adds the octave above to a note under 110 Hz, and to no other', () => {
    for (const sampleRate of RATES) {
      // How strong the second harmonic is against the third: the added octave lifts the even ones only.
      const evenness = (midi: number) => {
        const amps = harmonics(midi, sampleRate)
        return amps[1] / amps[2]
      }
      // G#2 is 103.8 Hz, A2 is 110 Hz exactly: the first note that is not under it.
      for (const midi of [40, 42, 44]) expect(evenness(midi), `midi ${midi}`).toBeGreaterThan(1.5 * evenness(45))
      // From A2 up the colour only drifts from note to note: nothing is switched on or off.
      for (const midi of [46, 47, 52, 57]) {
        expect(evenness(midi) / evenness(midi - 1), `midi ${midi}`).toBeGreaterThan(0.9)
        expect(evenness(midi) / evenness(midi - 1), `midi ${midi}`).toBeLessThan(1.1)
      }
      // The written note is still the one that sounds: the odd harmonics, which only it has, keep a good share.
      const low = harmonics(40, sampleRate)
      const odd = energy(low.filter((_, i) => i % 2 === 0))
      expect(odd / energy(low)).toBeGreaterThan(0.15)
    }
  })

  it('keeps at least a fifth of every note above 300 Hz, where a phone speaker starts to play', () => {
    for (let midi = 36; midi <= 86; midi++) {
      const freq = midiToFreq(midi)
      const amps = harmonics(midi, 44100)
      const above = energy(amps.filter((_, i) => (i + 1) * freq >= 300))
      expect(above / energy(amps), `midi ${midi}`).toBeGreaterThan(0.2)
    }
  })

  it('fills exactly the length asked for and scales with the gain', () => {
    const notes: VoiceNote[] = [{ time: 0.5, duration: 0.5, midi: 60 }]
    const natural = renderVoiceNotes(notes, { sampleRate: 48000 })
    const long = renderVoiceNotes(notes, { sampleRate: 48000, length: 96000 })
    expect(long.length).toBe(96000)
    expect(firstDifference(long.subarray(0, natural.length), natural)).toBe(-1)
    expect(peak(long, natural.length)).toBe(0)
    // Shorter than the notes: what fits is the same, the rest is left out.
    const short = renderVoiceNotes(notes, { sampleRate: 48000, length: 30000 })
    expect(firstDifference(short, natural.subarray(0, 30000))).toBe(-1)
    const half = renderVoiceNotes(notes, { sampleRate: 48000, gain: 0.5 })
    expect(peak(half)).toBeCloseTo(0.5 * peak(natural), 6)
    expect(firstDifference(renderVoiceNotes([], { sampleRate: 48000, length: 100 }), new Float32Array(100))).toBe(-1)
    expect(renderVoiceNotes([]).length).toBe(0)
  })

  it('carries a version for whoever keeps rendered sound', () => {
    expect(Number.isInteger(VOICE_SYNTH_VERSION)).toBe(true)
    expect(VOICE_SYNTH_VERSION).toBeGreaterThanOrEqual(1)
  })
})
