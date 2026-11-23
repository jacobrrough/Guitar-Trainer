import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderChartVoiced } from '../../audio/guitar'
import type { ScoreRecord } from '../../db/db'
import { DEFAULT_RANGES, MAX_KEY_NUDGE } from '../../music/keys'
import { arrange, songKey, songSpan, VOCAL_SONGS, VOICE_LEVELS, vocalSong, type VocalSong } from '../../songs/vocal'
import { vocalRunFor } from '../../songs/vocal/render'
import { afterPaint, GETTING_READY, useVocalRun, useVocalRunState, type VocalRunState } from '../../songs/vocal/useVocalRun'
import { SONG_LEVEL_UP_ACCURACY } from '../../training/constants'
import { attemptPerformance } from '../../training/performance'
import type { AttemptResult, VoiceProfile, VoiceRange } from '../../training/types'
import { lowerKeyNudge } from '../../training/voicePlan'
import type { ScoreSummary } from '../play/scoring'
import {
  SING_COPY,
  askedLevel,
  closerLine,
  isNewBest,
  keyCard,
  levelRows,
  lineChoices,
  lineWords,
  nextLevelAfter,
  resultRecord,
  runWords,
  savesAsResult,
  singPath,
  singingRange,
  singsAgainAtOnce,
  songCards,
  songKeyView,
  startLevel,
} from './singPage'

// The chords are not what these tests are about: an empty stem, at once, unless a test says otherwise.
vi.mock('../../audio/guitar', async (original) => {
  const actual = await original<typeof import('../../audio/guitar')>()
  return { ...actual, renderChartVoiced: vi.fn(actual.renderChartVoiced) }
})

// The real thing, wrapped so a test can see when the sound of a run is made, and make it break.
vi.mock('../../songs/vocal/render', async (original) => {
  const actual = await original<typeof import('../../songs/vocal/render')>()
  return { ...actual, vocalRunFor: vi.fn(actual.vocalRunFor) }
})

/**
 * The hooks of `useVocalRun.ts` without a screen. There is no renderer in these tests, so the three
 * React hooks they are built from are stood in for: values are kept in slots in the order they are
 * asked for, a memo is made again only when what it depends on changes, and effects run after the
 * render, with their clean-up before the next one. A state that is set shows at the next render.
 */
const screen = vi.hoisted(() => {
  interface Slot {
    deps?: unknown[]
    value?: unknown
    cleanup?: () => void
  }
  let slots: Slot[] = []
  let at = 0
  let afterRender: (() => void)[] = []
  let profile: unknown
  const same = (a: unknown[] | undefined, b: unknown[]) => !!a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  return {
    /** What the live query of the singing profile gives: undefined while it is being read. */
    setProfile(value: unknown): void {
      profile = value
    },
    useLiveQuery: () => profile,
    render<T>(hook: () => T): T {
      at = 0
      afterRender = []
      const out = hook()
      for (const run of afterRender) run()
      return out
    },
    unmount(): void {
      for (const slot of slots) slot.cleanup?.()
      slots = []
    },
    useMemo<T>(make: () => T, deps: unknown[]): T {
      const slot = (slots[at++] ??= {})
      if (!same(slot.deps, deps)) {
        slot.value = make()
        slot.deps = deps
      }
      return slot.value as T
    },
    useState<T>(initial: T): [T, (value: T) => void] {
      const slot = (slots[at++] ??= { value: initial })
      return [slot.value as T, (value: T) => void (slot.value = value)]
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]): void {
      const slot = (slots[at++] ??= {})
      if (same(slot.deps, deps)) return
      afterRender.push(() => {
        slot.cleanup?.()
        slot.deps = deps
        slot.cleanup = effect() ?? undefined
      })
    },
  }
})
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useMemo: screen.useMemo, useState: screen.useState, useEffect: screen.useEffect }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: screen.useLiveQuery }))

const song = (id: string): VocalSong => {
  const found = vocalSong(id)
  if (!found) throw new Error(`${id} is not a song to sing`)
  return found
}
const measured = (low: number, high: number, easy = low + 3): VoiceRange => ({ low, high, easy, source: 'measured', at: 1 })
const starting = (voice: 'lower' | 'higher'): VoiceRange => ({ ...DEFAULT_RANGES[voice], source: 'default', at: 1 })
/** Ranges a singer can really have: the two starting ranges, small and wide measured ones, low and high. */
const RANGES: VoiceRange[] = [starting('lower'), starting('higher'), measured(45, 59), measured(40, 54), measured(57, 71), measured(50, 57), measured(36, 50), measured(62, 74)]
/** Everything a stored key choice can hold, and a little more than it should. */
const STORED = [undefined, -5, -3, -2, -1, 0, 1, 2, 3, 5]
const best = (perfects: number, goods: number, misses: number, score = perfects * 100 + goods * 80): ScoreRecord => ({
  level: 1,
  score,
  accuracy: (perfects + goods) / (perfects + goods + misses),
  maxStreak: 3,
  perfects,
  goods,
  misses,
  speed: 1,
  date: 5,
})
const summaryOf = (perfects: number, goods: number, misses: number): ScoreSummary => ({
  score: perfects * 100 + goods * 80,
  streak: 0,
  maxStreak: 4,
  multiplier: 1,
  perfects,
  goods,
  misses,
  total: perfects + goods + misses,
  judged: perfects + goods + misses,
  accuracy: (perfects + goods) / (perfects + goods + misses),
})

describe('the notes a singer sings in', () => {
  it('are the stored easy notes, whoever set them', () => {
    expect(singingRange({ range: measured(45, 59) })).toEqual({ low: 45, high: 59, kind: 'own' })
    expect(singingRange({ range: { ...measured(46, 58), source: 'manual' } })).toEqual({ low: 46, high: 58, kind: 'own' })
    // A starting range the singer picked is theirs to sing in, but it was not found by listening.
    expect(singingRange({ range: starting('higher') })).toEqual({ low: 60, high: 67, kind: 'starting' })
  })

  it('are the starting notes of a lower voice while nothing is stored, never the key a song is written in', () => {
    expect(singingRange({})).toEqual({ low: 48, high: 55, kind: 'none' })
    expect(singingRange(undefined)).toEqual({ low: 48, high: 55, kind: 'none' })
  })
})

describe('the key of a song for one singer', () => {
  it('names the lowest and highest note of the song where it will be sung', () => {
    // Three notes next door to each other, placed in the middle of a lower voice: D, E and F sharp.
    const card = keyCard(song('sing-hot-cross-buns'), { range: starting('lower') })
    expect(card.fits).toBe(true)
    expect(card.title).toBe('In your key')
    expect(card.notes).toBe('This song: D3 to F#3')
    expect(card.yours).toBe('Your easy notes: C3 to G3')
    expect(card.moved).toBeNull()
    expect(card.reason).toBeNull()
  })

  it('says a song is in your key only when every note of the arrangement lies inside the easy notes', () => {
    for (const tune of VOCAL_SONGS) {
      for (const range of RANGES) {
        for (const stored of STORED) {
          const key = songKeyView(tune, range, stored)
          const where = `${tune.id} in ${range.low}-${range.high}, stored ${stored}`
          if (!key.fits) continue
          // The notes on the card are the notes of the chart that is sung, not a second sum.
          const sung = arrange(tune, { shift: key.shift, level: 2 }).notes.map((n) => n.midi)
          expect(Math.min(...sung), where).toBe(key.low)
          expect(Math.max(...sung), where).toBe(key.high)
          expect(key.low, where).toBeGreaterThanOrEqual(range.low)
          expect(key.high, where).toBeLessThanOrEqual(range.high)
        }
      }
    }
  })

  it('without easy notes of their own, is a key for a lower voice, and the card does not call it theirs', () => {
    const card = keyCard(song('sing-mary-lamb'), {})
    expect(card.fits).toBe(true)
    expect(card.title).toBe('In a key for a lower voice')
    expect(card.title).not.toMatch(/your key/i)
    expect(card.notes).toBe('This song: C3 to G3')
    expect(card.yours).toBe('Easy notes for a lower voice: C3 to G3')
    // The way to a key of their own is named, and only while they have none.
    expect(card.hint).toBe(SING_COPY.findYourNotes)
    expect(card.hint).toMatch(/My voice/)
    expect(keyCard(song('sing-mary-lamb'), { range: starting('lower') }).hint).toBeNull()
    expect(keyCard(song('sing-mary-lamb'), { range: measured(45, 59) }).hint).toBeNull()
    // The same place the song would have with the lower starting range stored.
    expect(songKeyView(song('sing-mary-lamb'), singingRange({}), undefined).shift).toBe(songKey(song('sing-mary-lamb'), DEFAULT_RANGES.lower).shift)
  })

  it('without easy notes of their own, no line of any card speaks of "your easy notes" as if they were known', () => {
    for (const tune of VOCAL_SONGS) {
      const card = keyCard(tune, {})
      // What the card states as a fact. (The hint and the reason may say "find your easy notes": that is the way out.)
      for (const line of [card.title, card.notes, card.yours, card.moved, card.end]) {
        if (line !== null) expect(line, `${tune.id}: ${line}`).not.toMatch(/\byour\b/i)
      }
    }
    // A song that is too wide is measured against the notes it was really placed in, and they are named for what they are.
    expect(keyCard(song('sing-amazing-grace'), {}).notes).toBe('This song reaches across 13 notes. The easy notes for a lower voice are 8 for now.')
    // And one that fills them says whose notes it fills.
    expect(keyCard(song('sing-mary-lamb'), {}).end).toBe('This song fills the easy notes for a lower voice, so it stays where it is.')
    // With notes of their own stored, the same lines are about the singer.
    expect(keyCard(song('sing-amazing-grace'), { range: starting('lower') }).notes).toBe('This song reaches across 13 notes. Your easy notes are 8 for now.')
    expect(keyCard(song('sing-mary-lamb'), { range: starting('lower') }).end).toBe('This song fills your easy notes, so it stays where it is.')
  })

  it('"Comes later" is the label of a song wider than the easy notes, with a kind reason and no key to move', () => {
    // Amazing Grace reaches across thirteen notes; a starting range holds eight.
    const card = keyCard(song('sing-amazing-grace'), { range: starting('lower') })
    expect(card.fits).toBe(false)
    expect(card.title).toBe('Comes later')
    expect(card.notes).toBe('This song reaches across 13 notes. Your easy notes are 8 for now.')
    expect(card.lower).toBeNull()
    expect(card.higher).toBeNull()
    expect(card.moved).toBeNull()
    // A stored key choice does not make it fit.
    expect(keyCard(song('sing-amazing-grace'), { range: starting('lower'), keyNudge: { 'sing-amazing-grace': -3 } }).fits).toBe(false)
  })

  it('the reason sends a singer with starting notes to find their own, and tells one with their own notes that it will wait', () => {
    const wide = song('sing-twinkle')
    expect(keyCard(wide, { range: starting('higher') }).reason).toBe(SING_COPY.laterStarting)
    expect(keyCard(wide, {}).reason).toBe(SING_COPY.laterStarting)
    expect(keyCard(wide, { range: measured(50, 57) }).reason).toBe(SING_COPY.laterOwn)
    expect(SING_COPY.laterStarting).toMatch(/My voice/)
    expect(SING_COPY.laterOwn).not.toMatch(/My voice/)
    // And a song that fits has no reason at all.
    expect(keyCard(wide, { range: measured(45, 59) }).reason).toBeNull()
  })
})

describe('"Lower" and "Higher"', () => {
  const buns = song('sing-hot-cross-buns')

  it('a stored choice that asks for more than the range gives counts for what it really moved', () => {
    // A lower starting voice has room for one small step up from the chosen key, whatever is stored.
    const range = starting('lower')
    const chosen = songKeyView(buns, range, undefined)
    const asked = songKeyView(buns, range, 3)
    expect(asked.shift).toBe(chosen.shift + 1)
    expect(asked.applied).toBe(1)
    // One tap on "Lower" brings it back to the chosen key: it stores 0, not 2.
    expect(asked.lower).toBe(0)
    expect(songKeyView(buns, range, asked.lower ?? undefined).shift).toBe(chosen.shift)
    // And there is nothing higher to offer.
    expect(asked.higher).toBeNull()
  })

  it('each button that is offered moves the song exactly one semitone, and one that is not has nowhere to go', () => {
    const reachable = (tune: VocalSong, range: VoiceRange) => Array.from({ length: 2 * MAX_KEY_NUDGE + 1 }, (_, i) => songKey(tune, range, i - MAX_KEY_NUDGE).shift)
    for (const tune of VOCAL_SONGS) {
      for (const range of RANGES) {
        for (const stored of STORED) {
          const key = songKeyView(tune, range, stored)
          const where = `${tune.id} in ${range.low}-${range.high}, stored ${stored}`
          if (!key.fits) {
            expect([key.lower, key.higher], where).toEqual([null, null])
            continue
          }
          const shifts = reachable(tune, range)
          if (key.lower === null) expect(Math.min(...shifts), where).toBe(key.shift)
          else expect(songKey(tune, range, key.lower).shift, where).toBe(key.shift - 1)
          if (key.higher === null) expect(Math.max(...shifts), where).toBe(key.shift)
          else expect(songKey(tune, range, key.higher).shift, where).toBe(key.shift + 1)
          // What is stored is always a choice the profile can hold.
          for (const next of [key.lower, key.higher]) if (next !== null) expect(Math.abs(next), where).toBeLessThanOrEqual(MAX_KEY_NUDGE)
        }
      }
    }
  })

  it('a song that fills the easy notes cannot move at all', () => {
    // Eight notes in a range of eight.
    const key = songKeyView(song('sing-mary-lamb'), starting('higher'), undefined)
    expect(key.fits).toBe(true)
    expect([key.lower, key.higher]).toEqual([null, null])
    // One sentence says so, not one for each button.
    expect(keyCard(song('sing-mary-lamb'), { range: starting('higher') }).end).toBe('This song fills your easy notes, so it stays where it is.')
  })

  it('a button with nowhere to go has a line that says which way is closed', () => {
    const range = starting('lower')
    expect(keyCard(buns, { range, keyNudge: { [buns.id]: 1 } }).end).toBe('This is as high as this song can go.')
    expect(keyCard(buns, { range, keyNudge: { [buns.id]: -2 } }).end).toBe('This is as low as this song can go.')
    expect(keyCard(buns, { range }).end).toBeNull()
    // A song that does not fit has no buttons, so nothing is said about them.
    expect(keyCard(song('sing-amazing-grace'), { range }).end).toBeNull()
  })

  it('stops three small steps from the chosen key even where the range has room for more', () => {
    const range = measured(40, 70)
    expect(songKeyView(buns, range, -3).lower).toBeNull()
    expect(songKeyView(buns, range, -3).higher).toBe(-2)
    expect(songKeyView(buns, range, 3).higher).toBeNull()
    expect(songKeyView(buns, range, 3).lower).toBe(2)
    // In the middle both are open, and the card has no "as low as it goes" line.
    const card = keyCard(buns, { range })
    expect([card.lower, card.higher]).toEqual([-1, 1])
    expect(card.end).toBeNull()
    // At three steps the line is there, although the range has room: the choice ends, not the voice.
    expect(keyCard(buns, { range, keyNudge: { [buns.id]: 3 } }).end).toBe('This is as high as this song can go.')
  })

  it('"Lower" stores what the Coach would store when it moves a song down itself', () => {
    for (const tune of VOCAL_SONGS) {
      for (const range of RANGES) {
        for (const stored of STORED) {
          expect(songKeyView(tune, range, stored).lower, `${tune.id} in ${range.low}-${range.high}, stored ${stored}`).toBe(lowerKeyNudge(tune, range, stored))
        }
      }
    }
  })

  it('the card says how far the song was moved, counting what really moved', () => {
    const range = measured(40, 70)
    expect(keyCard(buns, { range, keyNudge: { [buns.id]: -2 } }).moved).toBe('Moved 2 small steps lower.')
    expect(keyCard(buns, { range, keyNudge: { [buns.id]: 1 } }).moved).toBe('Moved 1 small step higher.')
    expect(keyCard(buns, { range, keyNudge: { [buns.id]: 0 } }).moved).toBeNull()
    // Asked for three up, room for one: one is what the card says.
    expect(keyCard(buns, { range: starting('lower'), keyNudge: { [buns.id]: 3 } }).moved).toBe('Moved 1 small step higher.')
    // The choice made for another song is not this song's.
    expect(keyCard(buns, { range, keyNudge: { 'sing-mary-lamb': -2 } }).moved).toBeNull()
  })
})

describe('the six levels', () => {
  it('are listed in order under the names the levels have, numbered 1 to 6', () => {
    const rows = levelRows({})
    expect(rows.map((r) => r.name)).toEqual(['Echo each line', 'Echo two lines', 'Whole tune', 'In tune', 'Hold the long notes', 'Performance'])
    expect(rows.map((r) => r.name)).toEqual(VOICE_LEVELS.map((l) => l.name))
    expect(rows.map((r) => r.about)).toEqual(VOICE_LEVELS.map((l) => l.about))
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('show the best run of each level in notes, read from the result stored under the level number', () => {
    const rows = levelRows({ '3': best(10, 4, 3), '1': best(17, 0, 0) })
    expect(rows[2].best).toBe('Best so far: 14 of 17 notes')
    expect(rows[0].best).toBe('Best so far: 17 of 17 notes')
    expect(rows[1].best).toBe('Not sung yet')
    expect(rows[3].best).toBe('Not sung yet')
    // No percentage and no score reaches the page.
    for (const row of rows) expect(row.best).not.toMatch(/%|\d{3,}/)
  })

  it('mark a level as done well from nine notes in ten, and never mark a level as bad', () => {
    const rows = levelRows({ '1': best(9, 0, 1), '2': best(8, 0, 2), '3': best(1, 0, 9), '4': best(7, 0, 3) })
    expect(rows.map((r) => r.tone)).toEqual(['ok', 'accent', 'default', 'accent', 'default', 'default'])
  })

  it('count a note inside the band but off its middle for four fifths, as the Coach does, when a level is marked as done well', () => {
    // Every note counted and none right in the middle: under way, and not yet done well.
    expect(levelRows({ '1': best(0, 17, 0) })[0].tone).toBe('accent')
    // Half of them in the middle is enough.
    expect(levelRows({ '1': best(9, 8, 0) })[0].tone).toBe('ok')
    expect(levelRows({ '1': best(8, 9, 0) })[0].tone).toBe('accent')
    // The line under the level still counts the notes that were on the note, all of them.
    expect(levelRows({ '1': best(0, 17, 0) })[0].best).toBe('Best so far: 17 of 17 notes')
  })

  it('a run is stored under level number index + 1, at speed 1, with the score the run was given', () => {
    const summary = summaryOf(10, 4, 3)
    expect(resultRecord(2, summary, 1234)).toEqual({ level: 3, score: 1320, accuracy: 14 / 17, maxStreak: 4, perfects: 10, goods: 4, misses: 3, speed: 1, date: 1234 })
    // What is stored is what the level row reads back.
    expect(levelRows({ [String(resultRecord(5, summary, 1).level)]: resultRecord(5, summary, 1) })[5].best).toBe('Best so far: 14 of 17 notes')
  })

  it('a run is a new best when it beats the stored score, as the song table keeps it', () => {
    expect(isNewBest(undefined, summaryOf(1, 0, 16))).toBe(true)
    expect(isNewBest(best(10, 4, 3), summaryOf(10, 5, 2))).toBe(true)
    expect(isNewBest(best(10, 4, 3), summaryOf(10, 4, 3))).toBe(false)
    // More notes on the note is not enough when fewer of them were right in the middle: the order is the Coach's.
    expect(isNewBest(best(14, 0, 3), summaryOf(0, 17, 0))).toBe(false)
  })

  it('open on the level sung last, or on the first when the song is new', () => {
    expect(startLevel(null)).toBe(0)
    expect(startLevel(4)).toBe(3)
    expect(startLevel(6)).toBe(5)
    // A stored number that is no level is the nearest one.
    expect(startLevel(9)).toBe(5)
    expect(startLevel(0)).toBe(0)
  })

  it('a level asked for in the address wins, read as the nearest level there is', () => {
    expect(startLevel(4, 1)).toBe(1)
    expect(startLevel(null, 5)).toBe(5)
    expect(startLevel(4, 12)).toBe(5)
    expect(askedLevel('2')).toBe(2)
    expect(askedLevel('0')).toBe(0)
    expect(askedLevel(null)).toBeUndefined()
    expect(askedLevel('')).toBeUndefined()
    expect(askedLevel('soon')).toBeUndefined()
    expect(singPath(7)).toBe('/sing/7')
    expect(singPath(7, 2)).toBe('/sing/7?level=2')
  })

  it('the first level asked for in an address is a level asked for, not no level', () => {
    // Level 0 is the one a number test loses first. A singer sent to "Echo each line" must land there,
    // also when the level they sang last was another.
    expect(singPath(7, 0)).toBe('/sing/7?level=0')
    for (let level = 0; level < VOICE_LEVELS.length; level++) {
      const asked = askedLevel(new URLSearchParams(singPath(7, level).split('?')[1]).get('level'))
      expect(startLevel(6, asked), `level ${level}`).toBe(level)
    }
  })

  it('offer the next level after nine notes in ten, and nothing after the last', () => {
    expect(nextLevelAfter(2, summaryOf(9, 0, 1))).toBe(3)
    expect(nextLevelAfter(2, summaryOf(89, 0, 11))).toBeNull()
    expect(nextLevelAfter(0, summaryOf(17, 0, 0))).toBe(1)
    expect(nextLevelAfter(5, summaryOf(17, 0, 0))).toBeNull()
    // A run in which nothing was scored offers nothing (and divides nothing by nothing).
    expect(nextLevelAfter(0, summaryOf(0, 0, 0))).toBeNull()
  })

  it('offer the next level exactly when the Coach would move the song up after that run', () => {
    // The trap: "17 of 17 notes" where every note was a little off its middle. The Coach counts such a
    // run as four fifths and keeps the level, so a card that said "you are ready" would be contradicted
    // by the next plan, and the next level, with its narrower band, would count none of those notes.
    expect(nextLevelAfter(0, summaryOf(0, 17, 0))).toBeNull()
    expect(nextLevelAfter(0, summaryOf(9, 8, 0))).toBe(1)
    expect(nextLevelAfter(0, summaryOf(8, 9, 0))).toBeNull()
    const sung = (perfects: number, goods: number, misses: number): AttemptResult => ({
      perfects,
      goods,
      misses,
      total: perfects + goods + misses,
      timingMedianMs: null,
      timingStdevMs: null,
      coverage: 1,
      durationSec: 30,
      playedTempo: 100,
      targetTempo: 100,
      speed: 1,
    })
    for (let perfects = 0; perfects <= 12; perfects++) {
      for (let goods = 0; perfects + goods <= 12; goods++) {
        const misses = 12 - perfects - goods
        const coachMovesUp = attemptPerformance(sung(perfects, goods, misses)).acc >= SONG_LEVEL_UP_ACCURACY
        expect(nextLevelAfter(3, summaryOf(perfects, goods, misses)) !== null, `${perfects} in the middle, ${goods} inside, ${misses} not`).toBe(coachMovesUp)
      }
    }
  })

  it('say what is still to do when every note counted and the next level is not offered yet', () => {
    // "17 of 17 notes" and no next level would be a riddle. One line says what the next step is.
    expect(closerLine(summaryOf(0, 17, 0))).toBe('Next, keep your dot in the middle of each bar, right to the end.')
    expect(closerLine(summaryOf(8, 9, 0))).toBe(SING_COPY.closer)
    // Not when the next level is offered: then the card says that instead.
    expect(closerLine(summaryOf(9, 8, 0))).toBeNull()
    expect(closerLine(summaryOf(17, 0, 0))).toBeNull()
    // Not when a note did not count: "every note" would not be true, and the tip speaks of those notes.
    expect(closerLine(summaryOf(0, 16, 1))).toBeNull()
    // Not for a run in which nothing was scored.
    expect(closerLine(summaryOf(0, 0, 0))).toBeNull()
    // It is the same on every level, the last one too: there it is what is left to do.
    expect(nextLevelAfter(5, summaryOf(0, 17, 0))).toBeNull()
  })
})

describe('one line on its own', () => {
  it('is named by its words, put back together from the syllables', () => {
    expect(lineWords(song('sing-mary-lamb'), 0)).toBe('Mary had a little lamb')
    expect(lineWords(song('sing-ode-to-joy'), 3)).toBe("Op'ning to the sun above")
    // A syllable carried over two notes is still one syllable, also in the middle of a word and at the end of a line.
    expect(lineWords(song('sing-aunt-rhody'), 1)).toBe('go tell Aunt Rhody')
    expect(lineWords(song('sing-amazing-grace'), 0)).toBe('Amazing grace how sweet the sound')
    expect(lineWords(song('sing-happy-birthday'), 2)).toBe('happy birthday dear friend')
    // A rest written at the end of a line has no word.
    expect(lineWords(song('sing-saints'), 0)).toBe('Oh when the saints')
  })

  it('a word that is written with a hyphen keeps it when its syllables are put together', () => {
    // "one-" and "horse" are two syllables of one word, like "Ma-" and "ry", but the word is "one-horse".
    expect(lineWords(song('sing-jingle-bells'), 3)).toBe('in a one-horse open sleigh hey')
    expect(lineWords(song('sing-jingle-bells'), 7)).toBe('in a one-horse open sleigh')
    for (const tune of VOCAL_SONGS) for (const c of lineChoices(tune)) expect(c.label, tune.id).not.toMatch(/onehorse/i)
    // Every other word is joined without one.
    expect(lineWords(song('sing-jingle-bells'), 0)).toBe('Jingle bells jingle bells')
  })

  it('a line without words is still a choice, named by its number alone', () => {
    const hummed: VocalSong = { ...song('sing-hot-cross-buns'), lines: [[[0, 1], [2, 1], [null, 2]], [[4, 2, ''], [2, 2]]] }
    expect(lineWords(hummed, 0)).toBe('')
    expect(lineChoices(hummed).map((c) => c.label)).toEqual(['Line 1', 'Line 2'])
    // A line number that does not exist has no words either, and nothing breaks.
    expect(lineWords(hummed, 7)).toBe('')
  })

  it('there is one choice for every line of the song, numbered from 1', () => {
    for (const tune of VOCAL_SONGS) {
      const choices = lineChoices(tune)
      expect(choices.map((c) => c.index), tune.id).toEqual(tune.lines.map((_, i) => i))
      for (const c of choices) expect(c.label, tune.id).toBe(`Line ${c.index + 1}: ${lineWords(tune, c.index)}`)
    }
    expect(lineChoices(song('sing-hot-cross-buns')).map((c) => c.label)).toEqual(['Line 1: Hot cross buns', 'Line 2: Hot cross buns', 'Line 3: One a penny two a penny hot cross buns'])
  })

  it('says over the run and under its start button that it is one line, for practice', () => {
    const [, , third] = lineChoices(song('sing-hot-cross-buns'))
    expect(runWords(2, 11, third.label)).toEqual({
      heading: 'Line 3: One a penny two a penny hot cross buns · Whole tune',
      ready: 'Line 3: One a penny two a penny hot cross buns · for practice',
    })
    // The whole song: the level and how much there is to sing, with no speed (a song is never slowed down).
    expect(runWords(2, 17, null)).toEqual({ heading: 'Whole tune', ready: 'Whole tune · 17 notes to sing' })
    expect(runWords(5, 1, null).ready).toBe('Performance · 1 note to sing')
  })

  it('is practice: only a run of the whole song is saved as a result', () => {
    const tune = song('sing-mary-lamb')
    expect(savesAsResult(arrange(tune, { shift: -10, level: 2 }))).toBe(true)
    expect(savesAsResult(arrange(tune, { shift: -10, level: 2, onlyLine: 0 }))).toBe(false)
    expect(savesAsResult(arrange(tune, { shift: -10, level: 0, onlyLine: 3 }))).toBe(false)
    // Something that is not a sung chart at all is nothing to save here.
    expect(savesAsResult({ voice: undefined })).toBe(false)
  })
})

describe('"Sing again" on the result card', () => {
  it('starts the same run again at once when nothing about it has changed', () => {
    expect(singsAgainAtOnce({ sameRun: true, saving: false, keyLowered: false })).toBe(true)
  })

  it('never starts the old key again once the Coach has moved the song down, even before the new key has arrived', () => {
    // The key choice is stored first and the page hears of it a moment later. In that moment the run on
    // screen still looks like the latest one, and a pass sung in it would be counted for the new key.
    expect(singsAgainAtOnce({ sameRun: true, saving: false, keyLowered: true })).toBe(false)
    expect(singsAgainAtOnce({ sameRun: false, saving: false, keyLowered: true })).toBe(false)
  })

  it('does not start while the run is still being saved: the Coach has not said yet whether the key moves', () => {
    expect(singsAgainAtOnce({ sameRun: true, saving: true, keyLowered: false })).toBe(false)
  })

  it('does not start a run that is no longer the one made for this singer (another key, another range)', () => {
    expect(singsAgainAtOnce({ sameRun: false, saving: false, keyLowered: false })).toBe(false)
  })
})

describe('the songs of the library for a singer', () => {
  const ids = (cards: { id: string }[]) => cards.map((c) => c.id)

  it('lists every song once: those that fit in the order of the course, the others under "Comes later"', () => {
    const { now, later } = songCards(VOCAL_SONGS, { range: starting('lower') }, [])
    expect(ids(now)).toEqual(['sing-hot-cross-buns', 'sing-mary-lamb', 'sing-ode-to-joy', 'sing-aunt-rhody', 'sing-saints', 'sing-jingle-bells'])
    expect(ids(later)).toEqual(['sing-london-bridge', 'sing-twinkle', 'sing-amazing-grace', 'sing-happy-birthday'])
    expect([...ids(now), ...ids(later)].sort()).toEqual(VOCAL_SONGS.map((s) => s.id).sort())
    for (const card of now) expect(card.key.title).toBe('In your key')
    for (const card of later) {
      expect(card.key.title).toBe('Comes later')
      expect(card.key.reason).toBe(SING_COPY.laterStarting)
    }
  })

  it('a wider range brings the later songs in, also the ones whose skills are not under way yet', () => {
    // Amazing Grace and Happy Birthday ask for skills the Coach waits for. The library does not wait.
    const { now, later } = songCards(VOCAL_SONGS, { range: measured(45, 59) }, [])
    expect(ids(now)).toEqual(VOCAL_SONGS.map((s) => s.id))
    expect(later).toEqual([])
    expect(now.filter((c) => (song(c.id).needs ?? []).length > 0).map((c) => c.id)).toEqual(['sing-amazing-grace', 'sing-happy-birthday'])
  })

  it('a card carries the name, the credit, one sentence about the song and the six levels', () => {
    const [card] = songCards([song('sing-aunt-rhody')], { range: starting('lower') }, []).now
    expect(card.title).toBe('Go Tell Aunt Rhody')
    expect(card.credit).toBe('Traditional')
    expect(card.description).toBe(song('sing-aunt-rhody').description)
    expect(card.levels).toHaveLength(6)
    expect(card.levels.every((l) => l.best === 'Not sung yet')).toBe(true)
    expect(card.plays).toBe(0)
    expect(card.sung).toBeNull()
  })

  it('takes the best runs and the play count from the stored row of that song, and from no other row', () => {
    const rows: Parameters<typeof songCards>[2] = [
      { builtinId: 'sing-mary-lamb', bestScores: { '1': best(20, 2, 4) }, playCount: 3 },
      { builtinId: 'ode-to-joy', bestScores: { '1': best(1, 1, 1) }, playCount: 9 },
      { bestScores: { '2': best(1, 1, 1) }, playCount: 5 },
    ]
    const { now } = songCards(VOCAL_SONGS, { range: starting('lower') }, rows)
    const mary = now.find((c) => c.id === 'sing-mary-lamb')
    expect(mary?.plays).toBe(3)
    expect(mary?.sung).toBe('Sung 3 times')
    expect(songCards([song('sing-mary-lamb')], {}, [{ builtinId: 'sing-mary-lamb', bestScores: {}, playCount: 1 }]).now[0].sung).toBe('Sung once')
    expect(mary?.levels[0].best).toBe('Best so far: 22 of 26 notes')
    for (const card of now.filter((c) => c.id !== 'sing-mary-lamb')) {
      expect(card.plays, card.id).toBe(0)
      expect(card.levels.every((l) => l.best === 'Not sung yet'), card.id).toBe(true)
    }
  })

  it('a song the singer moved is still in the list, in the key they chose', () => {
    const range = measured(45, 59)
    const [plain] = songCards([song('sing-mary-lamb')], { range }, []).now
    const [moved] = songCards([song('sing-mary-lamb')], { range, keyNudge: { 'sing-mary-lamb': -2 } }, []).now
    expect(plain.key.notes).toBe('This song: D3 to A3')
    expect(moved.key.notes).toBe('This song: C3 to G3')
    expect(moved.key.moved).toBe('Moved 2 small steps lower.')
  })
})

describe('the words on the song page and the library', () => {
  const BANNED = /\b(wrong|fail|failed|failure|tone deaf|louder|loud|push|belt|bpm|rating|accuracy|cents?|tier|reps?|score|semitones?)\b/i

  it('are plain and kind: nothing a beginner cannot use, nothing that blames', () => {
    const words: string[] = [GETTING_READY]
    for (const value of Object.values(SING_COPY)) words.push(typeof value === 'function' ? value('Whole tune') : value)
    const profiles: VoiceProfile[] = [{}, { range: starting('lower') }, { range: measured(45, 59), keyNudge: { 'sing-mary-lamb': -2, 'sing-twinkle': 3 } }]
    for (const voice of profiles) {
      for (const tune of VOCAL_SONGS) {
        const card = keyCard(tune, voice)
        words.push(card.title, card.notes, card.yours, ...[card.moved, card.reason, card.hint, card.end].filter((w): w is string => w !== null))
        words.push(...lineChoices(tune).map((c) => c.label))
      }
    }
    for (const row of levelRows({ '2': best(3, 2, 12) })) words.push(row.name, row.about, row.best)
    words.push(...Object.values(runWords(0, 26, 'Line 1: Mary had a little lamb')), ...Object.values(runWords(4, 26, null)))
    words.push(...songCards(VOCAL_SONGS, {}, [{ builtinId: 'sing-saints', bestScores: {}, playCount: 1 }, { builtinId: 'sing-ode-to-joy', bestScores: {}, playCount: 7 }]).now.flatMap((c) => [c.title, c.description, ...(c.sung ? [c.sung] : [])]))
    expect(words.length).toBeGreaterThan(100)
    for (const text of words) {
      expect(text, text).not.toMatch(BANNED)
      expect(text.trim(), text).toBe(text)
      expect(text.length, text).toBeGreaterThan(0)
    }
  })

  it('the waiting line is the one the page is asked to show', () => {
    expect(GETTING_READY).toBe('Getting your song ready')
  })
})

describe('after the page has painted (afterPaint)', () => {
  let frames: (() => void)[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    frames = []
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not run the work in the call, nor in the frame itself, but in a task after the frame', () => {
    const work = vi.fn()
    afterPaint(work)
    expect(work).not.toHaveBeenCalled()
    // Time alone, well short of the fallback, does nothing: the browser has not drawn yet.
    vi.advanceTimersByTime(50)
    expect(work).not.toHaveBeenCalled()
    // The frame callback runs before the browser paints, so the work must not be in it.
    frames[0]()
    expect(work).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(work).toHaveBeenCalledTimes(1)
    // The fallback that was waiting does not run it a second time.
    vi.advanceTimersByTime(5000)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('still runs when no frame ever comes (a tab in the background), a moment later', () => {
    const work = vi.fn()
    afterPaint(work)
    vi.advanceTimersByTime(5000)
    expect(work).toHaveBeenCalledTimes(1)
    // A frame that turns up after all changes nothing.
    frames[0]()
    vi.advanceTimersByTime(5000)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('called off, never runs: not from the frame, not from the fallback', () => {
    const work = vi.fn()
    const callOff = afterPaint(work)
    callOff()
    frames[0]()
    vi.advanceTimersByTime(5000)
    expect(work).not.toHaveBeenCalled()
    // Called off between the frame and its task as well.
    const second = afterPaint(work)
    frames[1]()
    second()
    vi.advanceTimersByTime(5000)
    expect(work).not.toHaveBeenCalled()
  })

  it('works where there are no frames at all', () => {
    vi.unstubAllGlobals()
    const work = vi.fn()
    afterPaint(work)
    expect(work).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(work).toHaveBeenCalledTimes(1)
  })
})

describe('a song made ready for one run (useVocalRunState)', () => {
  const s = song('sing-aunt-rhody')
  const record = { builtinId: s.id }
  const range = measured(50, 62, 55)
  /** One render of a screen that shows this record at this level. */
  const render = (level = 2, options?: { onlyLine?: number }, of: { builtinId?: string } | null = record): VocalRunState => {
    const useThisRun = () => useVocalRunState(of, level, options)
    return screen.render(useThisRun)
  }
  /** Lets the tasks that are waiting run (there are no frames here, so "after paint" is the next task), and what they start. */
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const made = () => vi.mocked(vocalRunFor).mock.calls.length
  const ready = (state: VocalRunState) => {
    if (state.status !== 'ready') throw new Error(`the run is ${state.status}, not ready`)
    return state.run
  }

  beforeEach(() => {
    screen.unmount()
    screen.setProfile(undefined)
    vi.mocked(vocalRunFor).mockClear()
    vi.mocked(renderChartVoiced).mockClear()
    vi.mocked(renderChartVoiced).mockImplementation(async () => ({ samples: new Float32Array(1), voice: null }))
  })
  afterEach(async () => {
    screen.unmount()
    await settle()
    const actual = await vi.importActual<typeof import('../../audio/guitar')>('../../audio/guitar')
    vi.mocked(renderChartVoiced).mockImplementation(actual.renderChartVoiced)
  })

  it('makes no sound inside a render: the first answer is "preparing", and the tracks are made after it', async () => {
    screen.setProfile({ range })
    expect(render()).toEqual({ status: 'preparing' })
    // Rendered again and again before the page could paint: still nothing made.
    expect(render()).toEqual({ status: 'preparing' })
    expect(made()).toBe(0)
    expect(renderChartVoiced).not.toHaveBeenCalled()
    await settle()
    expect(made()).toBe(1)
    const run = ready(render())
    // Both tracks are there before the Player is: the one that is scored and the one to listen to.
    expect(run.audio.type).toBe('audio/wav')
    expect(run.guide.type).toBe('audio/wav')
    expect(run.guide).not.toBe(run.audio)
  })

  it('is "preparing" while the singing profile is still being read, and makes nothing for it', async () => {
    expect(render()).toEqual({ status: 'preparing' })
    await settle()
    expect(render(0)).toEqual({ status: 'preparing' })
    await settle()
    expect(made()).toBe(0)
  })

  it('is "none" for a record that is not a song to sing, at once, and makes nothing for it', async () => {
    screen.setProfile({ range })
    expect(render(2, undefined, { builtinId: 'ode-to-joy' })).toEqual({ status: 'none' })
    expect(render(2, undefined, {})).toEqual({ status: 'none' })
    expect(render(2, undefined, null)).toEqual({ status: 'none' })
    await settle()
    expect(made()).toBe(0)
  })

  it('gives the song in the key of the stored range, moved by the singer\'s own choice for this song and for no other', async () => {
    const chosen = songKey(s, range).shift
    screen.setProfile({ range, keyNudge: { 'sing-mary-lamb': 2 } })
    render(3)
    await settle()
    const run = ready(render(3))
    expect(run.shift).toBe(chosen)
    expect(run.fits).toBe(true)
    expect(run.chart).toEqual(arrange(s, { shift: chosen, level: 3 }))
    // The Player scores every note of it.
    expect(run.notes).toBe(run.chart.notes)
    // The tracks are the ones the song's own module makes for this key and level, not a second mix.
    const same = vocalRunFor(s.id, { range }, 3)?.run
    expect(run.audio).toBe(same?.audio)
    expect(run.guide).toBe(await same?.guide)
    expect(run.key).toBe(same?.key)

    screen.setProfile({ range, keyNudge: { 'sing-mary-lamb': 2, [s.id]: -1 } })
    expect(render(3)).toEqual({ status: 'preparing' })
    await settle()
    const lower = ready(render(3))
    expect(lower.shift).toBe(chosen - 1)
    expect(lower.chart.voice?.shift).toBe(chosen - 1)
    expect(lower.key).not.toBe(run.key)
  })

  it('with no easy notes stored, is in the key the song page shows for a lower voice, not where the song is written', async () => {
    screen.setProfile({})
    render()
    await settle()
    const run = ready(render())
    expect(run.shift).toBe(-12)
    expect(run.shift).toBe(songKeyView(s, singingRange({}), undefined).shift)
    expect(run.fits).toBe(true)
    expect(Math.min(...run.notes.map((n) => n.midi))).toBeGreaterThanOrEqual(DEFAULT_RANGES.lower.low)
    expect(Math.max(...run.notes.map((n) => n.midi))).toBeLessThanOrEqual(DEFAULT_RANGES.lower.high)
  })

  it('says so when the song is too wide for the range', async () => {
    screen.setProfile({ range: starting('lower') })
    render(2, undefined, { builtinId: 'sing-amazing-grace' })
    await settle()
    expect(ready(render(2, undefined, { builtinId: 'sing-amazing-grace' })).fits).toBe(false)
  })

  it('with one line asked for, is that line alone', async () => {
    screen.setProfile({ range })
    render(0, { onlyLine: 2 })
    await settle()
    const run = ready(render(0, { onlyLine: 2 }))
    expect(run.chart.voice?.onlyLine).toBe(2)
    expect(run.chart).toEqual(arrange(s, { shift: songKey(s, range).shift, level: 0, onlyLine: 2 }))
    expect(savesAsResult(run.chart)).toBe(false)
  })

  it('the whole song asked for after one line is "preparing" again: the line that was ready is never handed out for it', async () => {
    screen.setProfile({ range: { ...range, low: 46, high: 58 } })
    render(2, { onlyLine: 1 })
    await settle()
    const line = ready(render(2, { onlyLine: 1 }))
    expect(render(2)).toEqual({ status: 'preparing' })
    await settle()
    const whole = ready(render(2))
    expect(whole.chart.voice?.onlyLine).toBeUndefined()
    expect(whole.notes.length).toBeGreaterThan(line.notes.length)
    // And another line is not the whole song either.
    expect(render(2, { onlyLine: 0 })).toEqual({ status: 'preparing' })
  })

  it('once ready it is the same object at every render, so the Player is not started again', async () => {
    screen.setProfile({ range: { ...range, low: 51 } })
    render()
    await settle()
    const first = render()
    expect(first.status).toBe('ready')
    expect(render()).toBe(first)
    await settle()
    expect(render()).toBe(first)
    expect(made()).toBe(1)
  })

  it('is not made again when the profile is written for another reason: a tired day, a key for another song', async () => {
    screen.setProfile({ range: { ...range, low: 52 } })
    render()
    await settle()
    const before = render()
    screen.setProfile({ range: { ...range, low: 52, at: 99, easy: 56 }, tiredOn: '2026-01-05', keyNudge: { 'sing-twinkle': 1 } })
    expect(render()).toBe(before)
    await settle()
    expect(render()).toBe(before)
    expect(made()).toBe(1)
  })

  it('a new range is "preparing" again, and the run of the key that was left never plays under the new one', async () => {
    const lower = { ...range, low: 45, high: 57 }
    const higher = { ...range, low: 57, high: 69 }
    screen.setProfile({ range: lower })
    render()
    await settle()
    const low = ready(render())
    screen.setProfile({ range: higher })
    // What is ready belongs to the other key: nothing is better than that.
    expect(render()).toEqual({ status: 'preparing' })
    await settle()
    const high = ready(render())
    expect(high.shift).toBe(songKey(s, higher).shift)
    expect(high.shift).not.toBe(low.shift)
    expect(high.chart.voice?.shift).toBe(high.shift)
    expect(high.guide).not.toBe(low.guide)
  })

  it('a run whose guide arrives after its level was left does not take the place of the level sung now', async () => {
    // A key no other test opens, so neither level is in memory already and both ask for their chords.
    const mine = { range: { ...range, low: 49, high: 61 }, keyNudge: { [s.id]: 1 } }
    screen.setProfile(mine)
    // The chords of the first level opened are slow to come; those of the second are there at once.
    let release = (): void => {}
    vi.mocked(renderChartVoiced).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ samples: new Float32Array(1), voice: null }))))
    render(5)
    await settle()
    expect(render(5)).toEqual({ status: 'preparing' })
    expect(render(4)).toEqual({ status: 'preparing' })
    await settle()
    const now = render(4)
    expect(ready(now).chart.voice?.judge).toEqual(VOICE_LEVELS[4].judge)
    // Now the guide of the level that was left arrives. It is for nobody.
    release()
    await settle()
    expect(render(4)).toBe(now)
  })

  it('a level that was left before the page painted is never made at all', async () => {
    screen.setProfile({ range: { ...range, low: 48, high: 60 } })
    render(5)
    render(1)
    await settle()
    expect(vi.mocked(vocalRunFor).mock.calls.map(([, , level]) => level)).toEqual([1])
    expect(ready(render(1)).chart.voice?.judge).toEqual(VOICE_LEVELS[1].judge)
  })

  it('a screen that was left before the page painted makes nothing', async () => {
    screen.setProfile({ range })
    render()
    screen.unmount()
    await settle()
    expect(made()).toBe(0)
  })

  it('says so when the tracks could not be made, and is ready again when something else is asked for', async () => {
    screen.setProfile({ range: { ...range, low: 47, high: 59 } })
    vi.mocked(vocalRunFor).mockImplementationOnce(() => {
      throw new RangeError('Array buffer allocation failed')
    })
    render(2)
    await settle()
    expect(render(2)).toEqual({ status: 'failed' })
    // It does not try the same thing again by itself at every render.
    await settle()
    expect(made()).toBe(1)
    expect(render(3)).toEqual({ status: 'preparing' })
    await settle()
    expect(render(3).status).toBe('ready')
  })

  it('after the tracks could not be made, leaving the screen and opening it again tries again', async () => {
    // The page says "Go back and open it again", so that has to be worth doing.
    screen.setProfile({ range: { ...range, low: 46, high: 59 } })
    vi.mocked(vocalRunFor).mockImplementationOnce(() => {
      throw new RangeError('Array buffer allocation failed')
    })
    render(1)
    await settle()
    expect(render(1)).toEqual({ status: 'failed' })
    screen.unmount()
    expect(render(1)).toEqual({ status: 'preparing' })
    await settle()
    expect(ready(render(1)).chart.voice?.judge).toEqual(VOICE_LEVELS[1].judge)
    expect(made()).toBe(2)
  })

  it('is not made again when the stored row of the song is written again (every saved run writes it)', async () => {
    screen.setProfile({ range: { ...range, low: 53 } })
    render(2, undefined, { builtinId: s.id })
    await settle()
    const before = render(2, undefined, { builtinId: s.id })
    expect(before.status).toBe('ready')
    // The row as the live query hands it out after a run: a new object, the same song.
    const rewritten = { builtinId: s.id, playCount: 4, bestScores: { '3': best(10, 4, 3) } }
    expect(render(2, undefined, rewritten)).toBe(before)
    await settle()
    expect(render(2, undefined, rewritten)).toBe(before)
    expect(made()).toBe(1)
  })

  it('another song asked for at the same level is "preparing", and what comes is that song, never the one that was ready', async () => {
    const other = song('sing-mary-lamb')
    screen.setProfile({ range: { ...range, low: 47, high: 60 } })
    render(2)
    await settle()
    const first = ready(render(2))
    expect(render(2, undefined, { builtinId: other.id })).toEqual({ status: 'preparing' })
    await settle()
    const second = ready(render(2, undefined, { builtinId: other.id }))
    expect(second.chart.notes.length).toBe(arrange(other, { shift: 0, level: 2 }).notes.length)
    expect(second.chart.notes.length).not.toBe(first.chart.notes.length)
    expect(second.key).toMatch(/^sing-mary-lamb:/)
    // And a record that is no song to sing after that is "none" at once: the run that was ready is not kept for it.
    expect(render(2, undefined, { builtinId: 'ode-to-joy' })).toEqual({ status: 'none' })
  })

  it('a stored key choice that asks for more than the easy notes hold is sung where the song page says it is', async () => {
    // Three steps up are stored; a lower starting voice has room for one. The card and the run must agree,
    // or the singer reads one key and is given the starting note of another.
    const buns = song('sing-hot-cross-buns')
    const voice = { range: starting('lower'), keyNudge: { [buns.id]: 3 } }
    screen.setProfile(voice)
    render(2, undefined, { builtinId: buns.id })
    await settle()
    const run = ready(render(2, undefined, { builtinId: buns.id }))
    const card = keyCard(buns, voice)
    expect(run.shift).toBe(card.shift)
    expect(run.shift).toBe(songKey(buns, starting('lower')).shift + 1)
    expect(run.fits).toBe(true)
    const sung = run.notes.map((n) => n.midi)
    expect(Math.min(...sung)).toBeGreaterThanOrEqual(DEFAULT_RANGES.lower.low)
    expect(Math.max(...sung)).toBeLessThanOrEqual(DEFAULT_RANGES.lower.high)
    expect(Math.max(...sung)).toBe(DEFAULT_RANGES.lower.high)
  })
})

describe('the run alone, for a screen that only waits for it (useVocalRun)', () => {
  const s = song('sing-hot-cross-buns')
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  beforeEach(() => {
    screen.unmount()
    screen.setProfile({ range: starting('higher') })
    vi.mocked(vocalRunFor).mockClear()
    vi.mocked(renderChartVoiced).mockImplementation(async () => ({ samples: new Float32Array(1), voice: null }))
  })
  afterEach(async () => {
    screen.unmount()
    await settle()
    const actual = await vi.importActual<typeof import('../../audio/guitar')>('../../audio/guitar')
    vi.mocked(renderChartVoiced).mockImplementation(actual.renderChartVoiced)
  })

  it('is nothing until both tracks exist, then the run, and makes no sound inside a render either', async () => {
    const useIt = () => useVocalRun({ builtinId: s.id }, 2)
    expect(screen.render(useIt)).toBeNull()
    expect(vocalRunFor).not.toHaveBeenCalled()
    await settle()
    const run = screen.render(useIt)
    expect(run?.chart).toEqual(arrange(s, { shift: songKey(s, DEFAULT_RANGES.higher).shift, level: 2 }))
    expect(run?.guide.type).toBe('audio/wav')
    expect(screen.render(useIt)).toBe(run)
  })

  it('is nothing for a record that is not a song to sing', async () => {
    const useIt = () => useVocalRun({ builtinId: 'ode-to-joy' }, 2)
    expect(screen.render(useIt)).toBeNull()
    await settle()
    expect(screen.render(useIt)).toBeNull()
    expect(vocalRunFor).not.toHaveBeenCalled()
  })
})

describe('the span of every song against the starting ranges', () => {
  it('the card of a song says "In your key" exactly when the key fits (no third state)', () => {
    for (const tune of VOCAL_SONGS) {
      for (const range of RANGES) {
        const card = keyCard(tune, { range })
        const span = songSpan(tune)
        expect(card.fits, `${tune.id} in ${range.low}-${range.high}`).toBe(span.high - span.low <= range.high - range.low)
        expect(card.title, tune.id).toBe(card.fits ? 'In your key' : 'Comes later')
      }
    }
  })
})
