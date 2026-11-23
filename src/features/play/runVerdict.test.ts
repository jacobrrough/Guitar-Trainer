import { describe, expect, it } from 'vitest'
import { NOT_COUNTED, NOT_COUNTED_VOICE, notCountedCopy, runVerdict, type RunVerdict } from './runVerdict'

const summary = (perfects: number, goods: number, total: number) => ({ perfects, goods, total })

/** One run for each way of not counting, so the list below is the verdicts `runVerdict` really gives. */
const NOT_COUNTED_RUNS: RunVerdict[] = [
  runVerdict(summary(0, 0, 0), { coverage: 1 }),
  runVerdict(summary(8, 0, 8), { coverage: 1, bleed: true }),
  runVerdict(summary(6, 0, 6), { coverage: 1, partial: true }),
]

describe('what a run that does not count is told', () => {
  it('has a title and a body for every verdict, for the guitar and for singing', () => {
    expect(NOT_COUNTED_RUNS).toEqual(['unscored', 'bleed', 'partial'])
    for (const table of [NOT_COUNTED, NOT_COUNTED_VOICE]) {
      expect(Object.keys(table).sort()).toEqual([...NOT_COUNTED_RUNS].sort())
      for (const verdict of NOT_COUNTED_RUNS) {
        if (verdict === 'counted') throw new Error('a run that counts has no such card')
        expect(table[verdict].title.length).toBeGreaterThan(5)
        expect(table[verdict].body.length).toBeGreaterThan(40)
        // Whatever the reason, the learner is told that nothing was saved or that it was practice.
        expect(table[verdict].body).toMatch(/not saved|practice/)
      }
    }
  })

  it('still tells a guitarist what it always has', () => {
    expect(NOT_COUNTED.unscored.title).toBe('Nothing was scored')
    expect(NOT_COUNTED.unscored.body).toBe(
      'The app could not hear your guitar. Check that the microphone is on and allowed, and bring the phone closer to the guitar. Then try again. This run was not saved.',
    )
    expect(NOT_COUNTED.partial.body).toBe(
      'Only part of it was played and scored this time: it was started from the middle, moved on the way, or the microphone was off for a while. That is fine for practice. Play it from the start to have it count.',
    )
    expect(NOT_COUNTED.bleed.body).toBe(
      'The microphone was hearing the guitar part from the speaker, so the app would be marking its own playing. Turn the guitar part off with the speaker button, or use headphones, then try again. This run was not saved.',
    )
  })

  it('says nothing about a guitar to a singer', () => {
    for (const { title, body } of Object.values(NOT_COUNTED_VOICE)) {
      expect(`${title} ${body}`).not.toMatch(/guitar|strum|pluck|pick\b|string|fret|play|speaker mode|speaker button/i)
    }
  })

  it('is kind to a singer: nothing about singing louder, nothing that blames', () => {
    for (const { title, body } of Object.values(NOT_COUNTED_VOICE)) {
      expect(`${title} ${body}`).not.toMatch(/louder|wrong|fail|tone.?deaf|push|belt|mistake/i)
    }
    // Not heard: the phone comes closer. Its own sound: headphones, or the guide off.
    expect(NOT_COUNTED_VOICE.unscored.body).toMatch(/could not hear you sing/)
    expect(NOT_COUNTED_VOICE.unscored.body).toMatch(/closer/)
    expect(NOT_COUNTED_VOICE.bleed.body).toMatch(/headphones/i)
    expect(NOT_COUNTED_VOICE.bleed.body).toMatch(/guide off/)
    // By the time this card is read the player has switched the guide off, so that "Try again" is not
    // lost the same way. The card says so, and how a singer who does wear headphones gets it back.
    expect(NOT_COUNTED_VOICE.bleed.body).toMatch(/turned the guide off/)
    expect(NOT_COUNTED_VOICE.bleed.body).toMatch(/speaker icon/)
    expect(NOT_COUNTED_VOICE.bleed.body).toMatch(/back on/)
    // Practice, sung: and headphones that were changed on the way are one of the reasons.
    expect(NOT_COUNTED_VOICE.partial.body).toMatch(/sung/)
    expect(NOT_COUNTED_VOICE.partial.body).toMatch(/headphones/)
  })

  it('is chosen by the instrument, the guitar when none is named', () => {
    for (const verdict of ['unscored', 'bleed', 'partial'] as const) {
      expect(notCountedCopy(verdict)).toBe(NOT_COUNTED[verdict])
      expect(notCountedCopy(verdict, 'guitar')).toBe(NOT_COUNTED[verdict])
      expect(notCountedCopy(verdict, 'voice')).toBe(NOT_COUNTED_VOICE[verdict])
      expect(NOT_COUNTED_VOICE[verdict].body).not.toBe(NOT_COUNTED[verdict].body)
    }
  })
})

describe('runVerdict', () => {
  it('counts an ordinary run, also a poor one that was clearly heard', () => {
    expect(runVerdict(summary(5, 1, 8), { coverage: 1 })).toBe('counted')
    expect(runVerdict(summary(0, 0, 8), { coverage: 0.9 })).toBe('counted')
    expect(runVerdict(summary(0, 1, 8), { coverage: 0.1 })).toBe('counted')
  })

  it('does not count a run in which the microphone delivered nothing', () => {
    expect(runVerdict(summary(0, 0, 0), { coverage: 1 })).toBe('unscored')
  })

  it('does not count a run with no hit and hardly a sound: the guitar was not heard', () => {
    expect(runVerdict(summary(0, 0, 8), { coverage: 0 })).toBe('unscored')
    expect(runVerdict(summary(0, 0, 8), { coverage: 0.1 })).toBe('unscored')
  })

  it('does not count a run that covered only part of the piece', () => {
    expect(runVerdict(summary(6, 0, 6), { coverage: 1, partial: true })).toBe('partial')
    // Not heard at all is the more useful thing to say when both are true.
    expect(runVerdict(summary(0, 0, 6), { coverage: 0, partial: true })).toBe('unscored')
  })

  it('does not count a run in which the microphone heard the app’s own guitar part', () => {
    expect(runVerdict(summary(8, 0, 8), { coverage: 1, bleed: true })).toBe('bleed')
  })
})
