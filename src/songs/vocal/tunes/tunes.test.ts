import { describe, expect, it } from 'vitest'
import type { Chart } from '../../../chart/types'
import { amazingGrace as guitarAmazingGrace } from '../../tunes/amazingGrace'
import { happyBirthday as guitarHappyBirthday } from '../../tunes/happyBirthday'
import { jingleBells as guitarJingleBells } from '../../tunes/jingleBells'
import { odeToJoy as guitarOdeToJoy } from '../../tunes/odeToJoy'
import { saints as guitarSaints } from '../../tunes/saints'
import { twinkleTwinkle as guitarTwinkle } from '../../tunes/twinkleTwinkle'
import type { Degree, VocalSong, VocalStep } from '../types'
import { VOCAL_TUNES } from './index'

/**
 * What each tune is, written a second time by hand in the notations a singer and a songbook use, so
 * that a slip in the numbers of a tune file cannot pass: solfege for the pitches, the words as they are
 * printed under the notes, the note lengths bar by bar and the word on every bar line for the rhythm, and
 * a lead sheet in C for the chords.
 */
interface Facts {
  id: string
  /** Highest note minus lowest note, in semitones. */
  span: number
  beatsPerBar: 3 | 4
  pickupBeats: number
  /** The first sung note. */
  first: string
  /** Every line in solfege: a comma is the octave below home, a dash is a rest. */
  solfege: string
  /** Every line as printed under a score: hyphens inside a word, an underscore where a syllable is carried to another note. */
  words: string
  /**
   * The note lengths bar by bar, the pickup first: w, h, q, e are a whole, half, quarter and eighth note,
   * a dot adds half as much again, a leading r makes it a rest, and "~" ties a note to the next one.
   */
  rhythm: string
  /** Beats in every line. */
  lineBeats: number[]
  /** What is sung on beat 1 of every bar: a syllable, "~" for a note still held from the bar before, "-" for a rest. */
  downbeats: string
  /** One chord per bar, as a lead sheet in C would name it. */
  chords: string
}

const FACTS: Facts[] = [
  {
    id: 'sing-hot-cross-buns',
    span: 4,
    beatsPerBar: 4,
    pickupBeats: 0,
    first: 'mi',
    solfege: 'mi re do / mi re do / do do do do re re re re mi re do',
    words: 'Hot cross buns / Hot cross buns / One a pen-ny two a pen-ny hot cross buns',
    rhythm: 'q q h | q q h | e e e e e e e e | q q h',
    lineBeats: [4, 4, 8],
    downbeats: 'Hot Hot One hot',
    chords: 'C C C C',
  },
  {
    id: 'sing-mary-lamb',
    span: 7,
    beatsPerBar: 4,
    pickupBeats: 0,
    first: 'mi',
    solfege: 'mi re do re mi mi mi / re re re mi sol sol / mi re do re mi mi mi / mi re re mi re do',
    words: 'Ma-ry had a lit-tle lamb / lit-tle lamb lit-tle lamb / Ma-ry had a lit-tle lamb / its fleece was white as snow',
    rhythm: 'q q q q | q q h | q q h | q q h | q q q q | q q q q | q q q q | w',
    lineBeats: [8, 8, 7, 9],
    downbeats: 'Ma- lit- lit- lit- Ma- lit- fleece snow',
    chords: 'C C G7 C C C G7 C',
  },
  {
    id: 'sing-ode-to-joy',
    span: 7,
    beatsPerBar: 4,
    pickupBeats: 0,
    first: 'mi',
    solfege: 'mi mi fa sol sol fa mi re / do do re mi mi re re / mi mi fa sol sol fa mi re / do do re mi re do do',
    words: "Joy-ful joy-ful we a-dore thee / God of glo-ry Lord of love / Hearts un-fold like flow'rs be-fore thee / Op'-ning to the sun a-bove",
    rhythm: 'q q q q | q q q q | q q q q | q. e h | q q q q | q q q q | q q q q | q. e h',
    lineBeats: [8, 8, 8, 8],
    downbeats: "Joy- we God Lord Hearts flow'rs Op'- sun",
    chords: 'C G7 C G C G7 C C',
  },
  {
    id: 'sing-aunt-rhody',
    span: 7,
    beatsPerBar: 4,
    pickupBeats: 0,
    first: 'mi',
    solfege: 'mi mi re do do / re re fa mi re do / sol sol fa mi mi / mi re do re mi do',
    words: 'Go tell Aunt Rho-dy / go tell Aunt Rho- _ dy / go tell Aunt Rho-dy / the old grey goose is dead',
    rhythm: 'h q q | h h | h q q | q q h | h q q | h q q | q q q q | w',
    lineBeats: [8, 8, 7, 9],
    downbeats: 'Go Rho- go Rho- go Rho- old dead',
    chords: 'C C G7 C C C G7 C',
  },
  {
    id: 'sing-saints',
    span: 7,
    beatsPerBar: 4,
    pickupBeats: 3,
    first: 'do',
    solfege: 'do mi fa sol - / do mi fa sol - / do mi fa sol mi do mi re - / mi mi re do do mi sol sol fa fa / mi fa sol mi do re do -',
    words: 'Oh when the saints / go march-ing in / Oh when the saints go march-ing in / Oh Lord I want to be in that num-ber / when the saints go march-ing in',
    rhythm: 'q q q | w | rq q q q | w | rq q q q | h h | h h | w | rq q q q | h. q | h h | h h | h q q | h h | h h | w | rq',
    lineBeats: [8, 8, 16, 17, 15],
    downbeats: 'saints - in - saints march- in - want be that ber saints march- in -',
    chords: 'C C C C C C G7 G7 C C F F C G7 C C',
  },
  {
    id: 'sing-london-bridge',
    span: 9,
    beatsPerBar: 4,
    pickupBeats: 0,
    first: 'sol',
    solfege: 'sol la sol fa mi fa sol / re mi fa mi fa sol / sol la sol fa mi fa sol / re sol mi do -',
    words: 'Lon-don Bridge is fall-ing down / fall-ing down fall-ing down / Lon-don Bridge is fall-ing down / my fair la-dy',
    rhythm: 'q. e q q | q q h | q q h | q q h | q. e q q | q q h | h h | q q rh',
    lineBeats: [8, 8, 8, 8],
    downbeats: 'Lon- fall- fall- fall- Lon- fall- my la-',
    chords: 'C C G7 C C C G7 C',
  },
  {
    id: 'sing-jingle-bells',
    span: 7,
    beatsPerBar: 4,
    pickupBeats: 0,
    first: 'mi',
    solfege:
      'mi mi mi mi mi mi / mi sol do re mi / fa fa fa fa fa mi mi / mi mi mi re re mi re sol / ' +
      'mi mi mi mi mi mi / mi sol do re mi / fa fa fa fa fa mi mi / mi mi sol sol fa re do',
    words:
      'Jin-gle bells jin-gle bells / jin-gle all the way / Oh what fun it is to ride / in a one-horse o-pen sleigh hey / ' +
      'Jin-gle bells jin-gle bells / jin-gle all the way / Oh what fun it is to ride / in a one-horse o-pen sleigh',
    rhythm:
      'q q h | q q h | q q q. e | w | q q q. e | q q q e e | q q q q | h h | ' +
      'q q h | q q h | q q q. e | w | q q q. e | q q q e e | q q q q | w',
    lineBeats: [8, 8, 7, 9, 8, 8, 7, 9],
    downbeats: 'Jin- jin- jin- way Oh is one- sleigh Jin- jin- jin- way Oh is one- sleigh',
    chords: 'C C C C F C G G7 C C C C F C G7 C',
  },
  {
    id: 'sing-twinkle',
    span: 9,
    beatsPerBar: 4,
    pickupBeats: 0,
    first: 'do',
    solfege:
      'do do sol sol la la sol / fa fa mi mi re re do / sol sol fa fa mi mi re / sol sol fa fa mi mi re / ' +
      'do do sol sol la la sol / fa fa mi mi re re do',
    words:
      'Twin-kle twin-kle lit-tle star / How I won-der what you are / Up a-bove the world so high / Like a dia-mond in the sky / ' +
      'Twin-kle twin-kle lit-tle star / How I won-der what you are',
    rhythm: 'q q q q | q q h | q q q q | q q h | q q q q | q q h | q q q q | q q h | q q q q | q q h | q q q q | q q h',
    lineBeats: [8, 8, 8, 8, 8, 8],
    downbeats: 'Twin- lit- How what Up world Like in Twin- lit- How what',
    chords: 'C F F C G7 G G7 G C F F C',
  },
  {
    id: 'sing-amazing-grace',
    span: 12,
    beatsPerBar: 3,
    pickupBeats: 1,
    first: 'sol,',
    solfege: 'sol, do mi do mi re do la, sol, / sol, do mi do mi re sol / mi sol mi sol mi do sol, la, do do la, sol, / sol, do mi do mi re do',
    words: 'A-ma-zing _ grace how sweet the sound / that saved a _ wretch like me / I once _ was _ lost but now _ am _ found / was blind but _ now I see',
    rhythm: 'q | h e e | h q | h q | h q | h e e | h q | h.~ | h q | q. e e e | h q | q. e e e | h q | h e e | h q | h.~ | h',
    lineBeats: [12, 12, 12, 12],
    downbeats: 'ma- grace sweet sound saved wretch me ~ once lost now found blind now see ~',
    chords: 'C C F C C C G G C C F C C G C C',
  },
  {
    id: 'sing-happy-birthday',
    span: 12,
    beatsPerBar: 3,
    pickupBeats: 1,
    first: 'sol,',
    solfege: 'sol, sol, la, sol, do ti, / sol, sol, la, sol, re do / sol, sol, sol mi do ti, la, / fa fa mi do re do',
    words: 'Hap-py birth-day to you / hap-py birth-day to you / hap-py birth-day dear friend _ / hap-py birth-day to you',
    rhythm: 'e e | q q q | h e e | q q q | h e e | q q q | q q e e | q q q | h',
    lineBeats: [6, 6, 6, 6],
    downbeats: 'birth- you birth- you birth- friend birth- you',
    chords: 'C G7 G7 C C F C C',
  },
]

/**
 * Lines that begin with a pickup of their own, shorter than the tune's: "its (fleece)", "the (old grey
 * goose)", "when the (saints)", "in a (one-horse)". The word before them ends inside a bar, so neither
 * that line nor this one is a whole number of bars; the two together are.
 */
const OWN_PICKUP: Record<string, number[]> = {
  'sing-mary-lamb': [3],
  'sing-aunt-rhody': [3],
  'sing-saints': [4],
  'sing-jingle-bells': [3, 7],
}

/**
 * Whose name the credit has to carry. A tune or a set of words with a known writer says so and says it is
 * in the public domain; the rest are exactly "Traditional". Calling Beethoven's melody traditional would pass
 * for a credit and be untrue.
 */
const WRITERS: Record<string, string[]> = {
  'sing-mary-lamb': ['Sarah Josepha Hale'],
  'sing-ode-to-joy': ['Ludwig van Beethoven', 'Henry van Dyke'],
  'sing-jingle-bells': ['James Lord Pierpont'],
  'sing-twinkle': ['Jane Taylor'],
  'sing-amazing-grace': ['John Newton'],
  'sing-happy-birthday': ['Mildred', 'Patty Hill'],
}

const SEMITONES: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, ti: 11 }

/** Semitones above home of one solfege name; null for the dash of a rest. */
function semitones(name: string): number | null {
  if (name === '-') return null
  const low = name.endsWith(',')
  const base = SEMITONES[low ? name.slice(0, -1) : name]
  if (base === undefined) throw new Error(`"${name}" is not a solfege name`)
  return low ? base - 12 : base
}

const parseSolfege = (text: string): (number | null)[][] => text.split(' / ').map((line) => line.trim().split(/\s+/).map(semitones))

/** "pen-ny" is sung as "pen-" then "ny"; "_" is a syllable carried to another note. */
const parseWords = (text: string): string[][] =>
  text.split(' / ').map((line) => line.trim().split(/\s+/).flatMap((word) => (word === '_' ? [''] : (word.match(/[^-]+-?/g) ?? []))))

const NOTE_BEATS: Record<string, number> = { w: 4, 'h.': 3, h: 2, 'q.': 1.5, q: 1, e: 0.5 }

interface Length {
  rest: boolean
  beats: number
}

/** The lengths of one bar of written rhythm; `tied` marks a note that carries on into the next one. */
function parseBar(text: string): (Length & { tied: boolean })[] {
  return text.trim().split(/\s+/).map((token) => {
    const tied = token.endsWith('~')
    const rest = token.startsWith('r')
    const beats = NOTE_BEATS[token.slice(rest ? 1 : 0, tied ? -1 : undefined)]
    if (beats === undefined) throw new Error(`"${token}" is not a note length`)
    return { rest, beats, tied }
  })
}

/** A written rhythm as the notes and rests that are heard: tied notes become one. */
function heardLengths(rhythm: string): Length[] {
  const out: Length[] = []
  let carry = false
  for (const { rest, beats, tied } of rhythm.split(' | ').flatMap(parseBar)) {
    if (carry) out[out.length - 1].beats += beats
    else out.push({ rest, beats })
    carry = tied
  }
  return out
}

const DEGREE_OF: Record<string, Degree> = { C: 'I', F: 'IV', G: 'V', G7: 'V7', Am: 'vi', Dm: 'ii' }

/** Notes of each chord as semitones above home, octave aside. */
const CHORD_NOTES: Record<Degree, number[]> = { I: [0, 4, 7], IV: [5, 9, 0], V: [7, 11, 2], V7: [7, 11, 2, 5], vi: [9, 0, 4], ii: [2, 5, 9] }

const tune = (id: string): VocalSong => {
  const found = VOCAL_TUNES.find((t) => t.id === id)
  if (!found) throw new Error(`The tune ${id} is not in VOCAL_TUNES`)
  return found
}

const beatsOf = (line: VocalStep[]): number => line.reduce((sum, step) => sum + step[1], 0)
const isSung = (step: VocalStep): boolean => step[0] !== null
const sungOf = (song: VocalSong): VocalStep[] => song.lines.flat().filter(isSung)
const pitchesOf = (song: VocalSong): number[] => sungOf(song).map((step) => step[0] as number)
const spanOf = (song: VocalSong): number => Math.max(...pitchesOf(song)) - Math.min(...pitchesOf(song))

/** Every move from one note to the next inside a line, in semitones, up counted as positive. The move from one line to the next is left out. */
function jumpsOf(song: VocalSong): number[] {
  return song.lines.flatMap((line) => {
    const pitches = line.filter(isSung).map((step) => step[0] as number)
    return pitches.slice(1).map((pitch, i) => pitch - pitches[i])
  })
}
const seconds = (song: VocalSong, beats: number): number => (beats * 60) / song.bpm

interface Placed {
  step: VocalStep
  /** Beats from the first note of the tune, pickup included. */
  start: number
}

/** Every note and rest of a tune with the beat it starts on: lines follow one another without a gap. */
function placed(song: VocalSong): Placed[] {
  const out: Placed[] = []
  let start = 0
  for (const step of song.lines.flat()) {
    out.push({ step, start })
    start += step[1]
  }
  return out
}

/** Beat of the bar line that opens bar `bar` (from 0), counted from the first note of the tune. */
const barLine = (song: VocalSong, bar: number): number => song.pickupBeats + bar * song.beatsPerBar

/** What is sung on beat 1 of every bar. */
function downbeats(song: VocalSong): string[] {
  const steps = placed(song)
  return song.chords.map((_, bar) => {
    const at = barLine(song, bar)
    const here = steps.find((p) => p.start <= at && at < p.start + p.step[1])
    if (!here) return '?'
    if (!isSung(here.step)) return '-'
    if (here.start < at) return '~'
    return here.step[2] === '' ? '_' : (here.step[2] ?? '?')
  })
}

describe('the songs to sing', () => {
  it('are the ten of the design, in its order, with ids that start with sing- and never repeat', () => {
    const ids = VOCAL_TUNES.map((t) => t.id)
    expect(ids).toEqual([
      'sing-hot-cross-buns',
      'sing-mary-lamb',
      'sing-ode-to-joy',
      'sing-aunt-rhody',
      'sing-saints',
      'sing-london-bridge',
      'sing-jingle-bells',
      'sing-twinkle',
      'sing-amazing-grace',
      'sing-happy-birthday',
    ])
    expect(new Set(ids).size).toBe(10)
    for (const id of ids) expect(id.startsWith('sing-')).toBe(true)
    expect(FACTS.map((f) => f.id)).toEqual(ids)
    expect(new Set(VOCAL_TUNES.map((t) => t.title)).size).toBe(10)
  })

  it('open after the lessons the design names, the last two after the course', () => {
    expect(VOCAL_TUNES.map((t) => t.lessonLevel)).toEqual([4, 5, 6, 7, 8, 8, 9, 9, 10, 10])
  })

  it('reach as far from low to high as the design lists', () => {
    expect(VOCAL_TUNES.map(spanOf)).toEqual([4, 7, 7, 7, 7, 9, 7, 9, 12, 12])
  })

  it('fit the smallest range the app stores when they are songs of the course, but for the two the design lets be wider', () => {
    const wider = ['sing-london-bridge', 'sing-twinkle']
    for (const t of VOCAL_TUNES.filter((s) => s.lessonLevel <= 9)) {
      if (wider.includes(t.id)) expect(spanOf(t), t.id).toBe(9)
      else expect(spanOf(t), t.id).toBeLessThanOrEqual(7)
    }
    // The songs the lessons sing and the three goal songs must be singable by everybody.
    for (const id of ['sing-hot-cross-buns', 'sing-mary-lamb', 'sing-ode-to-joy', 'sing-saints']) expect(spanOf(tune(id)), id).toBeLessThanOrEqual(7)
  })

  it('never share a line or a note between two places, so shortening one last note cannot change another line', () => {
    const lines = VOCAL_TUNES.flatMap((t) => t.lines)
    const steps = lines.flat()
    expect(lines.length).toBeGreaterThan(0)
    expect(new Set(lines).size).toBe(lines.length)
    expect(new Set(steps).size).toBe(steps.length)
  })

  it('cannot be changed in place, so what is done to one arrangement never reaches the next', () => {
    const parts: unknown[] = [VOCAL_TUNES]
    for (const t of VOCAL_TUNES) parts.push(t, t.lines, t.chords, ...t.lines, ...t.lines.flat(), ...(t.needs ? [t.needs] : []))
    expect(parts.length).toBeGreaterThan(300)
    for (const part of parts) expect(Object.isFrozen(part)).toBe(true)
    // The trap: taking the breath off the last note of a line in the tune itself would take it off again
    // every time the song is opened. A write has to stop at once, not shorten the note for good.
    const line = tune('sing-hot-cross-buns').lines[0]
    const buns = line[line.length - 1]
    expect(() => {
      buns[1] -= 0.5
    }).toThrow(TypeError)
    expect(buns).toEqual([0, 2, 'buns'])
    expect(() => line.pop()).toThrow(TypeError)
    expect(() => tune('sing-hot-cross-buns').chords.push('V')).toThrow(TypeError)
    expect(() => VOCAL_TUNES.pop()).toThrow(TypeError)
    expect(VOCAL_TUNES).toHaveLength(10)
  })

  it('are plain data: a copy made through JSON is the same tune, so a stored song never drifts from its source', () => {
    // An undefined syllable on a rest, or a length that is not a number, would come back as something else.
    for (const t of VOCAL_TUNES) expect(JSON.parse(JSON.stringify(t)), t.id).toStrictEqual(t)
  })

  it('leave room in the bar before the first word for a starting note and a silent beat, all but When the Saints', () => {
    // The starting note is given in the bar before the tune, and a silent beat has to follow it. "Oh when
    // the" takes three of that bar's four beats, so whoever arranges the Saints must give it a bar more.
    const freeBeats = (t: VocalSong): number => t.beatsPerBar - t.pickupBeats
    for (const t of VOCAL_TUNES) expect(t.pickupBeats, t.id).toBeLessThan(t.beatsPerBar)
    expect(VOCAL_TUNES.filter((t) => freeBeats(t) < 2).map((t) => t.id)).toEqual(['sing-saints'])
    expect(freeBeats(tune('sing-saints'))).toBe(1)
  })

  it('hold back from the Coach only the songs after the course, and only for skills the design has', () => {
    const skills = [
      'voice.pitch.match', 'voice.pitch.steps', 'voice.pitch.five-note', 'voice.pitch.hold', 'voice.range.slides', 'voice.pitch.echo',
      'voice.interval.thirds', 'voice.interval.triad', 'voice.breath.phrases', 'voice.interval.leaps', 'voice.pitch.runs', 'voice.pitch.alone',
    ]
    expect(VOCAL_TUNES).toHaveLength(10)
    for (const t of VOCAL_TUNES) {
      // A lesson opens a course song; a skill it asked for could hide the song the lesson has just handed over.
      if (t.lessonLevel <= 9) expect(t.needs ?? [], t.id).toEqual([])
      for (const id of t.needs ?? []) expect(skills, t.id).toContain(id)
    }
    // Which skill, and why: Amazing Grace is built on the notes of the home chord, and Happy Birthday is
    // the one tune with a jump wider than a sixth (its octave). Dropping or swapping a skill changes when the song is offered.
    expect(Object.fromEntries(VOCAL_TUNES.filter((t) => t.needs).map((t) => [t.id, t.needs]))).toEqual({
      'sing-amazing-grace': ['voice.interval.triad'],
      'sing-happy-birthday': ['voice.interval.leaps'],
    })
    expect(VOCAL_TUNES.filter((t) => jumpsOf(t).some((jump) => Math.abs(jump) > 9)).map((t) => t.id)).toEqual(['sing-happy-birthday'])
  })
})

describe('a singer who holds one note all the way through', () => {
  /** How many notes of a tune lie within `band` cents of a pitch held `cents` above home, in any octave. */
  function covered(song: VocalSong, cents: number, band: number): number {
    const off = (pitch: number): number => Math.abs(((((pitch * 100 - cents) % 1200) + 1800) % 1200) - 600)
    return pitchesOf(song).filter((pitch) => off(pitch) <= band).length
  }

  /** The most notes one held pitch can cover, tried every five cents round the octave. */
  function mostCovered(song: VocalSong, band: number): number {
    let most = 0
    for (let cents = 0; cents < 1200; cents += 5) most = Math.max(most, covered(song, cents, band))
    return most
  }

  it('measures a held note the way the scoring hears it: any octave counts, the note next door does not', () => {
    const song: VocalSong = { ...tune('sing-hot-cross-buns'), lines: [[[-5, 1, 'la'], [7, 1, 'la'], [9, 1, 'la'], [0, 1, 'la']]] }
    expect(covered(song, 700, 80)).toBe(2)
    expect(covered(song, 800, 80)).toBe(0)
    expect(covered(song, 1150, 80)).toBe(1)
    expect(mostCovered(song, 80)).toBe(2)
  })

  it('collects less than half of every tune on the widest band, wherever the note is held, all but Jingle Bells', () => {
    for (const t of VOCAL_TUNES.filter((s) => s.id !== 'sing-jingle-bells')) {
      expect(mostCovered(t, 80) / pitchesOf(t).length, t.id).toBeLessThan(0.5)
    }
  })

  it('collects just over half of Jingle Bells on its starting note, so "one held note stays under half" cannot be asked of it', () => {
    // The real chorus sits on mi: 26 of its 51 notes, and mi is the note the singer is given to start on.
    // Held between mi and fa, one pitch is within the two widest bands of every mi and every fa.
    const song = tune('sing-jingle-bells')
    expect(pitchesOf(song)[0]).toBe(4)
    expect([covered(song, 400, 35), pitchesOf(song).length]).toEqual([26, 51])
    expect(mostCovered(song, 80)).toBe(37)
    expect(mostCovered(song, 65)).toBe(37)
    expect(mostCovered(song, 35)).toBe(26)
  })
})

describe('what each description promises a beginner', () => {
  const distinct = (song: VocalSong): number => new Set(pitchesOf(song)).size
  /** Moves of more than one note of the scale (over two semitones), up or down, between neighbours in a line. */
  const skips = (song: VocalSong): number[] => jumpsOf(song).filter((jump) => Math.abs(jump) > 2)
  const everyLine = (song: VocalSong, test: (line: VocalStep[]) => boolean): boolean => song.lines.every(test)
  const top = (song: VocalSong): number => Math.max(...pitchesOf(song))

  const PROMISES: { id: string; says: string; holds: (song: VocalSong) => boolean }[] = [
    { id: 'sing-hot-cross-buns', says: 'three notes, each one next door', holds: (s) => distinct(s) === 3 && skips(s).length === 0 },
    { id: 'sing-mary-lamb', says: 'small steps, with one little jump', holds: (s) => skips(s).length === 1 && Math.abs(skips(s)[0]) <= 4 },
    { id: 'sing-ode-to-joy', says: 'five notes', holds: (s) => distinct(s) === 5 && skips(s).length === 0 },
    { id: 'sing-aunt-rhody', says: 'long notes', holds: (s) => everyLine(s, (line) => line.some((step) => isSung(step) && step[1] >= 2)) },
    { id: 'sing-saints', says: 'the same top note again and again', holds: (s) => everyLine(s, (line) => line.some((step) => step[0] === top(s))) },
    { id: 'sing-london-bridge', says: 'starts near the top and comes home', holds: (s) => top(s) - pitchesOf(s)[0] <= 2 && pitchesOf(s).at(-1) === 0 },
    { id: 'sing-jingle-bells', says: 'one note for most of the way', holds: (s) => pitchesOf(s).filter((pitch) => pitch === 4).length > pitchesOf(s).length / 2 },
    {
      id: 'sing-twinkle',
      says: 'one big jump right at the start',
      // The jump is the first move of the tune, and the only skip there is (it comes back when the first lines do).
      holds: (s) => jumpsOf(s).find((jump) => jump !== 0) === 7 && skips(s).every((jump) => jump === 7) && skips(s).length === 2,
    },
    { id: 'sing-amazing-grace', says: 'long notes and a wide reach', holds: (s) => spanOf(s) === 12 && everyLine(s, (line) => line.some((step) => isSung(step) && step[1] >= 2)) },
    {
      id: 'sing-happy-birthday',
      says: 'the third line has one big jump up',
      holds: (s) => jumpsOf(s).filter((jump) => Math.abs(jump) > 7).length === 1 && jumpsOf({ ...s, lines: [s.lines[2]] }).includes(12),
    },
  ]

  it('is written down here for every tune', () => {
    expect(PROMISES.map((p) => p.id)).toEqual(VOCAL_TUNES.map((t) => t.id))
  })

  for (const promise of PROMISES) {
    it(`${promise.id}: "${promise.says}" is true of the notes`, () => {
      const song = tune(promise.id)
      expect(song.description).toContain(promise.says)
      expect(promise.holds(song)).toBe(true)
    })
  }

  it('would be caught out by a tune that does not keep it', () => {
    const withLines = (id: string, lines: VocalStep[][]): VocalSong => ({ ...tune(id), lines })
    const holds = (id: string, lines: VocalStep[][]): boolean => PROMISES.find((p) => p.id === id)!.holds(withLines(id, lines))
    // A fourth note, a skip, a second jump, a line that never reaches the top, a jump that goes down.
    expect(holds('sing-hot-cross-buns', [[[4, 1, 'la'], [2, 1, 'la'], [0, 1, 'la'], [5, 1, 'la']]])).toBe(false)
    expect(holds('sing-hot-cross-buns', [[[4, 1, 'la'], [0, 1, 'la'], [2, 1, 'la']]])).toBe(false)
    expect(holds('sing-mary-lamb', [[[0, 1, 'la'], [4, 1, 'la'], [0, 1, 'la']]])).toBe(false)
    expect(holds('sing-saints', [[[0, 1, 'la'], [7, 1, 'la']], [[0, 1, 'la'], [5, 1, 'la']]])).toBe(false)
    expect(holds('sing-twinkle', [[[0, 1, 'la'], [2, 1, 'la'], [9, 1, 'la']]])).toBe(false)
    expect(holds('sing-happy-birthday', [[[0, 1, 'la']], [[0, 1, 'la']], [[7, 1, 'la'], [-5, 1, 'la']]])).toBe(false)
  })
})

for (const facts of FACTS) {
  describe(facts.id, () => {
    it('is the real tune, note for note and line for line', () => {
      const song = tune(facts.id)
      expect(song.lines.map((line) => line.map((step) => step[0]))).toEqual(parseSolfege(facts.solfege))
    })

    it(`starts on ${facts.first} and comes home to do`, () => {
      const pitches = pitchesOf(tune(facts.id))
      expect(pitches[0]).toBe(semitones(facts.first))
      expect(pitches[pitches.length - 1]).toBe(0)
      expect(spanOf(tune(facts.id))).toBe(facts.span)
    })

    it('carries the words as they are printed under the notes', () => {
      const song = tune(facts.id)
      expect(song.lines.map((line) => line.filter(isSung).map((step) => step[2]))).toEqual(parseWords(facts.words))
    })

    it('has a syllable on every sung note, none on a rest, and no word left unfinished', () => {
      const song = tune(facts.id)
      for (const line of song.lines) {
        // The rest after a line belongs to that line: the next one starts with a note, so its starting note can be given.
        expect(isSung(line[0])).toBe(true)
        expect(line[0][2]).not.toBe('')
        let open = false
        line.forEach((step, i) => {
          if (!isSung(step)) {
            expect(step).toHaveLength(2)
            // One rest at most, and only after the last note: a rest in the middle would be two lines.
            expect(i, `a rest inside a line of ${facts.id}`).toBe(line.length - 1)
            return
          }
          expect(step).toHaveLength(3)
          const syllable = step[2] as string
          expect(typeof syllable).toBe('string')
          expect(syllable).toMatch(/^([A-Za-z']+-?)?$/)
          if (syllable === '') {
            // A syllable held on the same pitch is one longer note, not two.
            const before = line[i - 1]
            expect(isSung(before) && before[0] !== step[0]).toBe(true)
          } else {
            open = syllable.endsWith('-')
          }
        })
        expect(open, `a word is left open at the end of a line of ${facts.id}`).toBe(false)
      }
    })

    it('fills its bars: every line as long as written here, and the whole tune one bar for every chord', () => {
      const song = tune(facts.id)
      expect(song.beatsPerBar).toBe(facts.beatsPerBar)
      expect(song.pickupBeats).toBe(facts.pickupBeats)
      const lengths = song.lines.map(beatsOf)
      expect(lengths).toEqual(facts.lineBeats)
      // As in a printed score, the pickup is paid back by the last bar: the tune is exactly one bar per chord.
      expect(lengths.reduce((a, b) => a + b, 0)).toBe(song.chords.length * song.beatsPerBar)
      for (const step of song.lines.flat()) {
        expect(step[1]).toBeGreaterThan(0)
        expect((step[1] * 2) % 1).toBe(0)
      }
    })

    it('has the rhythm a score prints, bar by bar', () => {
      const song = tune(facts.id)
      const bars = facts.rhythm.split(' | ').map((bar) => parseBar(bar).reduce((sum, length) => sum + length.beats, 0))
      // What is written here must itself be a score: full bars between a pickup and a last bar that together make one bar.
      const pickup = facts.pickupBeats > 0 ? [bars.shift()] : []
      expect(pickup).toEqual(facts.pickupBeats > 0 ? [facts.pickupBeats] : [])
      expect(bars.pop()).toBe(facts.beatsPerBar - facts.pickupBeats)
      expect(bars).toEqual(bars.map(() => facts.beatsPerBar))
      expect(song.lines.flat().map((step) => ({ rest: !isSung(step), beats: step[1] }))).toEqual(heardLengths(facts.rhythm))
    })

    it('has lines that are whole bars, but for a line with a pickup of its own and the line before it', () => {
      const song = tune(facts.id)
      const own = OWN_PICKUP[facts.id] ?? []
      const lengths = song.lines.map(beatsOf)
      let start = 0
      lengths.forEach((beats, i) => {
        // Where the line starts in its bar: the tune's own pickup puts it `pickupBeats` before a bar line.
        const beforeBarLine = (((song.pickupBeats - start) % song.beatsPerBar) + song.beatsPerBar) % song.beatsPerBar
        if (own.includes(i)) {
          expect(beforeBarLine, `line ${i} of ${facts.id} has a pickup of its own`).not.toBe(song.pickupBeats)
          expect((lengths[i - 1] + beats) % song.beatsPerBar).toBe(0)
        } else {
          expect(beforeBarLine, `line ${i} of ${facts.id} starts like the tune`).toBe(song.pickupBeats)
          if (!own.includes(i + 1)) expect(beats % song.beatsPerBar, `line ${i} of ${facts.id}`).toBe(0)
        }
        start += beats
      })
    })

    it('puts the right word on every bar line', () => {
      const song = tune(facts.id)
      expect(downbeats(song).join(' ')).toBe(facts.downbeats)
      // A note that is cut by a bar line is a long note that began on beat 1; anything else is a wrong length somewhere before it.
      for (const p of placed(song)) {
        const fromBarLine = (((p.start - song.pickupBeats) % song.beatsPerBar) + song.beatsPerBar) % song.beatsPerBar
        if (isSung(p.step) && fromBarLine + p.step[1] > song.beatsPerBar) expect(fromBarLine, `"${p.step[2]}" in ${facts.id}`).toBe(0)
      }
    })

    it('has one chord for every bar, each holding a note sung in its bar, and ends on the home chord', () => {
      const song = tune(facts.id)
      expect(song.chords).toEqual(facts.chords.split(' ').map((name) => DEGREE_OF[name]))
      expect(song.chords[song.chords.length - 1]).toBe('I')
      const steps = placed(song)
      song.chords.forEach((degree, bar) => {
        const from = barLine(song, bar)
        const sung = steps.filter((p) => isSung(p.step) && p.start < from + song.beatsPerBar && p.start + p.step[1] > from)
        if (sung.length === 0) return
        const fits = sung.some((p) => CHORD_NOTES[degree].includes((((p.step[0] as number) % 12) + 12) % 12))
        expect(fits, `bar ${bar + 1} of ${facts.id} is on ${degree}`).toBe(true)
      })
    })

    it('leaves room to breathe: no line over ten seconds, a last note long enough to cut short, no note too quick to hear', () => {
      const song = tune(facts.id)
      expect(song.bpm).toBeGreaterThanOrEqual(60)
      expect(song.bpm).toBeLessThanOrEqual(120)
      for (const line of song.lines) {
        const lastSung = line.findLastIndex(isSung)
        const singing = beatsOf(line.slice(0, lastSung + 1))
        expect(seconds(song, singing), `a line of ${facts.id}`).toBeLessThanOrEqual(10)
        // The arranger takes 0.4 s off the last note of a line for the breath, unless a rest is written there already.
        const restAfter = beatsOf(line.slice(lastSung + 1))
        if (seconds(song, restAfter) < 0.4) expect(seconds(song, line[lastSung][1]), `the last note of a line of ${facts.id}`).toBeGreaterThanOrEqual(0.65)
      }
      // Under a quarter of a second the scoring has almost nothing to judge, and no beginner is asked to hold a note over eight.
      for (const step of sungOf(song)) {
        expect(seconds(song, step[1]), `"${step[2]}" in ${facts.id}`).toBeGreaterThanOrEqual(0.3)
        expect(seconds(song, step[1]), `"${step[2]}" in ${facts.id}`).toBeLessThanOrEqual(8)
      }
    })

    it('says who wrote it and describes itself in one plain sentence', () => {
      const song = tune(facts.id)
      expect(song.title.length).toBeGreaterThan(0)
      const writers = WRITERS[facts.id]
      if (!writers) expect(song.credit).toBe('Traditional')
      else for (const name of [...writers, 'public domain']) expect(song.credit).toContain(name)
      expect(song.description).toMatch(/^[A-Z][^.!?]*\.$/)
      expect(song.description.length).toBeLessThanOrEqual(90)
      for (const text of [song.title, song.credit, song.description]) {
        expect(text).not.toMatch(/\b(bpm|rating|accuracy|rep|tier|push|belt|louder|as loud|tone deaf|wrong|failed|semitones?|interval|octave|pitch)\b/i)
      }
    })
  })
}

describe('the tunes the guitar side also has', () => {
  type Contour = [semitonesFromFirst: number, beatsAfterFirst: number][]

  /** A guitar melody as steps from its first note. */
  function guitarContour(chart: Chart): Contour {
    const beat = 60 / chart.tempos[0].bpm
    const first = chart.notes[0]
    return chart.notes.map((n) => [n.midi - first.midi, Math.round(((n.time - first.time) / beat) * 1000) / 1000])
  }

  /** The sung notes that start at or after `fromBeat`, as steps from the first of them. */
  function sungContour(song: VocalSong, fromBeat = 0): Contour {
    const notes = placed(song).filter((p) => isSung(p.step) && p.start >= fromBeat)
    const first = notes[0]
    return notes.map((p) => [(p.step[0] as number) - (first.step[0] as number), p.start - first.start])
  }

  /** The chord of every bar of a strummed guitar song, as its place in the key of G. */
  function guitarDegrees(chart: Chart): Degree[] {
    const inG: Record<string, Degree> = { G: 'I', C: 'IV', D: 'V', D7: 'V7' }
    const perBar = chart.timeSignatures[0].numerator
    const beat = 60 / chart.tempos[0].bpm
    const bars: Degree[] = []
    for (const n of chart.notes) bars[Math.floor(n.time / beat / perBar + 1e-6)] ??= inG[n.chordName ?? '']
    return bars
  }

  it('Ode to Joy is the melody the guitar plays', () => {
    expect(sungContour(tune('sing-ode-to-joy'))).toEqual(guitarContour(guitarOdeToJoy().chart))
  })

  it('Twinkle is the melody the guitar plays', () => {
    expect(sungContour(tune('sing-twinkle'))).toEqual(guitarContour(guitarTwinkle().chart))
  })

  it('Happy Birthday is the melody the guitar plays, pickup and all', () => {
    expect(sungContour(tune('sing-happy-birthday'))).toEqual(guitarContour(guitarHappyBirthday().chart))
  })

  it('Jingle Bells ends as the guitar plays it: the second time through the chorus, home on "sleigh"', () => {
    // The guitar plays the chorus once with its last ending; the sung chorus goes round twice.
    expect(sungContour(tune('sing-jingle-bells'), 32)).toEqual(guitarContour(guitarJingleBells().chart))
  })

  it('When the Saints has the chords the guitar strums under it, bar for bar', () => {
    expect(tune('sing-saints').chords).toEqual(guitarDegrees(guitarSaints().chart))
  })

  it('Amazing Grace has the chords the guitar strums under it, bar for bar', () => {
    expect(tune('sing-amazing-grace').chords).toEqual(guitarDegrees(guitarAmazingGrace().chart))
  })
})
