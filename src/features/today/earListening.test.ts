import { describe, expect, it } from 'vitest'
import type { PitchFrame } from '../../audio/AudioEngine'
import { midiToFreq } from '../../music/pitch'
import { EarListener, RunGuard, answerText, prepareRun, type EarAnswer } from './earListening'

const HOP_MS = (512 / 48000) * 1000
const CLARITY = 0.9
const RESPONSE_MS = 6000
const E2 = 40
const A2 = 45
const D3 = 50

type Sound = Array<{ midi: number | null; rms: number }>

const silence = (ms: number, rms = 0.0006): Sound => Array.from({ length: Math.round(ms / HOP_MS) }, () => ({ midi: null, rms }))

/** A note that is already sounding and fades: no jump in level, so no pluck is heard. */
function ring(midi: number, ms: number, from = 0.05, decay = 0.997): Sound {
  return Array.from({ length: Math.round(ms / HOP_MS) }, (_, i) => ({ midi, rms: from * decay ** i }))
}

/** A fresh pluck: one loud, unpitched frame (the pick noise), then the note fading. */
function pluck(midi: number, ms: number, rms = 0.08): Sound {
  return [{ midi: null, rms }, ...ring(midi, ms - HOP_MS, rms * 0.9)]
}

/** Feeds sounds to a listener on a running clock, as the microphone would. */
class Mic {
  now = 0
  readonly listener = new EarListener({ responseMs: RESPONSE_MS })

  play(...sounds: Sound[]): { answer: EarAnswer; at: number } | null {
    for (const s of sounds.flat()) {
      this.now += HOP_MS
      const frame: PitchFrame = { freq: s.midi === null ? 0 : midiToFreq(s.midi), clarity: s.midi === null ? 0 : 0.97, rms: s.rms, time: this.now / 1000 }
      const answer = this.listener.frame(frame, this.now, CLARITY)
      if (answer) return { answer, at: this.now }
    }
    return null
  }
}

describe('EarListener: when the player has answered', () => {
  it('does not take a string still ringing from the answer before as the answer', () => {
    const mic = new Mic()
    // Prompt 1 was A: the open A string was plucked and keeps ringing through the feedback and the next reference.
    expect(mic.play(pluck(A2, 2200))).toBeNull()
    mic.listener.open(E2, mic.now)
    const opened = mic.now
    // The A still sounds for a second and a half of the new turn: nothing is decided.
    expect(mic.play(ring(A2, 1500, 0.03))).toBeNull()
    expect(mic.listener.listening).toBe(true)
    // Then the player plucks the low E.
    const heard = mic.play(pluck(E2, 800))
    expect(heard?.answer.judgement).toBe('perfect')
    expect(heard?.answer.played).toBeCloseTo(E2, 1)
    expect(heard!.at - opened).toBeGreaterThan(1500)
  })

  it('does not take the end of the reference from the speaker as the answer', () => {
    const mic = new Mic()
    mic.play(silence(300), pluck(E2, 1200, 0.05))
    mic.listener.open(E2, mic.now)
    // The reference is the right note by definition: its tail must not score.
    expect(mic.play(ring(E2, 400, 0.01, 0.98))).toBeNull()
    expect(mic.play(silence(RESPONSE_MS))?.answer).toEqual({ judgement: 'miss', played: null, heard: false, ringing: false })
  })

  it('says so when the old string rang on and nothing new was played', () => {
    const mic = new Mic()
    mic.play(pluck(A2, 2200))
    mic.listener.open(E2, mic.now)
    const end = mic.play(ring(A2, RESPONSE_MS + 200, 0.03, 0.9995))
    expect(end?.answer).toEqual({ judgement: 'miss', played: null, heard: false, ringing: true })
    expect(answerText(end!.answer, 'E2', E2)).toBe('No new note heard, only a string that was already ringing. It was E2.')
  })

  it('lets a first wrong note be followed by the right one', () => {
    const mic = new Mic()
    mic.play(silence(500))
    mic.listener.open(E2, mic.now)
    expect(mic.play(silence(400), pluck(A2, 900))).toBeNull()
    const heard = mic.play(pluck(E2, 900))
    expect(heard?.answer.judgement).toBe('perfect')
    expect(heard?.answer.played).toBeCloseTo(E2, 1)
  })

  it('keeps listening after a wrong note and names the closest note heard when the time is up', () => {
    const mic = new Mic()
    mic.play(silence(500))
    mic.listener.open(E2, mic.now)
    const opened = mic.now
    // Five frets out, then one fret out: the nearer one is the answer.
    expect(mic.play(silence(300), pluck(A2, 800), pluck(E2 + 1, 800))).toBeNull()
    const end = mic.play(silence(RESPONSE_MS))
    expect(end?.answer.judgement).toBe('miss')
    expect(end?.answer.played).toBeCloseTo(E2 + 1, 1)
    expect(end?.answer.heard).toBe(true)
    expect(end!.at - opened).toBeGreaterThanOrEqual(RESPONSE_MS)
    expect(end!.at - opened).toBeLessThan(RESPONSE_MS + 2 * HOP_MS)
  })

  it('reports nothing heard after silence, from the frames or from the timer', () => {
    const mic = new Mic()
    mic.play(silence(500))
    mic.listener.open(E2, mic.now)
    expect(mic.play(silence(RESPONSE_MS - 100))).toBeNull()
    expect(mic.play(silence(200))?.answer).toEqual({ judgement: 'miss', played: null, heard: false, ringing: false })
    expect(mic.listener.listening).toBe(false)

    // No frames at all (a dead microphone): the screen's own timer asks for the answer.
    const dead = new EarListener({ responseMs: RESPONSE_MS })
    dead.open(E2, 1000)
    expect(dead.deadline).toBe(1000 + RESPONSE_MS)
    expect(dead.expire()).toEqual({ judgement: 'miss', played: null, heard: false, ringing: false })
  })

  it('gives the full time again after a late Replay, and does not judge the replayed note', () => {
    const mic = new Mic()
    mic.play(silence(500))
    mic.listener.open(E2, mic.now)
    const opened = mic.now
    expect(mic.play(silence(5500))).toBeNull()
    // Replay half a second before the time would have run out.
    const referenceMs = 1200
    mic.listener.replay(mic.now, referenceMs)
    const replayed = mic.now
    expect(mic.listener.deadline).toBeGreaterThanOrEqual(replayed + referenceMs + RESPONSE_MS)
    // The speaker plays the reference (the right note, with a pluck): the microphone hears it, and it must not score.
    expect(mic.play(pluck(E2, referenceMs, 0.05))).toBeNull()
    expect(mic.now - opened).toBeGreaterThan(RESPONSE_MS)
    expect(mic.listener.listening).toBe(true)
    // The player still has the whole answer time.
    expect(mic.play(silence(4000))).toBeNull()
    const heard = mic.play(pluck(E2, 800))
    expect(heard?.answer.judgement).toBe('perfect')
  })

  it('still ends the turn if nothing is played after a Replay', () => {
    const mic = new Mic()
    mic.play(silence(500))
    mic.listener.open(E2, mic.now)
    mic.play(silence(3000))
    mic.listener.replay(mic.now, 1200)
    const deadline = mic.listener.deadline
    const end = mic.play(pluck(E2, 1200, 0.05), silence(RESPONSE_MS + 500))
    expect(end?.answer).toEqual({ judgement: 'miss', played: null, heard: false, ringing: false })
    expect(end!.at).toBeGreaterThanOrEqual(deadline)
  })

  it('hears a new note played softly while the old string is still loud', () => {
    const mic = new Mic()
    mic.play(pluck(A2, 1500, 0.1))
    mic.listener.open(D3, mic.now)
    expect(mic.play(ring(A2, 300, 0.06))).toBeNull()
    // No jump in level, but the pitch is now a different note.
    const heard = mic.play(ring(D3, 600, 0.06))
    expect(heard?.answer.judgement).toBe('perfect')
  })

  it('does not mistake the ringing note jumping an octave for a new note', () => {
    const mic = new Mic()
    mic.play(pluck(A2, 1500, 0.1))
    mic.listener.open(A2 + 12, mic.now)
    // A fading string is often heard an octave up for a moment. It is still the old note.
    expect(mic.play(ring(A2, 300, 0.05), ring(A2 + 12, 400, 0.04), ring(A2, 300, 0.03))).toBeNull()
    expect(mic.listener.listening).toBe(true)
  })

  it('does not let an old string an octave away from the new note end the turn when it fades in and out', () => {
    const mic = new Mic()
    // Prompt 1 was the low E; prompt 2 is the high E, two octaves up. The low string is still sounding.
    mic.play(pluck(E2, 2200))
    mic.listener.open(E2 + 24, mic.now)
    // Close to the level where it can no longer be heard, the old note drops out for a moment and comes back.
    expect(mic.play(ring(E2, 300, 0.0046, 1), silence(80, 0.0035), ring(E2, 600, 0.0045, 1))).toBeNull()
    expect(mic.listener.listening).toBe(true)
    // The player still gets to answer.
    const heard = mic.play(silence(500), pluck(E2 + 24, 600))
    expect(heard?.answer.judgement).toBe('perfect')
    expect(heard?.answer.played).toBeCloseTo(E2 + 24, 1)
  })

  it('does not blame the player for an old string that fades in and out when nothing new was played', () => {
    for (const target of [E2, A2 + 12]) {
      const mic = new Mic()
      mic.play(pluck(A2, 2200))
      mic.listener.open(target, mic.now)
      const end = mic.play(ring(A2, 300, 0.0046, 1), silence(80, 0.0035), ring(A2, 600, 0.0045, 1), silence(RESPONSE_MS))
      expect(end?.answer).toEqual({ judgement: 'miss', played: null, heard: false, ringing: true })
    }
  })

  it('still takes the right note played softly just as the reference fades, with no jump in level', () => {
    const mic = new Mic()
    mic.play(silence(300), pluck(E2, 1200, 0.3))
    mic.listener.open(E2, mic.now)
    // The end of the reference is still in the air, then a short gap, then the player's note, quieter than the speaker was.
    const heard = mic.play(ring(E2, 100, 0.2, 0.98), silence(100), ring(E2, 600, 0.03))
    expect(heard?.answer.judgement).toBe('perfect')
  })

  it('waits a moment for a note that starts a little off to settle', () => {
    const mic = new Mic()
    mic.play(silence(500))
    mic.listener.open(E2, mic.now)
    // A hard pluck starts 35 cents sharp and settles onto the note.
    const settled = mic.play(silence(300), pluck(E2 + 0.35, 150), ring(E2 + 0.05, 600, 0.06))
    expect(settled?.answer.judgement).toBe('perfect')

    const flat = new Mic()
    flat.play(silence(500))
    flat.listener.open(E2, flat.now)
    // A string that is 40 cents flat stays "good": the turn ends shortly after, without waiting for the timeout.
    const start = flat.now
    const end = flat.play(silence(300), pluck(E2 - 0.4, 2000))
    expect(end?.answer.judgement).toBe('good')
    expect(end?.answer.played).toBeCloseTo(E2 - 0.4, 1)
    expect(end!.at - start).toBeLessThan(1000)
  })

  it('ignores frames once the turn is decided or closed', () => {
    const mic = new Mic()
    mic.play(silence(500))
    mic.listener.open(E2, mic.now)
    expect(mic.play(pluck(E2, 400))?.answer.judgement).toBe('perfect')
    expect(mic.play(pluck(A2, 400), silence(RESPONSE_MS))).toBeNull()
    mic.listener.open(E2, mic.now)
    mic.listener.close()
    expect(mic.play(silence(200), pluck(E2, 400))).toBeNull()
  })
})

describe('answerText', () => {
  it('says how far off the answer was, or that nothing was heard', () => {
    expect(answerText({ judgement: 'perfect', played: 40.02, heard: true }, 'E2', 40)).toBe('spot on (E2)')
    expect(answerText({ judgement: 'miss', played: 41, heard: true }, 'E2', 40)).toBe('100 cents sharp (E2)')
    expect(answerText({ judgement: 'miss', played: null, heard: false, ringing: false }, 'E2', 40)).toBe('No note heard. It was E2.')
    // Sound was there, but never a steady note: not the same as silence.
    expect(answerText({ judgement: 'miss', played: null, heard: true }, 'E2', 40)).toBe('We could not make out a clear note. It was E2.')
  })
})

describe('RunGuard / prepareRun: leaving while the microphone is still starting', () => {
  const deferred = () => {
    let resolve = () => {}
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('knows which run is the current one', () => {
    const guard = new RunGuard()
    const first = guard.begin()
    expect(first()).toBe(true)
    guard.end()
    expect(first()).toBe(false)
    const second = guard.begin()
    expect(second()).toBe(true)
    expect(first()).toBe(false)
    const third = guard.begin()
    expect(second()).toBe(false)
    expect(third()).toBe(true)
  })

  it('does not begin the run when Back was tapped before the microphone was ready', async () => {
    const guard = new RunGuard()
    const mic = deferred()
    let prepared = false
    const ready = prepareRun(guard.begin(), () => mic.promise, async () => {
      prepared = true
    })
    // The player leaves; only then does the microphone come up.
    guard.end()
    mic.resolve()
    expect(await ready).toBe(false)
    expect(prepared).toBe(false)
  })

  it('does not begin the run when Back was tapped while the reference notes were being made', async () => {
    const guard = new RunGuard()
    const notes = deferred()
    const ready = prepareRun(guard.begin(), async () => {}, () => notes.promise)
    await Promise.resolve()
    guard.end()
    notes.resolve()
    expect(await ready).toBe(false)
  })

  it('begins the run when nothing interrupted it, and passes a microphone failure on', async () => {
    const guard = new RunGuard()
    expect(await prepareRun(guard.begin(), async () => {}, async () => {})).toBe(true)
    await expect(prepareRun(guard.begin(), () => Promise.reject(new Error('denied')), async () => {})).rejects.toThrow('denied')
  })
})
