/**
 * The words a singer reads around a run: the result line and the tip (voiceCopy.ts), and what the
 * player itself says and decides for a sung chart (../playerLabels.ts, which has no test file of its
 * own: its words and its rules are held here).
 */
import { describe, expect, it } from 'vitest'
import { constantBeatGrid } from '../../../chart/timing'
import { emptyChart, type ChartNote, type VoiceChart } from '../../../chart/types'
import { midiToFreq } from '../../../music/pitch'
import {
  DEVICE_SETTLE_SEC,
  GUITAR_LABELS,
  PLAYER_DETECTOR,
  VOICE_LABELS,
  detectorFor,
  deviceChangeMakesPartial,
  guideStartsOn,
  guideTrackStep,
  ownSoundCounts,
  playerLabels,
  soundMaySwap,
  type PlayerLabels,
} from '../playerLabels'
import { NOT_COUNTED_VOICE, runVerdict } from '../runVerdict'
import type { ScoreSummary } from '../scoring'
import { VOICE, voiceDetector } from './judge'
import { VOICE_TIPS, voiceResultCopy, voiceResultLine, voiceTip } from './voiceCopy'
import { VoiceTracker, type NoteReason, type VoiceFeedback, type VoiceScoreSummary } from './voiceTracker'

const feedback = (over: Partial<Omit<VoiceFeedback, 'reasons'>> & { reasons?: Partial<Record<NoteReason, number>> } = {}): VoiceFeedback => ({
  notes: 12,
  hits: 12,
  octave: 0,
  medianCents: 0,
  ...over,
  reasons: { silent: 0, low: 0, high: 0, unsteady: 0, slid: 0, ...over.reasons },
})

/** Words that have no place in anything a singer is told (docs/SINGING.md §10), and the guitar's own. */
const UNKIND = /louder|wrong|fail|tone.?deaf|push|belt|bad\b|mistake|error/i
const GUITAR_WORDS = /guitar|drums|strum|pluck|pick\b|string|fret|play(ed|ing)? along/i

describe('voice result line', () => {
  it('says how many notes were on the note, out of how many', () => {
    expect(voiceResultLine({ hits: 5, notes: 8 })).toBe('You were on the note for 5 of 8 notes.')
    expect(voiceResultLine({ hits: 0, notes: 8 })).toBe('You were on the note for 0 of 8 notes.')
  })

  it('does not say "1 notes"', () => {
    expect(voiceResultLine({ hits: 1, notes: 1 })).toBe('You were on the note for 1 of 1 note.')
  })
})

describe('voice tip', () => {
  it('has nothing to add when every note was sung in tune where it is written', () => {
    expect(voiceTip(feedback())).toBeNull()
  })

  it('has nothing to say about a run in which no note was settled', () => {
    expect(voiceTip(feedback({ notes: 0, hits: 0, medianCents: null }))).toBeNull()
  })

  it('asks for the phone to come closer when notes were not heard, never for more voice', () => {
    const tip = voiceTip(feedback({ hits: 9, reasons: { silent: 3 } }))
    expect(tip).toBe(VOICE_TIPS.silent)
    expect(tip).toMatch(/closer/)
  })

  it('says under the note and to think higher when notes were sung low', () => {
    const tip = voiceTip(feedback({ hits: 8, reasons: { low: 4 } }))
    expect(tip).toBe(VOICE_TIPS.low)
    expect(tip).toMatch(/under the note/)
    expect(tip).toMatch(/higher/)
  })

  it('says over the note and to sing softer when notes were sung high', () => {
    const tip = voiceTip(feedback({ hits: 8, reasons: { high: 4 } }))
    expect(tip).toBe(VOICE_TIPS.high)
    expect(tip).toMatch(/over the note/)
    expect(tip).toMatch(/softer/)
  })

  it('asks to hold the note when the notes were close but not steady', () => {
    const tip = voiceTip(feedback({ hits: 8, reasons: { unsteady: 4 } }))
    expect(tip).toBe(VOICE_TIPS.unsteady)
    expect(tip).toMatch(/steady|hold/i)
  })

  it('speaks about what cost the most notes', () => {
    expect(voiceTip(feedback({ hits: 5, reasons: { silent: 1, low: 4, high: 2 } }))).toBe(VOICE_TIPS.low)
    expect(voiceTip(feedback({ hits: 5, reasons: { silent: 5, low: 1, unsteady: 1 } }))).toBe(VOICE_TIPS.silent)
    expect(voiceTip(feedback({ hits: 5, reasons: { high: 4, unsteady: 3 } }))).toBe(VOICE_TIPS.high)
  })

  it('when two things cost the same, starts with what the singer can do nothing about', () => {
    expect(voiceTip(feedback({ hits: 8, reasons: { silent: 2, low: 2 } }))).toBe(VOICE_TIPS.silent)
    expect(voiceTip(feedback({ hits: 8, reasons: { low: 2, high: 2 } }))).toBe(VOICE_TIPS.low)
  })

  it('mentions sliding only when nothing was missed and a good part of the notes were slid up to', () => {
    expect(voiceTip(feedback({ reasons: { slid: 5 } }))).toBe(VOICE_TIPS.slid)
    // One slide in twelve notes is singing, not a habit.
    expect(voiceTip(feedback({ reasons: { slid: 1 } }))).toBeNull()
    // Nor is one note of a short round "the notes", though it is a quarter of them; two are.
    expect(voiceTip(feedback({ notes: 4, hits: 4, reasons: { slid: 1 } }))).toBeNull()
    expect(voiceTip(feedback({ notes: 4, hits: 4, reasons: { slid: 2 } }))).toBe(VOICE_TIPS.slid)
    // A missed note is the more useful thing to talk about.
    expect(voiceTip(feedback({ hits: 10, reasons: { slid: 6, low: 2 } }))).toBe(VOICE_TIPS.low)
  })

  it('does not ask a singer to stop sliding in an exercise that is made of slides', () => {
    const slides = feedback({ notes: 6, hits: 6, reasons: { slid: 6 } })
    expect(voiceTip(slides)).toBe(VOICE_TIPS.slid)
    expect(voiceTip(slides, { glide: true })).toBeNull()
    // Everything else is said there as anywhere.
    expect(voiceTip(feedback({ hits: 3, reasons: { slid: 3, low: 3 } }), { glide: true })).toBe(VOICE_TIPS.low)
    expect(voiceTip(feedback({ octave: -1, reasons: { slid: 6 } }), { glide: true })).toBe(VOICE_TIPS.octaveLower)
  })

  it('tells a singer who sang it an octave lower that this counts', () => {
    const tip = voiceTip(feedback({ octave: -1 }))
    expect(tip).toBe('You sang it an octave lower. That counts.')
    expect(voiceTip(feedback({ octave: -2 }))).toBe(tip)
    expect(voiceTip(feedback({ octave: 1 }))).toBe('You sang it an octave higher. That counts.')
  })

  it('does not speak of octaves when no note counted', () => {
    expect(voiceTip(feedback({ hits: 0, octave: -1, reasons: { silent: 12 } }))).toBe(VOICE_TIPS.silent)
  })

  it('never says louder, wrong or anything unkind, and gives no numbers', () => {
    const sentences = Object.values(VOICE_TIPS)
    expect(sentences.length).toBeGreaterThanOrEqual(7)
    for (const s of sentences) {
      expect(s).not.toMatch(UNKIND)
      expect(s).not.toMatch(/\d|cents|semitone|percent|%/i)
      expect(s).not.toMatch(GUITAR_WORDS)
      // Short sentences, each one finished.
      expect(s).toMatch(/[.!]$/)
      expect(s.length).toBeLessThanOrEqual(90)
    }
    expect(voiceResultLine({ hits: 0, notes: 5 })).not.toMatch(UNKIND)
  })
})

describe('voice result copy from a run', () => {
  const summary = (voice?: VoiceFeedback): ScoreSummary => {
    const base: ScoreSummary = { score: 0, streak: 0, maxStreak: 0, multiplier: 1, perfects: 3, goods: 2, misses: 3, total: 8, judged: 8, accuracy: 0.625 }
    if (!voice) return base
    // A sung run's summary is the same summary with the feedback riding along.
    const sung: VoiceScoreSummary = { ...base, voice }
    return sung
  }

  it('reads the line and the tip from what the tracker says about the run', () => {
    const copy = voiceResultCopy(summary(feedback({ notes: 8, hits: 5, reasons: { low: 3 } })))
    expect(copy).toEqual({ line: 'You were on the note for 5 of 8 notes.', tip: VOICE_TIPS.low })
  })

  it('knows from the chart that a round of slides is meant to slide', () => {
    const slid = summary(feedback({ notes: 6, hits: 6, reasons: { slid: 6 } }))
    expect(voiceResultCopy(slid).tip).toBe(VOICE_TIPS.slid)
    expect(voiceResultCopy(slid, { glide: true })).toEqual({ line: 'You were on the note for 6 of 6 notes.', tip: null })
  })

  it('counts the notes from the summary when the run carries no feedback', () => {
    expect(voiceResultCopy(summary())).toEqual({ line: 'You were on the note for 5 of 8 notes.', tip: null })
  })
})

/**
 * The same words from a run the voice tracker really scored. The feedback above is written by hand;
 * here it is the tracker's own, so "under" cannot quietly come to mean "over" between the two files.
 */
describe('voice result copy from a real run', () => {
  const SR = 44100
  const HOP = 512 / SR
  /** A frame reports the pitch of the middle of its window, which lies this far before its time stamp. */
  const CENTRE = 1024 / SR
  const voice: VoiceChart = { judge: { band: 80, minShare: 0.5 }, cues: [], low: 60, high: 64, tonic: 60, shift: 0, lineStarts: [1] }
  // Three notes of a second each with a second of rest between them.
  const notes: ChartNote[] = [60, 62, 64].map((midi, id) => ({ id, time: 1 + 2 * id, duration: 1, midi, string: 0, fret: 0, velocity: 0.8, chordId: id, lyric: 'la' }))
  const chart = emptyChart({ source: 'builtin', duration: 8, notes, beats: constantBeatGrid(60, 0, 8, 4), tempos: [{ time: 0, bpm: 60 }], voice })

  /** A singer who sings every note `semitones` away from where it is written (none = nobody sings), heard to the end. */
  function run(semitones: number | null) {
    const tracker = new VoiceTracker(chart, notes, { sampleRate: SR })
    tracker.seek(0)
    for (let k = Math.round(-0.5 / HOP); k * HOP < 7.5; k++) {
      const time = k * HOP
      const sung = semitones === null ? undefined : notes.find((n) => time - CENTRE >= n.time && time - CENTRE < n.time + n.duration)
      const frame = sung ? { freq: midiToFreq(sung.midi + semitones!), clarity: 0.95, rms: 0.05, time } : { freq: 0, clarity: 0, rms: 0.001, time }
      tracker.frame(frame, time, { clarityThreshold: 0.85, a4: 440 })
      tracker.advance(time)
    }
    tracker.advance(Number.POSITIVE_INFINITY)
    const summary = tracker.summary()
    const result = tracker.toAttemptResult({ playedTempo: 60, targetTempo: 60, speed: 1, durationSec: 8 })
    return { summary, verdict: runVerdict(summary, result), copy: voiceResultCopy(summary, chart.voice) }
  }

  it('in tune where it is written: every note, and nothing to add', () => {
    expect(run(0)).toMatchObject({ verdict: 'counted', copy: { line: 'You were on the note for 3 of 3 notes.', tip: null } })
  })

  it('in tune an octave lower or higher: every note, and the word that this counts', () => {
    expect(run(-12).copy).toEqual({ line: 'You were on the note for 3 of 3 notes.', tip: VOICE_TIPS.octaveLower })
    expect(run(12).copy).toEqual({ line: 'You were on the note for 3 of 3 notes.', tip: VOICE_TIPS.octaveHigher })
  })

  it('a tone and a half under the notes is told "under", and over them "over"', () => {
    const under = run(-1.5)
    expect(under.verdict).toBe('counted')
    expect(under.copy).toEqual({ line: 'You were on the note for 0 of 3 notes.', tip: VOICE_TIPS.low })
    expect(run(1.5).copy).toEqual({ line: 'You were on the note for 0 of 3 notes.', tip: VOICE_TIPS.high })
  })

  it('under the notes in another octave is still "under": the octave is not what was the matter', () => {
    expect(run(-13.5).copy.tip).toBe(VOICE_TIPS.low)
    expect(run(10.5).copy.tip).toBe(VOICE_TIPS.low)
  })

  it('nobody singing is not a result: the card for it says the app could not hear, and never to sing louder', () => {
    const silent = run(null)
    expect(silent.verdict).toBe('unscored')
    expect(silent.summary.perfects + silent.summary.goods).toBe(0)
    expect(NOT_COUNTED_VOICE[silent.verdict === 'counted' ? 'unscored' : silent.verdict].body).toMatch(/could not hear you sing/)
    // Should a screen show the tip all the same, it is the one about the phone.
    expect(silent.copy.tip).toBe(VOICE_TIPS.silent)
  })
})

describe('what the player says', () => {
  it('says to a guitarist exactly what it has always said', () => {
    const g = GUITAR_LABELS
    expect(g.guideOn).toBe('Guitar part on: it plays along with the drums')
    expect(g.guideOff).toBe('Guitar part muted: only the drums play')
    expect(g.guideToggle).toBe('Toggle the guitar part')
    expect(g.guideOnShort).toBe('guitar part on')
    expect(g.guideOffShort).toBe('guitar part muted')
    expect(g.guideOffWhy).toBe('The guitar part is muted so the microphone hears you, not the speaker. Tap the speaker icon to hear it, or Listen first.')
    expect(g.listenNotice).toBe('Listen first: the part is played for you and nothing is scored.')
    expect(g.bleedNotice).toBe('The microphone is hearing the speaker, so this run will not count towards your progress. Use headphones, or turn on speaker mode.')
    expect(g.bleedAction).toBe('speaker-mode')
    expect(g.micError('Permission denied')).toBe('Microphone: Permission denied. You can still play along without scoring.')
    expect(g.playbackError('The element has no supported sources.')).toBe('Playback failed: The element has no supported sources.')
    expect(g.readyLine(12, 0.75)).toBe('12 notes · 75% speed')
    expect(g.readyLine(8, 1)).toBe('8 notes · 100% speed')
    expect(g.testLine).toBe('Test: one attempt, no pausing.')
    expect(g.judgement('perfect')).toBe('Perfect!')
    expect(g.judgement('good')).toBe('Good')
    expect(g.judgement('miss')).toBe('Miss')
  })

  it('chooses the words from the chart alone', () => {
    expect(playerLabels(emptyChart())).toBe(GUITAR_LABELS)
    const voice: VoiceChart = { judge: { band: 80, minShare: 0.5 }, cues: [], low: 55, high: 62, tonic: 55, shift: -5, lineStarts: [] }
    expect(playerLabels(emptyChart({ voice }))).toBe(VOICE_LABELS)
  })

  const said = (l: PlayerLabels): string[] => [
    l.guideOn,
    l.guideOff,
    l.guideToggle,
    l.guideOnShort,
    l.guideOffShort,
    l.guideOffWhy,
    l.listenNotice,
    l.bleedNotice,
    l.ownSoundNotice,
    l.deviceChangedNotice,
    l.micError('No microphone was found'),
    l.playbackError('The element has no supported sources.'),
    l.readyLine(12, 1),
    l.testLine,
  ]
  const flashed = (l: PlayerLabels): string[] => (['perfect', 'good', 'miss'] as const).map((k) => l.judgement(k) ?? '')

  it('has every line for both instruments', () => {
    for (const l of [GUITAR_LABELS, VOICE_LABELS]) {
      for (const s of said(l)) expect(s.length).toBeGreaterThan(3)
    }
  })

  it('says nothing about a guitar to a singer, and nothing unkind', () => {
    for (const s of [...said(VOICE_LABELS), ...flashed(VOICE_LABELS)]) {
      expect(s).not.toMatch(GUITAR_WORDS)
      expect(s).not.toMatch(UNKIND)
    }
  })

  it('tells a singer whose phone hears itself what the design says, and offers no speaker mode', () => {
    expect(VOICE_LABELS.bleedNotice).toBe('The microphone is hearing the speaker, so this run will not count. Use headphones, or turn the guide off.')
    expect(VOICE_LABELS.bleedAction).toBeNull()
    for (const s of said(VOICE_LABELS)) expect(s).not.toMatch(/speaker mode/i)
  })

  it('does not say for certain that the guide was heard when only the cue gives it away', () => {
    // A singer who joins in with the guide from its first moment looks the same to the app as the speaker.
    expect(VOICE_LABELS.ownSoundNotice).toMatch(/seems|may/i)
    expect(VOICE_LABELS.ownSoundNotice).toMatch(/headphones/)
    expect(VOICE_LABELS.ownSoundNotice).toMatch(/guide/)
  })

  it('says that the guide has gone off with that notice, and how to get it back', () => {
    // The player switches the guide off when the run is over, so that the next try is not lost the same
    // way. A singer who does wear headphones must not be left wondering where the guide went.
    expect(VOICE_LABELS.ownSoundNotice).toMatch(/guide is off now/)
    expect(VOICE_LABELS.ownSoundNotice).toMatch(/speaker icon/)
    expect(VOICE_LABELS.ownSoundNotice).toMatch(/back on/)
    // The same button is named the same way wherever a singer reads about it.
    expect(VOICE_LABELS.guideOffWhy).toMatch(/speaker icon/)
  })

  it('tells a singer that the sound did not start without calling anything a failure', () => {
    const said = VOICE_LABELS.playbackError('The element has no supported sources.')
    // What the browser reported is passed on as it is, for whoever is asked for help.
    expect(said).toContain('The element has no supported sources.')
    expect(said.replace('The element has no supported sources.', '')).not.toMatch(/fail|playback|error/i)
    expect(said).toMatch(/sound/)
  })

  it('does not flash Miss at a singer, and leaves the speed out of the ready line', () => {
    expect(VOICE_LABELS.judgement('miss')).toBeNull()
    expect(VOICE_LABELS.judgement('perfect')).toBeTruthy()
    expect(VOICE_LABELS.judgement('good')).toBeTruthy()
    expect(VOICE_LABELS.readyLine(12, 1)).toBe('12 notes to sing')
    expect(VOICE_LABELS.readyLine(1, 1)).toBe('1 note to sing')
  })
})

describe('the guide when a run begins', () => {
  const base = { hasGuide: true, echoCancellation: false, voiceHeadphones: false }

  it('is off without a guide track, whatever the settings', () => {
    expect(guideStartsOn({ voice: false, hasGuide: false, echoCancellation: true, voiceHeadphones: true })).toBe(false)
    expect(guideStartsOn({ voice: true, hasGuide: false, echoCancellation: true, voiceHeadphones: true })).toBe(false)
  })

  it('follows speaker mode on a guitar chart, as it always has', () => {
    expect(guideStartsOn({ ...base, voice: false })).toBe(false)
    expect(guideStartsOn({ ...base, voice: false, echoCancellation: true })).toBe(true)
    // Headphones for singing say nothing about the guitar side.
    expect(guideStartsOn({ ...base, voice: false, voiceHeadphones: true })).toBe(false)
  })

  it('follows "I use headphones" on a sung chart, and not speaker mode', () => {
    expect(guideStartsOn({ ...base, voice: true })).toBe(false)
    expect(guideStartsOn({ ...base, voice: true, voiceHeadphones: true })).toBe(true)
    // Echo cancellation changes nothing for singing: on a bare speaker the guide would score itself.
    expect(guideStartsOn({ ...base, voice: true, echoCancellation: true })).toBe(false)
  })
})

describe('the guide track coming and going', () => {
  it('changes nothing on a guitar chart: a guitar part that arrives late stays off until it is tapped, as before', () => {
    for (const hasGuide of [true, false]) {
      for (const idle of [true, false]) expect(guideTrackStep({ voice: false, hasGuide, idle })).toBe('keep')
    }
  })

  it('sets the switch of a sung chart at once when its track arrives and nothing is playing', () => {
    expect(guideTrackStep({ voice: true, hasGuide: true, idle: true })).toBe('set')
  })

  it('waits for the end of the run when the track arrives in the middle of one', () => {
    // Setting the switch swaps what is playing: never under a singer who is singing.
    expect(guideTrackStep({ voice: true, hasGuide: true, idle: false })).toBe('wait')
  })

  it('switches the guide off when its track goes away, run or no run', () => {
    // Left on, the track of the next level would start playing the moment it arrived, in the middle of a run.
    expect(guideTrackStep({ voice: true, hasGuide: false, idle: true })).toBe('off')
    expect(guideTrackStep({ voice: true, hasGuide: false, idle: false })).toBe('off')
  })
})

describe('when the sound of the player may be swapped', () => {
  const still = { starting: false, listening: false }

  it('may be before a run and after one', () => {
    expect(soundMaySwap({ ...still, phase: 'ready' })).toBe(true)
    // A finished run is over: the next one begins with a tap, and the new sound is there by then.
    expect(soundMaySwap({ ...still, phase: 'finished' })).toBe(true)
  })

  it('may not be while a run counts in, plays or is paused', () => {
    for (const phase of ['countin', 'playing', 'paused'] as const) expect(soundMaySwap({ ...still, phase })).toBe(false)
  })

  it('may not be while a start is under way or the guide is being listened to', () => {
    // "Try again" restarts and starts in one go: the phase reads ready for a moment while the start is already running.
    expect(soundMaySwap({ phase: 'ready', starting: true, listening: false })).toBe(false)
    expect(soundMaySwap({ phase: 'finished', starting: true, listening: false })).toBe(false)
    expect(soundMaySwap({ phase: 'ready', starting: false, listening: true })).toBe(false)
  })
})

describe('when the app’s own sound could score a run', () => {
  it('on a guitar chart: with the guitar part on, or over a real recording', () => {
    expect(ownSoundCounts({ voice: false, guideOn: false, backingIsClick: true })).toBe(false)
    expect(ownSoundCounts({ voice: false, guideOn: true, backingIsClick: true })).toBe(true)
    expect(ownSoundCounts({ voice: false, guideOn: false, backingIsClick: false })).toBe(true)
  })

  it('on a sung chart: only with the guide on, because the cues of the scored track are never credited', () => {
    expect(ownSoundCounts({ voice: true, guideOn: true, backingIsClick: true })).toBe(true)
    expect(ownSoundCounts({ voice: true, guideOn: false, backingIsClick: true })).toBe(false)
    // A screen that forgot to say the track is a click must not make every run on a bare phone "bleed".
    expect(ownSoundCounts({ voice: true, guideOn: false, backingIsClick: false })).toBe(false)
  })
})

describe('headphones pulled out in the middle of a run', () => {
  // The microphone has been open for a minute: an earlier round opened it.
  const run = { voice: true, guideOn: true, listening: false, sinceMicOpened: 60 }

  it('turns a sung run with the guide on into practice, from the count-in to the last note', () => {
    expect(deviceChangeMakesPartial({ ...run, phase: 'countin' })).toBe(true)
    expect(deviceChangeMakesPartial({ ...run, phase: 'playing' })).toBe(true)
    expect(deviceChangeMakesPartial({ ...run, phase: 'paused' })).toBe(true)
  })

  it('changes nothing before a run or after it', () => {
    expect(deviceChangeMakesPartial({ ...run, phase: 'ready' })).toBe(false)
    expect(deviceChangeMakesPartial({ ...run, phase: 'finished' })).toBe(false)
  })

  it('changes nothing with the guide off: then only the click and the cues play, and those cannot score', () => {
    expect(deviceChangeMakesPartial({ ...run, guideOn: false, phase: 'playing' })).toBe(false)
  })

  it('changes nothing while only listening, and nothing on a guitar chart', () => {
    expect(deviceChangeMakesPartial({ ...run, listening: true, phase: 'playing' })).toBe(false)
    expect(deviceChangeMakesPartial({ ...run, voice: false, phase: 'playing' })).toBe(false)
  })

  it('takes a change in the first moments after the microphone was opened for the microphone opening', () => {
    // Granting the permission and a headset going into its call mode raise the same event.
    expect(deviceChangeMakesPartial({ ...run, sinceMicOpened: 0.4, phase: 'countin' })).toBe(false)
    expect(deviceChangeMakesPartial({ ...run, sinceMicOpened: DEVICE_SETTLE_SEC - 0.1, phase: 'countin' })).toBe(false)
    expect(deviceChangeMakesPartial({ ...run, sinceMicOpened: DEVICE_SETTLE_SEC, phase: 'playing' })).toBe(true)
    // A microphone this player never opened (it was running already) has long settled.
    expect(deviceChangeMakesPartial({ ...run, sinceMicOpened: Number.POSITIVE_INFINITY, phase: 'playing' })).toBe(true)
    // A few seconds and no more: about the count-in of a slow exercise, so hardly any of the singing goes unwatched.
    expect(DEVICE_SETTLE_SEC).toBeLessThanOrEqual(4)
  })
})

describe('the pitch detector for a run', () => {
  const voice: VoiceChart = { judge: { band: 80, minShare: 0.5 }, cues: [], low: 60, high: 67, tonic: 60, shift: 0, lineStarts: [] }

  it('is the player’s own for a guitar chart: the whole neck, as before', () => {
    expect(detectorFor(emptyChart())).toEqual({ minFreq: 55, maxFreq: 1500, threshold: 0.9 })
    expect(PLAYER_DETECTOR).toEqual({ minFreq: 55, maxFreq: 1500, threshold: 0.9 })
  })

  it('hands out a detector of its own each time, so nobody can change the player’s', () => {
    const d = detectorFor(emptyChart())
    d.minFreq = 200
    expect(detectorFor(emptyChart()).minFreq).toBe(55)
    expect(PLAYER_DETECTOR.minFreq).toBe(55)
  })

  it('is narrowed to the voice for a sung chart, with room for any octave the singer may choose', () => {
    const d = detectorFor(emptyChart({ voice }))
    expect(d.minFreq).toBeGreaterThan(PLAYER_DETECTOR.minFreq)
    expect(d.maxFreq).toBeLessThan(PLAYER_DETECTOR.maxFreq)
    expect(d.minFreq).toBeLessThanOrEqual(midiToFreq(60 - 12))
    expect(d.maxFreq).toBeGreaterThanOrEqual(midiToFreq(67 + 12))
    expect(d.threshold).toBe(0.9)
  })

  it('is set where the app’s own notes are, whatever the guitar’s reference pitch is set to', () => {
    // The starting note, the guide voice and the chords are all at A = 440 and cannot follow the setting:
    // the detector takes no reference pitch at all, and its range is the one the voice tracker counts on.
    expect(VOICE.a4).toBe(440)
    const d = detectorFor(emptyChart({ voice }))
    expect(d).toEqual(voiceDetector(voice))
    expect(d.minFreq).toBeCloseTo(midiToFreq(60 - 14, 440), 6)
    expect(d.maxFreq).toBeCloseTo(midiToFreq(67 + 14, 440), 6)
    expect(detectorFor.length).toBe(1)
  })

  it('stays inside what a voice can do for the lowest and the highest range the app stores', () => {
    const low = detectorFor(emptyChart({ voice: { ...voice, low: 36, high: 43 } }))
    const high = detectorFor(emptyChart({ voice: { ...voice, low: 79, high: 86 } }))
    expect(low.minFreq).toBeGreaterThanOrEqual(60)
    expect(low.maxFreq).toBeGreaterThan(midiToFreq(43 + 12))
    expect(high.maxFreq).toBeLessThanOrEqual(1200)
    expect(high.minFreq).toBeLessThan(midiToFreq(79 - 12))
    for (const d of [low, high]) expect(d.maxFreq).toBeGreaterThan(d.minFreq * 2)
  })
})
