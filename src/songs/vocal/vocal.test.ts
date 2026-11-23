import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderChartVoiced } from '../../audio/guitar'
import { encodeWav, renderDrums, SYNTH_SAMPLE_RATE } from '../../audio/synth'
import { renderVoiceNotes, VOICE_SYNTH_VERSION } from '../../audio/voice'
import type { Chart, ChartNote, VoiceCue } from '../../chart/types'
import { db } from '../../db/db'
import { DEFAULT_RANGES } from '../../music/keys'
import { BUILT_IN_SONGS } from '../index'
import { accompanimentChart, arrange, songKey, vocalRevision } from './arrange'
import { VOCAL_SONGS, vocalSong } from './index'
import { installVocalSongs, vocalSongRecord } from './install'
import { levelDurations, VOICE_LEVELS } from './levels'
import { renderGuideTrack, renderGuideVoice, renderScoredTrack, vocalRun, vocalRunFor } from './render'
import type { Degree, VocalSong, VocalStep } from './types'

// The chord stem is the real one (the string model, as in any test without the recordings), but a test
// can make the job fail or answer at once.
vi.mock('../../audio/guitar', async (original) => {
  const actual = await original<typeof import('../../audio/guitar')>()
  return { ...actual, renderChartVoiced: vi.fn(actual.renderChartVoiced) }
})

const LEVELS = [0, 1, 2, 3, 4, 5]
/** Every key: the tune moved by up to six semitones either way from where it is written. */
const SHIFTS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
/** Times are sums of beats: two ways of adding them up may differ by a rounding error, never by this much. */
const EPS = 1e-6

const song = (id: string): VocalSong => {
  const found = vocalSong(id)
  if (!found) throw new Error(`${id} is not a song to sing`)
  return found
}
const beat = (s: VocalSong): number => 60 / s.bpm
const bar = (s: VocalSong): number => s.beatsPerBar * beat(s)
const isSung = (step: VocalStep): boolean => step[0] !== null
const sungSteps = (s: VocalSong): VocalStep[] => s.lines.flat().filter(isSung)
const endOf = (n: { time: number; duration: number }): number => n.time + n.duration
const us = (seconds: number): number => Math.round(seconds * 1e6)
/** Position of a time in beats from the start of the chart, to a thousandth. */
const beatAt = (s: VocalSong, time: number): number => Math.round((time / beat(s)) * 1000) / 1000
const cuesOf = (chart: Chart): VoiceCue[] => chart.voice?.cues ?? []
/** The guide's turns: every cue but the starting note in the intro. */
const callsOf = (chart: Chart): VoiceCue[] => cuesOf(chart).slice(1)

/** The scored notes line by line, split where the chart says a line starts. */
function linesOf(chart: Chart): ChartNote[][] {
  const starts = chart.voice?.lineStarts ?? []
  return starts.map((start, i) => chart.notes.filter((n) => n.time >= start - EPS && (i + 1 >= starts.length || n.time < starts[i + 1] - EPS)))
}

/** What is sung on beat 1 of every bar of a chart: the syllable of the note that starts there, or a dot. */
function downbeatWords(s: VocalSong, chart: Chart): string[] {
  const bars = Math.round((chart.duration - 1) / bar(s))
  return Array.from({ length: bars }, (_, b) => chart.notes.find((n) => Math.abs(n.time - b * bar(s)) < EPS)?.lyric ?? '.')
}

describe('the list of songs to sing', () => {
  it('is its own list: ten songs whose ids start with sing- and are never the id of a guitar song', () => {
    expect(VOCAL_SONGS).toHaveLength(10)
    const guitar = new Set(BUILT_IN_SONGS.map((b) => b.id))
    for (const s of VOCAL_SONGS) {
      expect(s.id.startsWith('sing-'), s.id).toBe(true)
      expect(guitar.has(s.id), s.id).toBe(false)
      expect(vocalSong(s.id)).toBe(s)
    }
    expect(new Set(VOCAL_SONGS.map((s) => s.id)).size).toBe(10)
    expect(vocalSong('ode-to-joy')).toBeUndefined()
    expect(vocalSong('constructor')).toBeUndefined()
  })

  it('every song says who wrote it', () => {
    for (const s of VOCAL_SONGS) expect(s.credit.trim().length, s.id).toBeGreaterThan(0)
  })

  it('songs for after the course are level 10, course songs come earlier', () => {
    const after = VOCAL_SONGS.filter((s) => s.lessonLevel >= 10).map((s) => s.id)
    expect(after).toEqual(['sing-amazing-grace', 'sing-happy-birthday'])
    for (const s of VOCAL_SONGS) expect(s.lessonLevel === 10 || (s.lessonLevel >= 1 && s.lessonLevel <= 9), s.id).toBe(true)
  })
})

/** Highest note minus lowest note of each song, in semitones, as the design lists them. */
const SPAN: Record<string, number> = {
  'sing-hot-cross-buns': 4,
  'sing-mary-lamb': 7,
  'sing-ode-to-joy': 7,
  'sing-aunt-rhody': 7,
  'sing-saints': 7,
  'sing-london-bridge': 9,
  'sing-jingle-bells': 7,
  'sing-twinkle': 9,
  'sing-amazing-grace': 12,
  'sing-happy-birthday': 12,
}

/**
 * Where the tune lies against the bar lines once it is arranged: the syllable that starts on beat 1 of
 * every bar of the whole-tune form, the bars before the tune included (a dot = no note starts there).
 * Written by hand from the songs as they are sung, so a line that is placed a beat out shows here.
 */
const ON_THE_BAR_LINE: Record<string, string> = {
  'sing-hot-cross-buns': '. Hot Hot One hot',
  'sing-mary-lamb': '. Ma- lit- lit- lit- Ma- lit- fleece snow',
  'sing-ode-to-joy': ". Joy- we God Lord Hearts flow'rs Op'- sun",
  'sing-aunt-rhody': '. Go Rho- go Rho- go Rho- old dead',
  // Two bars before the tune: "Oh when the" needs three beats of the second one.
  'sing-saints': '. . saints . in . saints march- in . want be that ber saints march- in .',
  'sing-london-bridge': '. Lon- fall- fall- fall- Lon- fall- my la-',
  'sing-jingle-bells': '. Jin- jin- jin- way Oh is one- sleigh Jin- jin- jin- way Oh is one- sleigh',
  'sing-twinkle': '. Twin- lit- How what Up world Like in Twin- lit- How what',
  'sing-amazing-grace': '. ma- grace sweet sound saved wretch me . once lost now found blind now see .',
  'sing-happy-birthday': '. birth- you birth- you birth- friend birth- you',
}

/** The lessons of the singing course sing these, and offer three of them as the song to work towards. */
const SUNG_IN_THE_COURSE = ['sing-hot-cross-buns', 'sing-mary-lamb', 'sing-ode-to-joy', 'sing-saints']

describe.each(VOCAL_SONGS.map((s) => [s.id, s] as const))('%s as a whole tune', (id, s) => {
  const chart = arrange(s, { shift: 0, level: 2 })

  it('covers the span the design lists, and says so on the chart', () => {
    const midis = chart.notes.map((n) => n.midi)
    expect(Math.max(...midis) - Math.min(...midis)).toBe(SPAN[id])
    expect(chart.voice?.low).toBe(Math.min(...midis))
    expect(chart.voice?.high).toBe(Math.max(...midis))
  })

  it('has every sung note of the tune, in order, on its written pitch and with its syllable', () => {
    const steps = sungSteps(s)
    expect(chart.notes.map((n) => n.midi)).toEqual(steps.map((step) => 60 + (step[0] as number)))
    expect(chart.notes.map((n) => n.lyric)).toEqual(steps.map((step) => step[2]))
    for (const n of chart.notes) expect(typeof n.lyric, `note ${n.id}`).toBe('string')
  })

  it('puts every line where the tune has it against the bar lines, the pickup at the end of the bars before', () => {
    expect(downbeatWords(s, chart).join(' ')).toBe(ON_THE_BAR_LINE[id])
  })

  it('is as long as the bars before the tune plus one bar for every chord', () => {
    const introBars = id === 'sing-saints' ? 2 : 1
    expect(us(chart.duration - 1)).toBe(us((introBars + s.chords.length) * bar(s)))
  })

  it('keeps every note its written length, except the last note of a line, which makes room for a breath', () => {
    const written = sungSteps(s).map((step) => step[1] * beat(s))
    const lastOfLine = new Set(linesOf(chart).map((line) => line[line.length - 1].id))
    chart.notes.forEach((n, i) => {
      if (lastOfLine.has(n.id)) {
        expect(n.duration, `note ${i}`).toBeLessThanOrEqual(written[i] + EPS)
        // Never cut to nothing: a quarter of a second of it is left at the very least.
        expect(n.duration, `note ${i}`).toBeGreaterThanOrEqual(0.25)
      } else {
        expect(us(n.duration), `note ${i}`).toBe(us(written[i]))
      }
    })
  })

  it('cuts the last note of a line by 0.4 s for the breath, unless a rest is written there or the tune ends with it', () => {
    const lines = linesOf(chart)
    s.lines.forEach((steps, i) => {
      const lastSung = steps.findLastIndex(isSung)
      const written = steps[lastSung][1] * beat(s)
      const restWritten = steps.slice(lastSung + 1).reduce((sum, step) => sum + step[1], 0) * beat(s)
      const whole = i === s.lines.length - 1 || restWritten >= 0.4
      expect(us(lines[i][lines[i].length - 1].duration), `line ${i}`).toBe(us(whole ? written : written - 0.4))
    })
  })

  it('names one chord for every bar of the tune, and the accompaniment strums that chord in that bar', () => {
    const introBars = id === 'sing-saints' ? 2 : 1
    const strums = accompanimentChart(s, 0, 2)
    const perBar: string[][] = []
    for (const n of strums.notes) {
      const b = Math.floor(n.time / bar(s) + EPS)
      perBar[b] = [...new Set([...(perBar[b] ?? []), n.chordName ?? '?'])]
    }
    expect(perBar).toHaveLength(introBars + s.chords.length)
    // In C the shapes are the chords of a lead sheet in C. The bars before the tune are not strummed.
    const inC: Record<Degree, string> = { I: 'C', IV: 'F', V: 'G', V7: 'G7', vi: 'Am', ii: 'Dm' }
    expect(Array.from(perBar, (names) => (names ?? []).join('+'))).toEqual([...Array.from({ length: introBars }, () => ''), ...s.chords.map((d) => inC[d])])
  })
})

describe('the songs the course sings', () => {
  it('span seven semitones or less', () => {
    for (const id of SUNG_IN_THE_COURSE) expect(SPAN[id], id).toBeLessThanOrEqual(7)
  })

  it('fit both starting ranges and every range of eight notes, edges included', () => {
    const ranges = [DEFAULT_RANGES.lower, DEFAULT_RANGES.higher, ...Array.from({ length: 37 }, (_, i) => ({ low: 36 + i, high: 43 + i }))]
    for (const id of SUNG_IN_THE_COURSE) {
      for (const range of ranges) {
        const key = songKey(song(id), range)
        expect(key.fits, `${id} in ${range.low}-${range.high}`).toBe(true)
        for (const n of arrange(song(id), { shift: key.shift, level: 2 }).notes) {
          expect(n.midi, `${id} in ${range.low}-${range.high}`).toBeGreaterThanOrEqual(range.low)
          expect(n.midi, `${id} in ${range.low}-${range.high}`).toBeLessThanOrEqual(range.high)
        }
      }
    }
  })
})

describe('the key of a song', () => {
  it('is the written key when no range is known yet', () => {
    expect(songKey(song('sing-ode-to-joy'))).toEqual({ shift: 0, fits: true })
  })

  it('keeps every note of every song that fits inside the range, and says so when a song is too wide', () => {
    const ranges = [DEFAULT_RANGES.lower, DEFAULT_RANGES.higher, { low: 45, high: 57 }, { low: 55, high: 69 }, { low: 41, high: 50 }]
    for (const s of VOCAL_SONGS) {
      for (const range of ranges) {
        const key = songKey(s, range)
        expect(key.fits, `${s.id} in ${range.low}-${range.high}`).toBe(SPAN[s.id] <= range.high - range.low)
        if (!key.fits) continue
        const voice = arrange(s, { shift: key.shift, level: 0 }).voice
        expect(voice?.low).toBeGreaterThanOrEqual(range.low)
        expect(voice?.high).toBeLessThanOrEqual(range.high)
      }
    }
  })

  it('moves with "Lower" and "Higher", but never out of the range', () => {
    const s = song('sing-hot-cross-buns')
    const range = { low: 48, high: 60 }
    const chosen = songKey(s, range).shift
    expect(songKey(s, range, -1).shift).toBe(chosen - 1)
    expect(songKey(s, range, 2).shift).toBe(chosen + 2)
    for (const nudge of [-3, 3]) {
      const voice = arrange(s, { shift: songKey(s, range, nudge).shift, level: 2 }).voice
      expect(voice?.low).toBeGreaterThanOrEqual(range.low)
      expect(voice?.high).toBeLessThanOrEqual(range.high)
    }
  })
})

describe('the six levels', () => {
  it('are the ones of the design: strictness rises and help is withdrawn, the speed never changes', () => {
    expect(VOICE_LEVELS).toHaveLength(6)
    expect(VOICE_LEVELS.map((l) => l.name)).toEqual(['Echo each line', 'Echo two lines', 'Whole tune', 'In tune', 'Hold the long notes', 'Performance'])
    expect(VOICE_LEVELS.map((l) => l.judge.band)).toEqual([80, 80, 65, 50, 50, 35])
    expect(VOICE_LEVELS.map((l) => l.judge.minShare)).toEqual([0.5, 0.5, 0.5, 0.5, 0.6, 0.6])
    expect(VOICE_LEVELS.map((l) => !!l.judge.sustain)).toEqual([false, false, false, false, true, true])
    expect(VOICE_LEVELS.map((l) => l.echo)).toEqual([1, 2, 0, 0, 0, 0])
    expect(VOICE_LEVELS.map((l) => l.shown)).toEqual(['la', 'la', 'words', 'words', 'words', 'words'])
    expect(VOICE_LEVELS.map((l) => l.doubled)).toEqual([true, true, true, true, false, false])
  })

  it('are described in plain, kind words', () => {
    const unkind = /\b(wrong|failed?|tone deaf|louder|push|belt|cents?|rating|accuracy|bpm)\b/i
    for (const l of VOICE_LEVELS) {
      expect(l.about.length, l.name).toBeGreaterThan(10)
      expect(l.about.length, l.name).toBeLessThan(90)
      expect(unkind.test(`${l.name} ${l.about}`), l.name).toBe(false)
    }
  })

  it('a level outside 0 to 5 is read as the nearest one, not as a crash in the middle of a page', () => {
    const s = song('sing-hot-cross-buns')
    expect(arrange(s, { shift: 0, level: -1 })).toEqual(arrange(s, { shift: 0, level: 0 }))
    expect(arrange(s, { shift: 0, level: 9 })).toEqual(arrange(s, { shift: 0, level: 5 }))
    expect(arrange(s, { shift: 0, level: Number.NaN })).toEqual(arrange(s, { shift: 0, level: 0 }))
  })
})

describe.each(VOCAL_SONGS.map((s) => [s.id, s] as const))('%s at every level', (id, s) => {
  const charts = LEVELS.map((level) => arrange(s, { shift: 0, level }))

  it('scores the same notes on all six', () => {
    const scored = (chart: Chart) => chart.notes.map((n) => [n.midi, us(n.duration)])
    for (const chart of charts) {
      expect(chart.notes).toHaveLength(sungSteps(s).length)
      expect(scored(chart)).toEqual(scored(charts[2]))
    }
  })

  it('carries the judging of its level', () => {
    charts.forEach((chart, level) => expect(chart.voice?.judge).toEqual(VOICE_LEVELS[level].judge))
  })

  it('shows "la" on the echo levels and the words from then on, and marks a syllable that is carried on', () => {
    const words = sungSteps(s).map((step) => step[2])
    charts.forEach((chart, level) => {
      const shown = chart.notes.map((n) => n.lyric)
      if (level <= 1) expect(shown).toEqual(words.map((w) => (w === '' ? '' : 'la')))
      else expect(shown).toEqual(words)
      // A carried syllable belongs to the note before it: it never opens a line.
      for (const line of linesOf(chart)) expect(line[0].lyric, `level ${level}`).not.toBe('')
    })
  })

  it('marks where every line starts', () => {
    charts.forEach((chart, level) => {
      const starts = chart.voice?.lineStarts ?? []
      expect(starts, `level ${level}`).toHaveLength(s.lines.length)
      const lines = linesOf(chart)
      expect(lines.map((line) => line.length), `level ${level}`).toEqual(s.lines.map((line) => line.filter(isSung).length))
      starts.forEach((start, i) => {
        expect(Math.abs(lines[i][0].time - start), `level ${level} line ${i}`).toBeLessThan(EPS)
        if (i > 0) expect(start).toBeGreaterThan(starts[i - 1])
      })
    })
  })

  it('opens with the starting note, then at least one silent beat', () => {
    charts.forEach((chart, level) => {
      const [first] = cuesOf(chart)
      expect(first.time, `level ${level}`).toBe(0)
      expect(first.midi, `level ${level}`).toBe(chart.notes[0].midi)
      expect(first.duration, `level ${level}`).toBeGreaterThanOrEqual(beat(s) - EPS)
      expect(first.duration, `level ${level}`).toBeLessThanOrEqual(2 * beat(s) + EPS)
      const next = Math.min(chart.notes[0].time, ...callsOf(chart).map((c) => c.time))
      expect(next - endOf(first), `level ${level}`).toBeGreaterThanOrEqual(beat(s) - EPS)
      // The tune starts in the bars before it only as far as its pickup reaches back.
      expect(us(next), `level ${level}`).toBe(us(charts[2].notes[0].time))
    })
  })

  it('never sounds a call over a note that is scored', () => {
    charts.forEach((chart, level) => {
      for (const cue of cuesOf(chart)) {
        for (const n of chart.notes) {
          const apart = endOf(cue) <= n.time + EPS || endOf(n) <= cue.time + EPS
          expect(apart, `level ${level}: cue at ${cue.time} over note ${n.id}`).toBe(true)
        }
      }
    })
  })

  it('leaves at least a beat between the end of anything the app sounds and the next scored note', () => {
    charts.forEach((chart, level) => {
      for (const cue of cuesOf(chart)) {
        const next = chart.notes.find((n) => n.time >= cue.time - EPS)
        if (next) expect(next.time - endOf(cue), `level ${level}: cue at ${cue.time}`).toBeGreaterThanOrEqual(beat(s) - EPS)
      }
    })
  })

  it('follows every line with at least 0.4 s in which nothing has to be sung', () => {
    charts.forEach((chart, level) => {
      const lines = linesOf(chart)
      lines.forEach((line, i) => {
        const last = line[line.length - 1]
        const nextNote = lines[i + 1]?.[0].time ?? chart.duration
        const nextCue = cuesOf(chart).find((c) => c.time >= last.time)?.time ?? chart.duration
        expect(Math.min(nextNote, nextCue) - endOf(last), `level ${level} line ${i}`).toBeGreaterThanOrEqual(0.4 - EPS)
      })
    })
  })

  it('asks for no line longer than ten seconds, and for no note shorter than a quarter of a second', () => {
    for (const chart of charts) {
      for (const line of linesOf(chart)) expect(endOf(line[line.length - 1]) - line[0].time).toBeLessThanOrEqual(10)
      for (const n of chart.notes) expect(n.duration).toBeGreaterThanOrEqual(0.25)
    }
  })

  it('is a chart the rest of the app can read: one note at a time, in order, on the grid', () => {
    charts.forEach((chart, level) => {
      expect(chart.version).toBe(1)
      expect(chart.title).toBe(s.title)
      expect(chart.artist).toBe(s.credit)
      expect(chart.source).toBe('builtin')
      expect(chart.tuning).toEqual([40, 45, 50, 55, 59, 64])
      expect(chart.capo).toBe(0)
      expect(chart.tempos).toEqual([{ time: 0, bpm: s.bpm }])
      expect(chart.timeSignatures).toEqual([{ time: 0, numerator: s.beatsPerBar, denominator: 4 }])
      chart.notes.forEach((n, i) => {
        expect(n.id).toBe(i)
        expect(n.string).toBe(0)
        expect(n.fret).toBe(0)
        expect(n.velocity).toBeGreaterThan(0)
        expect(endOf(n)).toBeLessThanOrEqual(chart.duration)
        if (i > 0) expect(n.time, `level ${level} note ${i}`).toBeGreaterThanOrEqual(endOf(chart.notes[i - 1]) - EPS)
      })
      expect(new Set(chart.notes.map((n) => n.chordId)).size).toBe(chart.notes.length)
      // A click on every beat from the first to the end, bar numbers counted from the bars before the tune.
      chart.beats.forEach((b, i) => {
        expect(us(b.time)).toBe(us(i * beat(s)))
        expect(b.bar).toBe(Math.floor(i / s.beatsPerBar))
        expect(b.beatInBar).toBe(i % s.beatsPerBar)
        expect(b.isDownbeat).toBe(i % s.beatsPerBar === 0)
      })
      expect(chart.beats.length).toBe(Math.ceil(chart.duration / beat(s) - EPS))
      // The chart ends on a bar line, with a second for the last note to settle.
      expect(Math.abs((chart.duration - 1) / bar(s) - Math.round((chart.duration - 1) / bar(s)))).toBeLessThan(EPS)
    })
  })

  it('has an accompaniment on the same beats and of the same length', () => {
    charts.forEach((chart, level) => {
      const strums = accompanimentChart(s, 0, level)
      expect(strums.beats, `level ${level}`).toEqual(chart.beats)
      expect(strums.duration, `level ${level}`).toBe(chart.duration)
      expect(strums.tempos).toEqual(chart.tempos)
      expect(strums.timeSignatures).toEqual(chart.timeSignatures)
      expect(strums.voice, 'the strums are not sung').toBeUndefined()
      for (const n of strums.notes) expect(endOf(n)).toBeLessThanOrEqual(chart.duration)
    })
  })

  it('lasts as long as the level list says', () => {
    const seconds = levelDurations(s)
    expect(seconds).toHaveLength(6)
    charts.forEach((chart, level) => expect(seconds[level], `level ${level}`).toBe(chart.duration))
    // The whole-tune levels are one length; an echo level lasts about twice as long.
    expect(new Set(seconds.slice(2)).size).toBe(1)
    for (const level of [0, 1]) {
      expect(seconds[level] / seconds[2], `level ${level}`).toBeGreaterThan(1.5)
      expect(seconds[level] / seconds[2], `level ${level}`).toBeLessThan(2.5)
    }
  })

  it('builds the same chart every time and leaves the tune as it was', () => {
    const before = JSON.stringify(s)
    for (const level of LEVELS) expect(arrange(s, { shift: 0, level })).toEqual(charts[level])
    expect(JSON.stringify(s)).toBe(before)
  })

  describe('in every key', () => {
    it('moves every note and cue by the same number of semitones and nothing else', () => {
      for (const shift of SHIFTS) {
        for (const level of [0, 2]) {
          const moved = arrange(s, { shift, level })
          const home = charts[level]
          expect(moved.notes.map((n) => n.midi)).toEqual(home.notes.map((n) => n.midi + shift))
          expect(cuesOf(moved).map((c) => c.midi)).toEqual(cuesOf(home).map((c) => c.midi + shift))
          expect(moved.notes.map((n) => [us(n.time), us(n.duration), n.lyric])).toEqual(home.notes.map((n) => [us(n.time), us(n.duration), n.lyric]))
          expect(moved.voice?.shift).toBe(shift)
          expect(moved.voice?.tonic).toBe(60 + shift)
          expect(moved.voice?.lineStarts).toEqual(home.voice?.lineStarts)
          expect(moved.beats).toEqual(home.beats)
          // Lanes and detector are set from these: every note and cue lies inside them, edges included.
          const all = [...moved.notes.map((n) => n.midi), ...cuesOf(moved).map((c) => c.midi)]
          expect(moved.voice?.low).toBe(Math.min(...all))
          expect(moved.voice?.high).toBe(Math.max(...all))
        }
      }
    })

    it('the accompaniment plays the chord of every bar in the key of the tune, on open shapes with a capo no higher than fret 2', () => {
      const tones: Record<Degree, number[]> = { I: [0, 4, 7], IV: [5, 9, 0], V: [7, 11, 2], V7: [7, 11, 2, 5], vi: [9, 0, 4], ii: [2, 5, 9] }
      const introBars = id === 'sing-saints' ? 2 : 1
      const capos = new Set<number>()
      for (const shift of SHIFTS) {
        const strums = accompanimentChart(s, shift, 2)
        capos.add(strums.capo)
        expect([0, 1, 2]).toContain(strums.capo)
        const heard: Set<number>[] = []
        for (const n of strums.notes) {
          expect(n.midi, `shift ${shift}`).toBeGreaterThanOrEqual(40)
          expect(n.midi, `shift ${shift}`).toBeLessThanOrEqual(74)
          expect(n.midi).toBe(strums.tuning[n.string] + n.fret + strums.capo)
          const b = Math.floor(n.time / bar(s) + EPS)
          heard[b] = (heard[b] ?? new Set()).add((((n.midi - 60 - shift) % 12) + 12) % 12)
        }
        expect(heard).toHaveLength(introBars + s.chords.length)
        s.chords.forEach((degree, i) => {
          const b = introBars + i
          expect([...heard[b]].sort((x, y) => x - y), `shift ${shift} bar ${b} (${degree})`).toEqual([...tones[degree]].sort((x, y) => x - y))
        })
        for (let b = 0; b < introBars; b++) expect(heard[b], `shift ${shift}: the bars before the tune`).toBeUndefined()
      }
      expect([...capos].sort()).toEqual([0, 1, 2])
    })

    it('strums on beat 1, and on beat 3 as well when there are four beats in the bar', () => {
      const strums = accompanimentChart(s, 0, 2)
      const beatsUsed = [...new Set(strums.notes.map((n) => beatAt(s, n.time) % s.beatsPerBar))].sort()
      expect(beatsUsed).toEqual(s.beatsPerBar === 4 ? [0, 2] : [0])
      // One strum is one chord: the strings struck together share an id, and no other strum has it.
      const timesOfStrum = new Map<number, Set<number>>()
      const strumsAtTime = new Map<number, Set<number>>()
      for (const n of strums.notes) {
        timesOfStrum.set(n.chordId, (timesOfStrum.get(n.chordId) ?? new Set()).add(us(n.time)))
        strumsAtTime.set(us(n.time), (strumsAtTime.get(us(n.time)) ?? new Set()).add(n.chordId))
      }
      for (const times of timesOfStrum.values()) expect(times.size).toBe(1)
      for (const ids of strumsAtTime.values()) expect(ids.size).toBe(1)
      expect(strums.notes.length).toBeGreaterThan(timesOfStrum.size * 3)
    })
  })
})

describe('the echo levels', () => {
  /** The guide's turns as [first beat, last beat] of each call, and the answers as the beat each line starts on. */
  const shape = (s: VocalSong, level: number) => {
    const chart = arrange(s, { shift: 0, level })
    return {
      chart,
      cueBeats: cuesOf(chart).map((c) => [beatAt(s, c.time), beatAt(s, endOf(c))]),
      lineBeats: (chart.voice?.lineStarts ?? []).map((t) => beatAt(s, t)),
      bars: Math.round((chart.duration - 1) / bar(s)),
    }
  }

  it('Hot Cross Buns line by line: listen for a bar, answer in the next, the last note of a call cut by a beat to make room', () => {
    const { cueBeats, lineBeats, bars } = shape(song('sing-hot-cross-buns'), 0)
    expect(cueBeats).toEqual([
      [0, 2],
      [4, 5], [5, 6], [6, 7],
      [12, 13], [13, 14], [14, 15],
      [20, 20.5], [20.5, 21], [21, 21.5], [21.5, 22], [22, 22.5], [22.5, 23], [23, 23.5], [23.5, 24], [24, 25], [25, 26], [26, 27],
    ])
    expect(lineBeats).toEqual([8, 16, 28])
    expect(bars).toBe(9)
  })

  it('Hot Cross Buns two lines at a time: the first two lines are one call, the odd last line is a call of its own', () => {
    const { cueBeats, lineBeats, bars } = shape(song('sing-hot-cross-buns'), 1)
    // The breath between the two lines is in the call as well: "buns" stops 0.4 s (0.48 of a beat here) before the next "Hot".
    expect(cueBeats.slice(0, 7)).toEqual([[0, 2], [4, 5], [5, 6], [6, 7.52], [8, 9], [9, 10], [10, 11]])
    expect(cueBeats[7]).toEqual([20, 20.5])
    expect(lineBeats).toEqual([12, 16, 28])
    expect(bars).toBe(9)
  })

  it('Ode to Joy: a call that ends on a one-beat note is left whole, and the answer waits for the next bar but one', () => {
    const { cueBeats, lineBeats } = shape(song('sing-ode-to-joy'), 0)
    // "thee" is the beat from 11 to 12, less the breath (0.4 s is 0.533 of a beat here), in the call as in the answer.
    // A beat after it is past the bar line, so the answer starts on the one after.
    expect(cueBeats[8]).toEqual([11, 11.467])
    expect(lineBeats[0]).toBe(16)
    // "love" is two beats: it gives one up and the answer follows at once.
    expect(cueBeats[15]).toEqual([30, 31])
    expect(lineBeats[1]).toBe(32)
  })

  it('When the Saints: the first call starts on beat 2 of the second bar, as the tune does, and a call never loses more than a beat', () => {
    const s = song('sing-saints')
    const { chart, cueBeats, lineBeats, bars } = shape(s, 0)
    expect(cueBeats[0]).toEqual([0, 2])
    expect(cueBeats[1][0]).toBe(5)
    // "saints" is four beats and a beat of rest is written after it: nothing is cut.
    expect(cueBeats[4]).toEqual([8, 12])
    expect(lineBeats).toEqual([13, 29, 53, 89, 122])
    expect(bars).toBe(35)
    // The long "in" that ends the last call keeps its four beats even though the answer has to wait for it.
    const lastCall = callsOf(chart)[callsOf(chart).length - 1]
    expect(beatAt(s, lastCall.duration)).toBe(4)
  })

  it.each(VOCAL_SONGS.map((s) => [s.id, s] as const))('%s: every call is the line it is followed by, a whole number of bars earlier', (_id, s) => {
    for (const level of [0, 1]) {
      const chart = arrange(s, { shift: 0, level })
      const lines = linesOf(chart)
      const calls = callsOf(chart)
      expect(calls).toHaveLength(chart.notes.length)
      const perCall = VOICE_LEVELS[level].echo
      let at = 0
      for (let first = 0; first < lines.length; first += perCall) {
        const answer = lines.slice(first, first + perCall).flat()
        const call = calls.slice(at, at + answer.length)
        at += answer.length
        expect(call.map((c) => c.midi)).toEqual(answer.map((n) => n.midi))
        expect(call.map((c) => c.lyric)).toEqual(answer.map((n) => n.lyric))
        const wait = (answer[0].time - call[0].time) / bar(s)
        expect(Math.abs(wait - Math.round(wait)), `level ${level} line ${first}`).toBeLessThan(EPS)
        expect(Math.round(wait)).toBeGreaterThanOrEqual(1)
        // The same rhythm: every note of the call starts as far into it as the note of the answer does.
        call.forEach((c, i) => expect(us(c.time - call[0].time)).toBe(us(answer[i].time - answer[0].time)))
        // And the same lengths, except that the last note may give up one beat at most, and keeps a beat at least.
        call.forEach((c, i) => {
          if (i < call.length - 1) expect(us(c.duration)).toBe(us(answer[i].duration))
          else {
            expect(c.duration).toBeLessThanOrEqual(answer[i].duration + EPS)
            expect(c.duration).toBeGreaterThanOrEqual(Math.min(answer[i].duration, beat(s)) - EPS)
            expect(answer[i].duration - c.duration).toBeLessThanOrEqual(beat(s) + EPS)
          }
        })
        // The whole call is over before the answer, and the answer before the next call.
        expect(endOf(call[call.length - 1])).toBeLessThanOrEqual(answer[0].time - beat(s) + EPS)
        const nextCall = calls[at]
        if (nextCall) expect(nextCall.time).toBeGreaterThanOrEqual(endOf(answer[answer.length - 1]) + 0.4 - EPS)
      }
    }
  })

  it('a call that ends on a note of a beat and a half keeps it whole: cut by a beat it would be too short to hear', () => {
    // One line of one bar at 120 beats a minute, ending on the bar line with a note of one and a half beats.
    const s: VocalSong = {
      id: 'sing-test', title: 'One line', credit: 'Nobody', description: 'One short line.', bpm: 120, beatsPerBar: 4, pickupBeats: 0,
      lines: [[[0, 1, 'one'], [2, 1, 'two'], [4, 0.5, 'and'], [5, 1.5, 'three']]], chords: ['I'], lessonLevel: 1,
    }
    const { cueBeats, lineBeats } = shape(s, 0)
    expect(cueBeats).toEqual([[0, 2], [4, 5], [5, 6], [6, 6.5], [6.5, 8]])
    // So the answer cannot follow at once: it waits for the next bar line.
    expect(lineBeats).toEqual([12])
  })

  /** The name of the chord strummed in every bar of the accompaniment, in the written key; a dash where a bar is not strummed. */
  const chordsByBar = (s: VocalSong, level: number): string[] => {
    const names: string[] = []
    for (const n of accompanimentChart(s, 0, level).notes) names[Math.floor(n.time / bar(s) + EPS)] = n.chordName ?? '?'
    return Array.from(names, (name) => name ?? '-')
  }

  it('Ode to Joy line by line: the chords of a line under its call and again under its answer, held through the bar of waiting', () => {
    // Bars: the starting note (no chord) | call 1 (two bars) | wait | answer 1 | call 2 | answer 2 | call 3 | wait | answer 3 | call 4 | answer 4.
    expect(chordsByBar(song('sing-ode-to-joy'), 0).join(' ')).toBe('-  C G7 G7 C G7  C G C G  C G7 G7 C G7  C C C C'.replace(/\s+/g, ' '))
  })

  it('Amazing Grace line by line: a line that starts before the bar line is strummed from the chord the tune has there', () => {
    // The starting note | then for each line its four bars twice. A line starts on beat 3 of the bar before it:
    // that bar is the last bar of the line before, whoever is singing.
    const line = (chords: string) => `${chords} ${chords}`
    expect(chordsByBar(song('sing-amazing-grace'), 0).join(' ')).toBe(['-', line('C C F C'), line('C C G G'), line('C C F C'), line('C G C C')].join(' '))
  })

  it('the whole-tune levels have no call: only the starting note is sounded', () => {
    for (const s of VOCAL_SONGS) for (const level of [2, 3, 4, 5]) expect(cuesOf(arrange(s, { shift: 0, level }))).toHaveLength(1)
  })
})

describe('the chords under every form of a song', () => {
  /** The name of the chord strummed in every bar of an accompaniment, in the written key. */
  const chordsByBar = (s: VocalSong, strums: Chart): string[] => {
    const names: string[] = []
    for (const n of strums.notes) names[Math.floor(n.time / bar(s) + EPS)] = n.chordName ?? '?'
    return names
  }

  it.each(VOCAL_SONGS.map((s) => [s.id, s] as const))('%s: wherever a line is sung, by the guide or by the singer, each of its bars has the chord the tune has there', (_id, s) => {
    const whole = arrange(s, { shift: 0, level: 2 })
    const wholeChords = chordsByBar(s, accompanimentChart(s, 0, 2))
    const wholeStarts = (whole.voice?.lineStarts ?? []).map((t) => beatAt(s, t))
    const lineBeats = s.lines.map((line) => line.reduce((sum, step) => sum + step[1], 0))
    let checked = 0
    /** Line `i` sung from beat `start` of a form, up to beat `until`: its bars against the same bars of the whole tune. */
    const sameChords = (chords: string[], start: number, until: number, i: number, where: string) => {
      const later = (start - wholeStarts[i]) / s.beatsPerBar
      expect(Math.abs(later - Math.round(later)), `${where}: a whole number of bars from where the tune has the line`).toBeLessThan(EPS)
      for (let b = 0; b * s.beatsPerBar < wholeStarts[i] + lineBeats[i] - EPS; b++) {
        if (b * s.beatsPerBar < wholeStarts[i] - EPS || b * s.beatsPerBar + Math.round(later) * s.beatsPerBar >= until - EPS) continue
        expect(chords[b + Math.round(later)], `${where}, bar ${b} of the tune`).toBe(wholeChords[b])
        checked++
      }
    }
    for (const level of [0, 1]) {
      for (const onlyLine of [undefined, ...s.lines.map((_line, i) => i)]) {
        const chart = arrange(s, { shift: 0, level, onlyLine })
        const chords = chordsByBar(s, accompanimentChart(s, 0, level, onlyLine))
        const lines = onlyLine === undefined ? s.lines.map((_line, i) => i) : [onlyLine]
        const answers = (chart.voice?.lineStarts ?? []).map((t) => beatAt(s, t))
        let cue = 1
        lines.forEach((i, at) => {
          const where = `level ${level}${onlyLine === undefined ? '' : ` line ${onlyLine} alone`}`
          sameChords(chords, answers[at], Infinity, i, `${where}, answer ${i}`)
          // The call of a line starts with the cue of its first note; its bars count up to where the answer begins.
          const call = beatAt(s, cuesOf(chart)[cue].time)
          cue += s.lines[i].filter(isSung).length
          const answered = answers[Math.floor(at / VOICE_LEVELS[level].echo) * VOICE_LEVELS[level].echo]
          sameChords(chords, call, answered, i, `${where}, call ${i}`)
        })
      }
    }
    // One line alone on a whole-tune level: the same, with no call.
    s.lines.forEach((_line, i) => {
      const chart = arrange(s, { shift: 0, level: 2, onlyLine: i })
      sameChords(chordsByBar(s, accompanimentChart(s, 0, 2, i)), beatAt(s, chart.voice?.lineStarts[0] ?? -1), Infinity, i, `line ${i} alone`)
    })
    // Every bar of the tune was looked at more than once: under its call, its answer and alone.
    expect(checked).toBeGreaterThan(5 * s.chords.length)
  })

  it.each(VOCAL_SONGS.map((s) => [s.id, s] as const))('%s: the starting note is heard alone, and the chords come in on the first bar line of the tune', (_id, s) => {
    // On a bare speaker the tracker knows the app's own sound by its starting note. A chord strummed
    // over that note hides it, and the guide then marks its own singing as the singer's.
    for (const level of LEVELS) {
      for (const onlyLine of [undefined, ...s.lines.map((_line, i) => i)]) {
        const chart = arrange(s, { shift: 0, level, onlyLine })
        const strums = accompanimentChart(s, 0, level, onlyLine)
        const where = `level ${level}${onlyLine === undefined ? '' : ` line ${onlyLine} alone`}`
        const [start] = cuesOf(chart)
        const firstStrum = Math.min(...strums.notes.map((n) => n.time))
        expect(firstStrum, where).toBeGreaterThanOrEqual(endOf(start) + beat(s) - EPS)
        // The first bar line at or after the first note of the tune, whoever sings it: a pickup is not strummed.
        const tuneStarts = Math.min(chart.notes[0].time, ...callsOf(chart).map((c) => c.time))
        expect(us(firstStrum), where).toBe(us(Math.ceil(tuneStarts / bar(s) - EPS) * bar(s)))
      }
    }
  })

  it('every chord a tune can name is that chord in all twelve keys, minor chords included, within reach of the guitar', () => {
    // No song of the list uses the two minor chords yet. A tune that does must not find them out of tune.
    const s: VocalSong = {
      id: 'sing-test', title: 'Six chords', credit: 'Nobody', description: 'One note for every chord.', bpm: 100, beatsPerBar: 4, pickupBeats: 0,
      lines: [[[0, 4, 'one'], [5, 4, 'four'], [7, 4, 'five'], [7, 4, 'seven'], [9, 4, 'six'], [2, 4, 'two']]], chords: ['I', 'IV', 'V', 'V7', 'vi', 'ii'], lessonLevel: 1,
    }
    const tones: Record<Degree, number[]> = { I: [0, 4, 7], IV: [0, 5, 9], V: [2, 7, 11], V7: [2, 5, 7, 11], vi: [0, 4, 9], ii: [2, 5, 9] }
    const roots: Record<Degree, number> = { I: 0, IV: 5, V: 7, V7: 7, vi: 9, ii: 2 }
    for (const shift of SHIFTS) {
      const strums = accompanimentChart(s, shift, 2)
      const heard: Set<number>[] = []
      const lowest: number[] = []
      for (const n of strums.notes) {
        expect(n.midi, `shift ${shift}`).toBeGreaterThanOrEqual(40)
        expect(n.midi, `shift ${shift}`).toBeLessThanOrEqual(74)
        expect(n.midi).toBe(strums.tuning[n.string] + n.fret + strums.capo)
        const b = Math.floor(n.time / bar(s) + EPS)
        heard[b] = (heard[b] ?? new Set()).add((((n.midi - 60 - shift) % 12) + 12) % 12)
        lowest[b] = Math.min(lowest[b] ?? Infinity, n.midi)
      }
      s.chords.forEach((degree, i) => {
        // Bar 0 is the bar of the starting note.
        const b = i + 1
        expect([...heard[b]].sort((x, y) => x - y), `shift ${shift} bar ${b} (${degree})`).toEqual(tones[degree])
        // The lowest string struck is the note the chord is named after, as a guitarist strums it.
        expect((((lowest[b] - 60 - shift) % 12) + 12) % 12, `shift ${shift} bar ${b} (${degree}) bass`).toBe(roots[degree])
      })
    }
  })
})

describe('one line at a time', () => {
  it.each(VOCAL_SONGS.map((s) => [s.id, s] as const))('%s: any line alone is the same notes as in the whole tune, in its own place in the bar, after its starting note', (_id, s) => {
    for (const level of [0, 2, 5]) {
      const whole = linesOf(arrange(s, { shift: 3, level }))
      s.lines.forEach((_line, i) => {
        const chart = arrange(s, { shift: 3, level, onlyLine: i })
        expect(chart.voice?.onlyLine).toBe(i)
        expect(chart.notes.map((n) => [n.midi, us(n.duration), n.lyric])).toEqual(whole[i].map((n) => [n.midi, us(n.duration), n.lyric]))
        expect(chart.voice?.lineStarts).toHaveLength(1)
        expect(Math.abs((chart.voice?.lineStarts[0] ?? -1) - chart.notes[0].time)).toBeLessThan(EPS)
        // The line starts as far into its bar as it does in the tune.
        const inBar = (t: number) => beatAt(s, t) % s.beatsPerBar
        expect(inBar(chart.notes[0].time)).toBe(inBar(whole[i][0].time))
        // Its own starting note, then a silent beat or more.
        const [start, ...calls] = cuesOf(chart)
        expect(start.time).toBe(0)
        expect(start.midi).toBe(chart.notes[0].midi)
        expect(start.duration).toBeGreaterThanOrEqual(beat(s) - EPS)
        const next = Math.min(chart.notes[0].time, ...calls.map((c) => c.time))
        expect(next - endOf(start)).toBeGreaterThanOrEqual(beat(s) - EPS)
        // The lanes keep the scale of the whole song.
        expect(chart.voice?.low).toBe(arrange(s, { shift: 3, level }).voice?.low)
        expect(chart.voice?.high).toBe(arrange(s, { shift: 3, level }).voice?.high)
        // On an echo level the line is called first; from "Whole tune" on it is not.
        expect(calls.map((c) => c.midi)).toEqual(level <= 1 ? chart.notes.map((n) => n.midi) : [])
        for (const cue of [start, ...calls]) {
          const following = chart.notes.find((n) => n.time >= cue.time - EPS)
          if (following) expect(following.time - endOf(cue)).toBeGreaterThanOrEqual(beat(s) - EPS)
        }
        // Shorter than the whole tune, and its strums lie on the same beats.
        expect(chart.duration).toBeLessThan(arrange(s, { shift: 3, level }).duration)
        const strums = accompanimentChart(s, 3, level, i)
        expect(strums.beats).toEqual(chart.beats)
        expect(strums.duration).toBe(chart.duration)
      })
    }
  })

  it('the whole song is not marked as one line, and a line that does not exist is read as the nearest one', () => {
    const s = song('sing-mary-lamb')
    const whole = arrange(s, { shift: 0, level: 2 })
    expect(whole.voice && 'onlyLine' in whole.voice).toBe(false)
    expect(arrange(s, { shift: 0, level: 2, onlyLine: 99 })).toEqual(arrange(s, { shift: 0, level: 2, onlyLine: 3 }))
    expect(arrange(s, { shift: 0, level: 2, onlyLine: -4 })).toEqual(arrange(s, { shift: 0, level: 2, onlyLine: 0 }))
  })

  it('"its fleece was white as snow" alone: one bar for the starting note, "its" on beat 4 of it, "fleece" on the bar line', () => {
    const s = song('sing-mary-lamb')
    const chart = arrange(s, { shift: 0, level: 2, onlyLine: 3 })
    expect(chart.notes.slice(0, 2).map((n) => [n.lyric, beatAt(s, n.time)])).toEqual([['its', 3], ['fleece', 4]])
    expect(cuesOf(chart).map((c) => [beatAt(s, c.time), beatAt(s, endOf(c))])).toEqual([[0, 2]])
  })

  it('the last line of When the Saints alone: its pickup is two beats, so one bar before it is enough', () => {
    const s = song('sing-saints')
    const chart = arrange(s, { shift: 0, level: 2, onlyLine: 4 })
    expect(chart.notes.slice(0, 3).map((n) => [n.lyric, beatAt(s, n.time)])).toEqual([['when', 2], ['the', 3], ['saints', 4]])
    expect(cuesOf(chart).map((c) => [beatAt(s, c.time), beatAt(s, endOf(c))])).toEqual([[0, 1]])
  })
})

describe('the breath at the end of a line', () => {
  /** Two one-bar lines at 120 beats a minute (a beat is half a second), the first ending in a rest of `restBeats`. */
  const twoLines = (restBeats: number): VocalSong => ({
    id: 'sing-test',
    title: 'Two lines',
    credit: 'Nobody',
    description: 'Two short lines.',
    bpm: 120,
    beatsPerBar: 4,
    pickupBeats: 0,
    lines: [
      restBeats > 0 ? [[0, 2, 'one'], [2, 2 - restBeats, 'two'], [null, restBeats]] : [[0, 2, 'one'], [2, 2, 'two']],
      [[4, 2, 'three'], [0, 2, 'four']],
    ],
    chords: ['I', 'V'],
    lessonLevel: 1,
  })
  const lastOfFirstLine = (s: VocalSong) => arrange(s, { shift: 0, level: 2 }).notes[1]

  it('is taken off the note when nothing is written: the note ends 0.4 s before the next line', () => {
    const n = lastOfFirstLine(twoLines(0))
    expect(us(endOf(n))).toBe(us(4 * 0.5 + 2 - 0.4))
  })

  it('is the written rest when that is 0.4 s or more: the note keeps its length', () => {
    // A beat of rest is half a second here.
    expect(us(lastOfFirstLine(twoLines(1)).duration)).toBe(us(0.5))
  })

  it('is made up to 0.4 s when the written rest is shorter', () => {
    // Half a beat of rest is a quarter of a second: the note gives the other 0.15 s.
    const n = lastOfFirstLine(twoLines(0.5))
    expect(us(n.duration)).toBe(us(0.75 - 0.15))
    expect(us(endOf(n))).toBe(us(4 * 0.5 + 2 - 0.4))
  })

  it('a shift that is not a whole number is read as the nearest key, and no number at all as the written key', () => {
    const s = twoLines(0)
    expect(arrange(s, { shift: 1.6, level: 2 })).toEqual(arrange(s, { shift: 2, level: 2 }))
    expect(arrange(s, { shift: Number.NaN, level: 2 })).toEqual(arrange(s, { shift: 0, level: 2 }))
  })
})

describe('tunes of shapes the ten songs do not have', () => {
  /** A small repeatable source of numbers from 0 to 1: the same tunes on every run. */
  function dice(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /**
   * A tune nobody wrote, kept to the rules a tune is written by: lines without gaps, a rest only at the
   * end of a line, whole bars in all. Everything else is thrown: three or four beats in the bar, a pickup
   * of any length down to half a beat short of a bar, one to five lines of one to nine notes, notes of
   * half a beat to four beats.
   */
  function oddTune(seed: number): VocalSong {
    const roll = dice(seed)
    const pick = <T,>(from: T[]): T => from[Math.floor(roll() * from.length)]
    const beatsPerBar = pick<3 | 4>([3, 4])
    const pickupBeats = pick([0, 0, 0.5, 1, 1.5, 2, beatsPerBar - 1, beatsPerBar - 0.5])
    const lines: VocalStep[][] = []
    let total = 0
    for (let l = 0, count = 1 + Math.floor(roll() * 5); l < count; l++) {
      const line: VocalStep[] = []
      for (let n = 0, notes = 1 + Math.floor(roll() * 9); n < notes; n++) {
        const beats = pick([0.5, 0.5, 1, 1, 1, 1.5, 2, 2, 3, 4])
        line.push([Math.floor(roll() * 13) - 5, beats, n > 0 && roll() < 0.15 ? '' : 'la'])
        total += beats
      }
      const rest = l < count - 1 && roll() < 0.3 ? pick([0.5, 1, 2, 3]) : 0
      const fill = l === count - 1 ? (beatsPerBar - (total % beatsPerBar)) % beatsPerBar : 0
      if (rest + fill > 0) line.push([null, rest + fill])
      total += rest + fill
      lines.push(line)
    }
    const chords = Array.from({ length: total / beatsPerBar }, () => pick<Degree>(['I', 'IV', 'V', 'V7', 'vi', 'ii']))
    return { id: 'sing-test', title: 'Odd', credit: 'Nobody', description: 'A tune nobody wrote.', bpm: pick([56, 72, 96, 108, 132]), beatsPerBar, pickupBeats, lines, chords, lessonLevel: 1 }
  }

  it('every rule of an arrangement holds for them: pickups of any length, one-note lines, short last notes, long rests', () => {
    let pickups = 0
    for (let seed = 1; seed <= 250; seed++) {
      const s = oddTune(seed)
      if (s.pickupBeats > 0) pickups++
      const whole = arrange(s, { shift: 0, level: 2 })
      for (const level of [0, 1, 2]) {
        for (const onlyLine of [undefined, 0, s.lines.length - 1]) {
          const where = `tune ${seed}, level ${level}${onlyLine === undefined ? '' : `, line ${onlyLine} alone`}`
          const chart = arrange(s, { shift: 0, level, onlyLine })
          const cues = cuesOf(chart)
          const { notes } = chart
          // The same notes at every level.
          if (onlyLine === undefined) expect(notes.map((n) => [n.midi, us(n.duration)]), where).toEqual(whole.notes.map((n) => [n.midi, us(n.duration)]))
          // The starting note for a beat or more, then a silent beat or more.
          expect(cues[0].time, where).toBe(0)
          expect(cues[0].midi, where).toBe(notes[0].midi)
          expect(cues[0].duration, where).toBeGreaterThanOrEqual(beat(s) - EPS)
          expect(Math.min(notes[0].time, ...cues.slice(1).map((c) => c.time)) - endOf(cues[0]), where).toBeGreaterThanOrEqual(beat(s) - EPS)
          // Everything has a length, and one voice can sing all the cues: none starts before the one before it has ended.
          for (const n of notes) expect(n.duration, where).toBeGreaterThan(0.05)
          cues.forEach((c, i) => {
            expect(c.duration, where).toBeGreaterThan(0.05)
            if (i > 0) expect(c.time, where).toBeGreaterThanOrEqual(endOf(cues[i - 1]) - EPS)
          })
          notes.forEach((n, i) => {
            if (i > 0) expect(n.time, where).toBeGreaterThanOrEqual(endOf(notes[i - 1]) - EPS)
          })
          // Nothing the app sounds lies over a scored note, or ends less than a beat before the next one.
          for (const c of cues) {
            for (const n of notes) expect(endOf(c) <= n.time + EPS || endOf(n) <= c.time + EPS, where).toBe(true)
            const next = notes.find((n) => n.time >= c.time - EPS)
            if (next) expect(next.time - endOf(c), where).toBeGreaterThanOrEqual(beat(s) - EPS)
          }
          // On an echo level every note is called first, and a line is answered a whole number of bars after its call.
          if (level <= 1) {
            expect(cues.slice(1).map((c) => c.midi), where).toEqual(notes.map((n) => n.midi))
            let first = 0
            for (const line of linesOf(chart)) {
              const wait = (line[0].time - cues[1 + first].time) / bar(s)
              expect(Math.abs(wait - Math.round(wait)), where).toBeLessThan(EPS)
              expect(Math.round(wait), where).toBeGreaterThanOrEqual(1)
              first += line.length
            }
          } else expect(cues, where).toHaveLength(1)
          // The chart ends on a bar line that the last note does not pass, and every bar has a chord from the first bar line of the tune on.
          const bars = (chart.duration - 1) / bar(s)
          expect(Math.abs(bars - Math.round(bars)), where).toBeLessThan(EPS)
          expect(endOf(notes[notes.length - 1]), where).toBeLessThanOrEqual(chart.duration - 1 + EPS)
          const strums = accompanimentChart(s, 0, level, onlyLine)
          expect(strums.duration, where).toBe(chart.duration)
          const strummed = new Set(strums.notes.map((n) => Math.floor(n.time / bar(s) + EPS)))
          const before = Math.ceil(Math.min(notes[0].time, ...cues.slice(1).map((c) => c.time)) / bar(s) - EPS)
          for (let b = 0; b < Math.round(bars); b++) expect(strummed.has(b), `${where}, bar ${b}`).toBe(b >= before)
        }
      }
    }
    // The tunes thrown really are of both kinds.
    expect(pickups).toBeGreaterThan(50)
    expect(pickups).toBeLessThan(230)
  })

  it('a line that is over before its first bar line has no chord under it, and its guide is still made', async () => {
    const s: VocalSong = {
      id: 'sing-test', title: 'Up beat', credit: 'Nobody', description: 'One word before the bar line.', bpm: 100, beatsPerBar: 4, pickupBeats: 1,
      lines: [[[7, 1, 'and']], [[0, 2, 'one'], [4, 1, 'two'], [null, 4]]], chords: ['I', 'V'], lessonLevel: 1,
    }
    const chart = arrange(s, { shift: 0, level: 2, onlyLine: 0 })
    expect(chart.notes.map((n) => beatAt(s, n.time))).toEqual([3])
    expect(us(chart.duration - 1)).toBe(us(bar(s)))
    expect(accompanimentChart(s, 0, 2, 0).notes).toEqual([])
    const guide = await renderGuideTrack(s, { shift: 0, level: 2, onlyLine: 0 })
    const voiceOnly = renderGuideVoice(chart, 2)
    expect(guide.length).toBe(voiceOnly.length)
    for (let i = 0; i < guide.length; i += 101) expect(guide[i]).toBeCloseTo(voiceOnly[i], 6)
  })

  it('three beats in the bar with a pickup of two: one beat is free, so the starting note gets a bar of its own', () => {
    const s: VocalSong = {
      id: 'sing-test', title: 'Waltz', credit: 'Nobody', description: 'A waltz that starts on beat 2.', bpm: 90, beatsPerBar: 3, pickupBeats: 2,
      lines: [[[0, 1, 'and'], [2, 1, 'a'], [4, 3, 'one'], [null, 1]]], chords: ['I', 'V'], lessonLevel: 1,
    }
    const chart = arrange(s, { shift: 0, level: 2 })
    expect(cuesOf(chart).map((c) => [beatAt(s, c.time), beatAt(s, endOf(c))])).toEqual([[0, 2]])
    expect(chart.notes.map((n) => beatAt(s, n.time))).toEqual([4, 5, 6])
    // Two bars before the tune, then its two.
    expect(us(chart.duration - 1)).toBe(us(4 * bar(s)))
  })
})

describe('one held note', () => {
  /**
   * The largest share of a song's notes that one pitch, held from start to end, can be in tune with at a
   * level: every pitch of the octave is tried in steps of five cents, any octave counting as the tracker
   * counts it. Nobody can score more than this by humming, whatever they hum.
   */
  function bestHeldShare(s: VocalSong, level: number): number {
    const band = VOICE_LEVELS[level].judge.band
    const offsets = sungSteps(s).map((step) => (step[0] as number) * 100)
    let best = 0
    for (let pitch = 0; pitch < 1200; pitch += 5) {
      const inTune = offsets.filter((cents) => {
        const off = (((cents - pitch) % 1200) + 1200) % 1200
        return Math.min(off, 1200 - off) <= band
      }).length
      best = Math.max(best, inTune / offsets.length)
    }
    return best
  }

  it('is never a clean round: under three quarters of the notes on every song and level', () => {
    for (const s of VOCAL_SONGS) for (const level of LEVELS) expect(bestHeldShare(s, level), `${s.id} level ${level}`).toBeLessThan(0.75)
  })

  it('is under half of the notes on every song but Jingle Bells, whose chorus sits on one note', () => {
    for (const s of VOCAL_SONGS) {
      if (s.id === 'sing-jingle-bells') continue
      for (const level of LEVELS) expect(bestHeldShare(s, level), `${s.id} level ${level}`).toBeLessThan(0.5)
    }
    // The exception, pinned so nobody is surprised by it: 26 of its 51 notes are one note, and a pitch
    // between that note and the next one up is inside the wide bands of 37 of them.
    const jingle = song('sing-jingle-bells')
    expect(bestHeldShare(jingle, 5)).toBeCloseTo(26 / 51, 6)
    expect(bestHeldShare(jingle, 0)).toBeCloseTo(37 / 51, 6)
  })
})

describe('the revision of a song', () => {
  const copy = (s: VocalSong): VocalSong => ({ ...s, lines: s.lines.map((line) => line.map((step) => [...step] as VocalStep)), chords: [...s.chords] })

  it('is the same for the same song built again, and different for every song', () => {
    for (const s of VOCAL_SONGS) {
      expect(vocalRevision(s)).toMatch(/^[0-9a-z]{6,}$/)
      expect(vocalRevision(copy(s))).toBe(vocalRevision(s))
    }
    expect(new Set(VOCAL_SONGS.map(vocalRevision)).size).toBe(10)
  })

  it('changes with anything the stored row or the sound is made from', () => {
    const s = copy(song('sing-aunt-rhody'))
    const rev = vocalRevision(s)
    const edit = (change: (draft: VocalSong) => void): string => {
      const draft = copy(s)
      change(draft)
      return vocalRevision(draft)
    }
    const changed = [
      edit((d) => void (d.title = 'Go Tell Aunt Nancy')),
      edit((d) => void (d.credit = 'Somebody')),
      edit((d) => void (d.bpm = 86)),
      edit((d) => void (d.beatsPerBar = 3)),
      edit((d) => void (d.pickupBeats = 1)),
      edit((d) => void (d.lines[0][0][0] = 5)),
      edit((d) => void (d.lines[0][0][1] = 1)),
      edit((d) => void (d.lines[0][0][2] = 'Do')),
      edit((d) => void (d.lines[1][4][2] = 'Rho')),
      edit((d) => void d.lines[3].push([null, 1])),
      edit((d) => void (d.chords[2] = 'V')),
      edit((d) => void d.lines.push(d.lines.pop()!.slice(0, -1), [[0, 4, 'dead']])),
    ]
    for (const other of changed) expect(other).not.toBe(rev)
    expect(new Set(changed).size).toBe(changed.length)
  })

  it('does not change with what is only read from the list: the description, the lesson, the skills it asks for', () => {
    const s = song('sing-amazing-grace')
    expect(vocalRevision({ ...s, description: 'Another sentence.', lessonLevel: 3, needs: undefined })).toBe(vocalRevision(s))
  })

  /** A fingerprint of the chart a row stores: every time to the microsecond, every pitch, syllable, cue, line start and click. */
  const stored = (chart: Chart): string => {
    const text = JSON.stringify([
      us(chart.duration),
      chart.beats.length,
      chart.notes.map((n) => [us(n.time), us(n.duration), n.midi, n.lyric]),
      cuesOf(chart).map((c) => [us(c.time), us(c.duration), c.midi]),
      (chart.voice?.lineStarts ?? []).map(us),
    ])
    let h = 2166136261
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
    return (h >>> 0).toString(36)
  }

  /**
   * The revision of every song beside a fingerprint of the chart its row stores, as recorded.
   *
   * A row already on a device is made again only when its revision moves. The trap this closes: a change
   * to the way songs are arranged (the bars before the tune, the breath, the length of the chart) moves
   * the chart and not the revision, and every stored row then keeps the old chart for good. So when the
   * right-hand value of a song changes and the left-hand one does not, raise `ARRANGEMENT_VERSION` in
   * arrange.ts, and only then record the new pairs here. A corrected tune moves both values of that
   * song and of no other.
   */
  const RECORDED: Record<string, [revision: string, chart: string]> = {
    'sing-hot-cross-buns': ['089x6hw0kbg3ja', 'c182u5'],
    'sing-mary-lamb': ['081il721jc3tbm', '2fkns6'],
    'sing-ode-to-joy': ['1xmlidt1gf1i16', '1j373vq'],
    'sing-aunt-rhody': ['0i2f7250wqnr9c', '1hngbt8'],
    'sing-saints': ['0a3qy9y1nt1upi', '149o1qy'],
    'sing-london-bridge': ['0csoodu0h7kpoj', '2raa7i'],
    'sing-jingle-bells': ['0xx6qef19wc8xq', 'ipugmf'],
    'sing-twinkle': ['0a5mj2o0mecjd2', 'cokin6'],
    'sing-amazing-grace': ['1kpwjcx0kleq7c', '1xr01fi'],
    'sing-happy-birthday': ['1gxq8lq0oc7bzw', '14sjesj'],
  }

  it('moves whenever the chart a row stores moves', () => {
    expect(Object.fromEntries(VOCAL_SONGS.map((s) => [s.id, [vocalRevision(s), stored(arrange(s, { shift: 0, level: 2 }))]]))).toEqual(RECORDED)
  })
})

describe('the sound of a song', () => {
  const s = song('sing-hot-cross-buns')
  const rate = SYNTH_SAMPLE_RATE
  const at = (seconds: number) => Math.round(seconds * rate)
  /** Mean square of a stretch of sound. */
  const power = (pcm: Float32Array, from: number, to: number) => {
    let sum = 0
    for (let i = at(from); i < at(to); i++) sum += pcm[i] * pcm[i]
    return sum / Math.max(1, at(to) - at(from))
  }
  const differ = (a: Float32Array, b: Float32Array, from: number, to: number) => {
    for (let i = at(from); i < at(to); i++) if (a[i] !== b[i]) return true
    return false
  }

  afterEach(() => {
    vi.mocked(renderChartVoiced).mockClear()
  })

  it('the scored track is the click and the cues, and not one sample of what the singer is scored on', () => {
    for (const level of [0, 2]) {
      const chart = arrange(s, { shift: 0, level })
      const scored = renderScoredTrack(chart)
      const click = renderDrums(chart, { sampleRate: rate })
      const cues = renderVoiceNotes(cuesOf(chart), { sampleRate: rate, length: click.length })
      expect(scored.length).toBe(click.length)
      const expected = click.map((v, i) => v + cues[i])
      expect(differ(scored, expected, 0, chart.duration)).toBe(false)
      // The starting note is in it.
      expect(differ(scored, click, 0.1, 1)).toBe(true)
      // While a note is scored, only the click sounds.
      for (const n of chart.notes) expect(differ(scored, click, n.time, endOf(n)), `level ${level} note ${n.id}`).toBe(false)
    }
  })

  it('the guide voice doubles the singer on the first four levels and leaves the last two to the singer', () => {
    for (const level of LEVELS) {
      const chart = arrange(s, { shift: 0, level })
      const scored = renderScoredTrack(chart)
      const guide = renderGuideVoice(chart, level)
      expect(guide.length).toBe(scored.length)
      const sungToo = chart.notes.every((n) => differ(guide, scored, n.time + 0.05, endOf(n) - 0.06))
      const neverSung = !differ(guide, scored, 0, chart.duration)
      expect(sungToo, `level ${level}`).toBe(level <= 3)
      expect(neverSung, `level ${level}`).toBe(level >= 4)
      // What it sings there is the note itself: the doubled line alone is the guide voice on the scored notes.
      if (level <= 3) {
        const melody = renderVoiceNotes(chart.notes, { sampleRate: rate, length: scored.length })
        const n = chart.notes[1]
        for (let i = at(n.time + 0.05); i < at(endOf(n) - 0.06); i += 97) expect(guide[i]).toBeCloseTo(scored[i] + melody[i], 5)
      }
    }
  })

  it('the guide track adds the strummed chords, under the voice and never clipping', async () => {
    const chart = arrange(s, { shift: 0, level: 2 })
    const voiceOnly = renderGuideVoice(chart, 2)
    const guide = await renderGuideTrack(s, { shift: 0, level: 2 })
    expect(renderChartVoiced).toHaveBeenCalledTimes(1)
    const [strummed, options] = vi.mocked(renderChartVoiced).mock.calls[0]
    expect(strummed).toEqual(accompanimentChart(s, 0, 2))
    // The click is already in the scored track: asking for it again would double it.
    expect(options).toMatchObject({ plucks: true, click: false, sampleRate: rate })
    expect(guide.length).toBe(voiceOnly.length)
    expect(differ(guide, voiceOnly, 0, chart.duration)).toBe(true)
    let peak = 0
    for (const v of guide) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThanOrEqual(1)
    // What was added is the chords: there in every bar of the tune, and well under the level of a sung note.
    const chords = guide.map((v, i) => v - voiceOnly[i])
    const melody = renderVoiceNotes(chart.notes, { sampleRate: rate, length: guide.length })
    const n = chart.notes[2]
    for (let b = 1; b < 5; b++) expect(power(chords, b * bar(s), (b + 1) * bar(s)), `bar ${b}`).toBeGreaterThan(1e-5)
    // They are the stem the guitar gave back at half its level: a strum as loud as the voice would bury the tune.
    const stem = (await vi.mocked(renderChartVoiced).mock.results[0].value).samples
    let loudest = 0
    for (let i = at(bar(s)); i < at(5 * bar(s)); i += 53) {
      expect(chords[i], `sample ${i}`).toBeCloseTo(0.5 * stem[i], 5)
      loudest = Math.max(loudest, Math.abs(stem[i]))
    }
    expect(loudest).toBeGreaterThan(0.1)
    // The bar of the starting note is left as it is on the scored track: the click and that note, nothing over them.
    expect(power(chords, 0, bar(s) - 0.05)).toBeLessThan(1e-10)
    expect(power(chords, bar(s), 5 * bar(s))).toBeLessThan(0.5 * power(melody, n.time + 0.1, endOf(n) - 0.1))
  }, 30_000)

  it('falls back to voice and click alone when the chords cannot be made', async () => {
    vi.mocked(renderChartVoiced).mockRejectedValueOnce(new Error('worker unavailable'))
    const chart = arrange(s, { shift: 0, level: 2 })
    const guide = await renderGuideTrack(s, { shift: 0, level: 2 })
    expect(renderChartVoiced).toHaveBeenCalledTimes(1)
    expect(guide.length).toBe(Math.ceil(chart.duration * rate))
    expect(differ(guide, renderGuideVoice(chart, 2), 0, chart.duration)).toBe(false)
    expect(guide.length).toBe(renderGuideVoice(chart, 2).length)
  })

  it('click, cues and the guide voice together stay under full scale without a limiter, in a low key and a high one', () => {
    // Neither the scored track nor the guide without its chords goes through the limiter: the levels alone
    // have to keep them from clipping. A low key is the test: under 110 Hz the guide voice adds its octave.
    const wide = song('sing-amazing-grace')
    for (const shift of [-17, 12]) {
      const chart = arrange(wide, { shift, level: 0 })
      for (const track of [renderScoredTrack(chart), renderGuideVoice(chart, 0)]) {
        let peak = 0
        for (const v of track) peak = Math.max(peak, Math.abs(v))
        expect(peak, `shift ${shift}`).toBeGreaterThan(0.2)
        expect(peak, `shift ${shift}`).toBeLessThan(0.9)
      }
    }
  })

  describe('opened for a run', () => {
    beforeEach(() => {
      // The chords are not what these tests are about: an empty stem at once.
      vi.mocked(renderChartVoiced).mockImplementation(async () => ({ samples: new Float32Array(1), voice: null }))
    })
    afterEach(async () => {
      const actual = await vi.importActual<typeof import('../../audio/guitar')>('../../audio/guitar')
      vi.mocked(renderChartVoiced).mockImplementation(actual.renderChartVoiced)
    })

    it('gives the arrangement, the scored track at once and the guide when it is ready', async () => {
      const run = vocalRun(s, { shift: 2, level: 0 })
      // The chords asked for are those of this level and key, and they were asked for once.
      expect(vi.mocked(renderChartVoiced).mock.calls.map(([chart]) => chart)).toEqual([accompanimentChart(s, 2, 0)])
      expect(run.chart).toEqual(arrange(s, { shift: 2, level: 0 }))
      expect(run.shift).toBe(2)
      expect(run.level).toBe(0)
      expect(run.audio.type).toBe('audio/wav')
      const pcm = renderScoredTrack(run.chart)
      expect(run.audio.size).toBe(44 + 2 * pcm.length)
      const guide = await run.guide
      expect(guide.type).toBe('audio/wav')
      expect(guide.size).toBe(run.audio.size)
      // Not the same sound: the guide sings the answers too. It is the guide track of this very level and key.
      const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
      const [heard, scored, expected] = [await bytes(guide), await bytes(run.audio), await bytes(encodeWav(await renderGuideTrack(s, { shift: 2, level: 0 }), rate))]
      expect(heard.some((v, i) => v !== scored[i])).toBe(true)
      expect(heard.every((v, i) => v === expected[i])).toBe(true)
    })

    it('keeps the last three and makes a fourth only by letting the one used longest ago go', () => {
      const open = (shift: number, level = 2, onlyLine?: number) => vocalRun(s, { shift, level, onlyLine })
      const a = open(-5)
      const b = open(-4)
      const c = open(-3)
      expect(open(-4)).toBe(b)
      expect(open(-3)).toBe(c)
      // The first one made is used again last of all, so it is not the one to go.
      expect(open(-5)).toBe(a)
      const d = open(-2)
      expect(open(-5)).toBe(a)
      expect(open(-3)).toBe(c)
      expect(open(-2)).toBe(d)
      // The one that went (-4) is made anew, the same arrangement in a new object.
      const again = open(-4)
      expect(again).not.toBe(b)
      expect(again.chart).toEqual(b.chart)
      // Level, line and song each make another run.
      expect(open(-4, 3)).not.toBe(again)
      expect(open(-4, 3, 0)).not.toBe(open(-4, 3))
      expect(vocalRun(song('sing-mary-lamb'), { shift: -4, level: 3 })).not.toBe(open(-4, 3))
    })

    it('asks for the chords of the very form it sings: the level, the key and the line', async () => {
      await renderGuideTrack(s, { shift: 3, level: 0, onlyLine: 1 })
      expect(vi.mocked(renderChartVoiced).mock.calls.at(-1)?.[0]).toEqual(accompanimentChart(s, 3, 0, 1))
      await renderGuideTrack(s, { shift: -2, level: 1 })
      expect(vi.mocked(renderChartVoiced).mock.calls.at(-1)?.[0]).toEqual(accompanimentChart(s, -2, 1))
    })

    it('a chord stem that would clip the mix is held under full scale', async () => {
      vi.mocked(renderChartVoiced).mockImplementationOnce(async (chart) => ({ samples: new Float32Array(Math.ceil(chart.duration * rate)).fill(1.9), voice: null }))
      const guide = await renderGuideTrack(s, { shift: 0, level: 2 })
      let peak = 0
      for (const v of guide) peak = Math.max(peak, Math.abs(v))
      expect(peak).toBeGreaterThan(0.5)
      expect(peak).toBeLessThanOrEqual(1)
    })

    it('for a singer, is in the key their range gives the song, moved by their own "Lower" or "Higher"', () => {
      const range = { low: 48, high: 60 }
      const chosen = songKey(s, range).shift
      const placed = vocalRunFor(s.id, { range }, 2)
      expect(placed?.fits).toBe(true)
      expect(placed?.run.shift).toBe(chosen)
      expect(placed?.run).toBe(vocalRun(s, { shift: chosen, level: 2 }))
      expect(vocalRunFor(s.id, { range, nudge: -2 }, 2)?.run.shift).toBe(chosen - 2)
      expect(vocalRunFor(s.id, { range }, 0, 1)?.run.chart.voice?.onlyLine).toBe(1)
      // No range yet: the song as it is written.
      expect(vocalRunFor(s.id, {}, 2)?.run.shift).toBe(0)
    })

    it('for a singer whose range the song is too wide for, says so', () => {
      const placed = vocalRunFor('sing-amazing-grace', { range: DEFAULT_RANGES.lower }, 2)
      expect(placed?.fits).toBe(false)
      expect(vocalRunFor('sing-hot-cross-buns', { range: DEFAULT_RANGES.lower }, 2)?.fits).toBe(true)
    })

    it('is nothing for a song that is not one to sing', () => {
      expect(vocalRunFor('ode-to-joy', { range: DEFAULT_RANGES.lower }, 2)).toBeNull()
      expect(vocalRunFor(undefined, {}, 2)).toBeNull()
    })

    it('names a run by song, revision, key, level and the version of the guide voice', () => {
      const run = vocalRun(s, { shift: 1, level: 4 })
      expect(run.key).toBe(`${s.id}:${vocalRevision(s)}:1:4:${VOICE_SYNTH_VERSION}`)
      expect(vocalRun(s, { shift: 1, level: 4, onlyLine: 2 }).key).not.toBe(run.key)
    })
  })
})

describe('the stored rows', () => {
  beforeEach(async () => {
    await db.songs.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('installVocalSongs writes one light row per song: stamped as a song to sing, no audio, the whole tune as its chart', async () => {
    await installVocalSongs()
    const rows = await db.songs.toArray()
    expect(rows.map((r) => r.builtinId).sort()).toEqual(VOCAL_SONGS.map((s) => s.id).sort())
    for (const row of rows) {
      const s = song(row.builtinId!)
      const chart = arrange(s, { shift: 0, level: 2 })
      expect(row.instrument).toBe('voice')
      expect(row.source).toBe('builtin')
      expect(row.title).toBe(s.title)
      expect(row.artist).toBe(s.credit)
      expect(row.bpm).toBe(s.bpm)
      expect(row.chart).toEqual(chart)
      expect(row.duration).toBe(chart.duration)
      expect(row.builtinRev).toBe(vocalRevision(s))
      expect(row.audioName).toBe(`${s.id}.voice`)
      expect('audioData' in row).toBe(false)
      expect('audio' in row).toBe(false)
      expect(row.bestScores).toEqual({})
      expect(row.playCount).toBe(0)
      expect(row.lastLevel).toBeNull()
      expect(row.lastSpeed).toBe(1)
    }
    // Light: all ten together are far smaller than the audio of one guitar song.
    expect(JSON.stringify(rows).length).toBeLessThan(400_000)
  })

  it('is idempotent: again, or twice at the same moment, leaves ten rows with the ids they had and writes nothing', async () => {
    await Promise.all([installVocalSongs(), installVocalSongs(), vocalSongRecord('sing-twinkle')])
    const first = await db.songs.toArray()
    expect(first).toHaveLength(10)
    const add = vi.spyOn(db.songs, 'add')
    const put = vi.spyOn(db.songs, 'put')
    const update = vi.spyOn(db.songs, 'update')
    await installVocalSongs()
    await Promise.all([installVocalSongs(), installVocalSongs()])
    expect(add).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(await db.songs.toArray()).toEqual(first)
  })

  it('vocalSongRecord writes the row when it is missing and returns the same row ever after', async () => {
    expect(await db.songs.count()).toBe(0)
    const row = await vocalSongRecord('sing-mary-lamb')
    expect(row.builtinId).toBe('sing-mary-lamb')
    expect(row.instrument).toBe('voice')
    expect(await db.songs.count()).toBe(1)
    expect(await db.songs.get(row.id)).toEqual(row)
    expect((await vocalSongRecord('sing-mary-lamb')).id).toBe(row.id)
    await installVocalSongs()
    expect(await db.songs.count()).toBe(10)
    expect((await vocalSongRecord('sing-mary-lamb')).id).toBe(row.id)
  })

  it('vocalSongRecord refuses an id that is not a song to sing, a guitar song included, and writes nothing', async () => {
    await expect(vocalSongRecord('sing-nothing')).rejects.toThrow(/sing-nothing/)
    await expect(vocalSongRecord('ode-to-joy')).rejects.toThrow(/ode-to-joy/)
    expect(await db.songs.count()).toBe(0)
  })

  it('a row made from an older version of the song is brought up to date in place: same id, results kept', async () => {
    const row = await vocalSongRecord('sing-ode-to-joy')
    const s = song('sing-ode-to-joy')
    const bestScores = { '2': { level: 2, score: 2600, accuracy: 0.9, maxStreak: 12, perfects: 20, goods: 8, misses: 2, speed: 1, date: 5 } }
    const older = { ...row.chart, title: 'Ode', notes: row.chart.notes.slice(0, 5) }
    await db.songs.update(row.id, { chart: older, title: 'Ode', artist: 'Someone', bpm: 60, duration: 12, builtinRev: 'older', bestScores, playCount: 4, lastLevel: 2, createdAt: 11 })
    for (const open of [() => vocalSongRecord('sing-ode-to-joy'), async () => (await installVocalSongs(), (await db.songs.get(row.id))!)]) {
      await db.songs.update(row.id, { chart: older, title: 'Ode', builtinRev: 'older' })
      const fresh = await open()
      expect(fresh.id).toBe(row.id)
      expect(fresh.chart).toEqual(arrange(s, { shift: 0, level: 2 }))
      expect(fresh.title).toBe(s.title)
      expect(fresh.artist).toBe(s.credit)
      expect(fresh.bpm).toBe(s.bpm)
      expect(fresh.duration).toBe(fresh.chart.duration)
      expect(fresh.builtinRev).toBe(vocalRevision(s))
      expect(fresh.bestScores).toEqual(bestScores)
      expect(fresh.playCount).toBe(4)
      expect(fresh.lastLevel).toBe(2)
      expect(fresh.createdAt).toBe(11)
      expect(fresh.instrument).toBe('voice')
      expect(await db.songs.get(row.id)).toEqual(fresh)
    }
    expect(await db.songs.count()).toBe(10)
  })

  it('leaves the guitar songs and their audio alone', async () => {
    const guitarId = await db.songs.add({
      title: 'Ode to Joy', artist: 'Ludwig van Beethoven', createdAt: 1, updatedAt: 1, audioData: new ArrayBuffer(16), audioType: 'audio/wav', audioName: 'ode-to-joy.v4m.wav',
      duration: 30, chart: arrange(song('sing-ode-to-joy'), { shift: 0, level: 2 }), source: 'builtin', bpm: 80, builtinId: 'ode-to-joy', builtinRev: 'x', bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 2,
    })
    const before = await db.songs.get(guitarId)
    await installVocalSongs()
    expect(await db.songs.get(guitarId)).toEqual(before)
    expect(await db.songs.count()).toBe(11)
    // The guitar's Ode to Joy is not taken for the song to sing of the same name.
    expect((await vocalSongRecord('sing-ode-to-joy')).id).not.toBe(guitarId)
  })
})
