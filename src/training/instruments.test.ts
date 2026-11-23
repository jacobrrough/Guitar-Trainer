import { afterEach, describe, expect, it, vi } from 'vitest'
import { VOICE_RELEASED, voiceEnabled } from '../app/features'
import { COURSE } from '../lessons/course'
import { VOICE_COURSE } from '../lessons/voiceCourse'
import {
  activeInstrument,
  courseFor,
  instrumentOf,
  instrumentOfBlockId,
  instrumentOfLessonId,
  instrumentOfSkillId,
  profileIdFor,
  skillById,
  skillsFor,
} from './instruments'
import { SKILLS } from './skills'
import type { SkillDef } from './types'
import { VOICE_SKILLS } from './voiceSkills'

// The voice skill list is filled by a later part of the app; one stand-in skill shows that lookups read both lists.
const stand = vi.hoisted(() => ({
  skill: {
    id: 'voice.pitch.match',
    name: 'Match a note',
    category: 'pitch',
    tier: 0,
    prerequisites: [],
    refTempo: 60,
    startTempo: 60,
    targetTempo: 60,
    description: '',
    tips: [],
    generators: ['voiceEcho'],
  } as const,
}))
vi.mock('./voiceSkills', () => ({ VOICE_SKILLS: [stand.skill] }))

const SETTINGS_KEY = 'guitar-trainer.settings.v1'

function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const memory = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  })
  return memory
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('which instrument a stored thing belongs to', () => {
  it('reads a row without a stamp as guitar', () => {
    expect(instrumentOf({})).toBe('guitar')
    expect(instrumentOf({ instrument: undefined })).toBe('guitar')
    expect(instrumentOf({ instrument: 'guitar' })).toBe('guitar')
    expect(instrumentOf({ instrument: 'voice' })).toBe('voice')
  })

  it('keeps guitar on profile row 1 and singing on row 2', () => {
    expect(profileIdFor('guitar')).toBe(1)
    expect(profileIdFor('voice')).toBe(2)
  })

  it('tells a voice skill by its "voice." prefix, and nothing else', () => {
    expect(instrumentOfSkillId('voice.pitch.match')).toBe('voice')
    expect(instrumentOfSkillId('voice.range.slides')).toBe('voice')
    for (const s of SKILLS) expect(instrumentOfSkillId(s.id), s.id).toBe('guitar')
    // A guitar skill that merely starts with the same letters, and a retired id nobody lists any more.
    expect(instrumentOfSkillId('voicing.triads')).toBe('guitar')
    expect(instrumentOfSkillId('retired.skill')).toBe('guitar')
  })

  it('tells a voice lesson by "v" and two digits', () => {
    expect(instrumentOfLessonId('v01-voice')).toBe('voice')
    expect(instrumentOfLessonId('v10-song')).toBe('voice')
    for (const l of COURSE) expect(instrumentOfLessonId(l.id), l.id).toBe('guitar')
    expect(instrumentOfLessonId('vibrato-basics')).toBe('guitar')
    expect(instrumentOfLessonId('l01-v02-mix')).toBe('guitar')
  })

  it('tells a voice block by its "voice-" prefix', () => {
    expect(instrumentOfBlockId('voice-2026-11-23-0-warmup')).toBe('voice')
    // The planner's guitar ids: date, position, kind.
    expect(instrumentOfBlockId('2026-11-23-0-warmup')).toBe('guitar')
    expect(instrumentOfBlockId('2026-11-23-3-song')).toBe('guitar')
    expect(instrumentOfBlockId('b-focus')).toBe('guitar')
    expect(instrumentOfBlockId('voiced-chords')).toBe('guitar')
  })

  it('knows all ten lessons of the singing course, and no id that only looks like one', () => {
    for (const id of ['v01-voice', 'v02-meet', 'v03-match', 'v04-steps', 'v05-words', 'v06-five', 'v07-hold', 'v08-jumps', 'v09-slides', 'v10-song']) expect(instrumentOfLessonId(id), id).toBe('voice')
    // One digit, three digits, a capital, no dash, nothing at all.
    for (const id of ['v1-voice', 'v100-song', 'V01-voice', 'v01', 'vo1-voice', '']) expect(instrumentOfLessonId(id), JSON.stringify(id)).toBe('guitar')
  })

  it('reads only the very start of a skill id or a block id', () => {
    for (const id of ['voice', 'voice-pitch.match', 'Voice.pitch.match', ' voice.pitch.match', 'lead.voice.leading', '']) expect(instrumentOfSkillId(id), JSON.stringify(id)).toBe('guitar')
    for (const id of ['voice', 'voice.2026-11-23-0-warmup', 'Voice-2026-11-23-0-warmup', '2026-11-23-0-voice-warmup', '']) expect(instrumentOfBlockId(id), JSON.stringify(id)).toBe('guitar')
  })
})

describe('skills and lessons per instrument', () => {
  it('gives guitar its own list, untouched: the same 27 skills', () => {
    expect(skillsFor('guitar')).toBe(SKILLS)
    expect(skillsFor('guitar')).toHaveLength(27)
    expect(skillsFor('guitar').every((s) => instrumentOfSkillId(s.id) === 'guitar')).toBe(true)
  })

  it('gives singing the voice list', () => {
    expect(skillsFor('voice')).toBe(VOICE_SKILLS)
    expect(skillsFor('voice')).not.toBe(SKILLS)
  })

  it('finds a skill of either instrument by id', () => {
    for (const s of SKILLS) expect(skillById(s.id), s.id).toBe(s)
    const sung: SkillDef | undefined = skillById('voice.pitch.match')
    expect(sung).toBe(VOICE_SKILLS[0])
    expect(sung?.name).toBe('Match a note')
  })

  it('answers undefined for an id in neither list, never some other skill', () => {
    expect(skillById('voice.no.such')).toBeUndefined()
    expect(skillById('no.such')).toBeUndefined()
    expect(skillById('')).toBeUndefined()
    // Names every plain object answers to are not skills either.
    expect(skillById('constructor')).toBeUndefined()
    expect(skillById('toString')).toBeUndefined()
  })

  it('gives each instrument its own course', () => {
    expect(courseFor('guitar')).toBe(COURSE)
    expect(courseFor('guitar')).toHaveLength(10)
    expect(courseFor('voice')).toBe(VOICE_COURSE)
    expect(courseFor('voice')).not.toBe(COURSE)
  })
})

describe('the voice side stays hidden until it is released', () => {
  it('is not released yet', () => {
    expect(VOICE_RELEASED).toBe(false)
  })

  it('is off on a device that has stored nothing, or has no storage at all', () => {
    expect(voiceEnabled()).toBe(VOICE_RELEASED)
    stubStorage()
    expect(voiceEnabled()).toBe(VOICE_RELEASED)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage is blocked')
      },
    })
    expect(voiceEnabled()).toBe(VOICE_RELEASED)
  })

  it('is on for a device that carries the preview key, and only for the value 1', () => {
    stubStorage({ 'gt.voice': '1' })
    expect(voiceEnabled()).toBe(true)
    for (const value of ['0', 'true', '']) {
      stubStorage({ 'gt.voice': value })
      expect(voiceEnabled(), JSON.stringify(value)).toBe(VOICE_RELEASED)
    }
  })

  it('shows guitar while the voice side is off, whatever the setting says', () => {
    expect(VOICE_RELEASED).toBe(false)
    stubStorage()
    expect(activeInstrument({ instrument: 'voice' })).toBe('guitar')
    expect(activeInstrument({ instrument: 'guitar' })).toBe('guitar')
  })

  it('follows the setting once the voice side is on', () => {
    stubStorage({ 'gt.voice': '1' })
    expect(activeInstrument({ instrument: 'voice' })).toBe('voice')
    expect(activeInstrument({ instrument: 'guitar' })).toBe('guitar')
  })

  it('shows guitar for a stored setting that names neither side, even with the voice side on', async () => {
    // Settings are read back from storage as they were written, by any version of the app or by hand.
    stubStorage({ 'gt.voice': '1', [SETTINGS_KEY]: JSON.stringify({ instrument: null, voiceHeadphones: 'yes' }) })
    vi.resetModules()
    const { getSettings } = await import('../app/settings')
    expect(activeInstrument(getSettings())).toBe('guitar')
    for (const instrument of [undefined, null, '', 'Voice', 'singing']) expect(activeInstrument({ instrument: instrument as never }), String(instrument)).toBe('guitar')
  })
})

describe('settings stored before singing existed', () => {
  async function settingsAfterLaunch(stored?: Record<string, unknown>) {
    const memory = stubStorage(stored ? { [SETTINGS_KEY]: JSON.stringify(stored) } : {})
    // settings.ts reads storage once, when it is first loaded: load it afresh, as a launch does.
    vi.resetModules()
    return { ...(await import('../app/settings')), memory }
  }

  it('pick up guitar and no headphones, and keep everything that was stored', async () => {
    const { getSettings } = await settingsAfterLaunch({ latencyMs: 95, calibratedAt: 1_700_000_000_000, handedness: 'left', metronome: { bpm: 72 } })
    expect(getSettings()).toMatchObject({ instrument: 'guitar', voiceHeadphones: false, latencyMs: 95, calibratedAt: 1_700_000_000_000, handedness: 'left' })
    expect(getSettings().metronome).toMatchObject({ bpm: 72, beatsPerBar: 4 })
  })

  it('start on guitar, without headphones, on a new device', async () => {
    const { getSettings, DEFAULT_SETTINGS } = await settingsAfterLaunch()
    expect(getSettings()).toMatchObject({ instrument: 'guitar', voiceHeadphones: false })
    expect(DEFAULT_SETTINGS).toMatchObject({ instrument: 'guitar', voiceHeadphones: false })
  })

  it('keep a singing choice across launches', async () => {
    const first = await settingsAfterLaunch({ latencyMs: 95 })
    first.updateSettings({ instrument: 'voice', voiceHeadphones: true })
    const stored = JSON.parse(first.memory.get(SETTINGS_KEY) ?? '{}') as Record<string, unknown>
    expect(stored).toMatchObject({ instrument: 'voice', voiceHeadphones: true, latencyMs: 95 })
    const second = await settingsAfterLaunch(stored)
    expect(second.getSettings()).toMatchObject({ instrument: 'voice', voiceHeadphones: true, latencyMs: 95 })
  })
})
