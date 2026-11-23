/**
 * Test helper: a virtual singer, the stand-in for a person in every singing simulation.
 *
 * It is built on another model than the app's guide voice, on purpose, and shares no code with it (this
 * file has no dependencies at all; a test keeps it that way). The guide voice adds up fixed harmonics.
 * This one works the way a voice does: the vocal folds give a train of pulses, no two periods quite
 * alike, air leaks through as noise, and the mouth shapes both with the three formants of a vowel. If
 * the scorer only worked on the app's own timbre, the simulations would show it.
 *
 * What it can be told is what a real singer does to a scorer: flat or sharp, another octave, a scoop
 * up to each note, vibrato, late or early, a consonant in front of each note, breathy, quiet, one note
 * for the whole tune, drifting away with time, joined-up singing, a slide.
 *
 * Left alone it sings in tune: through the app's analyser every held frame from C2 to D6, in all three
 * vowels, at 44.1 and 48 kHz, reads within 25 cents of the written note (the median within 2), at a
 * clarity around 0.98. Through the phone microphone model (`phoneMic`) the clarity of its held notes,
 * from the lowest tenth of the frames to the middle one, measured 0.98 to 0.99 at the default level,
 * 0.8 to 0.9 at `level: 0.02`, 0.72 to 0.86 with `breath: 0.4`, and 0.62 to 0.79 with both ("quiet and
 * breathy"). At `level: 0.01` it sinks into the room: a fifth of a higher voice's frames fall under 0.6.
 *
 * Level against the room: the phone model halves the voice and adds room noise at 0.0032. `level: 0.02`
 * therefore arrives at about 0.01, three times the room, and a level gate set at three times the room
 * lets through only 56 to 81 % of its held frames (75 to 98 % with `breath: 0.4`, which adds level).
 * From `level: 0.03` on every held frame clears such a gate.
 *
 * It is a model. Vocal fry, a break into the light voice, subharmonics and children's voices are not
 * in it.
 */

/** A note to sing. A `ChartNote` or a `VoiceCue` is one. */
export interface SungNote {
  /** Seconds. */
  time: number
  duration: number
  midi: number
  /** The pitch glides evenly over the note, starting on `midi` and ending on this (a sigh down, a siren up). */
  slideTo?: number
  /** This note against the take's level: 3 is a note forced out, 0.3 one that barely sounds. Default 1. */
  gain?: number
}

export type Vowel = 'ah' | 'ee' | 'oo'

/** How to sing. An option that is left out, or there but undefined, has its default; one that is not a number is refused. */
export interface SingOptions {
  sampleRate: number
  /** Length of the take. Default: half a second past the last note. */
  seconds?: number
  /** Every note this many cents off: negative is flat. Default 0. */
  cents?: number
  /** Whole octaves away from what is written: -1 is how a low voice sings a high tune. Default 0. */
  octave?: number
  /** Each note starts this many cents under its pitch and slides up to it (negative: starts above and comes down). Default 0. */
  scoopCents?: number
  /** How long the scoop takes. Default 0.15 s. */
  scoopSec?: number
  /** Vibrato: how far the pitch swings either side of the note, in cents. It sets in over the first 0.1 s of a note. Default 0. */
  vibratoCents?: number
  /** Swings a second. Default 5.5. */
  vibratoHz?: number
  /** Every note this much late, start and end alike; negative is early. Default 0. */
  lateSec?: number
  /** A consonant in front of every note: for this long there is breath and no voice, and the vowel is that much shorter. Default 0. */
  gapSec?: number
  /** Breath noise against the voice, as a ratio of their levels: 0.05 is a clear voice, 0.4 a breathy one, above 1 a whisper. Default 0.05. */
  breath?: number
  /** RMS of the held part of the notes, before any microphone. Default 0.1. 0.03 is quiet singing; 0.02 is so quiet that through the phone model it is only three times the room noise. */
  level?: number
  /** Sing this note whatever is written: someone humming one pitch through the tune. */
  monotoneMidi?: number
  /** The pitch slips by this many cents each second from the start of the first note on (negative: going flat). Default 0. */
  driftCentsPerSec?: number
  /** Carry the voice from each note into the next when no more than 0.15 s lies between them, gliding to the new pitch in 60 ms. Ignored with `gapSec`: a consonant stops the voice. Default false. */
  legato?: boolean
  /** Default 'ah', the vowel of "la". */
  vowel?: Vowel
  /** How unlike two periods are: each is up to this fraction longer or shorter than written. Default 0.005. */
  jitter?: number
  /** Another seed is another take of the same singing. Default 1. */
  seed?: number
}

/** Centre and bandwidth in Hz of the first three formants (adult averages after Peterson and Barney, 1952). */
const FORMANTS: Record<Vowel, Array<[centre: number, bandwidth: number]>> = {
  ah: [[730, 90], [1090, 110], [2440, 170]],
  ee: [[270, 60], [2290, 200], [3010, 300]],
  oo: [[300, 70], [870, 100], [2240, 200]],
}

const ATTACK = 0.05
const RELEASE = 0.06
const AIR_FADE = 0.02
/** Legato: the longest silence the voice is carried across, and how long the pitch takes to move. */
const TIE_GAP = 0.15
const GLIDE = 0.06
const VIBRATO_ONSET = 0.1
/** Corner of the glottal low-pass: with the lips' high-pass after it, harmonics above this fall by 6 dB an octave. */
const GLOTTIS_HZ = 200
/** Breath is not hiss to the top of the band: it is rounded off here. */
const AIR_TOP_HZ = 5000
/**
 * How much wider the formants are for breath than for voice. With the folds apart the mouth rings far
 * less. It matters to a pitch detector: noise through the sharp formants of a voiced "ah" was read as a
 * note (clarity up to 0.71) on one frame in eight; four times as wide, never (at most 0.56).
 *
 * "Never" is for breath that is under way. Where a breathy consonant sets in (`gapSec` with `breath` at
 * 0.2 or more) the analysed window holds only its first hundredths of a second, and for "ah" about one
 * consonant in five still gives a frame, at most two in a row, that reads as a note: anywhere from C3
 * to C#6, at a clarity up to 0.84 and a level above the scorer's 0.004. A real "s" or "h" sets in the
 * same way, so that is left in for the scorer to deal with.
 */
const AIR_DAMPING = 4
/** Half-width in samples of the band-limited pulse a glottal closure is written as. */
const PULSE_HALF = 8

interface Sung {
  /** Where the note begins: the consonant, if it has one. */
  start: number
  /** Where the voice begins and ends. */
  on: number
  off: number
  midi: number
  /** Semitones the pitch glides over the note. */
  slide: number
  gain: number
  /** The voice comes over from the note before, or carries on into the next, without stopping. */
  tiedIn: boolean
  tiedOut: boolean
}

type Settings = Required<Omit<SingOptions, 'seconds' | 'monotoneMidi'>> & Pick<SingOptions, 'seconds' | 'monotoneMidi'>

const DEFAULTS: Omit<Settings, 'sampleRate' | 'seconds' | 'monotoneMidi'> = {
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

/**
 * The options with the defaults filled in.
 *
 * The trap this closes: a table of cases written as `sing(notes, { sampleRate, cents: c.cents })`. Where a
 * case has no `cents` the key is there and undefined, and spread over the defaults it would wipe the 0
 * out: every pitch is then not a number, the folds never give a pulse, and the take is silence. A silent
 * take passes every "this must not score" case. So an undefined option is not given, and a number that
 * is not a number is refused out loud.
 */
function settingsOf(options: SingOptions): Settings {
  const given: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`sing: ${name} is not a number`)
    given[name] = value
  }
  const o = { ...DEFAULTS, ...given } as Settings
  if (!(o.sampleRate > 0)) throw new Error('sing: sampleRate has to be given, and above zero')
  if (!Object.hasOwn(FORMANTS, o.vowel)) throw new Error(`sing: there is no vowel '${o.vowel}'`)
  return o
}

/** The notes that can be sung at all, in order of time. One without a time, a pitch or a length is left out, as the guide voice leaves it out. */
function singable(notes: readonly SungNote[]): SungNote[] {
  const sung = notes.filter((n) => Number.isFinite(n.time) && Number.isFinite(n.midi) && Number.isFinite(n.duration) && n.duration > 0)
  for (const n of sung) {
    // Not left out but refused: one such number would turn the whole take into not-numbers on its way through the mouth.
    if (n.gain !== undefined && !Number.isFinite(n.gain)) throw new Error('sing: the gain of a note is not a number')
    if (n.slideTo !== undefined && !Number.isFinite(n.slideTo)) throw new Error('sing: the slideTo of a note is not a number')
  }
  return sung.sort((a, b) => a.time - b.time || a.midi - b.midi)
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
/** 0 to 1 with no slope at either end. */
const ease = (u: number) => 0.5 * (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u))))

/** The notes (in order of time) as this singer sings them: moved by the lateness, the vowel shortened by the consonant, joined where the voice carries over. */
function phrasing(written: readonly SungNote[], o: Settings): Sung[] {
  const sung = written.map((n): Sung => {
    const start = n.time + o.lateSec
    const off = start + n.duration
    return {
      start,
      // However long the consonant, a little of the vowel is left.
      on: Math.min(start + Math.max(0, o.gapSec), off - Math.min(0.03, n.duration / 2)),
      off,
      midi: o.monotoneMidi ?? n.midi,
      slide: o.monotoneMidi === undefined && n.slideTo !== undefined ? n.slideTo - n.midi : 0,
      gain: n.gain ?? 1,
      tiedIn: false,
      tiedOut: false,
    }
  })
  // One voice: a note still sounding when the next one starts ends there (and one that never got to sound is left out).
  for (let i = 0; i + 1 < sung.length; i++) sung[i].off = Math.min(sung[i].off, sung[i + 1].start)
  const heard = sung.filter((s) => s.off > s.on)
  if (o.legato && o.gapSec <= 0) {
    for (let i = 0; i + 1 < heard.length; i++) {
      if (heard[i + 1].start - heard[i].off > TIE_GAP) continue
      heard[i].off = heard[i + 1].start
      heard[i].tiedOut = true
      heard[i + 1].tiedIn = true
    }
  }
  return heard
}

/** Pitch of a note at time `t` as a fractional MIDI number, with everything the singer does to it. `origin` is where the drift starts. */
function pitchAt(s: Sung, t: number, o: Settings, origin: number): number {
  const since = Math.max(0, t - s.on)
  const along = Math.min(1, since / (s.off - s.on))
  const scoop = o.scoopSec > 0 ? -o.scoopCents * Math.max(0, 1 - since / o.scoopSec) : 0
  const vibrato = o.vibratoCents * Math.sin(2 * Math.PI * o.vibratoHz * since) * Math.min(1, since / VIBRATO_ONSET)
  const cents = o.cents + o.driftCentsPerSec * (t - origin) + scoop + vibrato
  return s.midi + s.slide * along + 12 * o.octave + cents / 100
}

/** Adds a glottal closure at a position between samples: a windowed sinc, so the pitch is not rounded to whole samples. */
function addPulse(train: Float32Array, position: number, amp: number): void {
  const centre = Math.floor(position)
  for (let k = Math.max(0, centre - PULSE_HALF + 1); k <= Math.min(train.length - 1, centre + PULSE_HALF); k++) {
    const x = k - position
    const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
    train[k] += amp * sinc * 0.5 * (1 + Math.cos((Math.PI * x) / PULSE_HALF))
  }
}

/** The vocal folds: one pulse per period of `pitch` wherever `voice` is above zero, each period a little off by the jitter. */
function pulseTrain(pitch: Float32Array, voice: Float32Array, sampleRate: number, jitter: number, rand: () => number): Float32Array {
  const train = new Float32Array(pitch.length)
  // A pulse is due the moment the voice starts.
  let phase = 1
  let wobble = 1
  for (let i = 0; i < pitch.length; i++) {
    if (voice[i] <= 0) {
      phase = 1
      continue
    }
    const step = (hz(pitch[i]) / sampleRate) * wobble
    const due = (1 - phase) / step
    if (due < 1) {
      addPulse(train, i + due, voice[i])
      phase += step - 1
      wobble = 1 + jitter * (2 * rand() - 1)
    } else {
      phase += step
    }
  }
  return train
}

/** Values this small are the dying end of a filter: zero them, or a long rest is spent on denormal arithmetic. */
const settle = (v: number) => (Math.abs(v) < 1e-30 ? 0 : v)

function lowPass(x: Float32Array, cornerHz: number, sampleRate: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cornerHz) / sampleRate)
  let y = 0
  for (let i = 0; i < x.length; i++) {
    y = settle(y + a * (x[i] - y))
    x[i] = y
  }
  return x
}

/** A formant: a two-pole resonator that passes low frequencies unchanged and lifts those around its centre. */
function resonate(x: Float32Array, centreHz: number, bandwidthHz: number, sampleRate: number): Float32Array {
  const c = -Math.exp((-2 * Math.PI * bandwidthHz) / sampleRate)
  const b = 2 * Math.exp((-Math.PI * bandwidthHz) / sampleRate) * Math.cos((2 * Math.PI * centreHz) / sampleRate)
  const a = 1 - b - c
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = settle(a * x[i] + b * y1 + c * y2)
    y2 = y1
    y1 = y
    x[i] = y
  }
  return x
}

/**
 * The mouth: the vowel's formants one after the other (each `damping` times as wide), then the lips,
 * which let more through the higher the frequency. In place.
 */
function mouth(x: Float32Array, vowel: Vowel, sampleRate: number, damping = 1): Float32Array {
  for (const [centre, bandwidth] of FORMANTS[vowel]) resonate(x, centre, bandwidth * damping, sampleRate)
  let before = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    x[i] = v - before
    before = v
  }
  return x
}

/**
 * Sings the notes. Deterministic: the same notes, options and seed give the same samples.
 * One voice: a note still sounding when the next one starts ends there.
 */
export function sing(notes: readonly SungNote[], options: SingOptions): Float32Array {
  const o = settingsOf(options)
  const sampleRate = o.sampleRate
  const written = singable(notes)
  const lastEnd = written.reduce((m, n) => Math.max(m, n.time + n.duration), 0)
  const length = o.seconds === undefined ? Math.ceil((lastEnd + Math.max(0, o.lateSec) + 0.5) * sampleRate) : Math.round(o.seconds * sampleRate)
  const out = new Float32Array(Math.max(0, length))
  const sung = phrasing(written, o)
  if (sung.length === 0 || out.length === 0) return out

  // Three tracks, a value per sample: the pitch, how hard the folds are driven, how much air comes with it.
  const pitch = new Float32Array(out.length)
  const voice = new Float32Array(out.length)
  const air = new Float32Array(out.length)
  // Where a note is fully held, its own gain: the level of the take is measured there.
  const held = new Float32Array(out.length)
  const origin = sung[0].start
  const index = (seconds: number) => Math.min(out.length, Math.max(0, Math.ceil(seconds * sampleRate)))
  sung.forEach((s, k) => {
    const seconds = s.off - s.on
    const attack = Math.min(ATTACK, 0.4 * seconds)
    const release = Math.min(RELEASE, 0.4 * seconds)
    // A joined note starts where the one before it was, and moves over.
    const comesFrom = s.tiedIn ? pitchAt(sung[k - 1], s.on, o, origin) - pitchAt(s, s.on, o, origin) : 0
    for (let i = index(s.on); i < index(s.off); i++) {
      const t = i / sampleRate
      const shape = (s.tiedIn ? 1 : ease((t - s.on) / attack)) * (s.tiedOut ? 1 : ease((s.off - t) / release))
      pitch[i] = pitchAt(s, t, o, origin) + comesFrom * (1 - ease((t - s.on) / GLIDE))
      voice[i] = shape * s.gain
      held[i] = shape >= 0.9 ? s.gain : 0
    }
    for (let i = index(s.start); i < index(s.off); i++) {
      const t = i / sampleRate
      air[i] = (s.tiedIn ? 1 : ease((t - s.start) / AIR_FADE)) * (s.tiedOut ? 1 : ease((s.off - t) / AIR_FADE)) * s.gain
    }
  })

  const folds = pulseTrain(pitch, voice, sampleRate, o.jitter, lcg(o.seed))
  const tone = mouth(lowPass(lowPass(folds, GLOTTIS_HZ, sampleRate), GLOTTIS_HZ, sampleRate), o.vowel, sampleRate)
  let energy = 0
  let count = 0
  for (let i = 0; i < out.length; i++) {
    if (held[i] <= 0) continue
    const v = tone[i] / held[i]
    energy += v * v
    count++
  }
  const toneRms = count > 0 ? Math.sqrt(energy / count) : 0
  if (toneRms <= 0) return out
  const scale = o.level / toneRms
  for (let i = 0; i < out.length; i++) out[i] = scale * tone[i]
  if (o.breath <= 0) return out

  // The breath takes the same way out through the mouth, and is set against the voice by level.
  const noise = lcg(o.seed + 7919)
  const hiss = new Float32Array(out.length)
  for (let i = 0; i < out.length; i++) hiss[i] = (2 * noise() - 1) * air[i]
  mouth(lowPass(lowPass(hiss, AIR_TOP_HZ, sampleRate), AIR_TOP_HZ, sampleRate), o.vowel, sampleRate, AIR_DAMPING)
  let hissEnergy = 0
  for (let i = 0; i < out.length; i++) {
    if (held[i] <= 0) continue
    const v = hiss[i] / held[i]
    hissEnergy += v * v
  }
  const hissRms = Math.sqrt(hissEnergy / count)
  if (hissRms <= 0) return out
  const hissScale = (o.breath * o.level) / hissRms
  for (let i = 0; i < out.length; i++) out[i] += hissScale * hiss[i]
  return out
}
