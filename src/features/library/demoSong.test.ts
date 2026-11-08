import { describe, expect, it } from 'vitest'
import { createDemoSong, demoChart, encodeWav, renderDemoAudio, renderDemoBacking } from './demoSong'

describe('demo song', () => {
  it('builds a consistent chart', () => {
    const chart = demoChart()
    expect(chart.notes.length).toBeGreaterThan(20)
    expect(chart.notes.every((n) => chart.tuning[n.string] + n.fret === n.midi)).toBe(true)
    for (let i = 1; i < chart.notes.length; i++) expect(chart.notes[i].time).toBeGreaterThanOrEqual(chart.notes[i - 1].time)
    expect(chart.beats[0].isDownbeat).toBe(true)
    expect(chart.notes.at(-1)!.time + chart.notes.at(-1)!.duration).toBeLessThan(chart.duration)
  })

  it('renders a valid 16-bit WAV', async () => {
    const song = createDemoSong()
    expect(song.audioType).toBe('audio/wav')
    const buf = new Uint8Array(await song.audio.arrayBuffer())
    expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...buf.slice(8, 12))).toBe('WAVE')
    const view = new DataView(buf.buffer)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16)
    expect(buf.length).toBe(44 + view.getUint32(40, true))
    expect(song.duration).toBeGreaterThan(20)
  })

  it('renders a drums-only backing of the same length as the riff', () => {
    const full = renderDemoAudio()
    const backing = renderDemoBacking()
    expect(backing.length).toBe(full.length)
    // Mid-way through a held riff note the backing is near silent while the full mix rings.
    const at = Math.round(10.9 * 44100)
    let eFull = 0
    let eBacking = 0
    for (let i = at; i < at + 2048; i++) {
      eFull += full[i] * full[i]
      eBacking += backing[i] * backing[i]
    }
    expect(eBacking).toBeLessThan(eFull * 0.05)
  })

  it('encodes clipping-safe samples', () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2, -2]))
    expect(blob.size).toBe(44 + 10)
  })
})
