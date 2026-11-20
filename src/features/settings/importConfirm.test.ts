import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DataSection } from './DataSection'
import { ImportConfirm } from './ImportConfirm'
import { IMPORT_NOTE, RESET_WARNING, backupSaved, importFlow, importWarning, type ImportFlow } from './importConfirm'

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
