import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { defaultProfile, getSession, loadProfile, localDateString, recordAttempt, resetTrainingData, saveProfile, saveSession } from './store'
import type { Attempt, BlockStatus, ExerciseBlock, Profile, SessionRecord, VoiceRange } from './types'
import { loadVoiceProfile, markTiredOn, saveVoiceRange, setKeyNudge } from './voiceProfile'

/**
 * What only a singer has (the easy notes, a key choice per song, the "tired" mark) lives on profile row 2.
 * Saving any of it must write that row and nothing else: no guitar profile, no lessons, no songs, no plan.
 */
const NOW = new Date(2026, 10, 23, 15).getTime()
const TODAY = localDateString(new Date(NOW))
const YESTERDAY = '2026-11-22'
const TABLES = ['skillStates', 'songItems', 'attempts', 'sessions', 'tests', 'milestones', 'lessons', 'songs'] as const

const range = (over: Partial<VoiceRange> = {}): VoiceRange => ({ low: 55, high: 62, easy: 58, source: 'measured', at: NOW, ...over })

function block(id: string, status: BlockStatus = 'pending'): ExerciseBlock {
  return { id, kind: 'focus', status, minutes: 5, skillId: 'voice.pitch.match', generatorId: 'voiceEcho', params: { tempo: 60, bars: 4 }, tempo: 60, reps: 1, reason: 'test' }
}

function session(date: string, statuses: BlockStatus[], voice = true): SessionRecord {
  const blocks = statuses.map((status, i) => block(`${voice ? 'voice-' : ''}${date}-${i}-focus`, status))
  return { date, plan: { date, minutes: 10, dayFactor: 1, blocks, explanation: [] }, minutesDone: 0, completedBlockIds: [], startedAt: 1 }
}

/** One sung round, as the Coach records it while a block is under way. */
function run(over: Partial<Attempt>): Attempt {
  return {
    at: NOW - 60_000,
    kind: 'practice',
    skillId: 'voice.pitch.match',
    instrument: 'voice',
    perfects: 3,
    goods: 1,
    misses: 0,
    total: 4,
    timingMedianMs: null,
    timingStdevMs: null,
    coverage: 1,
    durationSec: 20,
    playedTempo: 60,
    targetTempo: 60,
    speed: 1,
    difficulty: 10,
    performance: 0.9,
    accuracy: 0.95,
    reliable: true,
    ...over,
  }
}

function singer(over: Partial<Profile> = {}): Profile {
  return { ...defaultProfile(1), id: 2, instrument: 'voice', streak: 4, experience: 'some', placementDoneAt: 9, ...over }
}

beforeEach(async () => {
  await resetTrainingData()
  await db.songs.clear()
})

describe('the voice profile', () => {
  it('is empty before anything is saved, and reading it stores nothing', async () => {
    expect(await loadVoiceProfile()).toEqual({})
    expect(await db.profile.count()).toBe(0)
  })

  it('reads what the singing profile holds, never the guitar profile', async () => {
    await saveProfile({ ...defaultProfile(1), voice: { tiredOn: '2026-01-01' } })
    expect(await loadVoiceProfile()).toEqual({})
    await saveProfile(singer({ voice: { range: range(), keyNudge: { 'sing-twinkle': -2 } } }))
    expect(await loadVoiceProfile()).toEqual({ range: range(), keyNudge: { 'sing-twinkle': -2 } })
  })
})

describe('saving the range', () => {
  it('writes it on profile row 2 and creates nothing else', async () => {
    await saveVoiceRange(range(), NOW)
    expect(await db.profile.toArray()).toEqual([expect.objectContaining({ id: 2, instrument: 'voice', voice: { range: range() } })])
    for (const t of TABLES) expect(await db.table(t).count(), t).toBe(0)
    expect(await loadVoiceProfile()).toEqual({ range: range() })
    // A row the rest of the app can load as it is.
    expect(await loadProfile('voice')).toMatchObject({ id: 2, goals: ['all-round'], dailyMinutes: 20, streak: 0 })
  })

  it('keeps everything else the singer already has', async () => {
    await saveProfile(singer({ voice: { range: range({ low: 48, high: 55, easy: 52 }), keyNudge: { 'sing-twinkle': 1 }, tiredOn: YESTERDAY } }))
    await saveVoiceRange(range({ source: 'manual' }), NOW)
    expect(await db.profile.get(2)).toEqual(singer({ voice: { range: range({ source: 'manual' }), keyNudge: { 'sing-twinkle': 1 }, tiredOn: YESTERDAY } }))
  })

  it('never touches the guitar profile', async () => {
    const guitar = { ...defaultProfile(1), streak: 7 }
    await saveProfile(guitar)
    await saveVoiceRange(range(), NOW)
    await setKeyNudge('sing-twinkle', 1)
    await markTiredOn(TODAY)
    expect(await db.profile.get(1)).toEqual(guitar)
  })

  it("throws away today's singing plan when nothing in it was started, so the next one is made for the new range", async () => {
    await saveSession(session(TODAY, ['pending', 'pending']))
    await saveVoiceRange(range(), NOW)
    expect(await getSession(TODAY, 'voice')).toBeUndefined()
  })

  it('does the same when the blocks so far were only skipped', async () => {
    await saveSession(session(TODAY, ['skipped', 'pending']))
    await saveVoiceRange(range(), NOW)
    expect(await getSession(TODAY, 'voice')).toBeUndefined()
  })

  it('keeps the plan once a block is done', async () => {
    const id = await saveSession(session(TODAY, ['done', 'pending']))
    await saveVoiceRange(range(), NOW)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(id)
  })

  it('keeps the plan while a block is being sung', async () => {
    const id = await saveSession(session(TODAY, ['pending', 'active']))
    await saveVoiceRange(range(), NOW)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(id)
  })

  it('keeps the plan when a round of it was sung, though no block is finished yet', async () => {
    // A block stays pending in the stored plan until its last round. A range changed between two rounds
    // (the singer said a slide felt tight) must not take the day away from under that block.
    const id = await saveSession(session(TODAY, ['pending', 'pending']))
    await recordAttempt(run({ sessionId: id }))
    await saveVoiceRange(range(), NOW)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(id)
  })

  it('is not held back by rounds sung for another plan', async () => {
    const earlier = await saveSession(session(YESTERDAY, ['done']))
    await recordAttempt(run({ sessionId: earlier }))
    await recordAttempt(run({}))
    await saveSession(session(TODAY, ['pending']))
    await saveVoiceRange(range(), NOW)
    expect(await getSession(TODAY, 'voice')).toBeUndefined()
  })

  it("leaves today's guitar plan and the singing plans of other days", async () => {
    const guitar = await saveSession(session(TODAY, ['pending', 'pending'], false))
    const earlier = await saveSession(session(YESTERDAY, ['pending', 'pending']))
    await saveSession(session(TODAY, ['pending']))
    await saveVoiceRange(range(), NOW)
    expect((await db.sessions.toArray()).map((s) => s.id)).toEqual([guitar, earlier])
  })

  it.each([
    ['fewer than eight notes', range({ low: 55, high: 61 })],
    ['the lowest note above the highest', range({ low: 62, high: 55 })],
    ['a note between two keys', range({ low: 55.5 })],
    ['an easy note between two keys', range({ easy: 58.4 })],
    ['a missing edge', range({ high: Number.NaN })],
    ['a missing easy note', range({ easy: Number.NaN })],
    ['a lowest note under the lowest the app can follow', range({ low: 35, high: 47, easy: 40 })],
    ['a highest note above the highest the app can follow', range({ low: 76, high: 87, easy: 80 })],
  ])('refuses a range with %s, and stores nothing', async (_what, bad) => {
    await saveSession(session(TODAY, ['pending']))
    await expect(saveVoiceRange(bad, NOW)).rejects.toThrow(/range/i)
    expect(await db.profile.count()).toBe(0)
    expect(await db.sessions.count()).toBe(1)
  })

  it('stores a range that sits exactly on the lowest and the highest note the app can follow', async () => {
    const low = await saveVoiceRange(range({ low: 36, high: 43, easy: 40 }), NOW)
    expect(low.range).toEqual(range({ low: 36, high: 43, easy: 40 }))
    const high = await saveVoiceRange(range({ low: 79, high: 86, easy: 82 }), NOW)
    expect(high.range).toEqual(range({ low: 79, high: 86, easy: 82 }))
  })

  it('moves an easy note that lies outside the range onto its nearest edge, rather than refusing the range', async () => {
    // "Tight" lowers the top by one. A singer whose easy note was the top note must still get the smaller
    // range: refusing it would leave the range that felt tight in place.
    const stored = await saveVoiceRange(range({ low: 50, high: 59, easy: 60, source: 'manual' }), NOW)
    expect(stored.range).toEqual(range({ low: 50, high: 59, easy: 59, source: 'manual' }))
    expect((await db.profile.get(2))?.voice?.range).toEqual(stored.range)
    // A hum at the very bottom of the voice: the lowest comfortable note is two above it.
    expect((await saveVoiceRange(range({ low: 50, high: 59, easy: 49 }), NOW)).range).toMatchObject({ low: 50, high: 59, easy: 50 })
    // An easy note inside the range, edges included, is stored as it is.
    expect((await saveVoiceRange(range({ low: 50, high: 59, easy: 50 }), NOW)).range?.easy).toBe(50)
    expect((await saveVoiceRange(range({ low: 50, high: 59, easy: 59 }), NOW)).range?.easy).toBe(59)
  })

  it('does not change the range it was handed', async () => {
    const asked = Object.freeze(range({ low: 50, high: 59, easy: 61 }))
    await saveVoiceRange(asked, NOW)
    expect(asked.easy).toBe(61)
  })

  it("keeps the plan of a day the singer ended with \"My voice is tired\", though nothing in it was sung", async () => {
    // Every block was skipped by that button. A range changed later the same day must not bring a fresh
    // plan up: the day is over because the singer said so.
    const id = await saveSession(session(TODAY, ['skipped', 'skipped']))
    await markTiredOn(TODAY)
    await saveVoiceRange(range(), NOW)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(id)
    expect((await loadVoiceProfile()).tiredOn).toBe(TODAY)
  })

  it('a tired mark of an earlier day does not hold on to the plan of today', async () => {
    await saveSession(session(TODAY, ['skipped', 'skipped']))
    await markTiredOn(YESTERDAY)
    await saveVoiceRange(range(), NOW)
    expect(await getSession(TODAY, 'voice')).toBeUndefined()
  })

  it('keeps the plan when the only round sung for it did not count', async () => {
    // The microphone heard the speaker: nothing was scored, but the singer is in the middle of that block.
    const id = await saveSession(session(TODAY, ['pending']))
    await recordAttempt(run({ sessionId: id, bleed: true }))
    await saveVoiceRange(range(), NOW)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(id)
  })

  it('goes by the day of the moment it is given, not by the clock', async () => {
    const yesterdayNoon = new Date(2026, 10, 22, 12).getTime()
    const today = await saveSession(session(TODAY, ['pending']))
    await saveSession(session(YESTERDAY, ['pending']))
    await saveVoiceRange(range(), yesterdayNoon)
    expect((await db.sessions.toArray()).map((s) => s.id)).toEqual([today])
    // A profile made on the way starts at that moment too.
    expect((await db.profile.get(2))?.startedAt).toBe(yesterdayNoon)
  })

  it('accepts the smallest range the app uses: eight notes', async () => {
    await saveVoiceRange(range({ low: 48, high: 55, easy: 52, source: 'default' }), NOW)
    expect((await loadVoiceProfile()).range).toMatchObject({ low: 48, high: 55, easy: 52 })
  })
})

describe('the key of a song', () => {
  it('remembers how far a song was moved, song by song', async () => {
    await saveProfile(singer({ voice: { range: range() } }))
    await setKeyNudge('sing-twinkle', -2)
    await setKeyNudge('sing-saints', 1)
    expect(await loadVoiceProfile()).toEqual({ range: range(), keyNudge: { 'sing-twinkle': -2, 'sing-saints': 1 } })
    await setKeyNudge('sing-twinkle', -1)
    expect((await loadVoiceProfile()).keyNudge).toEqual({ 'sing-twinkle': -1, 'sing-saints': 1 })
    expect(await db.profile.get(2)).toMatchObject({ streak: 4, experience: 'some' })
  })

  it('never stores more than three semitones either way', async () => {
    await setKeyNudge('sing-twinkle', 7)
    await setKeyNudge('sing-saints', -9)
    await setKeyNudge('sing-mary-lamb', 1.6)
    expect((await loadVoiceProfile()).keyNudge).toEqual({ 'sing-twinkle': 3, 'sing-saints': -3, 'sing-mary-lamb': 2 })
  })

  it('forgets a song that is back in its own key', async () => {
    await setKeyNudge('sing-twinkle', -2)
    await setKeyNudge('sing-saints', 1)
    await setKeyNudge('sing-twinkle', 0)
    expect((await loadVoiceProfile()).keyNudge).toEqual({ 'sing-saints': 1 })
    await setKeyNudge('sing-mary-lamb', Number.NaN)
    expect((await loadVoiceProfile()).keyNudge).toEqual({ 'sing-saints': 1 })
  })

  it("does not throw away today's plan", async () => {
    const id = await saveSession(session(TODAY, ['pending']))
    await setKeyNudge('sing-twinkle', -1)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(id)
  })
})

describe('"My voice is tired"', () => {
  it('marks the day on the singing profile and keeps the rest', async () => {
    await saveProfile(singer({ voice: { range: range(), keyNudge: { 'sing-twinkle': -1 } } }))
    await markTiredOn(TODAY)
    expect(await db.profile.get(2)).toEqual(singer({ voice: { range: range(), keyNudge: { 'sing-twinkle': -1 }, tiredOn: TODAY } }))
    await markTiredOn('2026-11-25')
    expect((await loadVoiceProfile()).tiredOn).toBe('2026-11-25')
  })

  it("does not throw away today's plan", async () => {
    const id = await saveSession(session(TODAY, ['skipped', 'skipped']))
    await markTiredOn(TODAY)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(id)
  })
})
