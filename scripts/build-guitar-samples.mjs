/**
 * Builds the app's guitar sample pack from the University of Iowa steel-string guitar recordings as
 * edited and published in https://github.com/nbrosowsky/tonejs-instruments (samples: CC BY 3.0).
 *
 *   node scripts/build-guitar-samples.mjs <path>/tonejs-instruments/samples/guitar-acoustic
 *
 * Every chromatic note D2..D5 is trimmed to its attack, cut where it has died away (4 s at most),
 * faded out, and packed one after another into a single mono MP3 (one request, one decode on the
 * phone). The manifest next to the sampler records where each note starts, how long it is and how
 * far off pitch the recording is, measured on the encoded file. Needs ffmpeg with libmp3lame.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SRC = process.argv[2]
if (!SRC) {
  console.error('usage: node scripts/build-guitar-samples.mjs <samples/guitar-acoustic dir>')
  process.exit(1)
}
const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_AUDIO = path.join(ROOT, 'public/samples/guitar-steel.mp3')
const OUT_MANIFEST = path.join(ROOT, 'src/audio/instrument/guitarSteel.json')
const SR = 44100
/** Bump when the pack changes in any audible way: stored song audio is rendered again. */
const PACK_VERSION = 1
const MAX_SECONDS = 4
const MIN_SECONDS = 1.2
const LEAD_IN = 0.2
const GAP = 0.12
const PRE_ROLL = 0.003
/** The onset is where the signal first reaches this fraction of the note's peak. The app uses the same rule after decoding. */
const ONSET_FRACTION = 0.05
const BITRATE = process.env.BITRATE ?? '96k'
/**
 * Recordings replaced by a neighbour resampled one semitone: the open A string in the source dies
 * away about 11 dB faster in its first second than the notes either side of it.
 */
const SUBSTITUTE = { 45: 46 }

const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B']
const midiOf = (name) => {
  const m = /^([A-G]s?)(\d)$/.exec(name)
  return NAMES.indexOf(m[1]) + 12 * (Number(m[2]) + 1)
}
const freqOf = (midi) => 440 * 2 ** ((midi - 69) / 12)

function readWav(file) {
  const b = readFileSync(file)
  let o = 12
  let fmt = null
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4)
    const size = b.readUInt32LE(o + 4)
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) }
    if (id === 'data') {
      if (!fmt || fmt.bits !== 16 || fmt.rate !== SR) throw new Error(`${file}: expected 16-bit ${SR} Hz`)
      const n = Math.floor(size / 2 / fmt.channels)
      const x = new Float32Array(n)
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + i * 2 * fmt.channels) / 32768
      return x
    }
    o += 8 + size + (size & 1)
  }
  throw new Error(`${file}: no data chunk`)
}

function writeWav(file, x) {
  const b = Buffer.alloc(44 + x.length * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + x.length * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(SR, 24)
  b.writeUInt32LE(SR * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(x.length * 2, 40)
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2)
  writeFileSync(file, b)
}

const peakOf = (x, from = 0, to = x.length) => {
  let p = 0
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

/** First index (from `from`) where |x| reaches `fraction` of the peak of the following 150 ms. */
function onsetIndex(x, from, to, fraction = ONSET_FRACTION) {
  const peak = peakOf(x, from, to)
  for (let i = from; i < to; i++) if (Math.abs(x[i]) >= fraction * peak) return i
  return -1
}

/** Lanczos-8 resampling: `ratio` > 1 lowers the pitch (the output is longer). */
function resample(x, ratio) {
  const A = 8
  const out = new Float32Array(Math.floor(x.length * ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i / ratio
    const base = Math.floor(pos)
    let s = 0
    for (let k = base - A + 1; k <= base + A; k++) {
      if (k < 0 || k >= x.length) continue
      const d = pos - k
      const w = d === 0 ? 1 : (A * Math.sin(Math.PI * d) * Math.sin((Math.PI * d) / A)) / (Math.PI * Math.PI * d * d)
      s += x[k] * w
    }
    out[i] = s
  }
  return out
}

function estimateCents(x, start, midi) {
  const expected = freqOf(midi)
  const len = Math.round(0.3 * SR)
  const from = start + Math.round(0.4 * SR)
  const lo = Math.floor(SR / (expected * 1.06))
  const hi = Math.ceil(SR / (expected / 1.06))
  const r = (lag) => {
    let s = 0
    for (let i = from; i < from + len; i++) s += x[i] * x[i + lag]
    return s
  }
  let best = -Infinity
  let bestLag = lo
  const v = new Map()
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    const val = r(lag)
    v.set(lag, val)
    if (lag >= lo && lag <= hi && val > best) {
      best = val
      bestLag = lag
    }
  }
  const a = v.get(bestLag - 1)
  const c = v.get(bestLag + 1)
  const d = a - 2 * best + c
  const lag = bestLag + (d !== 0 ? (0.5 * (a - c)) / d : 0)
  return 1200 * Math.log2(SR / lag / expected)
}

// ---- 1. Trim each recording
const sources = new Map()
for (const f of readdirSync(SRC).filter((f) => f.endsWith('.wav'))) sources.set(midiOf(f.replace('.wav', '')), readWav(path.join(SRC, f)))
const midis = [...sources.keys()].sort((a, b) => a - b)
for (let m = midis[0]; m <= midis[midis.length - 1]; m++) if (!sources.has(m)) throw new Error(`missing note ${m}`)

const segments = []
for (const midi of midis) {
  let x = sources.get(midi)
  if (SUBSTITUTE[midi]) x = resample(sources.get(SUBSTITUTE[midi]), 2 ** ((SUBSTITUTE[midi] - midi) / 12))
  const onset = onsetIndex(x, 0, Math.min(x.length, Math.round(0.5 * SR)))
  if (onset < 0) throw new Error(`no onset in ${midi}`)
  const begin = Math.max(0, onset - Math.round(PRE_ROLL * SR))
  // End where a 50 ms window has fallen below -60 dBFS, within the limits.
  const win = Math.round(0.05 * SR)
  let end = Math.min(x.length, onset + Math.round(MAX_SECONDS * SR))
  for (let i = onset + Math.round(MIN_SECONDS * SR); i + win < end; i += win) {
    let e = 0
    for (let k = i; k < i + win; k++) e += x[k] * x[k]
    if (Math.sqrt(e / win) < 0.001) {
      end = i + win
      break
    }
  }
  const seg = x.slice(begin, end)
  const fadeIn = Math.min(seg.length, Math.round(0.001 * SR))
  for (let i = 0; i < fadeIn; i++) seg[i] *= i / fadeIn
  const fadeOut = Math.min(seg.length, Math.round(0.25 * SR))
  for (let i = 0; i < fadeOut; i++) seg[seg.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut)
  segments.push({ midi, seg, pre: onset - begin })
}

// ---- 2. Pack
const gap = Math.round(GAP * SR)
const total = Math.round(LEAD_IN * SR) + segments.reduce((n, s) => n + s.seg.length + gap, 0)
const packed = new Float32Array(total)
let at = Math.round(LEAD_IN * SR)
for (const s of segments) {
  packed.set(s.seg, at)
  s.offset = at
  at += s.seg.length + gap
}

// ---- 3. Encode, then measure the encoded file
const tmp = mkdtempSync(path.join(os.tmpdir(), 'guitar-pack-'))
try {
  const wav = path.join(tmp, 'pack.wav')
  const raw = path.join(tmp, 'decoded.raw')
  writeWav(wav, packed)
  mkdirSync(path.dirname(OUT_AUDIO), { recursive: true })
  mkdirSync(path.dirname(OUT_MANIFEST), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', String(SR), '-codec:a', 'libmp3lame', '-b:a', BITRATE, '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', OUT_AUDIO])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT_AUDIO, '-f', 's16le', '-ac', '1', '-ar', String(SR), raw])
  const rawBuf = readFileSync(raw)
  const decoded = new Float32Array(rawBuf.length / 2)
  for (let i = 0; i < decoded.length; i++) decoded[i] = rawBuf.readInt16LE(i * 2) / 32768

  const notes = []
  let worstShift = 0
  for (const s of segments) {
    const expected = s.offset + s.pre
    const from = Math.max(0, expected - Math.round(0.08 * SR))
    const found = onsetIndex(decoded, from, Math.min(decoded.length, expected + Math.round(0.15 * SR)))
    if (found < 0) throw new Error(`note ${s.midi} not found in the encoded file`)
    worstShift = Math.max(worstShift, Math.abs(found - expected))
    const length = s.seg.length - s.pre
    notes.push({
      midi: s.midi,
      start: Number((expected / SR).toFixed(5)),
      length: Number((length / SR).toFixed(5)),
      peak: Number(peakOf(decoded, found, Math.min(decoded.length, found + length)).toFixed(4)),
      cents: Number(estimateCents(decoded, found, s.midi).toFixed(1)),
    })
  }
  const manifest = {
    id: 'guitar-steel',
    version: PACK_VERSION,
    file: 'samples/guitar-steel.mp3',
    sampleRate: SR,
    duration: Number((packed.length / SR).toFixed(3)),
    onsetFraction: ONSET_FRACTION,
    preRoll: PRE_ROLL,
    source: 'University of Iowa Electronic Music Studios, Musical Instrument Samples (steel-string guitar), as edited in nbrosowsky/tonejs-instruments',
    licence: 'CC BY 3.0',
    notes,
  }
  writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 1) + '\n')
  const bytes = statSync(OUT_AUDIO).size
  console.log(`${notes.length} notes, ${manifest.duration} s, ${(bytes / 1024).toFixed(0)} KiB at ${BITRATE}`)
  console.log(`onset shift after encode/decode: up to ${((worstShift / SR) * 1000).toFixed(2)} ms`)
  console.log(`pitch error (cents): ${notes.map((n) => n.cents).join(' ')}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
