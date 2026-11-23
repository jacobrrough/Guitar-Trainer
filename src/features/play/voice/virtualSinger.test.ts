/**
 * The virtual singer is what stands in for a person in every singing simulation, so it is tested like
 * an instrument: each thing it can be told to do (flat, an octave down, a scoop, vibrato, late, a
 * consonant, breathy, quiet, one note throughout, drifting) has to show up in what the real analyser
 * reads, in the direction a listener would expect, at both sample rates.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FrameAnalyzer, type FrameAnalyzerOptions } from '../../../audio/pitch/frameAnalyzer'
import { renderVoiceNotes } from '../../../audio/voice'
import { constantBeatGrid } from '../../../chart/timing'
import { emptyChart } from '../../../chart/types'
import { midiToFreq } from '../../../music/pitch'
import { clickTrack, delayed, mix, phoneMic, type SimCase } from '../simCases.testutil'
import { sing, type SingOptions, type SungNote } from './virtualSinger.testutil'

const RATES = [44100, 48000]
const WINDOW = 2048
/** The clarity and the level from which the scorer takes a frame for singing (docs/SINGING.md, section 3). */
const VOICED = 0.6
const AUDIBLE = 0.004

interface Heard {
  /** Seconds at the middle of the analysed window: the moment the reading belongs to. */
  at: number
  from: number
  to: number
  /** Fractional MIDI number of a confident pitch, NaN when there is none. */
  midi: number
  clarity: number
  rms: number
}

/** The samples through the real analyser, in render quanta as the worklet feeds it, with a sung run's detector settings. */
function hear(samples: Float32Array, sampleRate: number, options: FrameAnalyzerOptions = {}): Heard[] {
  const analyzer = new FrameAnalyzer(sampleRate, { windowSize: WINDOW, hop: 512, minFreq: 60, maxFreq: 1200, threshold: 0.9, ...options })
  const frames: Heard[] = []
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    const frame = analyzer.push(samples.subarray(i, i + 128))
    if (!frame) continue
    const to = (i + 128) / sampleRate
    const from = to - WINDOW / sampleRate
    // Without the level, the first whisper of noise entering an empty window passes for a pitch.
    const voiced = frame.freq > 0 && frame.clarity >= VOICED && frame.rms >= AUDIBLE
    frames.push({ at: (from + to) / 2, from, to, midi: voiced ? 69 + 12 * Math.log2(frame.freq / 440) : NaN, clarity: frame.clarity, rms: frame.rms })
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

const voiced = (f: Heard) => !Number.isNaN(f.midi)
/** Cents from a note, any octave counting as the note (the scorer folds the same way). */
const folded = (midi: number, target: number) => {
  const cents = (midi - target) * 100
  return cents - 1200 * Math.round(cents / 1200)
}
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]
const median = (xs: number[]) => quantile(xs, 0.5)
/** Frames whose whole window lies between two times. */
const within = (frames: Heard[], from: number, to: number) => frames.filter((f) => f.from >= from && f.to <= to)

/** One held note starting at 0.3 s, and what the analyser reads in its settled part. */
function heldNote(midi: number, sampleRate: number, options: Partial<SingOptions> = {}, seconds = 1.2): Heard[] {
  const take = sing([{ time: 0.3, duration: seconds, midi }], { sampleRate, ...options })
  return within(hear(take, sampleRate), 0.3 + 0.15, 0.3 + seconds - 0.1)
}

const centsRead = (frames: Heard[], target: number) => frames.filter(voiced).map((f) => (f.midi - target) * 100)

/** Five notes up and back from `home`, a beat each at 75 bpm, written the way a chart writes them (95 % of the beat). */
function scale(home: number): SungNote[] {
  const beat = 0.8
  return [0, 2, 4, 5, 7, 5, 4, 2, 0].map((offset, i) => ({ time: 0.5 + i * beat, duration: 0.95 * beat, midi: home + offset }))
}

/** Amplitude of one frequency in a stretch of samples. */
function partial(samples: Float32Array, sampleRate: number, freq: number, from: number, seconds: number): number {
  const n = Math.round((Math.floor(seconds * freq) / freq) * sampleRate)
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

/** Frequency of the strongest harmonic of a held note (samples from 0.5 s on, half a second of them). */
function strongestPartial(samples: Float32Array, sampleRate: number, midi: number): number {
  const freq = midiToFreq(midi)
  let best = 0
  let bestFreq = 0
  for (let h = 1; h * freq < 4000; h++) {
    const amp = partial(samples, sampleRate, h * freq, 0.5, 0.5)
    if (amp > best) {
      best = amp
      bestFreq = h * freq
    }
  }
  return bestFreq
}

describe('the virtual singer, left alone', () => {
  it('sings the written notes in tune, in every vowel, from the lowest note a range can hold to the highest', () => {
    for (const sampleRate of RATES) {
      for (const vowel of ['ah', 'ee', 'oo'] as const) {
        // C2 to D6 is as far as the range finder believes a voice; "la" is what is sung, so "ah" is looked at closest.
        for (let midi = 36; midi <= 86; midi += vowel === 'ah' ? 2 : 5) {
          const frames = heldNote(midi, sampleRate, { vowel, seconds: 1 }, 0.65)
          const cents = frames.filter(voiced).map((f) => (f.midi - midi) * 100)
          const label = `${vowel} midi ${midi} at ${sampleRate}`
          expect(frames.length, label).toBeGreaterThan(20)
          // Every frame carries a confident pitch, and it is the written note in the written octave.
          expect(cents.length, label).toBe(frames.length)
          expect(Math.abs(median(cents)), label).toBeLessThanOrEqual(3)
          expect(Math.max(...cents.map(Math.abs)), label).toBeLessThanOrEqual(25)
          expect(median(frames.map((f) => f.clarity)), label).toBeGreaterThanOrEqual(0.95)
        }
      }
    }
  })

  it('is a voice and not a test tone: no two periods are quite alike', () => {
    for (const sampleRate of RATES) {
      const clarity = (options: Partial<SingOptions>) => median(heldNote(57, sampleRate, { breath: 0, ...options }).map((f) => f.clarity))
      const steady = clarity({ jitter: 0 })
      const usual = clarity({})
      const rough = clarity({ jitter: 0.03 })
      expect(steady).toBeGreaterThan(0.995)
      expect(usual).toBeLessThan(steady)
      expect(rough).toBeLessThan(usual - 0.02)
      // The usual half a percent leaves the pitch where it is.
      expect(Math.abs(median(centsRead(heldNote(57, sampleRate), 57)))).toBeLessThanOrEqual(6)
    }
  })

  it('is the same take every time, and another take with another seed', () => {
    const notes = scale(55)
    const a = sing(notes, { sampleRate: 44100 })
    expect(firstDifference(sing(notes, { sampleRate: 44100 }), a)).toBe(-1)
    const frozen = JSON.stringify(notes)
    const b = sing(notes, { sampleRate: 44100, seed: 2 })
    expect(JSON.stringify(notes)).toBe(frozen)
    expect(b.length).toBe(a.length)
    expect(firstDifference(b, a)).toBeGreaterThanOrEqual(0)
    // Both things that make a take a take follow the seed: the unevenness of the voice, and the breath.
    const takes = (options: Partial<SingOptions>) => [1, 2].map((seed) => sing(notes.slice(0, 2), { sampleRate: 44100, seed, ...options }))
    for (const [first, second] of [takes({ breath: 0 }), takes({ jitter: 0 })]) expect(firstDifference(first, second)).toBeGreaterThanOrEqual(0)
    const [still, same] = takes({ breath: 0, jitter: 0 })
    expect(firstDifference(still, same)).toBe(-1)
    // Another take of the same singing: the same notes are read.
    for (const take of [a, b]) {
      const frames = within(hear(take, 44100), 0.5 + 0.15, 0.5 + 0.7)
      expect(Math.abs(median(centsRead(frames, 55)))).toBeLessThanOrEqual(6)
    }
  })

  it('has the defaults it says it has', () => {
    const notes = scale(60).slice(0, 3)
    const spelled: SingOptions = {
      sampleRate: 48000,
      cents: 0,
      octave: 0,
      scoopCents: 0,
      scoopSec: 0.15,
      vibratoCents: 0,
      vibratoHz: 5.5,
      lateSec: 0,
      gapSec: 0,
      breath: 0.05,
      level: 0.1,
      driftCentsPerSec: 0,
      legato: false,
      vowel: 'ah',
      jitter: 0.005,
      seed: 1,
    }
    expect(firstDifference(sing(notes, { sampleRate: 48000 }), sing(notes, spelled))).toBe(-1)
  })

  it('takes an option that is there but undefined as not given: a table of cases cannot sing silence by accident', () => {
    // The trap: `sing(notes, { sampleRate, cents: c.cents })` with no cents in the case. If the undefined got
    // through, the take would be silent (or not numbers at all) and every "must not score" case would pass.
    const notes = scale(60).slice(0, 2)
    const plain = sing(notes, { sampleRate: 44100 })
    expect(plain.some((v) => v !== 0)).toBe(true)
    const names = ['seconds', 'cents', 'octave', 'scoopCents', 'scoopSec', 'vibratoCents', 'vibratoHz', 'lateSec', 'gapSec', 'breath', 'level', 'monotoneMidi', 'driftCentsPerSec', 'legato', 'vowel', 'jitter', 'seed'] as const
    for (const name of names) {
      const options: SingOptions = { sampleRate: 44100, [name]: undefined }
      expect(firstDifference(sing(notes, options), plain), name).toBe(-1)
    }
  })

  it('refuses a setting that is not a number, instead of singing nothing', () => {
    const notes = scale(60).slice(0, 1)
    for (const name of ['cents', 'octave', 'scoopCents', 'scoopSec', 'vibratoCents', 'vibratoHz', 'lateSec', 'gapSec', 'breath', 'level', 'monotoneMidi', 'driftCentsPerSec', 'jitter', 'seed', 'seconds'] as const) {
      expect(() => sing(notes, { sampleRate: 44100, [name]: NaN }), name).toThrow(name)
    }
    expect(() => sing(notes, { sampleRate: 44100, level: Infinity })).toThrow('level')
    expect(() => sing(notes, { sampleRate: NaN })).toThrow('sampleRate')
    expect(() => sing(notes, { sampleRate: 0 })).toThrow('sampleRate')
    expect(() => sing(notes, { sampleRate: 44100, vowel: 'uh' as 'ah' })).toThrow("no vowel 'uh'")
    expect(() => sing(notes, {} as SingOptions)).toThrow('sampleRate')
    // One such number in one note would spread through the whole take on its way through the mouth.
    expect(() => sing([...notes, { time: 3, duration: 1, midi: 60, gain: NaN }], { sampleRate: 44100 })).toThrow('gain')
    expect(() => sing([...notes, { time: 3, duration: 1, midi: 60, slideTo: NaN }], { sampleRate: 44100 })).toThrow('slideTo')
  })

  it('leaves out a note that cannot be sung, and sings the rest', () => {
    const good: SungNote = { time: 0.3, duration: 0.8, midi: 57 }
    const alone = sing([good], { sampleRate: 44100 })
    const broken: SungNote[] = [
      { time: NaN, duration: 1, midi: 60 },
      { time: 0.1, duration: 5, midi: NaN },
      { time: 2, duration: 0, midi: 60 },
      { time: 2, duration: -1, midi: 60 },
      { time: 9, duration: Infinity, midi: 60 },
    ]
    // Neither the sound nor the length of the take follows a note that was left out.
    expect(firstDifference(sing([...broken, good], { sampleRate: 44100 }), alone)).toBe(-1)
    expect(alone.length).toBe(Math.ceil(1.6 * 44100))
  })

  it('starts and ends a note the way a voice does: over a twentieth of a second, not at a stroke', () => {
    for (const sampleRate of RATES) {
      const take = sing([{ time: 0.5, duration: 1, midi: 57 }], { sampleRate, breath: 0 })
      const level = (from: number, to: number) => {
        let p = 0
        for (let i = Math.round(from * sampleRate); i < Math.round(to * sampleRate); i++) p = Math.max(p, Math.abs(take[i]))
        return p
      }
      const held = level(0.8, 1.2)
      expect(held).toBeGreaterThan(0.1)
      // Coming in: hardly there after 8 ms, part of the way after 25 ms, all there after 60 ms.
      expect(level(0.5, 0.508)).toBeLessThan(0.25 * held)
      expect(level(0.52, 0.53)).toBeGreaterThan(0.2 * held)
      expect(level(0.52, 0.53)).toBeLessThan(0.85 * held)
      expect(level(0.56, 0.6)).toBeGreaterThan(0.8 * held)
      // Going out: all there 70 ms before the written end, part of the way 30 ms before, hardly there at the end.
      expect(level(1.4, 1.43)).toBeGreaterThan(0.8 * held)
      expect(level(1.465, 1.475)).toBeGreaterThan(0.2 * held)
      expect(level(1.465, 1.475)).toBeLessThan(0.85 * held)
      expect(level(1.492, 1.5)).toBeLessThan(0.25 * held)
    }
  })

  it('is one voice: a note that starts while another is still sounding takes over from it', () => {
    for (const sampleRate of RATES) {
      // The second note starts half way through the first, a fifth higher.
      const frames = hear(sing([{ time: 0.3, duration: 1.5, midi: 55 }, { time: 1, duration: 0.8, midi: 62 }], { sampleRate }), sampleRate)
      expect(Math.abs(median(centsRead(within(frames, 0.45, 0.9), 55)))).toBeLessThanOrEqual(3)
      // Two voices a fifth apart would read as neither note; one voice reads as the second.
      const after = within(frames, 1.15, 1.7)
      expect(after.length).toBeGreaterThan(30)
      expect(after.every(voiced)).toBe(true)
      expect(Math.max(...centsRead(after, 62).map(Math.abs))).toBeLessThanOrEqual(25)
      // The note that was taken over is over: it does not come back when a short newcomer has finished.
      const interrupted = hear(sing([{ time: 0.3, duration: 1.7, midi: 55 }, { time: 1, duration: 0.3, midi: 62 }], { sampleRate, breath: 0 }), sampleRate)
      expect(within(interrupted, 1.15, 1.25).every(voiced)).toBe(true)
      expect(within(interrupted, 1.4, 2).every((f) => f.rms < 1e-4)).toBe(true)
    }
  })

  it('lasts half a second past the last note, or as long as it is told', () => {
    const notes: SungNote[] = [{ time: 1, duration: 0.5, midi: 60 }]
    expect(sing(notes, { sampleRate: 48000 }).length).toBe(96000)
    expect(sing(notes, { sampleRate: 48000, lateSec: 0.25 }).length).toBe(108000)
    expect(sing(notes, { sampleRate: 44100, seconds: 3 }).length).toBe(132300)
    expect(firstDifference(sing([], { sampleRate: 44100, seconds: 1 }), new Float32Array(44100))).toBe(-1)
    // Without breath a rest is silent to the last sample.
    const dry = sing(notes, { sampleRate: 48000, breath: 0 })
    expect(dry.subarray(0, 47000).every((v) => v === 0)).toBe(true)
    expect(dry.subarray(73000).every((v) => Math.abs(v) < 1e-4)).toBe(true)
  })
})

describe('what the singer can be told', () => {
  it('cents: flat or sharp by that much', () => {
    for (const sampleRate of RATES) {
      for (const cents of [-120, -60, -30, 30, 150]) {
        const read = median(centsRead(heldNote(60, sampleRate, { cents }), 60))
        expect(Math.abs(read - cents), `${cents} cents at ${sampleRate}`).toBeLessThanOrEqual(6)
      }
    }
  })

  it('octave: the same notes an octave down or up', () => {
    for (const sampleRate of RATES) {
      for (const octave of [-1, 1]) {
        const frames = heldNote(60, sampleRate, { octave })
        expect(frames.filter(voiced).length / frames.length).toBeGreaterThanOrEqual(0.95)
        // Not folded: the analyser reads the other octave itself.
        expect(Math.abs(median(centsRead(frames, 60 + 12 * octave)))).toBeLessThanOrEqual(6)
      }
    }
  })

  it('scoopCents and scoopSec: each note starts under the pitch and slides up to it', () => {
    for (const sampleRate of RATES) {
      const read = (options: Partial<SingOptions>) => hear(sing([{ time: 0.3, duration: 1.2, midi: 62 }], { sampleRate, ...options }), sampleRate).filter(voiced)
      /** Seconds after the written start at which the reading first comes within 30 cents, and how far under the first reading is. */
      const arrival = (frames: Heard[]) => frames.find((f) => Math.abs(f.midi - 62) * 100 <= 30)!.at - 0.3
      const first = (frames: Heard[]) => (frames[0].midi - 62) * 100
      const straight = read({})
      const scooped = read({ scoopCents: 200 })
      const slow = read({ scoopCents: 200, scoopSec: 0.4 })
      const deep = read({ scoopCents: 400 })
      expect(Math.abs(first(straight))).toBeLessThan(30)
      expect(first(scooped)).toBeLessThan(-100)
      expect(first(deep)).toBeLessThan(first(scooped) - 100)
      // On the note about when it says: 0.15 s by default, later for a slower scoop.
      expect(arrival(straight)).toBeLessThan(0.06)
      expect(arrival(scooped)).toBeGreaterThan(0.08)
      expect(arrival(scooped)).toBeLessThan(0.2)
      expect(arrival(slow)).toBeGreaterThan(arrival(scooped) + 0.15)
      expect(arrival(slow)).toBeLessThan(0.45)
      // After the scoop the note is the note.
      for (const frames of [scooped, slow, deep]) expect(Math.abs(median(centsRead(within(frames, 0.3 + 0.5, 0.3 + 1.1), 62)))).toBeLessThanOrEqual(6)
      // A negative scoop comes down onto the note instead.
      expect(first(read({ scoopCents: -200 }))).toBeGreaterThan(100)
    }
  })

  it('vibratoCents and vibratoHz: the pitch swings that wide and that often around the note', () => {
    for (const sampleRate of RATES) {
      const swing = (options: Partial<SingOptions>) => {
        const frames = heldNote(64, sampleRate, options, 2.3).filter(voiced)
        const cents = centsRead(frames, 64)
        const mean = cents.reduce((s, c) => s + c, 0) / cents.length
        // Swings a second: from the first upward crossing of the mean to the last, so a cut-off swing at either end does not count.
        const crossings: number[] = []
        for (let i = 1; i < cents.length; i++) if (cents[i - 1] < mean && cents[i] >= mean) crossings.push(frames[i].at)
        const perSecond = crossings.length > 1 ? (crossings.length - 1) / (crossings[crossings.length - 1] - crossings[0]) : 0
        return { mean, half: (quantile(cents, 0.95) - quantile(cents, 0.05)) / 2, perSecond }
      }
      const none = swing({})
      const narrow = swing({ vibratoCents: 50, vibratoHz: 6 })
      const wide = swing({ vibratoCents: 80, vibratoHz: 6 })
      const slow = swing({ vibratoCents: 50, vibratoHz: 4.5 })
      expect(none.half).toBeLessThan(8)
      // The analysis window is a quarter of a swing long, so a little of the width is averaged away.
      expect(narrow.half).toBeGreaterThan(35)
      expect(narrow.half).toBeLessThan(55)
      expect(wide.half).toBeGreaterThan(narrow.half + 15)
      expect(wide.half).toBeLessThan(88)
      for (const s of [narrow, wide, slow]) expect(Math.abs(s.mean)).toBeLessThan(8)
      expect(Math.abs(narrow.perSecond - 6)).toBeLessThan(0.3)
      expect(Math.abs(slow.perSecond - 4.5)).toBeLessThan(0.3)
      // It sets in over the first tenth of a second: a note does not begin at the full swing.
      const start = hear(sing([{ time: 0.3, duration: 1, midi: 60 }], { sampleRate, vibratoCents: 80, vibratoHz: 6 }), sampleRate).filter(voiced)
      const swingIn = (from: number, to: number) => start.filter((f) => f.at >= from && f.at <= to).map((f) => Math.abs(f.midi - 60) * 100)
      expect(swingIn(0.3, 0.36).length).toBeGreaterThan(3)
      expect(Math.max(...swingIn(0.3, 0.36))).toBeLessThan(50)
      expect(Math.max(...swingIn(0.4, 0.6))).toBeGreaterThan(60)
    }
  })

  it('lateSec: every note that much late, or early when negative', () => {
    for (const sampleRate of RATES) {
      const onset = (lateSec: number) => hear(sing([{ time: 0.5, duration: 0.8, midi: 57 }], { sampleRate, lateSec, seconds: 2 }), sampleRate).find(voiced)!.at
      const ending = (lateSec: number) => hear(sing([{ time: 0.5, duration: 0.8, midi: 57 }], { sampleRate, lateSec, seconds: 2 }), sampleRate).filter(voiced).at(-1)!.at
      // One hop of the analyser is 11 ms: that is how finely an onset can be placed.
      expect(Math.abs(onset(0.15) - onset(0) - 0.15)).toBeLessThan(0.015)
      expect(Math.abs(onset(-0.08) - onset(0) + 0.08)).toBeLessThan(0.015)
      // The whole note moves: it ends late as well.
      expect(Math.abs(ending(0.15) - ending(0) - 0.15)).toBeLessThan(0.015)
    }
  })

  it('gapSec: a consonant in front of every note, with breath in it and no pitch', () => {
    for (const sampleRate of RATES) {
      const take = (gapSec: number, breath = 0.05) => hear(sing([{ time: 0.5, duration: 0.8, midi: 57 }], { sampleRate, gapSec, breath, seconds: 2 }), sampleRate)
      const plain = take(0).filter(voiced)
      const spoken = take(0.1).filter(voiced)
      // The vowel starts a tenth of a second later and ends where it did.
      expect(Math.abs(spoken[0].at - plain[0].at - 0.1)).toBeLessThan(0.015)
      expect(Math.abs(spoken.at(-1)!.at - plain.at(-1)!.at)).toBeLessThan(0.015)
      expect(Math.abs(median(centsRead(within(spoken, 0.75, 1.2), 57)))).toBeLessThanOrEqual(6)
      // Inside the consonant there is sound, more of it with more breath, and none of it is a pitch.
      const inGap = (frames: Heard[]) => frames.filter((f) => f.from >= 0.5 && f.to <= 0.6)
      const soft = inGap(take(0.1))
      const hissy = inGap(take(0.1, 0.4))
      expect(soft.length).toBeGreaterThan(3)
      expect(soft.every((f) => !voiced(f))).toBe(true)
      expect(hissy.every((f) => !voiced(f))).toBe(true)
      expect(median(soft.map((f) => f.rms))).toBeGreaterThan(0.001)
      expect(median(hissy.map((f) => f.rms))).toBeGreaterThan(4 * median(soft.map((f) => f.rms)))
      expect(inGap(take(0.1, 0)).every((f) => f.rms < 1e-6)).toBe(true)
    }
  })

  it('breath that is under way is never taken for a note', () => {
    for (const sampleRate of RATES) {
      for (const vowel of ['ah', 'ee', 'oo'] as const) {
        // Two and a half seconds of consonant: air through the mouth, and no voice. The frames looked at hold
        // nothing but breath. Where breath sets in, a frame or two can still read as a note (see AIR_DAMPING).
        const take = sing([{ time: 0.2, duration: 3, midi: 57 }], { sampleRate, vowel, gapSec: 2.5, breath: 0.4 })
        const frames = within(hear(take, sampleRate), 0.25, 2.65)
        expect(frames.length).toBeGreaterThan(190)
        expect(median(frames.map((f) => f.rms))).toBeGreaterThan(0.02)
        expect(frames.filter(voiced).length, `${vowel} at ${sampleRate}`).toBe(0)
      }
    }
  })

  it('breath: more air, less clarity, the same note', () => {
    for (const sampleRate of RATES) {
      const clarity = (breath: number) => median(heldNote(60, sampleRate, { breath }).map((f) => f.clarity))
      const clear = clarity(0)
      const usual = clarity(0.05)
      const breathy = clarity(0.4)
      const whisper = clarity(1.5)
      expect(clear).toBeGreaterThanOrEqual(usual)
      expect(usual).toBeGreaterThan(0.95)
      expect(breathy).toBeLessThan(usual - 0.05)
      // Still singing: breathy is above the scorer's gate, and the pitch has not moved.
      expect(breathy).toBeGreaterThan(VOICED + 0.1)
      expect(Math.abs(median(centsRead(heldNote(60, sampleRate, { breath: 0.4 }), 60)))).toBeLessThanOrEqual(8)
      // More air than voice is no longer a note.
      expect(whisper).toBeLessThan(VOICED)
    }
  })

  it('level: how loud the held notes are, whatever the note or the vowel', () => {
    for (const sampleRate of RATES) {
      for (const vowel of ['ah', 'ee', 'oo'] as const) {
        for (const midi of [45, 57, 69]) {
          const loud = median(heldNote(midi, sampleRate, { vowel, breath: 0, seconds: 1.1 }, 0.7).map((f) => f.rms))
          expect(loud / 0.1, `${vowel} midi ${midi}`).toBeGreaterThan(0.9)
          expect(loud / 0.1, `${vowel} midi ${midi}`).toBeLessThan(1.1)
        }
        const quiet = median(heldNote(57, sampleRate, { vowel, breath: 0, level: 0.01, seconds: 1.1 }, 0.7).map((f) => f.rms))
        expect(quiet, vowel).toBeGreaterThan(0.009)
        expect(quiet, vowel).toBeLessThan(0.011)
      }
      // Across a tune one level holds for the take: no note is far from it.
      const frames = hear(sing(scale(52), { sampleRate, breath: 0 }), sampleRate)
      const levels = scale(52).map((n) => median(within(frames, n.time + 0.15, n.time + n.duration - 0.1).map((f) => f.rms)))
      for (const level of levels) {
        expect(level).toBeGreaterThan(0.05)
        expect(level).toBeLessThan(0.2)
      }
      // A voice is not a level meter either: where a harmonic meets a formant the note comes out stronger.
      expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(1.2)
    }
  })

  it('a note of its own loudness: gain on one note', () => {
    const notes: SungNote[] = [
      { time: 0.3, duration: 0.8, midi: 57 },
      { time: 1.3, duration: 0.8, midi: 57, gain: 3 },
      { time: 2.3, duration: 0.8, midi: 57, gain: 0.25 },
    ]
    const frames = hear(sing(notes, { sampleRate: 48000, breath: 0 }), 48000)
    const levels = notes.map((n) => median(within(frames, n.time + 0.15, n.time + n.duration - 0.1).map((f) => f.rms)))
    expect(levels[0]).toBeGreaterThan(0.085)
    expect(levels[0]).toBeLessThan(0.115)
    expect(levels[1] / levels[0]).toBeCloseTo(3, 1)
    expect(levels[2] / levels[0]).toBeCloseTo(0.25, 1)
  })

  it('monotoneMidi: one note through the whole tune', () => {
    for (const sampleRate of RATES) {
      const notes = scale(55)
      const frames = hear(sing(notes, { sampleRate, monotoneMidi: 58 }), sampleRate)
      for (const n of notes) {
        const cents = centsRead(within(frames, n.time + 0.15, n.time + n.duration - 0.1), 58)
        expect(cents.length).toBeGreaterThan(20)
        expect(Math.abs(median(cents)), `written ${n.midi}`).toBeLessThanOrEqual(6)
      }
    }
  })

  it('driftCentsPerSec: flatter (or sharper) the longer the take runs, from the first note on', () => {
    for (const sampleRate of RATES) {
      const notes: SungNote[] = [
        { time: 1, duration: 0.6, midi: 60 },
        { time: 3, duration: 0.6, midi: 64 },
        { time: 6, duration: 0.6, midi: 60 },
      ]
      const read = (drift: number) => {
        const frames = hear(sing(notes, { sampleRate, driftCentsPerSec: drift }), sampleRate)
        return notes.map((n) => median(centsRead(within(frames, n.time + 0.15, n.time + n.duration - 0.1), n.midi)))
      }
      const flat = read(-10)
      // The readings of a note are centred a third of a second into it: 0.33, 2.33 and 5.33 s after the first note began.
      expect(Math.abs(flat[0] + 3.3)).toBeLessThanOrEqual(6)
      expect(Math.abs(flat[1] + 23.3)).toBeLessThanOrEqual(6)
      expect(Math.abs(flat[2] + 53.3)).toBeLessThanOrEqual(6)
      expect(Math.abs(read(8)[2] - 42.6)).toBeLessThanOrEqual(6)
      // Without it nothing moves.
      for (const cents of read(0)) expect(Math.abs(cents)).toBeLessThanOrEqual(6)
    }
  })

  it('legato: the voice carries from note to note instead of stopping', () => {
    for (const sampleRate of RATES) {
      const notes = scale(57)
      const detached = hear(sing(notes, { sampleRate, breath: 0 }), sampleRate)
      const joined = hear(sing(notes, { sampleRate, breath: 0, legato: true }), sampleRate)
      const levelOf = (frames: Heard[], n: SungNote) => median(within(frames, n.time + 0.15, n.time + n.duration - 0.1).map((f) => f.rms))
      for (let i = 1; i < notes.length; i++) {
        const join = notes[i].time
        const around = (frames: Heard[]) => frames.filter((f) => f.at >= join - 0.06 && f.at <= join + 0.03)
        const quieter = (frames: Heard[]) => Math.min(levelOf(frames, notes[i - 1]), levelOf(frames, notes[i]))
        // Detached, the level drops to a fraction of either note between them; joined, it stays up.
        expect(Math.min(...around(detached).map((f) => f.rms)), `join ${i}`).toBeLessThan(0.3 * quieter(detached))
        expect(Math.min(...around(joined).map((f) => f.rms)), `join ${i}`).toBeGreaterThan(0.6 * quieter(joined))
        // And the next note is reached soon after its written start.
        const settled = within(joined, join + 0.12, join + 0.6)
        expect(Math.abs(median(centsRead(settled, notes[i].midi))), `join ${i}`).toBeLessThanOrEqual(6)
      }
      // Over a leap the pitch takes about 60 ms to move across: the new note is not there at once, and nothing else is read on the way.
      const leap = hear(sing([{ time: 0.3, duration: 0.7, midi: 57 }, { time: 1, duration: 0.7, midi: 64 }], { sampleRate, legato: true }), sampleRate).filter(voiced)
      const arrived = leap.find((f) => f.at > 0.9 && Math.abs(f.midi - 64) <= 0.5)!.at - 1
      expect(arrived).toBeGreaterThan(0.035)
      expect(arrived).toBeLessThan(0.09)
      for (const f of leap.filter((f) => f.at >= 0.9 && f.at <= 1.15)) {
        expect(f.midi, `${f.at.toFixed(3)} s`).toBeGreaterThan(56.5)
        expect(f.midi, `${f.at.toFixed(3)} s`).toBeLessThan(64.5)
      }
      // A rest is still a rest: after the last note the line ends.
      const end = notes[notes.length - 1].time + notes[notes.length - 1].duration
      expect(joined.filter((f) => f.from >= end + 0.05).every((f) => f.rms < 1e-4)).toBe(true)
      // Notes with a real gap between them are not joined.
      const apart: SungNote[] = [
        { time: 0.3, duration: 0.5, midi: 57 },
        { time: 1.3, duration: 0.5, midi: 59 },
      ]
      expect(firstDifference(sing(apart, { sampleRate, legato: true }), sing(apart, { sampleRate }))).toBe(-1)
    }
  })

  it('everything at once: the settings add up instead of getting in each other\'s way', () => {
    for (const sampleRate of RATES) {
      // Written D4 from 0.5 s; sung as one hummed C an octave down, 30 cents flat and going flatter, late, after a
      // consonant, with vibrato, half as loud and a little breathy.
      const options: SingOptions = { sampleRate, monotoneMidi: 60, octave: -1, cents: -30, driftCentsPerSec: -20, lateSec: 0.15, gapSec: 0.1, vibratoCents: 50, vibratoHz: 6, level: 0.05, breath: 0.2, seconds: 3 }
      const frames = hear(sing([{ time: 0.5, duration: 1.5, midi: 62 }], options), sampleRate)
      // The vowel starts 0.25 s after the written start and ends 0.15 s after the written end.
      const sung = frames.filter((f) => voiced(f) && Math.abs(f.midi - 48) < 2)
      expect(Math.abs(sung[0].at - 0.75)).toBeLessThan(0.03)
      expect(Math.abs(sung.at(-1)!.at - 2.15)).toBeLessThan(0.03)
      // Whole swings of the vibrato (six of them a second), so its average is the note: C3, 30 cents flat, and
      // 20 cents flatter for each second since the (late) start. The readings are centred 0.775 s after it.
      const settled = within(frames, 0.65 + 0.4, 0.65 + 0.4 + 0.75)
      const cents = centsRead(settled, 48)
      expect(cents.length).toBe(settled.length)
      const mean = cents.reduce((sum, c) => sum + c, 0) / cents.length
      expect(Math.abs(mean - (-30 - 20 * 0.775))).toBeLessThanOrEqual(6)
      expect((quantile(cents, 0.95) - quantile(cents, 0.05)) / 2).toBeGreaterThan(35)
      expect(median(settled.map((f) => f.rms)) / 0.05).toBeGreaterThan(0.85)
      expect(median(settled.map((f) => f.rms)) / 0.05).toBeLessThan(1.15)
    }
  })

  it('quick notes: eighths at 132 beats a minute are each sung on their own pitch', () => {
    // The fastest thing the course asks for (4.4 notes a second). Joined, detached or with a consonant, every
    // note has to be there for the scorer's shortest rule: 0.08 s in tune.
    const eighth = 60 / 132 / 2
    const notes: SungNote[] = [0, 2, 4, 5, 7, 5, 4, 2, 0, 4, 7, 4].map((offset, i) => ({ time: 0.4 + i * eighth, duration: 0.95 * eighth, midi: 57 + offset }))
    for (const sampleRate of RATES) {
      for (const options of [{}, { legato: true }, { gapSec: 0.06 }] as Array<Partial<SingOptions>>) {
        const frames = hear(sing(notes, { sampleRate, ...options }), sampleRate)
        for (const n of notes) {
          const inTune = frames.filter((f) => f.at >= n.time && f.at <= n.time + n.duration && voiced(f) && Math.abs(f.midi - n.midi) * 100 <= 50)
          // Frames are 512 samples apart.
          expect((inTune.length * 512) / sampleRate, `midi ${n.midi} at ${n.time.toFixed(2)} s, ${JSON.stringify(options)} at ${sampleRate}`).toBeGreaterThanOrEqual(0.08)
        }
      }
    }
  })

  it('a slide: the pitch glides evenly through a note with slideTo', () => {
    for (const sampleRate of RATES) {
      // A sigh down a fifth, then a small siren up an octave.
      for (const [from, to] of [[57, 50], [52, 64]] as const) {
        const frames = hear(sing([{ time: 0.3, duration: 2, midi: from, slideTo: to }], { sampleRate }), sampleRate).filter(voiced)
        const at = (seconds: number) => frames.reduce((best, f) => (Math.abs(f.at - seconds) < Math.abs(best.at - seconds) ? f : best)).midi
        expect(Math.abs(at(0.3 + 0.1) - (from + (to - from) * 0.05))).toBeLessThan(0.3)
        expect(Math.abs(at(0.3 + 1) - (from + to) / 2)).toBeLessThan(0.3)
        expect(Math.abs(at(0.3 + 1.9) - (to - (to - from) * 0.05))).toBeLessThan(0.3)
        // Never back the other way.
        const inside = frames.filter((f) => f.at >= 0.4 && f.at <= 2.2)
        for (let i = 1; i < inside.length; i++) expect((inside[i].midi - inside[i - 1].midi) * Math.sign(to - from)).toBeGreaterThan(-0.15)
      }
    }
  })
})

describe('the proof does not rest on the app\'s own voice', () => {
  it('shares no code with the app: the singer file imports nothing', () => {
    const source = readFileSync(new URL('./virtualSinger.testutil.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\bfrom\s+['"]/)
    expect(source).not.toMatch(/\bimport\s*\(/)
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  it('has the colour of a mouth, which the guide voice has not', () => {
    const sampleRate = 44100
    const notes = [{ time: 0, duration: 1.5, midi: 45 }]
    // First formants: "ah" around 730 Hz, "ee" and "oo" around 300 Hz. The strongest harmonic sits there.
    const strongest = (vowel: 'ah' | 'ee' | 'oo', midi: number) => strongestPartial(sing([{ time: 0, duration: 1.5, midi }], { sampleRate, vowel, breath: 0, jitter: 0 }), sampleRate, midi)
    for (const midi of [45, 52, 57]) {
      expect(strongest('ah', midi), `ah ${midi}`).toBeGreaterThan(550)
      expect(strongest('ah', midi), `ah ${midi}`).toBeLessThan(950)
      for (const vowel of ['ee', 'oo'] as const) {
        expect(strongest(vowel, midi), `${vowel} ${midi}`).toBeGreaterThan(150)
        expect(strongest(vowel, midi), `${vowel} ${midi}`).toBeLessThan(460)
      }
    }
    // The guide voice has no formants: its strongest harmonic is its first or second on every note.
    for (const midi of [45, 52, 57]) expect(strongestPartial(renderVoiceNotes([{ time: 0, duration: 1.5, midi }], { sampleRate }), sampleRate, midi)).toBeLessThanOrEqual(2 * midiToFreq(midi) + 1)
    // "ee" has its second formant above 2 kHz, "oo" below 1 kHz: the same note, another shape of mouth.
    const share = (vowel: 'ah' | 'ee' | 'oo', from: number, to: number) => {
      const take = sing(notes, { sampleRate, vowel, breath: 0, jitter: 0 })
      let inBand = 0
      let all = 0
      for (let h = 1; h * 110 < 4000; h++) {
        const e = partial(take, sampleRate, h * 110, 0.5, 0.5) ** 2
        all += e
        if (h * 110 >= from && h * 110 <= to) inBand += e
      }
      return inBand / all
    }
    expect(share('ee', 1900, 3300)).toBeGreaterThan(5 * share('oo', 1900, 3300))
    expect(share('oo', 600, 1100)).toBeGreaterThan(2 * share('ee', 600, 1100))
    // The folds close softly: like any sung vowel, nearly all of it lies under 1.5 kHz. A bare pulse train would be all top.
    for (const vowel of ['ah', 'ee', 'oo'] as const) expect(share(vowel, 0, 1500), vowel).toBeGreaterThan(0.95)
  })
})

describe('the singer through a phone', () => {
  const chart = (seconds: number) => emptyChart({ duration: seconds, beats: constantBeatGrid(75, 0, seconds), tempos: [{ time: 0, bpm: 75 }] })
  const asCase = (seconds: number): SimCase => ({ name: 'scale', kind: 'skill', chart: chart(seconds), notes: [] })

  it.each([
    ['a low voice', 48],
    ['a high voice', 60],
  ] as const)('%s is still read note for note through a phone microphone in a living room', (_name, home) => {
    for (const sampleRate of RATES) {
      const notes = scale(home)
      const frames = hear(phoneMic(sing(notes, { sampleRate }), sampleRate), sampleRate)
      for (const n of notes) {
        const settled = within(frames, n.time + 0.15, n.time + n.duration - 0.1)
        const cents = settled.filter(voiced).map((f) => folded(f.midi, n.midi))
        expect(cents.length / settled.length, `midi ${n.midi} at ${sampleRate}`).toBeGreaterThanOrEqual(0.9)
        expect(Math.abs(median(cents)), `midi ${n.midi} at ${sampleRate}`).toBeLessThanOrEqual(10)
      }
    }
  })

  it('quiet singing reads less clearly than full singing, because the room does not get quieter', () => {
    for (const sampleRate of RATES) {
      const phrase = scale(55).slice(0, 3)
      const clarity = (level: number) => {
        const frames = hear(phoneMic(sing(phrase, { sampleRate, level }), sampleRate), sampleRate)
        return median(phrase.flatMap((n) => within(frames, n.time + 0.15, n.time + n.duration - 0.1).map((f) => f.clarity)))
      }
      expect(clarity(0.1)).toBeGreaterThan(0.9)
      expect(clarity(0.02)).toBeLessThan(clarity(0.1) - 0.02)
      expect(clarity(0.02)).toBeGreaterThan(clarity(0.005) + 0.1)
    }
  })

  it('goes together with the click track and a late microphone the way the guitar simulations put them together', () => {
    const sampleRate = 48000
    const notes = scale(57)
    const take = sing(notes, { sampleRate, seconds: 8 })
    const click = clickTrack(asCase(8), sampleRate)
    expect(take.length).toBe(click.length)
    // Voice with the click at half its level, 60 ms late, through the phone: the notes are where they were, 60 ms on.
    const frames = hear(phoneMic(delayed(mix(take, click, 0.5), 0.06, sampleRate), sampleRate), sampleRate)
    let read = 0
    let total = 0
    for (const n of notes) {
      const settled = within(frames, n.time + 0.06 + 0.15, n.time + 0.06 + n.duration - 0.1)
      total += settled.length
      read += settled.filter((f) => voiced(f) && Math.abs(folded(f.midi, n.midi)) <= 25).length
    }
    // A kick takes a frame with it here and there; the rest is the voice.
    expect(read / total).toBeGreaterThanOrEqual(0.9)
    expect(total).toBeGreaterThan(300)
  })
})
