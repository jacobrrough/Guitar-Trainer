import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/db'
import { getSession, resetTrainingData, saveSession } from './store'
import type { Block, ExerciseBlock, SessionRecord } from './types'

/**
 * Since schema version 5 a day may hold one session per instrument, and the index that enforces it only
 * sees rows that say which instrument they belong to. So every session that is saved has to carry the
 * stamp: an unstamped row would sit outside the index and a second plan for the same day would slip in.
 */
const DATE = '2026-11-23'

function block(id: string): ExerciseBlock {
  return { id, kind: 'focus', status: 'pending', minutes: 5, skillId: 'a', generatorId: 'g', params: { tempo: 60, bars: 4 }, tempo: 60, reps: 1, reason: 'test' }
}

const guitarBlocks = (date = DATE): Block[] => [block(`${date}-0-warmup`), block(`${date}-1-focus`)]
const voiceBlocks = (date = DATE): Block[] => [block(`voice-${date}-0-warmup`), block(`voice-${date}-1-focus`)]

function session(blocks: Block[], over: Partial<SessionRecord> = {}): SessionRecord {
  return { date: DATE, plan: { date: DATE, minutes: 10, dayFactor: 1, blocks, explanation: [] }, minutesDone: 0, completedBlockIds: [], startedAt: 1, ...over }
}

const indexed = (instrument: 'guitar' | 'voice', date = DATE) => db.sessions.where('[instrument+date]').equals([instrument, date]).toArray()

beforeEach(async () => {
  await resetTrainingData()
})

describe('saveSession stamps the instrument', () => {
  it('stores a session that says nothing as a guitar session', async () => {
    const id = await saveSession(session(guitarBlocks()))
    expect((await db.sessions.get(id))?.instrument).toBe('guitar')
    expect((await indexed('guitar')).map((s) => s.id)).toEqual([id])
  })

  it('reads a singing session from the ids of its blocks', async () => {
    const id = await saveSession(session(voiceBlocks()))
    expect((await db.sessions.get(id))?.instrument).toBe('voice')
    expect((await indexed('voice')).map((s) => s.id)).toEqual([id])
    expect(await indexed('guitar')).toEqual([])
  })

  it('keeps a guitar and a singing session for the same day side by side', async () => {
    const guitar = await saveSession(session(guitarBlocks()))
    const voice = await saveSession(session(voiceBlocks()))
    expect(voice).not.toBe(guitar)
    expect((await db.sessions.where('date').equals(DATE).toArray()).map((s) => s.instrument).sort()).toEqual(['guitar', 'voice'])
  })

  it('refuses a second plan for the same instrument and day', async () => {
    await saveSession(session(guitarBlocks()))
    await expect(saveSession(session(guitarBlocks()))).rejects.toMatchObject({ name: 'ConstraintError' })
    await saveSession(session(voiceBlocks()))
    await expect(saveSession(session(voiceBlocks()))).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await db.sessions.count()).toBe(2)
  })

  it('takes a session with no blocks as guitar, unless it says otherwise', async () => {
    const plain = await saveSession(session([]))
    const sung = await saveSession(session([], { instrument: 'voice' }))
    expect((await db.sessions.get(plain))?.instrument).toBe('guitar')
    expect((await db.sessions.get(sung))?.instrument).toBe('voice')
  })

  it('throws when the stamp and the block ids disagree, and stores nothing', async () => {
    await expect(saveSession(session(voiceBlocks(), { instrument: 'guitar' }))).rejects.toThrow(/guitar.*voice|voice.*guitar/)
    await expect(saveSession(session(guitarBlocks(), { instrument: 'voice' }))).rejects.toThrow(/guitar.*voice|voice.*guitar/)
    expect(await db.sessions.count()).toBe(0)
  })

  it('accepts a stamp that agrees with the block ids', async () => {
    await saveSession(session(guitarBlocks(), { instrument: 'guitar' }))
    await saveSession(session(voiceBlocks(), { instrument: 'voice' }))
    expect((await db.sessions.toArray()).map((s) => s.instrument)).toEqual(['guitar', 'voice'])
  })

  it('leaves the caller holding the record as it was stored', async () => {
    // The coach saves a record and carries on with `{ ...record, id }`: that copy and the stored row must not differ.
    const record = session(guitarBlocks())
    const id = await saveSession(record)
    expect(await getSession(DATE)).toEqual({ ...record, id })
    expect(await db.sessions.get(id)).toEqual({ ...record, id })
  })

  it('saves a stored session again in place', async () => {
    const id = await saveSession(session(guitarBlocks()))
    const stored = (await db.sessions.get(id))!
    expect(await saveSession({ ...stored, minutesDone: 7 })).toBe(id)
    expect(await db.sessions.toArray()).toEqual([{ ...stored, minutesDone: 7 }])
  })

  it('keeps a singing session a singing session through every later save', async () => {
    const guitar = await saveSession(session(guitarBlocks()))
    const voice = await saveSession(session(voiceBlocks()))
    const stored = (await db.sessions.get(voice))!
    // The coach saves a day again after each block, with the blocks changed and the rest spread over.
    const done = { ...stored, plan: { ...stored.plan, blocks: stored.plan.blocks.map((b) => ({ ...b, status: 'done' as const })) }, completedBlockIds: stored.plan.blocks.map((b) => b.id) }
    expect(await saveSession(done)).toBe(voice)
    // A plan made again for the same row carries only the id of the old one, not its stamp.
    const { instrument: _instrument, ...replanned } = { ...done, plan: { ...done.plan, blocks: voiceBlocks() } }
    expect(await saveSession(replanned)).toBe(voice)
    expect((await db.sessions.get(voice))?.instrument).toBe('voice')
    expect((await db.sessions.get(guitar))?.instrument).toBe('guitar')
    expect(await db.sessions.count()).toBe(2)
  })

  it('never lets one side overwrite the stored session of the other', async () => {
    const guitar = await saveSession(session(guitarBlocks()))
    const voice = await saveSession(session(voiceBlocks()))
    const storedGuitar = (await db.sessions.get(guitar))!
    const storedVoice = (await db.sessions.get(voice))!
    // Singing blocks spread over the guitar row, and the reverse: the stored stamp gives it away.
    await expect(saveSession({ ...storedGuitar, plan: storedVoice.plan })).rejects.toThrow(/guitar.*voice/)
    await expect(saveSession({ ...storedVoice, plan: storedGuitar.plan })).rejects.toThrow(/voice.*guitar/)
    // Without the stamp the blocks decide, and the index refuses a second session of that side for the day.
    await expect(saveSession({ id: guitar, date: DATE, plan: storedVoice.plan, minutesDone: 0, completedBlockIds: [], startedAt: 1 })).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await db.sessions.get(guitar)).toEqual(storedGuitar)
    expect(await db.sessions.get(voice)).toEqual(storedVoice)
  })

  it('stores a record it cannot write on, stamped all the same', async () => {
    // Saving such a record worked before sessions were stamped (the new id is simply not written back).
    const frozen = Object.freeze(session(guitarBlocks()))
    const id = await saveSession(frozen)
    expect(await db.sessions.get(id)).toEqual({ ...frozen, id, instrument: 'guitar' })
    expect((await indexed('guitar')).map((s) => s.id)).toEqual([id])
    expect(frozen.instrument).toBeUndefined()
    // Stamped already, it is stored as it is.
    const sung = Object.freeze(session(voiceBlocks(), { instrument: 'voice' }))
    const sungId = await saveSession(sung)
    expect(await db.sessions.get(sungId)).toEqual({ ...sung, id: sungId })
  })
})
