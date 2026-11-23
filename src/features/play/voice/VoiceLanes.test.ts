import { describe, expect, it } from 'vitest'
import { constantBeatGrid } from '../../../chart/timing'
import { emptyChart, type Chart, type ChartNote, type VoiceChart, type VoiceCue } from '../../../chart/types'
import { DEFAULT_RANGES } from '../../../music/keys'
import { midiToFreq } from '../../../music/pitch'
import { stringColor } from '../../../music/strings'
import { arrange, songKey } from '../../../songs/vocal/arrange'
import { VOCAL_SONGS } from '../../../songs/vocal'
import { DEFAULT_TUNING } from '../../../training/exercises/builder'
import { exerciseParams, generateExercise } from '../../../training/exercises/index'
import { maxStepFor } from '../../../training/planner'
import { VOICE_SKILLS } from '../../../training/voiceSkills'
import { HighwayRenderer } from '../Highway'
import { createLaneRenderer } from '../laneRenderer'
import type { ScoreSummary } from '../scoring'
import {
  BREATH_MARK,
  SAME_OCTAVE_REACH,
  TRAIL_SECONDS,
  VoiceLanesRenderer,
  answerShown,
  barBox,
  barLabel,
  breaksLine,
  callSounding,
  extendTrail,
  fillFraction,
  foldIntoWindow,
  foldTarget,
  glidePairs,
  laneLayout,
  lanesVisibleSeconds,
  lineX,
  missArrow,
  notesReadout,
  octaveShift,
  pitchToY,
  pitchWindow,
  turnCaptions,
  type TrailPoint,
  type VoiceLanesState,
} from './VoiceLanes'
import { VOICE } from './judge'
import { VoiceTracker, type NoteProgress } from './voiceTracker'

const voiceOf = (over: Partial<VoiceChart> = {}): VoiceChart => ({
  judge: { band: 80, minShare: 0.5 },
  cues: [],
  low: 55,
  high: 62,
  tonic: 55,
  shift: -5,
  lineStarts: [],
  ...over,
})

const note = (id: number, time: number, duration: number, midi: number, lyric?: string): ChartNote => ({
  id,
  time,
  duration,
  midi,
  string: 0,
  fret: 0,
  velocity: 0.8,
  chordId: id,
  ...(lyric === undefined ? {} : { lyric }),
})

const cue = (time: number, duration: number, midi: number, lyric?: string): VoiceCue => ({ time, duration, midi, ...(lyric === undefined ? {} : { lyric }) })

describe('pitch lanes: where a pitch is drawn', () => {
  const win = pitchWindow(voiceOf())
  const area = { top: 80, bottom: 380 }

  it('shows two notes of room under the lowest note and over the highest', () => {
    expect(win).toEqual({ bottom: 53, top: 64 })
    expect(pitchToY(53, win, area)).toBe(380)
    expect(pitchToY(64, win, area)).toBe(80)
  })

  it('draws a higher note higher up, each semitone the same step', () => {
    const ys = [55, 56, 57, 62].map((m) => pitchToY(m, win, area))
    expect(ys[1]).toBeLessThan(ys[0])
    expect(ys[3]).toBeLessThan(ys[2])
    expect(ys[0] - ys[1]).toBeCloseTo(ys[1] - ys[2], 9)
    expect(ys[0] - ys[1]).toBeCloseTo(300 / 11, 9)
  })

  it('does not round a pitch between two notes', () => {
    const between = pitchToY(57.5, win, area)
    expect(between).toBeCloseTo((pitchToY(57, win, area) + pitchToY(58, win, area)) / 2, 9)
  })

  it('still has a height for a chart of one pitch', () => {
    const one = pitchWindow({ low: 60, high: 60 })
    expect(pitchToY(60, one, area)).toBeCloseTo(230, 9)
  })
})

describe('pitch lanes: bars', () => {
  const voice = voiceOf()
  const l = laneLayout(800, 420, voice, 6)

  it('puts the line near the left, with room behind it for what was just sung', () => {
    for (const w of [320, 390, 844, 1280, 1920]) {
      expect(lineX(w)).toBeLessThan(w / 3)
      expect(lineX(w)).toBeGreaterThanOrEqual(60)
    }
    expect(l.lineX).toBe(lineX(800))
  })

  it('starts a note on the line at the moment it is due', () => {
    expect(barBox(note(0, 4, 1, 57), 4, l).x).toBeCloseTo(l.lineX, 9)
  })

  it('moves bars from right to left as the song goes on', () => {
    const early = barBox(note(0, 4, 1, 57), 2, l)
    const later = barBox(note(0, 4, 1, 57), 3, l)
    expect(early.x).toBeGreaterThan(l.lineX)
    expect(later.x).toBeLessThan(early.x)
    expect(early.x - later.x).toBeCloseTo(l.pps, 9)
  })

  it('makes a bar as long as its note lasts', () => {
    const short = barBox(note(0, 4, 0.5, 57), 0, l)
    const long = barBox(note(1, 4, 2, 57), 0, l)
    expect(long.w).toBeCloseTo(4 * short.w, 9)
    expect(long.w).toBeCloseTo(2 * l.pps, 9)
  })

  it('centres a bar on its pitch and keeps the lowest and highest note inside the lanes', () => {
    const low = barBox(note(0, 0, 1, voice.low), 0, l)
    const high = barBox(note(1, 0, 1, voice.high), 0, l)
    expect(low.y + low.h / 2).toBeCloseTo(pitchToY(voice.low, l.win, l), 9)
    expect(low.y + low.h).toBeLessThanOrEqual(l.bottom)
    expect(high.y).toBeGreaterThanOrEqual(l.top)
  })

  it('shows the whole visible stretch of time between the line and the right edge', () => {
    expect(barBox(note(0, 6, 1, 57), 0, l).x).toBeLessThanOrEqual(800)
    expect(barBox(note(0, 6, 1, 57), 0, l).x).toBeGreaterThan(800 - 40)
  })

  it('never lays out bars of no height or a negative scale on a tiny canvas', () => {
    const tiny = laneLayout(120, 90, voiceOf({ low: 48, high: 72 }), 6)
    expect(tiny.barHeight).toBeGreaterThan(0)
    expect(tiny.pps).toBeGreaterThan(0)
    expect(tiny.bottom).toBeGreaterThan(tiny.top)
  })
})

describe('pitch lanes: how much of the time is on screen', () => {
  const beatsShown = (bpm: number, width: number) => (lanesVisibleSeconds(bpm, width) * bpm) / 60

  it('shows the same number of beats at every tempo, so a slow song shows more seconds', () => {
    expect(lanesVisibleSeconds(60, 844)).toBeCloseTo(2 * lanesVisibleSeconds(120, 844), 9)
  })

  it('shows at least five beats on a narrow phone and no more than ten on a wide screen', () => {
    expect(beatsShown(72, 320)).toBeGreaterThanOrEqual(5)
    expect(beatsShown(72, 390)).toBeGreaterThanOrEqual(5)
    expect(beatsShown(72, 2560)).toBeLessThanOrEqual(10)
    expect(beatsShown(72, 1280)).toBeGreaterThan(beatsShown(72, 390))
  })

  it('follows the learner’s own setting for how far ahead to see', () => {
    expect(lanesVisibleSeconds(60, 844, 6)).toBeCloseTo(2 * lanesVisibleSeconds(60, 844, 3), 9)
  })
})

describe('pitch lanes: the part of a bar that fills in', () => {
  const n = note(0, 4, 2, 57)
  const progress = (share: number, status: NoteProgress['status'] = 'pending'): NoteProgress => ({ status, share, cents: null, octave: 0 })

  it('is empty before anything was sung', () => {
    expect(fillFraction(n, undefined, 5)).toBe(0)
    expect(fillFraction(n, progress(0), 5)).toBe(0)
  })

  it('is the share of the note sung in tune', () => {
    expect(fillFraction(n, progress(0.5), 6)).toBeCloseTo(0.5, 9)
    expect(fillFraction(n, progress(1), 6.5)).toBe(1)
  })

  it('never runs ahead of the line while the note is still being sung', () => {
    // A quarter of the bar has passed the line: credit for a note begun early must not fill what is still to come.
    expect(fillFraction(n, progress(0.6), 4.5)).toBeCloseTo(0.25, 9)
    expect(fillFraction(n, progress(0.2), 3.9)).toBe(0)
  })

  it('shows what was sung once the note is settled, wherever the bar is', () => {
    expect(fillFraction(n, progress(0.7, 'hit'), 4.1)).toBeCloseTo(0.7, 9)
    expect(fillFraction(n, progress(0.3, 'miss'), 9)).toBeCloseTo(0.3, 9)
  })

  it('stays between empty and full', () => {
    expect(fillFraction(n, progress(1.4, 'hit'), 9)).toBe(1)
    expect(fillFraction(n, progress(-0.2, 'hit'), 9)).toBe(0)
  })
})

describe('pitch lanes: the dot for the voice', () => {
  const win = pitchWindow(voiceOf({ low: 60, high: 72 }))

  it('keeps a pitch that is inside the lanes where it is', () => {
    expect(foldIntoWindow(64.3, win, 64)).toBeCloseTo(64.3, 9)
  })

  it('brings a low voice singing a high tune up onto the note, and a high voice down', () => {
    expect(foldIntoWindow(52.2, win, 64)).toBeCloseTo(64.2, 9)
    expect(foldIntoWindow(40, win, 64)).toBe(64)
    expect(foldIntoWindow(83.7, win, 72)).toBeCloseTo(71.7, 9)
  })

  it('folds towards the note being sung, not towards the middle of the screen', () => {
    // An octave under the top note: the dot belongs on the top bar, though the octave below is on screen too.
    expect(foldIntoWindow(60, win, 72)).toBe(72)
    expect(foldIntoWindow(60, win, 61)).toBe(60)
  })

  it('stays inside the lanes when the voice is off the top or the bottom', () => {
    expect(foldIntoWindow(78, win, 72)).toBe(win.top)
    expect(foldIntoWindow(55.5, win, 60)).toBe(win.bottom)
  })

  it('uses the middle of the lanes when there is no note to sing', () => {
    expect(foldIntoWindow(42, win)).toBe(66)
    expect(foldIntoWindow(90.5, win)).toBeCloseTo(66.5, 9)
  })
})

describe('pitch lanes: the octave the dot is drawn in', () => {
  it('is the one nearest the note for a voice that is heard for the first time', () => {
    expect(octaveShift(64.3, 64)).toBe(0)
    expect(octaveShift(52.2, 64)).toBe(1)
    expect(octaveShift(83.7, 72)).toBe(-1)
    expect(octaveShift(40, 64, null)).toBe(2)
  })

  it('stays the same over a jump of a fifth or a sixth, while the note before is still what is heard', () => {
    // The tune goes from C up to G. What the microphone hears reaches the screen a moment after the bar
    // does, so for that moment C is heard against G: seven under it, not five over it.
    expect(octaveShift(60, 67, 0)).toBe(0)
    expect(octaveShift(48, 67, 1)).toBe(1)
    // Down a sixth, and the note before held a little flat.
    expect(octaveShift(68.7, 60, 0)).toBe(0)
    expect(SAME_OCTAVE_REACH).toBeGreaterThanOrEqual(9)
    // As far as the reach goes, and no further.
    expect(octaveShift(67 - SAME_OCTAVE_REACH, 67, 0)).toBe(0)
    expect(octaveShift(67 - SAME_OCTAVE_REACH - 0.5, 67, 0)).toBe(1)
    expect(octaveShift(60 + SAME_OCTAVE_REACH + 0.5, 60, 0)).toBe(-1)
  })

  it('changes when the voice itself has changed octave', () => {
    // The top note taken an octave down, and a little sharp or flat at that.
    expect(octaveShift(55, 67, 0)).toBe(1)
    expect(octaveShift(55.8, 67, 0)).toBe(1)
    expect(octaveShift(54.4, 67, 0)).toBe(1)
    // And back up where it is written.
    expect(octaveShift(67, 67, 1)).toBe(0)
    // Kept short of an octave: a voice an octave away must never be drawn as "a long way under".
    expect(SAME_OCTAVE_REACH).toBeLessThan(11)
  })

  it('is settled once chosen: asked again with its own answer, it gives the same', () => {
    for (const [midi, near] of [
      [60, 67],
      [41.3, 64],
      [88, 60],
      [66, 60],
      [54, 60],
    ]) {
      const first = octaveShift(midi, near)
      expect(octaveShift(midi, near, first)).toBe(first)
      // The octave nearest the note is never further from it than half an octave.
      expect(Math.abs(midi + 12 * first - near)).toBeLessThanOrEqual(6)
    }
  })

  it('places the dot with the octave it is given, still inside the lanes', () => {
    const win = pitchWindow(voiceOf({ low: 60, high: 69 }))
    expect(foldIntoWindow(60, win, 67, 0)).toBe(60)
    expect(foldIntoWindow(48, win, 67, 1)).toBe(60)
    // Without one, the nearest: this is what made the dot leap over the bar.
    expect(foldIntoWindow(60, win, 67)).toBe(win.top)
    // Nine under the note and off the bottom of the lanes: at the edge, on the side the voice is on.
    expect(foldIntoWindow(51, win, 60, 0)).toBe(win.bottom)
  })
})

describe('pitch lanes: the note the dot is drawn by', () => {
  // C for a beat, straight up to G for a beat, a rest of two beats, then D for two.
  const notes = [note(0, 4, 1, 60), note(1, 5, 1, 67), note(2, 8, 2, 62)]

  it('is the note that sounds', () => {
    expect(foldTarget(notes, [], 4.5)).toBe(60)
    expect(foldTarget(notes, [], 5.5)).toBe(67)
    expect(foldTarget(notes, [], 9.9)).toBe(62)
  })

  it('changes at the moment the next note is due, not before', () => {
    expect(foldTarget(notes, [], 4.999)).toBe(60)
    expect(foldTarget(notes, [], 5.001)).toBe(67)
  })

  it('in a rest is the note nearer in time: the one just sung, then the one to come', () => {
    // G ended at 6 and D is due at 8.
    expect(foldTarget(notes, [], 6.4)).toBe(67)
    expect(foldTarget(notes, [], 7.5)).toBe(62)
  })

  it('before the first note is the first, and after the last one the last', () => {
    expect(foldTarget(notes, [], 0)).toBe(60)
    expect(foldTarget(notes, [], 60)).toBe(62)
  })

  it('is the app’s own note while that sounds, and the first answer once that is nearer', () => {
    const cues = [cue(0, 2, 55)]
    expect(foldTarget(notes, cues, 1)).toBe(55)
    expect(foldTarget(notes, cues, 2.5)).toBe(55)
    expect(foldTarget(notes, cues, 3.5)).toBe(60)
    // Cues in any order: the nearest one counts, not the first in the list.
    expect(foldTarget(notes, [cue(12, 1, 50), cue(0, 2, 55)], 12.5)).toBe(50)
  })

  it('is there for a chart of one note, and missing for a chart of none', () => {
    expect(foldTarget([note(0, 4, 1, 64)], [], 0)).toBe(64)
    expect(foldTarget([note(0, 4, 1, 64)], [], 30)).toBe(64)
    expect(foldTarget([], [cue(2, 1, 57)], 9)).toBe(57)
    expect(foldTarget([], [], 3)).toBeUndefined()
  })
})

describe('pitch lanes: when the app itself is singing', () => {
  const cues = [cue(0, 1, 55), cue(1, 1, 57), cue(8, 2, 59)]

  it('is from just before a note of the app to a moment after it, the stretch the tracker does not listen in', () => {
    expect(callSounding(cues, 0.5)).toBe(true)
    expect(callSounding(cues, 1.99)).toBe(true)
    expect(callSounding(cues, 9)).toBe(true)
    // What the speaker played is still in the room, and on its way through the microphone, a moment later.
    expect(callSounding(cues, 2 + VOICE.cueAfter - 0.01)).toBe(true)
    expect(callSounding(cues, 2 + VOICE.cueAfter + 0.01)).toBe(false)
    expect(callSounding(cues, 8 - VOICE.cueBefore + 0.01)).toBe(true)
    expect(callSounding(cues, 8 - VOICE.cueBefore - 0.01)).toBe(false)
  })

  it('is over by the time the singer answers', () => {
    expect(callSounding(cues, 4)).toBe(false)
    expect(callSounding(cues, 6.5)).toBe(false)
    expect(callSounding(cues, 12)).toBe(false)
  })

  it('lasts longer by the delay of the sound: what is heard now was played that long ago', () => {
    expect(callSounding(cues, 2.5, 0.27)).toBe(true)
    expect(callSounding(cues, 2 + VOICE.cueAfter + 0.27 + 0.01, 0.27)).toBe(false)
    // A delay never makes the stretch begin later: nothing of the call may slip through at its start.
    expect(callSounding(cues, 0.01, 0.27)).toBe(true)
  })

  it('never is on a chart without a note from the app', () => {
    expect(callSounding([], 0)).toBe(false)
    expect(callSounding([], 5)).toBe(false)
  })
})

describe('pitch lanes: the trail behind the dot', () => {
  it('keeps a second and a half of where the voice was', () => {
    const trail: TrailPoint[] = []
    for (let i = 0; i <= 40; i++) extendTrail(trail, i * 0.1, 60 + i * 0.01)
    expect(trail[trail.length - 1].time).toBeCloseTo(4, 9)
    expect(trail[0].time).toBeGreaterThanOrEqual(4 - TRAIL_SECONDS - 1e-9)
    expect(trail[0].time).toBeLessThan(4 - TRAIL_SECONDS + 0.11)
  })

  it('remembers silence as a gap, not as a pitch', () => {
    const trail: TrailPoint[] = []
    extendTrail(trail, 1, 60)
    extendTrail(trail, 1.1, null)
    extendTrail(trail, 1.2, 62)
    expect(trail.map((p) => p.midi)).toEqual([60, null, 62])
  })

  it('does not grow while the song stands still', () => {
    const trail: TrailPoint[] = []
    extendTrail(trail, 2, 60)
    extendTrail(trail, 2, 61)
    extendTrail(trail, 2, 62)
    expect(trail).toEqual([{ time: 2, midi: 62 }])
  })

  it('starts again when the song jumps back', () => {
    const trail: TrailPoint[] = []
    extendTrail(trail, 5, 60)
    extendTrail(trail, 5.1, 60)
    extendTrail(trail, 0.2, 64)
    expect(trail).toEqual([{ time: 0.2, midi: 64 }])
  })
})

describe('pitch lanes: answers that stay hidden', () => {
  it('shows every note of an ordinary chart', () => {
    expect(answerShown(voiceOf(), 'pending')).toBe(true)
    expect(answerShown(voiceOf(), undefined)).toBe(true)
  })

  it('hides a note of an echo until it has been judged', () => {
    const echo = voiceOf({ hideAnswers: true })
    expect(answerShown(echo, 'pending')).toBe(false)
    expect(answerShown(echo, undefined)).toBe(false)
    expect(answerShown(echo, 'skipped')).toBe(false)
    expect(answerShown(echo, 'hit')).toBe(true)
    expect(answerShown(echo, 'miss')).toBe(true)
  })
})

describe('pitch lanes: what is written at a bar', () => {
  it('writes the syllable, with its hyphen when the word goes on', () => {
    expect(barLabel('Twin-')).toEqual({ text: 'Twin-', carried: false })
    expect(barLabel('la')).toEqual({ text: 'la', carried: false })
    expect(barLabel('5')).toEqual({ text: '5', carried: false })
  })

  it('treats an empty syllable as the one before, still being held', () => {
    expect(barLabel('')).toEqual({ text: '', carried: true })
  })

  it('writes nothing on a note without words', () => {
    expect(barLabel(undefined)).toEqual({ text: '', carried: false })
  })
})

describe('pitch lanes: the arrow at a note that did not count', () => {
  const p = (status: NoteProgress['status'], reason?: NoteProgress['reason']): NoteProgress => ({ status, share: 0.1, cents: null, octave: 0, reason })

  it('points up when the note was sung under, down when it was sung over', () => {
    expect(missArrow(p('miss', 'low'))).toBe('up')
    expect(missArrow(p('miss', 'high'))).toBe('down')
  })

  it('says nothing about a note that was not heard, or was only unsteady', () => {
    expect(missArrow(p('miss', 'silent'))).toBeNull()
    expect(missArrow(p('miss', 'unsteady'))).toBeNull()
  })

  it('never marks a note that counted or is still to come', () => {
    expect(missArrow(p('hit', 'slid'))).toBeNull()
    expect(missArrow(p('hit', 'low'))).toBeNull()
    expect(missArrow(p('pending', 'high'))).toBeNull()
    expect(missArrow(p('pending'))).toBeNull()
    expect(missArrow(undefined)).toBeNull()
  })
})

describe('pitch lanes: whose turn it is', () => {
  it('says Listen over the starting note and Your turn where the tune begins', () => {
    const notes = [note(0, 4, 1, 60), note(1, 5, 1, 62), note(2, 8, 1, 64), note(3, 9, 2, 60)]
    const captions = turnCaptions(notes, [cue(0, 2, 60)], [4, 8])
    expect(captions).toEqual([
      { time: 0, end: 2, text: 'Listen' },
      // Your turn stays up for the first line only: after that the singer is singing.
      { time: 4, end: 6, text: 'Your turn' },
    ])
  })

  it('takes the notes of one call together, and names every answer', () => {
    const cues = [cue(0, 1, 60), cue(1, 1, 62), cue(2, 1, 64), cue(8, 1, 62), cue(9, 2, 60)]
    const notes = [note(0, 4, 1, 60), note(1, 5, 1, 62), note(2, 6, 1, 64), note(3, 12, 1, 62), note(4, 13, 2, 60)]
    expect(turnCaptions(notes, cues, [4, 12])).toEqual([
      { time: 0, end: 3, text: 'Listen' },
      { time: 4, end: 7, text: 'Your turn' },
      { time: 8, end: 11, text: 'Listen' },
      { time: 12, end: 15, text: 'Your turn' },
    ])
  })

  it('has nothing to say on a chart without a note from the app', () => {
    expect(turnCaptions([note(0, 1, 1, 60)], [], [1])).toEqual([])
  })

  it('does not promise a turn after a call that nothing follows', () => {
    expect(turnCaptions([], [cue(0, 2, 60)], [])).toEqual([{ time: 0, end: 2, text: 'Listen' }])
  })
})

describe('pitch lanes: glides', () => {
  it('joins each note to the next one of the same line', () => {
    const notes = [note(0, 4, 1, 60), note(1, 6, 1, 64), note(2, 8, 2, 60), note(3, 16, 1, 61), note(4, 18, 1, 65)]
    const pairs = glidePairs(notes, [4, 16])
    expect(pairs.map(([a, b]) => [a.time, b.time])).toEqual([
      [4, 6],
      [6, 8],
      [16, 18],
    ])
  })

  it('joins nothing when there is one note', () => {
    expect(glidePairs([note(0, 4, 1, 60)], [4])).toEqual([])
  })

  it('knows where a line begins between two notes', () => {
    const a = note(0, 4, 1, 60)
    const b = note(1, 6, 1, 64)
    expect(breaksLine(a, b, [4])).toBe(false)
    expect(breaksLine(a, b, [6])).toBe(true)
    // A line start written a hair off the note (seconds from a beat grid) is still that note's.
    expect(breaksLine(a, b, [6.0000004])).toBe(true)
    expect(breaksLine(a, b, [4.0000004])).toBe(false)
    expect(breaksLine(a, b, [])).toBe(false)
    expect(breaksLine(a, b, [1, 8])).toBe(false)
  })
})

describe('pitch lanes: the corner', () => {
  it('counts the notes that were in tune out of all there are', () => {
    expect(notesReadout({ perfects: 2, goods: 1, total: 8 })).toBe('3 of 8 notes')
    expect(notesReadout({ perfects: 0, goods: 0, total: 12 })).toBe('0 of 12 notes')
  })

  it('does not say "1 notes"', () => {
    expect(notesReadout({ perfects: 1, goods: 0, total: 1 })).toBe('1 of 1 note')
  })
})

/** A 2D context that takes any call and any setting, and remembers the calls with the colours they were made in. */
function stubCanvas(width = 800, height = 420) {
  const calls: Array<{ fn: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown }> = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 7 })
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} })
      return (...args: unknown[]) => {
        calls.push({ fn: prop, args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle })
      }
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value
      return true
    },
  })
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width, height }),
  } as unknown as HTMLCanvasElement
  const texts = () => calls.filter((c) => c.fn === 'fillText').map((c) => String(c.args[0]))
  return { canvas, calls, texts, clear: () => calls.splice(0, calls.length) }
}

const hud = (perfects: number, goods: number, total: number): ScoreSummary => ({
  score: perfects * 100 + goods * 80,
  streak: perfects + goods,
  maxStreak: perfects + goods,
  multiplier: 1,
  perfects,
  goods,
  misses: 0,
  total,
  judged: perfects + goods,
  accuracy: 1,
})

/** "Twinkle" as a call and its answer: the app sings two notes, the singer answers with four, the last one carried. */
function echoChart(over: Partial<VoiceChart> = {}): Chart {
  const notes = [note(0, 4, 1, 55, 'Twin-'), note(1, 5, 1, 55, 'kle'), note(2, 6, 1, 62, 'star'), note(3, 7, 1, 60, '')]
  return emptyChart({
    title: 'Echo',
    duration: 12,
    notes,
    beats: constantBeatGrid(60, 0, 12, 4),
    tempos: [{ time: 0, bpm: 60 }],
    voice: voiceOf({ cues: [cue(0, 1, 55, 'Twin-'), cue(1, 1, 55, 'kle')], lineStarts: [4], ...over }),
  })
}

function stateOf(chart: Chart, songTime: number, over: Partial<VoiceLanesState> = {}): VoiceLanesState {
  return {
    songTime,
    duration: chart.duration,
    notes: chart.notes,
    chart,
    beats: chart.beats,
    detectedMidi: null,
    detectedMatches: false,
    hud: hud(0, 0, chart.notes.length),
    lastJudgement: null,
    visibleSeconds: 6,
    paused: false,
    progressOf: () => undefined,
    ...over,
  }
}

describe('pitch lanes: drawing', () => {
  it('is what a sung chart is drawn with, and only a sung chart', () => {
    expect(createLaneRenderer(echoChart(), stubCanvas().canvas)).toBeInstanceOf(VoiceLanesRenderer)
    const guitar = createLaneRenderer(emptyChart(), stubCanvas().canvas)
    expect(guitar).toBeInstanceOf(HighwayRenderer)
    expect(guitar).not.toBeInstanceOf(VoiceLanesRenderer)
  })

  it('draws nothing on a canvas that has no size yet', () => {
    const { canvas, calls } = stubCanvas(0, 0)
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    calls.splice(0, calls.length)
    r.draw(stateOf(echoChart(), 0))
    expect(calls).toEqual([])
  })

  it('takes its size from the canvas, like the highway', () => {
    const { canvas } = stubCanvas(640, 360)
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    expect(r.width).toBe(640)
    expect(r.height).toBe(360)
    expect(canvas.width).toBe(640)
  })

  it('writes the words, both turns, a breath mark and the count of notes', () => {
    const { canvas, texts } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    r.draw(stateOf(echoChart(), 0.5, { hud: hud(0, 0, 4) }))
    const drawn = texts()
    for (const word of ['Listen', 'Your turn', 'Twin-', 'kle', 'star', BREATH_MARK, '0 of 4 notes']) expect(drawn).toContain(word)
    // The call and the answer both carry "Twin-".
    expect(drawn.filter((t) => t === 'Twin-')).toHaveLength(2)
  })

  it('brings a caption in with its turn, holds it by the line while the turn lasts and takes it out with the last note', () => {
    const { canvas, calls, clear } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart()
    const l = laneLayout(r.width, r.height, chart.voice!, 6)
    /** Where the caption was written at `t` (its left end), or null when it was not. */
    const xOf = (text: string, t: number): number | null => {
      clear()
      r.draw(stateOf(chart, t))
      const c = calls.find((x) => x.fn === 'fillText' && x.args[0] === text)
      return c ? Number(c.args[1]) : null
    }
    // The stub measures seven pixels a letter.
    const listen = 'Listen'.length * 7
    // The call lasts from 0 to 2. A second before it: over its first note, on the way in.
    expect(xOf('Listen', -1)).toBeCloseTo(l.lineX + l.pps, 6)
    // While it sounds: by the line, where the eyes are.
    expect(xOf('Listen', 0.5)).toBeCloseTo(l.lineX + 8, 6)
    expect(xOf('Listen', 1.5)).toBeCloseTo(l.lineX + 8, 6)
    // Its last moments: the word ends where the last note ends, and goes out with it.
    expect(xOf('Listen', 1.95)).toBeCloseTo(l.lineX + 0.05 * l.pps - listen, 6)
    expect(xOf('Listen', 6)).toBeNull()
    // The answer runs from 4 to 8: "Your turn" is on its way while the app still sings, then waits by the line.
    expect(xOf('Your turn', 1)).toBeCloseTo(l.lineX + 3 * l.pps, 6)
    expect(xOf('Your turn', 5)).toBeCloseTo(l.lineX + 8, 6)
    // The two never stand on each other: while both are on screen the first ends before the second begins.
    for (let t = -2; t < 9; t += 0.1) {
      const a = xOf('Listen', t)
      const b = xOf('Your turn', t)
      if (a !== null && b !== null) expect(a + listen, `at ${t.toFixed(1)}`).toBeLessThanOrEqual(b)
    }
  })

  it('writes no empty label for a carried syllable, and joins it to the note before', () => {
    const plain = stubCanvas()
    const carried = stubCanvas()
    const a = new VoiceLanesRenderer(plain.canvas)
    const b = new VoiceLanesRenderer(carried.canvas)
    a.resize()
    b.resize()
    const withWord = echoChart()
    withWord.notes = withWord.notes.map((n) => (n.lyric === '' ? { ...n, lyric: 'ah' } : n))
    a.draw(stateOf(withWord, 4))
    b.draw(stateOf(echoChart(), 4))
    expect(carried.texts()).not.toContain('')
    // One more joining curve than the same notes with a word of their own on the last one.
    const curves = (c: typeof plain) => c.calls.filter((x) => x.fn === 'bezierCurveTo').length
    expect(curves(carried)).toBe(curves(plain) + 1)
  })

  it('shows no score, multiplier, streak or percentage, and never the word Miss', () => {
    const { canvas, texts } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    r.draw(stateOf(echoChart(), 5, { hud: { ...hud(1, 1, 4), streak: 12, multiplier: 4 }, lastJudgement: { text: 'Miss', at: 4.9 } }))
    const drawn = texts().join(' | ')
    expect(drawn).toContain('2 of 4 notes')
    expect(drawn).not.toMatch(/×|streak|SCORE|ACCURACY|%|Miss/i)
  })

  it('shows a short word of praise when a note has just counted', () => {
    const { canvas, texts } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    r.draw(stateOf(echoChart(), 5.2, { lastJudgement: { text: 'Perfect!', at: 5.1 } }))
    expect(texts()).toContain('Perfect!')
  })

  it('fills the sung part of a bar from its start, in the colour of the dot', () => {
    const { canvas, calls } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart()
    const state = stateOf(chart, 5.5, { progressOf: (id) => (id === 0 ? { status: 'hit', judgement: 'good', share: 0.5, cents: 10, octave: 0 } : undefined) })
    r.draw(state)
    const l = laneLayout(r.width, r.height, chart.voice!, state.visibleSeconds)
    const box = barBox(chart.notes[0], 5.5, l)
    const clips = calls.filter((c) => c.fn === 'rect' && Math.abs(Number(c.args[0]) - box.x) < 0.5)
    expect(clips).toHaveLength(1)
    expect(Number(clips[0].args[2])).toBeCloseTo(box.w * 0.5, 6)
    // Nothing else was sung, so nothing else is filled.
    expect(calls.filter((c) => c.fn === 'rect')).toHaveLength(1)
  })

  it('puts the dot on the line at the pitch that is sung, an octave folded and not rounded', () => {
    const { canvas, calls } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart()
    // The third note (62) is due; the singer is an octave under it and a little sharp.
    const state = stateOf(chart, 6.4, { detectedMidi: 50.3 })
    r.draw(state)
    const l = laneLayout(r.width, r.height, chart.voice!, state.visibleSeconds)
    const dots = calls.filter((c) => c.fn === 'arc' && c.args[0] === l.lineX)
    expect(dots).toHaveLength(1)
    expect(Number(dots[0].args[1])).toBeCloseTo(pitchToY(62.3, l.win, l), 6)
  })

  it('puts the dot on the bar that is being sung when the lanes are taller than an octave', () => {
    const { canvas, calls } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart({ high: 69 })
    chart.notes = [note(0, 4, 2, 69, 'la')]
    // An octave under the top note. The octave below is on screen as well, and nearer the middle: the dot still belongs on the bar.
    const state = stateOf(chart, 5, { detectedMidi: 57 })
    r.draw(state)
    const l = laneLayout(r.width, r.height, chart.voice!, state.visibleSeconds)
    const dots = calls.filter((c) => c.fn === 'arc' && c.args[0] === l.lineX)
    expect(dots).toHaveLength(1)
    expect(Number(dots[0].args[1])).toBeCloseTo(pitchToY(69, l.win, l), 6)
  })

  /** Draws one frame after another on one renderer and reads where the dot was put each time. */
  function dotFollower(chart: Chart) {
    const { canvas, calls, clear } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const l = laneLayout(r.width, r.height, chart.voice!, 6)
    return {
      l,
      /** The pitch the dot was drawn at (read back from its y), or null when there was none. */
      at(songTime: number, detectedMidi: number | null): number | null {
        clear()
        r.draw(stateOf(chart, songTime, { detectedMidi }))
        const dots = calls.filter((c) => c.fn === 'arc' && c.args[0] === l.lineX)
        if (dots.length === 0) return null
        const y = Number(dots[0].args[1])
        return l.win.bottom + ((l.bottom - y) / (l.bottom - l.top)) * (l.win.top - l.win.bottom)
      },
    }
  }

  /** C for a beat, then up a fifth to G: the jump of "Twinkle, twinkle". */
  function fifthChart(): Chart {
    const chart = echoChart({ low: 60, high: 69, cues: [] })
    chart.notes = [note(0, 4, 1, 60, 'Twin-'), note(1, 5, 1, 67, 'kle')]
    return chart
  }

  it('does not throw the dot over the bar at a jump of a fifth, while the note before is still what is heard', () => {
    const dot = dotFollower(fifthChart())
    expect(dot.at(4.5, 60)).toBeCloseTo(60, 6)
    // The bar of G is on the line. The sound is always a moment behind the screen, so C is still heard:
    // the dot stays where the voice is, under the bar, and does not appear five notes over it.
    expect(dot.at(5.1, 60)).toBeCloseTo(60, 6)
    expect(dot.at(5.15, 60.4)).toBeCloseTo(60.4, 6)
    expect(dot.at(5.3, 67)).toBeCloseTo(67, 6)
  })

  it('does the same for a voice an octave under the lanes', () => {
    const dot = dotFollower(fifthChart())
    expect(dot.at(4.5, 48)).toBeCloseTo(60, 6)
    expect(dot.at(5.1, 48)).toBeCloseTo(60, 6)
    expect(dot.at(5.3, 55)).toBeCloseTo(67, 6)
  })

  it('follows a voice that takes the high note an octave down', () => {
    const dot = dotFollower(fifthChart())
    expect(dot.at(4.5, 60)).toBeCloseTo(60, 6)
    expect(dot.at(5.3, 55.2)).toBeCloseTo(67.2, 6)
    // And a rest in the singing changes nothing about the octave the voice is in.
    expect(dot.at(5.5, null)).toBeNull()
    expect(dot.at(5.6, 55)).toBeCloseTo(67, 6)
  })

  it('finds the octave afresh when the song starts again', () => {
    const dot = dotFollower(fifthChart())
    // A low voice: an octave under the lanes all through the first run.
    expect(dot.at(4.5, 48)).toBeCloseTo(60, 6)
    // From the top again, and now a voice a little under the first note. With the octave of the run
    // before it would be drawn seven over the bar.
    expect(dot.at(3.9, 55)).toBe(dot.l.win.bottom)
  })

  it('finds the octave afresh for another chart', () => {
    const { canvas, calls, clear } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const first = fifthChart()
    r.draw(stateOf(first, 4.5, { detectedMidi: 48 }))
    // The next exercise, later on the clock than the first was left: nothing of the octave before is kept.
    const next = fifthChart()
    clear()
    r.draw(stateOf(next, 4.6, { detectedMidi: 55 }))
    const l = laneLayout(r.width, r.height, next.voice!, 6)
    const dots = calls.filter((c) => c.fn === 'arc' && c.args[0] === l.lineX)
    expect(dots).toHaveLength(1)
    expect(Number(dots[0].args[1])).toBeCloseTo(pitchToY(l.win.bottom, l.win, l), 6)
  })

  it('shows no dot while nothing is heard', () => {
    const { canvas, calls } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    r.draw(stateOf(echoChart(), 6.4))
    expect(calls.filter((c) => c.fn === 'arc')).toHaveLength(0)
  })

  it('draws the trail of the last moments behind the line', () => {
    const { canvas, calls, clear } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart()
    for (let t = 4; t < 5; t += 0.05) r.draw(stateOf(chart, t, { detectedMidi: 55 + (t - 4) }))
    clear()
    r.draw(stateOf(chart, 5, { detectedMidi: 56 }))
    const l = laneLayout(r.width, r.height, chart.voice!, 6)
    const strokes = calls.filter((c) => c.fn === 'lineTo' && Number(c.args[0]) < l.lineX && Number(c.args[0]) > l.lineX - 1.2 * l.pps)
    // About twenty steps were sung in the second before; the trail shows them where they were sung.
    expect(strokes.length).toBeGreaterThanOrEqual(15)
    const first = strokes.find((c) => Math.abs(Number(c.args[0]) - (l.lineX - 0.5 * l.pps)) < 0.03 * l.pps)
    expect(first).toBeDefined()
    expect(Number(first!.args[1])).toBeCloseTo(pitchToY(55.5, l.win, l), 0)
  })

  it('keeps the notes of an echo out of sight until each is judged', () => {
    const { canvas, texts, clear } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart({ hideAnswers: true })
    r.draw(stateOf(chart, 3))
    // Neither the answer nor the call gives the tune away.
    for (const word of ['Twin-', 'kle', 'star']) expect(texts()).not.toContain(word)
    expect(texts()).toContain('Listen')
    clear()
    r.draw(stateOf(chart, 5.5, { progressOf: (id) => (id === 0 ? { status: 'hit', judgement: 'perfect', share: 1, cents: 0, octave: 0 } : undefined) }))
    expect(texts()).toContain('Twin-')
    expect(texts()).not.toContain('kle')
  })

  it('lets a hidden note fill in while it is sung, without saying where it is', () => {
    const { canvas, calls, texts } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart({ hideAnswers: true })
    // Half way through the first answer, in tune from its start.
    const state = stateOf(chart, 4.5, { progressOf: (id) => (id === 0 ? { status: 'pending', share: 0.5, cents: null, octave: 0 } : undefined) })
    r.draw(state)
    const l = laneLayout(r.width, r.height, chart.voice!, state.visibleSeconds)
    const box = barBox(chart.notes[0], 4.5, l)
    const fills = calls.filter((c) => c.fn === 'rect')
    expect(fills).toHaveLength(1)
    expect(Number(fills[0].args[0])).toBeCloseTo(box.x, 6)
    expect(Number(fills[0].args[2])).toBeCloseTo(box.w * 0.5, 6)
    // The fill is as tall as the lanes: it says when, not which note.
    expect(Number(fills[0].args[1])).toBeCloseTo(l.top, 6)
    expect(Number(fills[0].args[3])).toBeCloseTo(l.bottom - l.top, 6)
    expect(texts()).not.toContain('Twin-')
  })

  /** The dots on the line and the strokes of the trail in one drawn frame. */
  const voiceMarks = (calls: ReturnType<typeof stubCanvas>['calls'], x: number) => ({
    dots: calls.filter((c) => c.fn === 'arc' && c.args[0] === x).length,
    trail: calls.filter((c) => c.fn === 'lineTo' && c.strokeStyle === stringColor(1)).length,
  })

  it('does not draw the call of an echo by ear with the dot: what the microphone hears of the speaker is not shown', () => {
    const { canvas, calls, clear } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart({ hideAnswers: true })
    const l = laneLayout(r.width, r.height, chart.voice!, 6)
    // The app sings 55, 55 from 0 to 2 and a bare phone hears it. Nothing of it may reach the screen,
    // neither the dot nor the line it leaves behind: together they would write out the hidden tune.
    for (let t = 0.1; t < 2.2; t += 0.05) {
      clear()
      r.draw(stateOf(chart, t, { detectedMidi: 55, playing: true }))
      expect(voiceMarks(calls, l.lineX), `at ${t.toFixed(2)}`).toEqual({ dots: 0, trail: 0 })
    }
    // In the rest before the answer nothing is left behind the line either.
    clear()
    r.draw(stateOf(chart, 2.2 + VOICE.cueAfter, { detectedMidi: null, playing: true }))
    expect(voiceMarks(calls, l.lineX)).toEqual({ dots: 0, trail: 0 })
    // The singer's own turn: the dot is back, and its trail with it.
    for (let t = 4; t < 4.5; t += 0.05) {
      clear()
      r.draw(stateOf(chart, t, { detectedMidi: 55, playing: true }))
    }
    expect(voiceMarks(calls, l.lineX).dots).toBe(1)
    expect(voiceMarks(calls, l.lineX).trail).toBeGreaterThanOrEqual(5)
  })

  it('allows for the delay of the sound: the end of a call is heard that much later', () => {
    const { canvas, calls, clear } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart({ hideAnswers: true })
    const l = laneLayout(r.width, r.height, chart.voice!, 6)
    const at = 2 + VOICE.cueAfter + 0.1
    r.draw(stateOf(chart, at, { detectedMidi: 55, playing: true, lag: 0.27 }))
    expect(voiceMarks(calls, l.lineX).dots).toBe(0)
    clear()
    r.draw(stateOf(chart, at, { detectedMidi: 55, playing: true, lag: 0 }))
    expect(voiceMarks(calls, l.lineX).dots).toBe(1)
  })

  it('still shows the voice during a call when the notes are in plain sight, and whenever nothing is playing', () => {
    const dotsAt = (chart: Chart, over: Partial<VoiceLanesState>) => {
      const { canvas, calls } = stubCanvas()
      const r = new VoiceLanesRenderer(canvas)
      r.resize()
      r.draw(stateOf(chart, 0.5, { detectedMidi: 55, ...over }))
      return voiceMarks(calls, laneLayout(r.width, r.height, chart.voice!, 6).lineX).dots
    }
    // Nothing is hidden on this chart: a singer who hums along with the call sees where they are.
    expect(dotsAt(echoChart(), { playing: true })).toBe(1)
    // Before the start, in the count-in and in a pause the app is not singing: the dot shows that the microphone hears.
    expect(dotsAt(echoChart({ hideAnswers: true }), { playing: false })).toBe(1)
    // A screen that does not say whether the song is playing gets the careful answer.
    expect(dotsAt(echoChart({ hideAnswers: true }), {})).toBe(0)
  })

  it('draws a glide between the notes of a slide, and none on other charts', () => {
    const curves = (chart: Chart) => {
      const { canvas, calls } = stubCanvas()
      const r = new VoiceLanesRenderer(canvas)
      r.resize()
      r.draw(stateOf(chart, 4))
      return calls.filter((c) => c.fn === 'bezierCurveTo').length
    }
    const slide = (glide: boolean): Chart => {
      const chart = echoChart(glide ? { glide: true } : {})
      // Home, top, home, each with a beat between for the glide; every note has its own word, so nothing is "carried".
      chart.notes = [note(0, 4, 1, 55, '1'), note(1, 6, 1, 59, '3'), note(2, 8, 2, 55, '1')]
      chart.voice!.cues = [cue(0, 1, 55, '1')]
      return chart
    }
    expect(curves(slide(false))).toBe(0)
    expect(curves(slide(true))).toBe(2)
  })

  it('draws no glide over the breath between two turns of a slide', () => {
    const { canvas, calls } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const chart = echoChart({ glide: true, lineStarts: [4, 12], cues: [] })
    // Two turns of home, top, home. The second begins at 12, after a rest to breathe in.
    chart.notes = [note(0, 4, 1, 55, '1'), note(1, 6, 1, 59, '3'), note(2, 8, 2, 55, '1'), note(3, 12, 1, 55, '1'), note(4, 14, 1, 59, '3'), note(5, 16, 2, 55, '1')]
    chart.duration = 20
    // Enough of the song on screen to see both turns at once.
    r.draw(stateOf(chart, 4, { visibleSeconds: 20 }))
    expect(calls.filter((c) => c.fn === 'bezierCurveTo')).toHaveLength(4)
  })

  it('marks a note sung under with an arrow up, and one sung over with an arrow down', () => {
    const { canvas, calls, texts } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const progress: Record<number, NoteProgress> = {
      0: { status: 'miss', share: 0.1, cents: -140, octave: 0, reason: 'low' },
      1: { status: 'miss', share: 0, cents: 120, octave: 0, reason: 'high' },
      2: { status: 'miss', share: 0, cents: null, octave: 0, reason: 'silent' },
    }
    const chart = echoChart()
    const state = stateOf(chart, 7.1, { progressOf: (id) => progress[id] })
    r.draw(state)
    const arrows = texts().filter((t) => t === '↑' || t === '↓')
    expect(arrows.sort()).toEqual(['↑', '↓'])
    // Over the end of its bar: a note is judged after it has passed the line, and its start may be off the screen by then.
    const l = laneLayout(r.width, r.height, chart.voice!, state.visibleSeconds)
    const box = barBox(chart.notes[0], 7.1, l)
    const up = calls.find((c) => c.fn === 'fillText' && c.args[0] === '↑')!
    expect(Number(up.args[1])).toBeGreaterThan(box.x + box.w / 2)
    expect(Number(up.args[1])).toBeLessThanOrEqual(box.x + box.w)
    expect(Number(up.args[2])).toBeLessThanOrEqual(box.y)
  })

  it('says Paused over a paused song', () => {
    const { canvas, texts } = stubCanvas()
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    r.draw(stateOf(echoChart(), 3, { paused: true }))
    expect(texts()).toContain('Paused')
  })

  it('draws a chart with no notes, no beats and no cues without complaint', () => {
    const { canvas, texts } = stubCanvas(390, 300)
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const empty = emptyChart({ duration: 0, voice: voiceOf({ low: 60, high: 60 }) })
    expect(() => r.draw(stateOf(empty, 0, { detectedMidi: 30 }))).not.toThrow()
    expect(texts()).toContain('0 of 0 notes')
  })
})

/**
 * The lanes on what they will really be given: every exercise of every singing skill and every song
 * at every level, as the generators and the arranger build them today. Nothing here knows how a chart
 * was made; it only looks at what was drawn.
 */
describe('pitch lanes: every sung chart the app makes', () => {
  interface Sung {
    name: string
    chart: Chart
  }

  const RANGES = [DEFAULT_RANGES.lower, DEFAULT_RANGES.higher, { low: 45, high: 59, easy: 52 }]

  const exercises: Sung[] = VOICE_SKILLS.flatMap((skill) =>
    RANGES.flatMap((range) => {
      const steps: Array<number | undefined> = skill.steps ? skill.steps.map((_, i) => i).filter((i) => i <= maxStepFor(skill, range)) : [undefined]
      return steps.map((step) => {
        const generatorId = skill.generators[0]
        const params = exerciseParams(skill, generatorId, skill.startTempo, { ...range, ...(step === undefined ? {} : { step, startStep: step }) })
        return { name: `${skill.id} step ${step ?? '-'} in ${range.low}-${range.high}`, chart: generateExercise(skill, generatorId, params, DEFAULT_TUNING).chart }
      })
    }),
  )

  const songs: Sung[] = VOCAL_SONGS.flatMap((song) => {
    const shift = songKey(song, RANGES[2]).shift
    const whole = [0, 1, 2, 3, 4, 5].map((level) => ({ name: `${song.id} level ${level}`, chart: arrange(song, { shift, level }) }))
    // "Practise one line": the shortest charts there are, some of them on a single pitch.
    const lines = song.lines.flatMap((_, onlyLine) => [0, 2].map((level) => ({ name: `${song.id} line ${onlyLine} level ${level}`, chart: arrange(song, { shift, level, onlyLine }) })))
    return [...whole, ...lines]
  })

  const ALL = [...exercises, ...songs]

  /** Draws the whole chart, a frame every `step` seconds, as a run in which every note has counted once it is past. */
  function drawThrough(chart: Chart, step: number, size: [number, number]) {
    const { canvas, calls, clear } = stubCanvas(size[0], size[1])
    const r = new VoiceLanesRenderer(canvas)
    r.resize()
    const texts = new Set<string>()
    const captions = new Set<string>()
    let unsound = 0
    for (let t = 0; t <= chart.duration + step; t += step) {
      clear()
      const state = stateOf(chart, t, {
        visibleSeconds: lanesVisibleSeconds(chart.tempos[0]?.bpm ?? 120, size[0]),
        // A voice wandering over two octaves, silent now and then.
        detectedMidi: Math.floor(t) % 4 === 3 ? null : 40 + ((t * 7) % 24),
        progressOf: (id) => {
          const n = chart.notes.find((x) => x.id === id)
          if (!n) return undefined
          if (t < n.time) return { status: 'pending', share: 0, cents: null, octave: 0 }
          if (t < n.time + n.duration) return { status: 'pending', share: 0.4, cents: null, octave: 0 }
          return id % 3 === 0 ? { status: 'miss', share: 0.2, cents: -130, octave: 0, reason: 'low' } : { status: 'hit', judgement: 'good', share: 0.9, cents: 12, octave: -1 }
        },
      })
      r.draw(state)
      for (const c of calls) {
        if (c.fn === 'fillText') {
          texts.add(String(c.args[0]))
          if (c.args[0] === 'Listen' || c.args[0] === 'Your turn') captions.add(String(c.args[0]))
        }
        // A coordinate that is not a number draws nothing and says nothing: the worst kind of fault on a canvas.
        for (const a of c.args) if (typeof a === 'number' && !Number.isFinite(a)) unsound++
      }
    }
    return { texts, captions, unsound }
  }

  it('has charts to look at: every skill, every song, every level', () => {
    expect(exercises.length).toBeGreaterThanOrEqual(VOICE_SKILLS.length * 2)
    expect(songs.length).toBeGreaterThanOrEqual(VOCAL_SONGS.length * 6)
    for (const { name, chart } of ALL) {
      expect(chart.voice, name).toBeDefined()
      expect(chart.notes.length, name).toBeGreaterThan(0)
    }
  })

  it('draws each of them from start to end, on a phone and on a wide screen, with every coordinate a number', () => {
    for (const { name, chart } of ALL) {
      for (const size of [
        [390, 560],
        [1280, 620],
      ] as Array<[number, number]>) {
        const { unsound, texts } = drawThrough(chart, 0.5, size)
        expect(unsound, name).toBe(0)
        expect([...texts].filter((t) => t.trim() === '' || /undefined|NaN|null/.test(t)), name).toEqual([])
      }
    }
  })

  it('writes every word of every chart, except on an echo by ear, where judged notes show theirs', () => {
    for (const { name, chart } of ALL) {
      const { texts } = drawThrough(chart, 0.25, [844, 390])
      const words = new Set(chart.notes.map((n) => n.lyric).filter((w): w is string => !!w))
      expect(words.size, name).toBeGreaterThan(0)
      for (const w of words) expect(texts.has(w), `${name}: "${w}"`).toBe(true)
    }
  })

  it('says Listen wherever the app sings first, and Your turn wherever the singer answers', () => {
    for (const { name, chart } of ALL) {
      const voice = chart.voice!
      const { captions } = drawThrough(chart, 0.5, [844, 390])
      expect(captions.has('Listen'), name).toBe(voice.cues.length > 0)
      expect(captions.has('Your turn'), name).toBe(voice.cues.length > 0)
      // One "Your turn" for each call that is answered, and never one without a call before it.
      const turns = turnCaptions(chart.notes, voice.cues, voice.lineStarts)
      const mine = turns.filter((c) => c.text === 'Your turn')
      for (const c of mine) {
        expect(chart.notes.some((n) => Math.abs(n.time - c.time) < 1e-6), name).toBe(true)
        expect(turns.some((k) => k.text === 'Listen' && k.end <= c.time + 1e-6), name).toBe(true)
        expect(c.end, name).toBeGreaterThan(c.time)
      }
      // The words never stand over each other: each caption ends before the next begins.
      for (let i = 1; i < turns.length; i++) expect(turns[i].time, name).toBeGreaterThanOrEqual(turns[i - 1].end - 1e-6)
    }
  })

  it('never draws a note outside the lanes: what the chart says is its range holds every note and cue', () => {
    for (const { name, chart } of ALL) {
      const voice = chart.voice!
      const l = laneLayout(844, 390, voice, 6)
      for (const item of [...chart.notes, ...voice.cues]) {
        const box = barBox(item, 0, l)
        expect(box.y, name).toBeGreaterThanOrEqual(l.top)
        expect(box.y + box.h, name).toBeLessThanOrEqual(l.bottom)
      }
    }
  })
})

/**
 * The lanes on what the voice tracker really hands them, not on progress written by hand: the two are
 * built apart, and a share that was seconds, or cents with the other sign, would pass every test above.
 */
describe('pitch lanes: drawn from a real run', () => {
  const SR = 44100
  const HOP = 512 / SR
  /** A frame reports the pitch of the middle of its window, which lies this far before its time stamp. */
  const CENTRE = 1024 / SR
  const voice = voiceOf({ low: 60, high: 64, tonic: 60, shift: 0, lineStarts: [1] })
  const notes = [note(0, 1, 1, 60, 'la'), note(1, 3, 1, 64, 'la')]
  const chart = emptyChart({ source: 'builtin', duration: 6, notes, beats: constantBeatGrid(60, 0, 6, 4), tempos: [{ time: 0, bpm: 60 }], voice })
  interface Sung {
    from: number
    to: number
    midi: number
  }

  function armed(): VoiceTracker {
    const tracker = new VoiceTracker(chart, notes, { sampleRate: SR })
    tracker.seek(0)
    return tracker
  }

  /** Feeds the tracker what the detector would report up to song time `until`, as the player does; returns the last pitch for the screen. */
  function hear(tracker: VoiceTracker, sung: Sung[], until: number): number | null {
    let shown: number | null = null
    for (let k = Math.round(-0.5 / HOP); k * HOP < until; k++) {
      const time = k * HOP
      const s = sung.find((x) => time - CENTRE >= x.from && time - CENTRE < x.to)
      const frame = s ? { freq: midiToFreq(s.midi), clarity: 0.95, rms: 0.05, time } : { freq: 0, clarity: 0, rms: 0.001, time }
      shown = tracker.frame(frame, time, { clarityThreshold: 0.85, a4: 440 }).midi
      tracker.advance(time)
    }
    return shown
  }

  it('points the arrow to where the note is: up after singing under it, down after singing over it', () => {
    const tracker = armed()
    hear(tracker, [{ from: 1, to: 2, midi: 58.5 }, { from: 3, to: 4, midi: 65.5 }], 5)
    tracker.advance(Number.POSITIVE_INFINITY)
    expect(tracker.progressOf(0)).toMatchObject({ status: 'miss', reason: 'low' })
    expect(missArrow(tracker.progressOf(0))).toBe('up')
    expect(tracker.progressOf(1)).toMatchObject({ status: 'miss', reason: 'high' })
    expect(missArrow(tracker.progressOf(1))).toBe('down')
  })

  it('fills a bar as it is sung, up to the line, and whole once the note has counted', () => {
    const tracker = armed()
    const sung = [{ from: 1, to: 2, midi: 60 }]
    hear(tracker, sung, 1.5)
    const half = fillFraction(notes[0], tracker.progressOf(0), 1.5)
    // Half of the note has passed the line and all of that was in tune.
    expect(half).toBeGreaterThan(0.3)
    expect(half).toBeLessThanOrEqual(0.5)
    hear(tracker, sung, 3)
    expect(tracker.progressOf(0)).toMatchObject({ status: 'hit' })
    expect(fillFraction(notes[0], tracker.progressOf(0), 3)).toBe(1)
    // The note nobody sang stays empty, whatever it turns out as.
    tracker.advance(Number.POSITIVE_INFINITY)
    expect(fillFraction(notes[1], tracker.progressOf(1), 6)).toBe(0)
  })

  it('leaves a bar half full when only its first half was sung', () => {
    const tracker = armed()
    hear(tracker, [{ from: 1, to: 1.5, midi: 60 }], 3)
    tracker.advance(Number.POSITIVE_INFINITY)
    const filled = fillFraction(notes[0], tracker.progressOf(0), 3)
    expect(filled).toBeGreaterThan(0.3)
    expect(filled).toBeLessThan(0.7)
  })

  it('puts the dot of a low voice on the bar, a little over it when the voice is a little sharp', () => {
    const tracker = armed()
    const shown = hear(tracker, [{ from: 1, to: 2, midi: 48.3 }], 1.5)
    expect(shown).not.toBeNull()
    const near = foldTarget(notes, voice.cues, 1.5)
    expect(near).toBe(60)
    expect(foldIntoWindow(shown!, pitchWindow(voice), near)).toBeCloseTo(60.3, 1)
  })
})
