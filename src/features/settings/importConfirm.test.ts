import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type SongRecord } from '../../db/db'
import { defaultRange } from '../../music/keys'
import { exportTrainingData, importTrainingData, loadProfile, resetTrainingData, saveProfile, saveSkillState } from '../../training/store'
import type { SkillState } from '../../training/types'
import { loadVoiceProfile, saveVoiceRange } from '../../training/voiceProfile'
import { DataSection } from './DataSection'
import { ImportConfirm } from './ImportConfirm'
import {
  IMPORT_NOTE,
  RESET_SCOPES,
  RESET_WARNING,
  backupContents,
  backupSaved,
  exportNote,
  importFlow,
  importNote,
  importWarning,
  resetDone,
  resetLabel,
  resetSide,
  resetWarning,
  type BackupContents,
  type ImportFlow,
} from './importConfirm'

/**
 * The singing side is switched by hand in this file, not by the release constant: the cases below say
 * what the screens do with it off and with it on, and have to keep saying so on the day it is released.
 */
const side = vi.hoisted(() => ({ on: false }))
vi.mock('../../app/features', () => ({ VOICE_RELEASED: false, voiceEnabled: () => side.on }))

afterEach(() => {
  side.on = false
})

const idle: ImportFlow<string> = { step: 'idle' }

describe('importing a backup', () => {
  it('the Settings card says that importing replaces the current data', () => {
    const html = renderToStaticMarkup(createElement(DataSection))
    expect(html).not.toMatch(/nothing is deleted/i)
    expect(html).not.toMatch(/merge/i)
    expect(html).toContain(IMPORT_NOTE)
    expect(IMPORT_NOTE).toMatch(/replaces/)
  })

  it('picking a file imports nothing: it waits for a yes', () => {
    const picked = importFlow(idle, { type: 'picked', file: 'old-backup.json' })
    expect(picked.importFile).toBeUndefined()
    expect(picked.state).toEqual({ step: 'confirm', file: 'old-backup.json', backedUp: false })
  })

  it('cancelling imports nothing', () => {
    const picked = importFlow(idle, { type: 'picked', file: 'old-backup.json' }).state
    const cancelled = importFlow(picked, { type: 'cancelled' })
    expect(cancelled.importFile).toBeUndefined()
    expect(cancelled.state).toEqual(idle)
  })

  it('only a yes on the waiting file imports it, once', () => {
    const picked = importFlow(idle, { type: 'picked', file: 'old-backup.json' }).state
    const yes = importFlow(picked, { type: 'confirmed' })
    expect(yes.importFile).toBe('old-backup.json')
    expect(yes.state).toEqual(idle)
    // A second tap, or a yes with nothing waiting, does nothing.
    expect(importFlow(yes.state, { type: 'confirmed' }).importFile).toBeUndefined()
  })

  it('saving a backup first is remembered, and still needs the yes', () => {
    const picked = importFlow(idle, { type: 'picked', file: 'old-backup.json' }).state
    const saved = importFlow(picked, { type: 'backedUp' })
    expect(saved.importFile).toBeUndefined()
    expect(saved.state).toEqual({ step: 'confirm', file: 'old-backup.json', backedUp: true })
    expect(importFlow(idle, { type: 'backedUp' }).state).toEqual(idle)
  })

  it('closing the file picker without choosing changes nothing', () => {
    expect(importFlow(idle, { type: 'picked', file: undefined })).toEqual({ state: idle })
  })

  it('the warning names the file and says what is lost and what is kept', () => {
    const text = importWarning('old-backup.json')
    expect(text).toContain('old-backup.json')
    expect(text).toMatch(/replaces all the training data on this device/)
    expect(text).toMatch(/songs are kept/i)
  })

  it('the confirmation offers a backup first, on both screens', () => {
    const noop = () => {}
    const html = renderToStaticMarkup(
      createElement(ImportConfirm, { fileName: 'old-backup.json', backedUp: false, busy: false, onBackup: noop, onConfirm: noop, onCancel: noop }),
    )
    expect(html).toContain('old-backup.json')
    expect(html).toContain('Save a backup first')
    expect(html).toContain('Replace my data')
    expect(html).toContain('Cancel')
  })

  it('a backup only counts as saved when a file was handed over', () => {
    expect(backupSaved('shared')).toBe(true)
    expect(backupSaved('downloaded')).toBe(true)
    // A closed share sheet saved nothing. A new tab may have been blocked, and saves nothing by itself.
    expect(backupSaved('cancelled')).toBe(false)
    expect(backupSaved('opened')).toBe(false)
    expect(backupSaved(null)).toBe(false)
  })

  it('the reset warning says what goes and what stays', () => {
    expect(RESET_WARNING).toMatch(/lessons/)
    expect(RESET_WARNING).toMatch(/cannot be undone/)
    expect(RESET_WARNING).toMatch(/songs are kept/i)
  })
})

/** What a learner reads of a drawn component: its text, one piece per element. */
function textOf(html: string): string[] {
  return html
    .split(/<[^>]*>/)
    .map((piece) => piece.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim())
    .filter((piece) => piece !== '')
}

/** Switches the singing side on for one test. */
function voiceSideOn(): void {
  side.on = true
}

const GUITAR_BACKUP: BackupContents = { version: 1, singing: false }
const BOTH: BackupContents = { version: 2, singing: true }
const NO_SINGER: BackupContents = { version: 2, singing: false }

/** A backup file as the store writes it, with only what the question before an import reads. */
function file(fields: Record<string, unknown>): string {
  return JSON.stringify({ exportedAt: 1, profile: { id: 1 }, skillStates: [], songItems: [], attempts: [], sessions: [], tests: [], ...fields })
}

describe('what a picked file holds', () => {
  it('a file written before singing existed is a guitar backup', () => {
    expect(backupContents(file({ version: 1 }))).toEqual(GUITAR_BACKUP)
  })

  it('a version 1 file is a guitar backup whatever else it carries: the store takes its guitar rows only', () => {
    expect(backupContents(file({ version: 1, profiles: [{ id: 1 }, { id: 2 }] }))).toEqual(GUITAR_BACKUP)
  })

  it('a version 2 file holds singing when it carries the singing profile', () => {
    expect(backupContents(file({ version: 2, profiles: [{ id: 1 }, { id: 2 }] }))).toEqual(BOTH)
    expect(backupContents(file({ version: 2, profiles: [{ id: 2 }] }))).toEqual(BOTH)
  })

  it('a version 2 file from a device that never sang holds no singing', () => {
    expect(backupContents(file({ version: 2, profiles: [{ id: 1 }] }))).toEqual(NO_SINGER)
    expect(backupContents(file({ version: 2, profiles: [] }))).toEqual(NO_SINGER)
    expect(backupContents(file({ version: 2 }))).toEqual(NO_SINGER)
    // A row the store would not take for a profile is not a singer either.
    expect(backupContents(file({ version: 2, profiles: [null, 2, { id: '2' }] }))).toEqual(NO_SINGER)
  })

  it('anything that is not a backup is null, and never an error', () => {
    for (const text of ['', 'not json', 'null', '42', '[]', '"2"', '{}', file({ version: 3 }), file({ version: '1' }), file({ version: 2, profiles: 'x' })]) {
      expect(backupContents(text)).toBeNull()
    }
  })

  describe('read from the files this app writes', () => {
    beforeEach(async () => {
      await db.delete()
      await db.open()
    })

    it('a device that only plays guitar exports a file without singing', async () => {
      await loadProfile()
      expect(backupContents(await exportTrainingData())).toEqual(NO_SINGER)
    })

    it('a device with a singing profile exports a file that holds both', async () => {
      await loadProfile()
      await loadProfile('voice')
      expect(backupContents(await exportTrainingData())).toEqual(BOTH)
    })
  })
})

describe('the question before an import, by what the file holds', () => {
  const TODAY =
    '“old-backup.json” replaces all the training data on this device: your lessons, practice history, skill checks and skill ratings. Anything you did after that backup was made will be gone. Your songs are kept.'

  it('reads as it always did when it is not told what the file holds', () => {
    expect(importWarning('old-backup.json')).toBe(TODAY)
    expect(importWarning('old-backup.json', null)).toBe(TODAY)
    expect(importWarning('old-backup.json', undefined)).toBe(TODAY)
  })

  it('a guitar backup replaces guitar only, and says singing stays', () => {
    const text = importWarning('old-backup.json', GUITAR_BACKUP)
    expect(text).toMatch(/guitar backup/)
    expect(text).toMatch(/replaces the guitar training data on this device/)
    expect(text).toMatch(/Your singing stays as it is/)
    expect(text).not.toMatch(/replaces all/)
  })

  it('a backup that holds both replaces both, and says so', () => {
    const text = importWarning('old-backup.json', BOTH)
    expect(text).toMatch(/holds guitar and singing/)
    expect(text).toMatch(/replaces all the training data on this device/)
    expect(text).not.toMatch(/singing stays/i)
  })

  it('a newer backup without singing still replaces both: the singing on this device goes, and the question says it', () => {
    const text = importWarning('old-backup.json', NO_SINGER)
    expect(text).toMatch(/no singing/)
    expect(text).toMatch(/replaces all the training data on this device/)
    expect(text).toMatch(/singing progress on this device will be gone/)
    expect(text).not.toMatch(/singing stays/i)
  })

  it('a newer backup without singing, on a device with no singing to lose, gets the question a guitar-only device always got', () => {
    // Nothing of singing can go, so nothing is said about it: "your singing progress will be gone" would only puzzle someone who never sang.
    expect(importWarning('old-backup.json', NO_SINGER, false)).toBe(TODAY)
    expect(importWarning('old-backup.json', NO_SINGER, false)).not.toMatch(/sing/i)
    // Where there is singing on the device, and where nobody could look, the question says that it goes.
    expect(importWarning('old-backup.json', NO_SINGER, true)).toMatch(/singing progress on this device will be gone/)
    expect(importWarning('old-backup.json', NO_SINGER)).toBe(importWarning('old-backup.json', NO_SINGER, true))
    expect(importWarning('old-backup.json', NO_SINGER, undefined)).toBe(importWarning('old-backup.json', NO_SINGER, true))
  })

  it('what the device holds changes nothing about the other questions: they say what the file does', () => {
    for (const backup of [GUITAR_BACKUP, BOTH]) {
      expect(importWarning('old-backup.json', backup, false)).toBe(importWarning('old-backup.json', backup, true))
      expect(importWarning('old-backup.json', backup, false)).toBe(importWarning('old-backup.json', backup))
    }
    expect(importWarning('old-backup.json', null, false)).toBe(TODAY)
  })

  it('every form names the file, says what is lost and that the songs are kept', () => {
    for (const backup of [GUITAR_BACKUP, BOTH, NO_SINGER]) {
      const text = importWarning('old-backup.json', backup)
      expect(text).toContain('“old-backup.json”')
      expect(text).toMatch(/lessons, practice history, skill checks and skill ratings/)
      expect(text).toMatch(/will be gone/)
      expect(text).toMatch(/Your songs are kept\.$/)
    }
  })

  it('the confirmation shows the question that fits the file', () => {
    const noop = () => {}
    const draw = (backup?: BackupContents | null) =>
      textOf(renderToStaticMarkup(createElement(ImportConfirm, { fileName: 'old-backup.json', backup, backedUp: false, busy: false, onBackup: noop, onConfirm: noop, onCancel: noop })))
    expect(draw()).toEqual([TODAY, 'Not sure? Save a backup of what you have now first.', 'Save a backup first', 'Replace my data', 'Cancel'])
    expect(draw(GUITAR_BACKUP)[0]).toBe(importWarning('old-backup.json', GUITAR_BACKUP))
    expect(draw(NO_SINGER)[0]).toBe(importWarning('old-backup.json', NO_SINGER))
    expect(draw(BOTH).slice(1)).toEqual(draw().slice(1))
  })

  it('the confirmation is told whether the device has singing to lose', () => {
    const noop = () => {}
    const draw = (singerHere?: boolean) =>
      textOf(renderToStaticMarkup(createElement(ImportConfirm, { fileName: 'old-backup.json', backup: NO_SINGER, singerHere, backedUp: false, busy: false, onBackup: noop, onConfirm: noop, onCancel: noop })))
    expect(draw(false)[0]).toBe(TODAY)
    expect(draw(true)[0]).toBe(importWarning('old-backup.json', NO_SINGER, true))
    expect(draw()[0]).toBe(importWarning('old-backup.json', NO_SINGER, true))
  })
})

/** A stored skill rating, with only what the store and the screens read of it. */
function rated(skillId: string, rating: number): SkillState {
  return { skillId, rating, confidence: 3, tempoCeiling: 0, ease: 2.3, intervalDays: 2, plateauStep: 0, attempts: 4, lastPracticedAt: 1 }
}

const GUITAR_SKILL = 'basics.first-frets'
const SUNG_SKILL = 'voice.pitch.match'

/** An empty device. */
async function freshDevice(): Promise<void> {
  await db.delete()
  await db.open()
}

/** A device somebody plays the guitar on, with one skill at `rating`. */
async function guitarist(rating: number): Promise<void> {
  await loadProfile()
  await saveSkillState(rated(GUITAR_SKILL, rating))
}

/** The same device with a singer on it: set up, with easy notes and one sung skill at `rating`. */
async function singer(voice: 'lower' | 'higher', rating: number): Promise<void> {
  await saveVoiceRange(defaultRange(voice, 1))
  await saveProfile({ ...(await loadProfile('voice')), experience: 'new', placementDoneAt: 5 })
  await saveSkillState(rated(SUNG_SKILL, rating))
}

const ratingOf = async (skillId: string) => (await db.skillStates.get(skillId))?.rating
const easyNote = async () => (await loadVoiceProfile()).range?.easy

describe('what each question promises is what the import then does', () => {
  /** Three files, each made on another device, and then this device: a guitarist at 70 and a lower-voiced singer at 60. */
  async function filesAndDevice(): Promise<{ old: string; newerNoSinger: string; newerBoth: string }> {
    await freshDevice()
    await guitarist(20)
    const newerNoSinger = await exportTrainingData()
    // What a copy of the app from before singing wrote: version 1, one profile.
    const old = JSON.stringify({ ...JSON.parse(newerNoSinger), version: 1, profiles: undefined })
    await singer('higher', 35)
    const newerBoth = await exportTrainingData()
    await freshDevice()
    await guitarist(70)
    await singer('lower', 60)
    return { old, newerNoSinger, newerBoth }
  }

  beforeEach(freshDevice)

  it('"a guitar backup": the guitar is replaced and the singing stays as it is', async () => {
    const { old } = await filesAndDevice()
    expect(backupContents(old)).toEqual(GUITAR_BACKUP)
    expect(importWarning('f.json', backupContents(old), true)).toMatch(/Your singing stays as it is/)
    await importTrainingData(old)
    expect(await ratingOf(GUITAR_SKILL)).toBe(20)
    expect(await ratingOf(SUNG_SKILL)).toBe(60)
    expect(await easyNote()).toBe(defaultRange('lower', 1).easy)
    expect((await loadProfile('voice')).placementDoneAt).toBe(5)
  })

  it('"holds guitar and no singing": the singing of the device goes, the easy notes with it', async () => {
    const { newerNoSinger } = await filesAndDevice()
    expect(backupContents(newerNoSinger)).toEqual(NO_SINGER)
    expect(importWarning('f.json', backupContents(newerNoSinger), true)).toMatch(/singing progress on this device will be gone, your easy notes too/)
    await importTrainingData(newerNoSinger)
    expect(await ratingOf(GUITAR_SKILL)).toBe(20)
    expect(await ratingOf(SUNG_SKILL)).toBeUndefined()
    expect(await easyNote()).toBeUndefined()
    expect(await db.profile.get(2)).toBeUndefined()
  })

  it('"holds guitar and singing": both are replaced by what the file holds', async () => {
    const { newerBoth } = await filesAndDevice()
    expect(backupContents(newerBoth)).toEqual(BOTH)
    await importTrainingData(newerBoth)
    expect(await ratingOf(GUITAR_SKILL)).toBe(20)
    expect(await ratingOf(SUNG_SKILL)).toBe(35)
    expect(await easyNote()).toBe(defaultRange('higher', 1).easy)
  })
})

describe('what each reset warns of is what it then removes', () => {
  beforeEach(async () => {
    await freshDevice()
    await guitarist(70)
    await singer('lower', 60)
    await db.songs.add({ title: 'A song of mine' } as SongRecord)
  })

  it('guitar: the guitar data goes, the singing is not touched', async () => {
    expect(resetWarning('guitar')).toMatch(/Your singing is not touched/)
    await resetTrainingData(resetSide('guitar'))
    expect(await ratingOf(GUITAR_SKILL)).toBeUndefined()
    expect(await db.profile.get(1)).toBeUndefined()
    expect(await ratingOf(SUNG_SKILL)).toBe(60)
    expect(await easyNote()).toBe(defaultRange('lower', 1).easy)
  })

  it('singing: the singing data goes, the easy notes with it, and the guitar data is not touched', async () => {
    expect(resetWarning('voice')).toMatch(/and your easy notes/)
    await resetTrainingData(resetSide('voice'))
    expect(await ratingOf(SUNG_SKILL)).toBeUndefined()
    expect(await easyNote()).toBeUndefined()
    expect(await ratingOf(GUITAR_SKILL)).toBe(70)
    expect(await db.profile.get(1)).toBeDefined()
  })

  it('both, and the one reset of a device without the singing side: everything goes', async () => {
    for (const scope of ['both', undefined] as const) {
      await guitarist(70)
      await singer('lower', 60)
      await resetTrainingData(resetSide(scope))
      expect(await db.skillStates.count()).toBe(0)
      expect(await db.profile.count()).toBe(0)
    }
  })

  it('the songs are kept, whichever reset it is', async () => {
    for (const scope of [...RESET_SCOPES, undefined]) {
      expect(resetWarning(scope)).toMatch(/Your songs are kept\.$/)
      await resetTrainingData(resetSide(scope))
      expect(await db.songs.count()).toBe(1)
    }
  })
})

describe('resetting', () => {
  it('a device without the singing side has the one reset, worded as it always was', () => {
    expect(resetWarning()).toBe(RESET_WARNING)
    expect(RESET_WARNING).toBe(
      'This deletes your lessons, practice history, skill checks and skill ratings on this device. It cannot be undone. Your songs are kept.',
    )
    expect(resetDone()).toBe('Training data reset.')
    expect(resetSide()).toBeUndefined()
  })

  it('there are three resets once somebody can sing: guitar, singing, both', () => {
    expect(RESET_SCOPES).toEqual(['guitar', 'voice', 'both'])
    expect(RESET_SCOPES.map(resetLabel)).toEqual(['Reset guitar…', 'Reset singing…', 'Reset both…'])
  })

  it('each says what it removes and what it leaves alone', () => {
    const guitar = resetWarning('guitar')
    expect(guitar).toMatch(/deletes your guitar lessons, practice history, skill checks and skill ratings/)
    expect(guitar).toMatch(/Your singing is not touched/)
    expect(guitar).not.toMatch(/easy notes/)

    const voice = resetWarning('voice')
    expect(voice).toMatch(/deletes your singing lessons, practice history, skill checks and skill ratings/)
    // The easy notes live on the singing profile, which goes with the rest.
    expect(voice).toMatch(/easy notes/)
    expect(voice).toMatch(/Your guitar data is not touched/)

    const both = resetWarning('both')
    expect(both).toMatch(/for guitar and for singing/)
    expect(both).toMatch(/easy notes/)
    expect(both).not.toMatch(/not touched/)

    for (const text of [guitar, voice, both]) {
      expect(text).toMatch(/It cannot be undone\./)
      expect(text).toMatch(/Your songs are kept\.$/)
    }
    expect(new Set([guitar, voice, both, RESET_WARNING]).size).toBe(4)
  })

  it('the store is handed one side, or nothing for everything', () => {
    expect(resetSide('guitar')).toBe('guitar')
    expect(resetSide('voice')).toBe('voice')
    expect(resetSide('both')).toBeUndefined()
  })

  it('afterwards the card says which data was reset', () => {
    expect(resetDone('guitar')).toBe('Guitar training data reset.')
    expect(resetDone('voice')).toBe('Singing training data reset.')
    expect(resetDone('both')).toBe('Guitar and singing training data reset.')
  })
})

describe('the data card of Settings', () => {
  it('reads as it always did while the singing side is off', () => {
    expect(textOf(renderToStaticMarkup(createElement(DataSection)))).toEqual([
      'Your data',
      'Export',
      'Save your lessons, practice history, skill checks and skill ratings as a backup file.',
      'Export training data',
      'Import',
      'Loads a backup file. This replaces the training data on this device, so you will be asked before anything changes.',
      'Import from file…',
      'Reset training data',
      'Start training from scratch.',
      'Reset training data…',
    ])
    expect(exportNote(false)).toBe('Save your lessons, practice history, skill checks and skill ratings as a backup file.')
    expect(importNote(false)).toBe(IMPORT_NOTE)
  })

  it('never mentions singing while the singing side is off', () => {
    expect(renderToStaticMarkup(createElement(DataSection))).not.toMatch(/sing|voice/i)
  })

  it('with the singing side on it says one backup holds guitar and singing', () => {
    voiceSideOn()
    const text = textOf(renderToStaticMarkup(createElement(DataSection)))
    expect(text).toContain(exportNote(true))
    expect(exportNote(true)).toMatch(/guitar and singing/)
    expect(text).toContain(importNote(true))
    expect(importNote(true)).toMatch(/replaces/)
    expect(importNote(true)).toMatch(/guitar data only/)
    expect(importNote(true)).toMatch(/guitar and singing/)
  })

  it('with the singing side on it offers the three resets, each under its own name', () => {
    voiceSideOn()
    const html = renderToStaticMarkup(createElement(DataSection))
    const text = textOf(html)
    for (const scope of RESET_SCOPES) expect(text).toContain(resetLabel(scope))
    expect(text).not.toContain('Reset training data…')
    for (const id of ['data-reset-guitar', 'data-reset-voice', 'data-reset-both']) expect(html).toContain(`data-testid="${id}"`)
  })
})
