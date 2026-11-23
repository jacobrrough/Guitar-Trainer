/**
 * "Meet the note": the learner hears a note, then slides until their dot sits on the bar and holds it.
 * Nothing is scored or stored, so the only things to get right are when the note counts as found, that
 * any octave will do, that the app's own note is never taken for the learner's, and that running out of
 * time is "not yet" and nothing worse.
 *
 * The rules first, on frames written by hand; then the virtual singer through the app's real analyser.
 */
import { describe, expect, it, vi } from 'vitest'
import { FrameAnalyzer } from '../../audio/pitch/frameAnalyzer'
import { renderVoiceNotes } from '../../audio/voice'
import { DEFAULT_RANGES, MIN_RANGE_SPAN, type RangeAroundEasy } from '../../music/keys'
import { freqToMidi } from '../../music/pitch'
import { mix, phoneMic } from '../play/simCases.testutil'
import { analyseMic } from '../play/simulate'
import { VOICE, voiceDetector } from '../play/voice/judge'
import { sing, type SingOptions, type SungNote } from '../play/voice/virtualSinger.testutil'
import type { EarFrame, Heard } from '../play/voice/voiceEar'
import { GuidePlayer, MATCH, MATCH_COPY, NoteMatcher, foldNear, matchLine, matchNotes, noteLabel, playGuideNote, type MatchStatus, type MatchView } from './noteMatch'
import { RANGE, VoiceListener } from './rangeFinder'

// The sung cases render and analyse up to half a minute of audio each.
vi.setConfig({ testTimeout: 120_000 })

/** Seconds between two detector frames at 44.1 kHz. */
const HOP = 512 / 44100
const NOTE = 52

function voice(midi: number, seconds: number, from: number): Heard[] {
  const out: Heard[] = []
  for (let i = 0; i < Math.round(seconds / HOP); i++) {
    const t = from + i * HOP
    out.push({ at: t, time: t, midi, rms: 0.05, clarity: 0.95, seconds: HOP })
  }
  return out
}

/** Gives a matcher what was heard, frame by frame as the microphone would, silence included: call it with the time to go on to. */
function feeding(matcher: NoteMatcher, heard: Heard[] = []): (until: number) => MatchStatus[] {
  let i = 0
  let t = 0
  return (until) => {
    const seen: MatchStatus[] = []
    for (; t < until; t += HOP) {
      const now: Heard[] = []
      while (i < heard.length && heard[i].time <= t + 1e-9) now.push(heard[i++])
      matcher.listen(now, t)
      seen.push(matcher.view().status)
    }
    return seen
  }
}

describe('the numbers', () => {
  it('are the ones of the plan: one second in tune inside two and a half, three notes, the widest scoring band', () => {
    expect(MATCH).toMatchObject({ inTune: 1, within: 2.5, notes: 3, band: 80 })
  })

  it('wait after the app has sung as long as the scorer waits after a cue', () => {
    expect(MATCH.afterTone).toBe(VOICE.cueAfter)
    // The note is sung at least as long as the learner is asked to hold it.
    expect(MATCH.tone).toBeGreaterThanOrEqual(MATCH.inTune)
  })

  it('give a beginner time to look for the note, and do not leave them looking for ever', () => {
    expect(MATCH.timeout).toBeGreaterThanOrEqual(15)
    expect(MATCH.timeout).toBeLessThanOrEqual(30)
  })
})

describe('finding the note', () => {
  it('takes one second in tune', () => {
    const matcher = new NoteMatcher(NOTE, 0)
    const feed = feeding(matcher, voice(NOTE, 3, 1))
    feed(1 + MATCH.inTune - 0.1)
    expect(matcher.view()).toMatchObject({ status: 'listening', where: 'on' })
    expect(matcher.view().held).toBeGreaterThan(0.8)
    expect(matcher.view().held).toBeLessThan(1)
    feed(1 + MATCH.inTune + 0.1)
    expect(matcher.view()).toMatchObject({ status: 'found', held: 1 })
  })

  it('adds up the time in tune inside two and a half seconds, so a wobble does not start it over', () => {
    const matcher = new NoteMatcher(NOTE, 0)
    feeding(matcher, [...voice(NOTE, 0.6, 1), ...voice(NOTE + 3, 0.5, 1.6), ...voice(NOTE, 0.6, 2.1)])(2.8)
    expect(matcher.view().status).toBe('found')
  })

  it('forgets what was sung more than two and a half seconds ago', () => {
    const matcher = new NoteMatcher(NOTE, 0)
    const seen = feeding(matcher, [...voice(NOTE, 0.6, 1), ...voice(NOTE, 0.6, 1.6 + MATCH.within - 0.3)])(6)
    expect(seen).not.toContain('found')
    // The same two stretches a second closer together are inside the window.
    const closer = new NoteMatcher(NOTE, 0)
    expect(feeding(closer, [...voice(NOTE, 0.6, 1), ...voice(NOTE, 0.6, 1.6 + MATCH.within - 1.3)])(6)).toContain('found')
  })

  it('is as wide as the widest band a first exercise is scored with, and no wider', () => {
    expect(MATCH.band).toBe(80)
    const inside = new NoteMatcher(NOTE, 0)
    feeding(inside, voice(NOTE - 0.7, 2, 0.5))(3)
    expect(inside.view().status).toBe('found')
    const outside = new NoteMatcher(NOTE, 0)
    feeding(outside, voice(NOTE - 0.9, 2, 0.5))(2.4)
    expect(outside.view()).toMatchObject({ status: 'listening', where: 'under', held: 0 })
  })

  it('counts the note in any octave, and remembers which one it was', () => {
    for (const [sung, octave] of [[NOTE, 0], [NOTE - 12, -1], [NOTE + 12.3, 1], [NOTE - 24, -2]]) {
      const matcher = new NoteMatcher(NOTE, 0)
      feeding(matcher, voice(sung, 2, 0.5))(3)
      expect(matcher.view(), `sung on ${sung}`).toMatchObject({ status: 'found', octave })
    }
  })

  it('stays found once it was found', () => {
    const matcher = new NoteMatcher(NOTE, 0)
    const seen = feeding(matcher, [...voice(NOTE, 1.5, 0.5), ...voice(NOTE + 5, 4, 2)])(7)
    expect(seen[seen.length - 1]).toBe('found')
    expect(matcher.view().octave).toBe(0)
  })

  it('does not listen before its time: the note the app plays is not the learner singing', () => {
    // The guide note sounds from 0.2 s to 2.7 s; listening opens at 3 s.
    const matcher = new NoteMatcher(NOTE, 3)
    const feed = feeding(matcher, [...voice(NOTE, 2.5, 0.2), ...voice(NOTE, 1.5, 4)])
    feed(3.9)
    expect(matcher.view()).toMatchObject({ status: 'listening', held: 0, where: 'silent' })
    feed(4 + MATCH.inTune + 0.1)
    expect(matcher.view().status).toBe('found')
    // A sound that runs across the opening counts only from there on.
    const across = new NoteMatcher(NOTE, 3)
    expect(feeding(across, voice(NOTE, 1.5, 2.2))(5)).not.toContain('found')
  })
})

describe('running out of time', () => {
  it('is "not yet" after the time-out, with someone singing another note or nobody singing at all', () => {
    for (const heard of [voice(NOTE + 4, MATCH.timeout + 2, 0.5), []]) {
      const matcher = new NoteMatcher(NOTE, 0)
      const feed = feeding(matcher, heard)
      expect(new Set(feed(MATCH.timeout - 0.5))).toEqual(new Set(['listening']))
      feed(MATCH.timeout + 0.5)
      expect(matcher.view().status).toBe('not-yet')
    }
  })

  it('counts from when listening opened, not from when the screen did', () => {
    const matcher = new NoteMatcher(NOTE, 5)
    const feed = feeding(matcher)
    feed(MATCH.timeout + 4.5)
    expect(matcher.view().status).toBe('listening')
    feed(MATCH.timeout + 5.5)
    expect(matcher.view().status).toBe('not-yet')
  })

  it('is never a failure: the note can still be found afterwards, and the words stay kind', () => {
    const matcher = new NoteMatcher(NOTE, 0)
    const feed = feeding(matcher, [...voice(NOTE + 4, MATCH.timeout + 1, 0.5), ...voice(NOTE, 2, MATCH.timeout + 2)])
    const seen = new Set(feed(MATCH.timeout + 1.9))
    expect(seen).toEqual(new Set(['listening', 'not-yet']))
    expect(matchLine(matcher.view())).toBe(MATCH_COPY.notYet)
    expect(MATCH_COPY.notYet).toMatch(/^Not yet/)
    feed(MATCH.timeout + 2 + MATCH.inTune + 0.2)
    expect(matcher.view().status).toBe('found')
    expect(matchLine(matcher.view())).toBe(MATCH_COPY.found)
  })
})

describe('what the screen says while the learner looks for the note', () => {
  const at = (heard: Heard[], until: number) => {
    const matcher = new NoteMatcher(NOTE, 0)
    feeding(matcher, heard)(until)
    return matcher.view()
  }

  it('says which way to slide', () => {
    expect(at(voice(NOTE - 2, 0.5, 0.5), 1)).toMatchObject({ where: 'under' })
    expect(matchLine(at(voice(NOTE - 2, 0.5, 0.5), 1))).toBe(MATCH_COPY.under)
    expect(at(voice(NOTE + 2, 0.5, 0.5), 1)).toMatchObject({ where: 'over' })
    expect(matchLine(at(voice(NOTE + 2, 0.5, 0.5), 1))).toBe(MATCH_COPY.over)
    expect(matchLine(at(voice(NOTE, 0.5, 0.5), 1))).toBe(MATCH_COPY.on)
    // An octave down and a little under it is "under", by the short way.
    expect(at(voice(NOTE - 13.5, 0.5, 0.5), 1)).toMatchObject({ where: 'under' })
    expect(at(voice(NOTE - 10.5, 0.5, 0.5), 1)).toMatchObject({ where: 'over' })
  })

  it('says so when it hears nobody, and never asks for more voice', () => {
    expect(at([], 1)).toMatchObject({ where: 'silent' })
    expect(matchLine(at([], 1))).toBe(MATCH_COPY.turn)
    // A voice that stopped a moment ago is no longer "on the note".
    expect(at(voice(NOTE, 0.5, 0.5), 2)).toMatchObject({ where: 'silent' })
    // Silent for a good while: the phone may be too far away.
    expect(matchLine(at([], MATCH.quietHint + 0.5))).toBe(MATCH_COPY.silent)
    expect(MATCH_COPY.silent).toMatch(/closer/)
    // Someone who has been singing and stops for a breath was heard: the phone is not too far away.
    expect(matchLine(at(voice(NOTE + 3, MATCH.quietHint + 1, 0.5), MATCH.quietHint + 2.5))).toBe(MATCH_COPY.turn)
  })

  it('tells a low voice that the octave below counts', () => {
    expect(matchLine(at(voice(NOTE - 12, 2, 0.5), 3))).toBe(MATCH_COPY.octaveLower)
    expect(matchLine(at(voice(NOTE + 12, 2, 0.5), 3))).toBe(MATCH_COPY.octaveHigher)
    expect(MATCH_COPY.octaveLower).toBe('You sang it an octave lower. That counts.')
  })

  it('draws the dot in the octave of the bar', () => {
    expect(foldNear(NOTE - 12, NOTE)).toBeCloseTo(NOTE, 9)
    expect(foldNear(NOTE + 11.5, NOTE)).toBeCloseTo(NOTE - 0.5, 9)
    expect(foldNear(NOTE + 5.9, NOTE)).toBeCloseTo(NOTE + 5.9, 9)
    expect(foldNear(NOTE - 18.2, NOTE)).toBeCloseTo(NOTE + 5.8, 9)
  })

  it('never blames, never asks for more voice, and shows no number a beginner cannot use', () => {
    const words = Object.values(MATCH_COPY)
    expect(words.length).toBeGreaterThan(10)
    for (const line of words) {
      expect(line, line).not.toMatch(/\b(wrong|fail(ed|ure)?|tone.deaf|louder|push|belt|bad|mistake|error|missed)\b/i)
      expect(line, line).not.toMatch(/\b(cents?|hz|hertz|midi|semitones?|bpm|rating|accuracy|frequency|score[ds]? \d)\b/i)
      expect(line, line).not.toMatch(/\d/)
    }
  })
})

describe('the three notes', () => {
  it('are the easy note, then one a little higher and one a little lower', () => {
    expect(matchNotes(DEFAULT_RANGES.lower)).toEqual([52, 54, 50])
    expect(matchNotes(DEFAULT_RANGES.higher)).toEqual([64, 66, 62])
  })

  it('stay inside the easy notes when the easy note sits at an edge', () => {
    expect(matchNotes({ low: 48, high: 55, easy: 48 })).toEqual([48, 50, 52])
    expect(matchNotes({ low: 48, high: 55, easy: 55 })).toEqual([55, 53, 51])
    // An easy note stored outside its own range is read as the nearest edge.
    expect(matchNotes({ low: 48, high: 55, easy: 40 })[0]).toBe(48)
  })

  it('are counted for the learner, from one', () => {
    expect(noteLabel(0)).toBe('Note 1 of 3')
    expect(noteLabel(2)).toBe('Note 3 of 3')
  })

  it('are three different whole notes inside every range the app stores, never far from the easy note', () => {
    expect(MATCH.notes).toBe(3)
    for (let span = MIN_RANGE_SPAN; span <= RANGE.widest; span++) {
      for (let easy = 45; easy <= 45 + span; easy++) {
        const range: RangeAroundEasy = { low: 45, high: 45 + span, easy }
        const notes = matchNotes(range)
        const what = `45 to ${45 + span}, easy ${easy}: ${notes.join(' ')}`
        expect(notes, what).toHaveLength(3)
        expect(new Set(notes).size, what).toBe(3)
        expect(notes[0], what).toBe(easy)
        for (const note of notes) {
          expect(Number.isInteger(note), what).toBe(true)
          expect(note, what).toBeGreaterThanOrEqual(range.low)
          expect(note, what).toBeLessThanOrEqual(range.high)
          expect(Math.abs(note - easy), what).toBeLessThanOrEqual(4)
        }
      }
    }
  })
})

describe('the note the app plays', () => {
  it('is the guide voice singing that note, at the rate of the sound output, and says when it ends', () => {
    const calls: string[] = []
    let played: Float32Array | null = null
    const ctx = {
      sampleRate: 48000,
      currentTime: 12,
      destination: {},
      createBuffer: (_channels: number, length: number, sampleRate: number) => ({
        length,
        sampleRate,
        copyToChannel(data: Float32Array) {
          played = data
        },
      }),
      createBufferSource: () => ({
        buffer: null,
        connect: () => calls.push('connect'),
        start: () => calls.push('start'),
        stop: () => calls.push('stop'),
      }),
    }
    const playing = playGuideNote(ctx as unknown as AudioContext, NOTE)
    expect(calls).toEqual(['connect', 'start'])
    expect(playing.endsAt).toBeCloseTo(12 + MATCH.tone, 6)
    const samples = played as unknown as Float32Array
    expect(samples.length / 48000).toBeCloseTo(MATCH.tone, 2)
    // What was put in the buffer reads as the note.
    const analyzer = new FrameAnalyzer(48000, { minFreq: 60, maxFreq: 1200, threshold: 0.9 })
    const heard: number[] = []
    for (let i = 0; i + 128 <= samples.length; i += 128) {
      const frame = analyzer.push(samples.subarray(i, i + 128))
      if (frame && frame.freq > 0 && frame.clarity > 0.9) heard.push(freqToMidi(frame.freq))
    }
    heard.sort((a, b) => a - b)
    expect(heard[heard.length >> 1]).toBeCloseTo(NOTE, 1)
    playing.stop()
    expect(calls).toEqual(['connect', 'start', 'stop'])
  })

  it('is one note at a time: a new one ends the one before, and leaving ends whatever sounds', () => {
    const log: string[] = []
    let made = 0
    const ctx = {
      sampleRate: 44100,
      currentTime: 3,
      destination: {},
      createBuffer: () => ({ copyToChannel() {} }),
      createBufferSource: () => {
        const id = ++made
        return { buffer: null, connect() {}, start: () => log.push(`start ${id}`), stop: () => log.push(`stop ${id}`) }
      },
    } as unknown as AudioContext
    const player = new GuidePlayer()
    expect(player.play(ctx, NOTE)).toBeCloseTo(3 + MATCH.tone, 6)
    expect(player.play(ctx, NOTE + 2, 1)).toBeCloseTo(4, 6)
    expect(log).toEqual(['start 1', 'stop 1', 'start 2'])
    player.stop()
    player.stop()
    expect(log).toEqual(['start 1', 'stop 1', 'start 2', 'stop 2'])
    // The screen has gone while the microphone was still being asked for: nothing is sung into the next one.
    player.play(ctx, NOTE)
    player.close()
    expect(player.play(ctx, NOTE)).toBe(3)
    expect(log).toEqual(['start 1', 'stop 1', 'start 2', 'stop 2', 'start 3', 'stop 3'])
    // The same screen shown again sings again.
    player.open()
    player.play(ctx, NOTE)
    expect(log[log.length - 1]).toBe('start 4')
  })
})

/**
 * Sung, through the analyser with the detector set as the tool sets it for the singer's range, at both
 * sample rates and through the phone microphone model.
 */
describe('a singer meets the note', () => {
  const ROOM = 0.5

  function frames(mic: Float32Array, sampleRate: number, range: RangeAroundEasy): Array<EarFrame & { time: number }> {
    return analyseMic(mic, { sampleRate, spectrum: false, preRoll: 0, detector: { pitch: true, ...voiceDetector(range) } }).map(({ wall, frame }) => ({ freq: frame.freq, clarity: frame.clarity, rms: frame.rms, time: wall }))
  }

  /** Listens to a recording as the tool does: the room first, then every frame to the matcher. */
  function meet(mic: Float32Array, sampleRate: number, range: RangeAroundEasy, target: number, from: number): { matcher: NoteMatcher; foundAt: number | null; seen: Set<MatchStatus>; wheres: Set<MatchView['where']> } {
    const listener = new VoiceListener(sampleRate)
    const matcher = new NoteMatcher(target, from)
    const seen = new Set<MatchStatus>()
    const wheres = new Set<MatchView['where']>()
    let foundAt: number | null = null
    for (const frame of frames(mic, sampleRate, range)) {
      if (frame.time < ROOM) {
        listener.rest(frame)
        continue
      }
      matcher.listen(listener.hear(frame), frame.time)
      const view = matcher.view()
      seen.add(view.status)
      wheres.add(view.where)
      if (view.status === 'found' && foundAt === null) foundAt = frame.time
    }
    return { matcher, foundAt, seen, wheres }
  }

  const sung = (notes: SungNote[], sampleRate: number, options: Partial<SingOptions> = {}) => phoneMic(sing(notes, { sampleRate, ...options }), sampleRate)

  for (const sampleRate of [44100, 48000]) {
    it(`finds a singer who slides up to the note and holds it, one second after they arrive (${sampleRate} Hz)`, () => {
      const range = DEFAULT_RANGES.lower
      // From a fourth under the note up to it in two seconds, then held.
      const mic = sung([{ time: 1, duration: 2, midi: NOTE - 5, slideTo: NOTE }, { time: 3, duration: 3, midi: NOTE }], sampleRate, { legato: true })
      const arrives = 1 + 2 * ((5 - MATCH.band / 100) / 5)
      const { foundAt, matcher } = meet(mic, sampleRate, range, NOTE, ROOM)
      expect(foundAt).not.toBeNull()
      expect(foundAt!).toBeGreaterThan(arrives + MATCH.inTune - 0.05)
      expect(foundAt!).toBeLessThan(arrives + MATCH.inTune + 0.3)
      expect(matcher.view().octave).toBe(0)
    })

    it(`finds a low voice that sings a high note an octave down (${sampleRate} Hz)`, () => {
      const range = DEFAULT_RANGES.higher
      const mic = sung([{ time: 1, duration: 3, midi: range.easy - 12 }], sampleRate)
      const { foundAt, matcher } = meet(mic, sampleRate, range, range.easy, ROOM)
      expect(foundAt).not.toBeNull()
      expect(foundAt!).toBeLessThan(1 + MATCH.inTune + 0.4)
      expect(matcher.view().octave).toBe(-1)
      expect(matchLine(matcher.view())).toBe(MATCH_COPY.octaveLower)
    })

    it(`says "not yet" to a singer who stays a third away, and nothing worse (${sampleRate} Hz)`, () => {
      const notes: SungNote[] = []
      for (let t = 1; t < MATCH.timeout + 2; t += 3) notes.push({ time: t, duration: 2.5, midi: NOTE + 4 })
      const { seen, matcher } = meet(sung(notes, sampleRate), sampleRate, DEFAULT_RANGES.lower, NOTE, ROOM)
      expect(seen).toEqual(new Set(['listening', 'not-yet']))
      expect(matcher.view()).toMatchObject({ status: 'not-yet', held: 0 })
    })

    it(`finds a singer who sings along with the app's note only once they have held it for a second on their own (${sampleRate} Hz)`, () => {
      // A beginner joins in while the app is still singing, and carries on. The second in tune is counted
      // from where listening opens: what was sung together with the app could be the app.
      const guide = renderVoiceNotes([{ time: 1, duration: MATCH.tone, midi: NOTE }], { sampleRate, tail: 6 })
      const along = sing([{ time: 1.2, duration: 3.5, midi: NOTE }], { sampleRate, seconds: 7 })
      const opens = 1 + MATCH.tone + MATCH.afterTone
      const { foundAt } = meet(phoneMic(mix(guide, along), sampleRate), sampleRate, DEFAULT_RANGES.lower, NOTE, opens)
      expect(foundAt).not.toBeNull()
      expect(foundAt!).toBeGreaterThan(opens + MATCH.inTune - 0.05)
      expect(foundAt!).toBeLessThan(opens + MATCH.inTune + 0.2)
    })

    it(`keeps to its band through the real detector: 70 cents under is the note, 90 cents under is not (${sampleRate} Hz)`, () => {
      const held = (cents: number) => meet(sung([{ time: 1, duration: 5, midi: NOTE }], sampleRate, { cents }), sampleRate, DEFAULT_RANGES.lower, NOTE, ROOM)
      expect(held(-70).foundAt).not.toBeNull()
      const under = held(-90)
      expect(under.seen).toEqual(new Set(['listening']))
      // Heard, and told which way to go.
      expect(under.matcher.view().held).toBe(0)
      expect(under.wheres.has('under')).toBe(true)
      expect(under.wheres.has('on')).toBe(false)
    })

    it(`finds nothing in a room where nobody sings, however long it listens (${sampleRate} Hz)`, () => {
      const room = phoneMic(new Float32Array(sampleRate * (MATCH.timeout + 3)), sampleRate)
      const { seen, matcher, wheres } = meet(room, sampleRate, DEFAULT_RANGES.lower, NOTE, ROOM)
      expect(seen).toEqual(new Set(['listening', 'not-yet']))
      expect(wheres).toEqual(new Set(['silent']))
      expect(matcher.view()).toMatchObject({ status: 'not-yet', held: 0 })
      // Nobody was heard: after a while the screen says where the phone should be, and never asks for more voice.
      expect(matchLine({ ...matcher.view(), status: 'listening' })).toBe(MATCH_COPY.silent)
    })

    it(`does not take its own guide note, coming back through the microphone, for the learner (${sampleRate} Hz)`, () => {
      const guide = phoneMic(renderVoiceNotes([{ time: 1, duration: MATCH.tone, midi: NOTE }], { sampleRate, tail: 3 }), sampleRate)
      const opens = 1 + MATCH.tone + MATCH.afterTone
      const { seen, matcher } = meet(guide, sampleRate, DEFAULT_RANGES.lower, NOTE, opens)
      expect(seen).toEqual(new Set(['listening']))
      expect(matcher.view().held).toBe(0)
      // Listening from the start, the same recording is "found": the wait after the note is what keeps it out.
      expect(meet(guide, sampleRate, DEFAULT_RANGES.lower, NOTE, ROOM).seen).toContain('found')
    })
  }
})
