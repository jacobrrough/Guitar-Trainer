import { describe, expect, it } from 'vitest'
import { createDemoSong, demoChart, encodeWav } from './demoSong'

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

  it('encodes clipping-safe samples', () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2, -2]))
    expect(blob.size).toBe(44 + 10)
  })
})
