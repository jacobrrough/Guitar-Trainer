import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { defaultRange } from '../../music/keys'
import { VOCAL_SONGS } from '../../songs/vocal'
import { exportTrainingData, loadProfile, saveProfile } from '../../training/store'
import type { Profile } from '../../training/types'
import { saveVoiceRange } from '../../training/voiceProfile'
import { CalibrationDialog } from './CalibrationDialog'
import { calibrationAdvice } from './calibration'
import { SINGING_CARD, deviceHoldsSinging, exportFileName, formatError, holdsSinging, importStatusText, pickBackup, restoreBackup, syncWords, wantsSongsToSing, type RestoreSteps } from './dataSection'
import { SettingsPage } from './SettingsPage'

/**
 * The singing side is switched by hand in this file, not by the release constant: the cases below say
 * what the screens do with it off and with it on, and have to keep saying so on the day it is released.
 */
const side = vi.hoisted(() => ({ on: false }))
vi.mock('../../app/features', () => ({ VOICE_RELEASED: false, voiceEnabled: () => side.on }))

describe('dataSection helpers', () => {
  it('builds a dated export file name', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('guitar-trainer-training-2026-01-05.json')
    expect(exportFileName(new Date(2026, 10, 18))).toBe('guitar-trainer-training-2026-11-18.json')
  })

  it('describes import counts', () => {
    expect(importStatusText({ attempts: 12, skills: 3 })).toBe('Imported 12 attempts and 3 skill ratings.')
    expect(importStatusText({ attempts: 1, skills: 1 })).toBe('Imported 1 attempt and 1 skill rating.')
  })

  it('formats errors', () => {
    expect(formatError(new Error('bad file'))).toBe('bad file')
    expect(formatError('oops')).toBe('oops')
    expect(formatError(42)).toBe('Something went wrong.')
    expect(formatError(new Error(''))).toBe('Something went wrong.')
  })
})

/** What a learner reads of a drawn component: its text, one piece per element. */
function textOf(html: string): string[] {
  return html
    .split(/<[^>]*>/)
    .map((piece) => piece.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&'))
    .filter((piece) => piece.trim() !== '')
}

/** Switches the singing side on for one test. */
function voiceSideOn(): void {
  side.on = true
}

afterEach(() => {
  side.on = false
})

const SET_UP = { experience: 'new', placementDoneAt: 5 } as const

describe('a picked backup file', () => {
  /** A stand-in for a picked file that counts how often it is read. */
  function picked(text: string | Error): { reads: number; text(): Promise<string> } {
    const file = {
      reads: 0,
      text: async () => {
        file.reads++
        if (text instanceof Error) throw text
        return text
      },
    }
    return file
  }

  it('closing the picker without a file picks nothing', async () => {
    expect(await pickBackup(undefined, true)).toBeUndefined()
    expect(await pickBackup(undefined, false)).toBeUndefined()
  })

  it('with one instrument the question is the same for every file, so the file is not read before the yes', async () => {
    const file = picked(JSON.stringify({ version: 1 }))
    expect(await pickBackup(file, false)).toEqual({ file, backup: null })
    expect(file.reads).toBe(0)
  })

  it('with the singing side on the file is looked at, so the question can say what it replaces', async () => {
    const guitar = picked(JSON.stringify({ version: 1 }))
    expect(await pickBackup(guitar, true)).toEqual({ file: guitar, backup: { version: 1, singing: false } })
    const both = picked(JSON.stringify({ version: 2, profiles: [{ id: 1 }, { id: 2 }] }))
    expect((await pickBackup(both, true))?.backup).toEqual({ version: 2, singing: true })
  })

  it('a file that cannot be read or is no backup still waits for the yes, with the general question', async () => {
    const broken = picked(new Error('gone'))
    expect(await pickBackup(broken, true)).toEqual({ file: broken, backup: null })
    const other = picked('hello')
    expect(await pickBackup(other, true)).toEqual({ file: other, backup: null })
  })

  /** A stand-in for the look at the device that counts how often it is asked. */
  function device(answer: boolean | Error): { asked: number; holds(): Promise<boolean> } {
    const d = {
      asked: 0,
      holds: async () => {
        d.asked++
        if (answer instanceof Error) throw answer
        return answer
      },
    }
    return d
  }
  const NEWER_NO_SINGER = JSON.stringify({ version: 2, profiles: [{ id: 1 }] })

  it('a newer backup without singing clears the singing here, so the device is asked whether it has any', async () => {
    const file = picked(NEWER_NO_SINGER)
    expect(await pickBackup(file, true, device(false).holds)).toEqual({ file, backup: { version: 2, singing: false }, singerHere: false })
    expect(await pickBackup(file, true, device(true).holds)).toEqual({ file, backup: { version: 2, singing: false }, singerHere: true })
  })

  it('a device that cannot be asked is taken to have singing: the question then says the most, never too little', async () => {
    const file = picked(NEWER_NO_SINGER)
    expect((await pickBackup(file, true, device(new Error('closed')).holds))?.singerHere).toBe(true)
  })

  it('the device is not asked for a file whose question does not depend on it, nor while the singing side is off', async () => {
    const d = device(false)
    await pickBackup(picked(JSON.stringify({ version: 1 })), true, d.holds)
    await pickBackup(picked(JSON.stringify({ version: 2, profiles: [{ id: 2 }] })), true, d.holds)
    await pickBackup(picked('hello'), true, d.holds)
    await pickBackup(picked(NEWER_NO_SINGER), false, d.holds)
    expect(d.asked).toBe(0)
  })
})

describe('whether a device has singing to lose', () => {
  it('a singer who has been through the set-up, or easy notes alone', () => {
    expect(holdsSinging(SET_UP)).toBe(true)
    expect(holdsSinging({ voice: { range: defaultRange('lower', 1) } })).toBe(true)
  })

  it('not a singing profile that merely exists, or was only begun', () => {
    expect(holdsSinging({})).toBe(false)
    expect(holdsSinging({ voice: {} })).toBe(false)
    expect(holdsSinging({ experience: 'new' })).toBe(false)
    expect(holdsSinging({ voice: { tiredOn: '2026-11-20' } })).toBe(false)
  })

  describe('asked of the device itself', () => {
    beforeEach(async () => {
      await db.delete()
      await db.open()
    })

    it('a device that only plays the guitar has none, and asking writes nothing', async () => {
      await loadProfile()
      expect(await deviceHoldsSinging()).toBe(false)
      expect(await db.profile.count()).toBe(1)
    })

    it('a device whose singer has found their easy notes has', async () => {
      await saveVoiceRange(defaultRange('higher', 1))
      expect(await deviceHoldsSinging()).toBe(true)
    })

    it('a device with a set-up singer has; a singing profile that was only ever loaded has not', async () => {
      await loadProfile('voice')
      expect(await deviceHoldsSinging()).toBe(false)
      await saveProfile({ ...(await loadProfile('voice')), ...SET_UP })
      expect(await deviceHoldsSinging()).toBe(true)
    })
  })
})

describe('songs to sing after an import', () => {
  it('belong on the device when the singing side is on and the singer has been through the set-up', () => {
    expect(wantsSongsToSing(true, SET_UP)).toBe(true)
  })

  it('not while the singing side is off, whatever the backup held', () => {
    expect(wantsSongsToSing(false, SET_UP)).toBe(false)
  })

  it('not for a singing profile that only exists: the set-up writes the songs when it is finished', () => {
    expect(wantsSongsToSing(true, {})).toBe(false)
    expect(wantsSongsToSing(true, { experience: 'new' })).toBe(false)
    expect(wantsSongsToSing(true, { placementDoneAt: 5 })).toBe(false)
  })

  /** Stand-ins for the store and the song installer that write down the order they are called in. */
  function steps(over: Partial<RestoreSteps> = {}): { log: string[]; steps: RestoreSteps } {
    const log: string[] = []
    return {
      log,
      steps: {
        importData: async (json) => {
          log.push(`import ${json}`)
          return { attempts: 12, skills: 3 }
        },
        singerIsSetUp: async () => {
          log.push('ask')
          return true
        },
        installSongs: async () => {
          log.push('install')
        },
        ...over,
      },
    }
  }

  it('the singer is looked for after the import, in what the import left, and then the songs are written', async () => {
    const run = steps()
    expect(await restoreBackup('FILE', run.steps)).toEqual({ attempts: 12, skills: 3 })
    expect(run.log).toEqual(['import FILE', 'ask', 'install'])
  })

  it('no singer, no songs', async () => {
    const run = steps({ singerIsSetUp: async () => false })
    expect(await restoreBackup('FILE', run.steps)).toEqual({ attempts: 12, skills: 3 })
    expect(run.log).toEqual(['import FILE'])
  })

  it('a file that is refused writes nothing', async () => {
    const run = steps({
      importData: async () => {
        throw new Error('Unsupported training data version')
      },
    })
    await expect(restoreBackup('FILE', run.steps)).rejects.toThrow('Unsupported training data version')
    expect(run.log).toEqual([])
  })

  it('songs that could not be written do not turn a finished import into an error: they are written when first opened', async () => {
    const run = steps({
      installSongs: async () => {
        throw new Error('no room')
      },
    })
    expect(await restoreBackup('FILE', run.steps)).toEqual({ attempts: 12, skills: 3 })
  })

  describe('on a real device', () => {
    const singer = (extra: Partial<Profile> = {}) => ({ ...SET_UP, ...extra })
    const sungRows = async () => (await db.songs.toArray()).filter((s) => s.instrument === 'voice')

    /** A backup of a device with a guitarist and, when asked, a singer. Leaves the database empty. */
    async function backupWith(voice: Partial<Profile> | null): Promise<string> {
      await loadProfile()
      if (voice) await saveProfile({ ...(await loadProfile('voice')), ...voice })
      const json = await exportTrainingData()
      await db.delete()
      await db.open()
      return json
    }

    beforeEach(async () => {
      await db.delete()
      await db.open()
    })

    it('a backup with a singer brings every song to sing with it', async () => {
      const json = await backupWith(singer())
      voiceSideOn()
      await restoreBackup(json)
      expect((await sungRows()).map((s) => s.builtinId).sort()).toEqual(VOCAL_SONGS.map((s) => s.id).sort())
    })

    it('nothing of singing is written while the singing side is off', async () => {
      const json = await backupWith(singer())
      await restoreBackup(json)
      expect(await db.songs.count()).toBe(0)
    })

    it('a backup whose singer never finished the set-up brings no songs', async () => {
      const json = await backupWith({})
      voiceSideOn()
      await restoreBackup(json)
      expect(await db.songs.count()).toBe(0)
    })

    it('a guitar backup on a device with a singer leaves the singer, and the songs are there afterwards', async () => {
      const guitarOnly = JSON.stringify({ ...JSON.parse(await backupWith(null)), version: 1, profiles: undefined })
      await saveProfile({ ...(await loadProfile('voice')), ...singer() })
      voiceSideOn()
      await restoreBackup(guitarOnly)
      expect((await loadProfile('voice')).experience).toBe('new')
      expect(await sungRows()).toHaveLength(VOCAL_SONGS.length)
    })
  })
})

describe('the words of the sound sync', () => {
  const noop = () => {}
  const draw = (instrument?: 'guitar' | 'voice') => textOf(renderToStaticMarkup(createElement(CalibrationDialog, { onClose: noop, onResult: noop, instrument })))

  it('for the guitar the dialog opens as it always did, letter for letter', () => {
    const guitar = [
      'Sync your sound',
      '✕',
      'You will hear 8 clicks. Rest your fingers lightly across the strings so they do not ring, and ',
      'strum on each click',
      '. The app measures how long your sound takes to arrive and lines up the scoring to match.',
      'Use the speakers or headphones you normally play with, and keep the phone where you usually keep it.',
      'Start',
    ]
    expect(draw()).toEqual(guitar)
    expect(draw('guitar')).toEqual(guitar)
  })

  it('for the guitar every later line is the one it always was', () => {
    const words = syncWords()
    expect(syncWords('guitar')).toBe(words)
    expect(words.ready).toBe('Get ready…')
    expect(words.running).toBe('Strum on every click…')
    expect(words.result(120)).toEqual(['Your sound reaches the app about ', '120 ms', ' after the beat.'])
    expect(words.heard(8, 8, true)).toBe('8 of 8 clicks heard.')
    expect(words.heard(5, 8, false)).toBe('5 of 8 clicks heard. The gap varied a lot between clicks, so this is rough: measure again and strum right on each click.')
    expect(words.use(120)).toBe('Use 120 ms')
    expect(words.advice(1, 8, 0.05)).toBe(calibrationAdvice(1, 8, 0.05))
    expect(words.advice(1, 8, 0.002)).toBe(calibrationAdvice(1, 8, 0.002))
  })

  it('a singer is asked to let the phone listen, or to clap along', () => {
    const text = draw('voice')
    expect(text.join('')).toContain('Let the phone listen to its own clicks, or clap along with them')
    expect(text[0]).toBe('Sync your sound')
    expect(text.at(-1)).toBe('Start')
  })

  it('nothing a singer reads here speaks of a guitar, of strumming or of playing, and no line asks for more force', () => {
    const words = syncWords('voice')
    const all = [
      ...words.intro(8),
      words.place,
      words.ready,
      words.running,
      ...words.result(120),
      words.heard(8, 8, true),
      words.heard(5, 8, false),
      words.use(120),
      words.advice(1, 8, 0.05),
      words.advice(1, 8, 0.002),
      ...draw('voice'),
    ]
    for (const line of all) expect(line).not.toMatch(/guitar|strum|string|\bplay|harder|louder|wrong|failed|push|belt/i)
  })

  it('a singer is given no number of milliseconds to make sense of', () => {
    const words = syncWords('voice')
    expect([...words.result(120), words.use(120)].join(' ')).not.toMatch(/\d|\bms\b/)
  })

  it('a singer whose clicks were not heard is told how many were, and what to do about a noisy room', () => {
    const words = syncWords('voice')
    expect(words.advice(3, 8, 0.002)).toMatch(/3 of 8 clicks/)
    expect(words.advice(3, 8, 0.05)).toMatch(/noisy/i)
    expect(words.heard(5, 8, false)).toMatch(/^5 of 8 clicks heard\. /)
  })
})

describe('the Singing card of Settings', () => {
  const draw = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsPage)))

  it('is not there while the singing side is off, and nothing else on the page speaks of singing', () => {
    const html = draw()
    expect(html.includes('data-testid="singing-settings"')).toBe(false)
    expect(textOf(html).filter((line) => /\bsing|voice|easy notes/i.test(line))).toEqual([])
  })

  it('is there once the singing side is on, with the headphones switch', () => {
    voiceSideOn()
    const html = draw()
    expect(html.includes('data-testid="singing-settings"')).toBe(true)
    const text = textOf(html)
    expect(text).toContain(SINGING_CARD.title)
    expect(text).toContain(SINGING_CARD.headphones)
    expect(SINGING_CARD.headphones).toBe('I use headphones')
  })

  it('the rest of the page is the same with the singing side on', () => {
    const before = textOf(draw())
    voiceSideOn()
    const after = textOf(draw())
    // The data card speaks of both instruments then (its own tests); everything before it is unchanged.
    const upTo = before.indexOf('Your data')
    expect(upTo).toBeGreaterThan(0)
    expect(after.filter((line) => before.slice(0, upTo).includes(line)).slice(0, upTo)).toEqual(before.slice(0, upTo))
  })

  it('says nothing unkind and asks for no force', () => {
    for (const line of Object.values(SINGING_CARD)) expect(line).not.toMatch(/wrong|failed|tone deaf|louder|push|belt/i)
  })
})
