import { describe, expect, it } from 'vitest'
import { normalize, pluck } from '../synth'
import { ChromaAnalyzer, PITCH_CLASSES, chordMatch, chromaSimilarity, chordTemplate } from './chroma'

const SR = 44100
const N = 2048
const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

/** Plucks the given notes together (slight strum offsets) and returns a frame ~120 ms after the attack. */
function frameOf(midis: number[]): Float32Array {
  const buf = new Float32Array(SR)
  midis.forEach((m, i) => pluck(buf, i * 200, midiToFreq(m), 0.8, 0.6, 11 + i * 7, SR))
  normalize(buf)
  const start = Math.round(0.12 * SR)
  return buf.slice(start, start + N)
}

function chromaOf(midis: number[]): Float32Array {
  return new ChromaAnalyzer(N, SR).analyze(frameOf(midis))
}

function argmax(v: Float32Array): number {
  let best = 0
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i
  return best
}

describe('ChromaAnalyzer', () => {
  it('maps a single A2 to pitch class A and suppresses its third harmonic', () => {
    const c = chromaOf([45])
    expect(argmax(c)).toBe(9)
    expect(c[9]).toBe(1)
    expect(c[4]).toBeLessThan(0.8) // E (3rd harmonic)
    expect(chordMatch(c, [45]).ok).toBe(true)
  })

  it('recognises an open E major chord and rejects A minor', () => {
    const c = chromaOf([40, 47, 52, 56, 59, 64])
    expect(chordMatch(c, [40, 47, 52, 56, 59, 64]).ok).toBe(true)
    expect(chordMatch(c, [45, 52, 57, 60, 64]).ok).toBe(false)
  })

  it('prefers G major over E minor for an open G chord', () => {
    const c = chromaOf([43, 47, 50, 55, 59, 67])
    const g = chordMatch(c, [43, 47, 50, 55, 59, 67])
    const em = chordMatch(c, [40, 47, 52, 55, 59, 64])
    expect(g.ok).toBe(true)
    expect(g.similarity).toBeGreaterThan(em.similarity)
  })

  it('accepts a power chord', () => {
    expect(chordMatch(chromaOf([40, 47, 52]), [40, 47, 52]).ok).toBe(true)
  })

  it('recognises a high E major triad on the top strings', () => {
    expect(chordMatch(chromaOf([64, 68, 71]), [64, 68, 71]).ok).toBe(true)
  })

  it('maps a single B4 to pitch class B', () => {
    const c = chromaOf([71])
    expect(argmax(c)).toBe(11)
    expect(chordMatch(c, [71]).ok).toBe(true)
  })

  it('returns zeros for silence', () => {
    const c = new ChromaAnalyzer(N, SR).analyze(new Float32Array(N))
    expect(Array.from(c)).toEqual(new Array(PITCH_CLASSES).fill(0))
    expect(chordMatch(c, [40, 47, 52]).ok).toBe(false)
  })

  it('reuses the output array', () => {
    const analyzer = new ChromaAnalyzer(N, SR)
    const frame = frameOf([40, 47, 52])
    const out = new Float32Array(PITCH_CLASSES)
    for (let i = 0; i < 100; i++) expect(analyzer.analyze(frame, out)).toBe(out)
  })
})

describe('chroma helpers', () => {
  it('builds templates and similarity', () => {
    const t = chordTemplate([40, 52, 47])
    expect(Array.from(t).filter(Boolean).length).toBe(2)
    expect(chromaSimilarity(t, t)).toBeCloseTo(1, 5)
  })
})
