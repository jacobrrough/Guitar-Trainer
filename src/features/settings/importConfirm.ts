/**
 * Importing and resetting training data, the part both data screens (Settings and Progress) share:
 * the words, and the rule that a picked file is never imported until the learner has said yes.
 */

/** Under the Import heading. */
export const IMPORT_NOTE =
  'Loads a backup file. This replaces the training data on this device, so you will be asked before anything changes.'

/** Shown before a reset. */
export const RESET_WARNING =
  'This deletes your lessons, practice history, skill checks and skill ratings on this device. It cannot be undone. Your songs are kept.'

/** Shown before an import, with the buttons to save a backup first, go ahead or cancel. */
export function importWarning(fileName: string): string {
  return `“${fileName}” replaces all the training data on this device: your lessons, practice history, skill checks and skill ratings. Anything you did after that backup was made will be gone. Your songs are kept.`
}

export const BACKUP_OFFER = 'Not sure? Save a backup of what you have now first.'
export const BACKUP_DONE = 'Backup saved. You can now replace your data.'

/** How an export ended: handed to the share sheet, share sheet closed, shown in a new tab, or downloaded. */
export type ExportOutcome = 'shared' | 'cancelled' | 'opened' | 'downloaded'

/**
 * Whether an export put a backup file in the learner's hands, so the question may say "Backup saved".
 * A new tab does not count: the browser may have blocked it, and nothing is kept until they save it.
 */
export function backupSaved(outcome: ExportOutcome | null): boolean {
  return outcome === 'shared' || outcome === 'downloaded'
}

/** Where an import stands: nothing chosen, or a file waiting for a yes. */
export type ImportFlow<F> = { step: 'idle' } | { step: 'confirm'; file: F; backedUp: boolean }

export type ImportEvent<F> =
  | { type: 'picked'; file: F | undefined }
  /** The learner saved a backup of the current data while deciding. */
  | { type: 'backedUp' }
  | { type: 'confirmed' }
  | { type: 'cancelled' }

/**
 * Next step of an import. `importFile` is set only when the learner confirms a waiting file: that is
 * the one moment the current data may be replaced.
 */
export function importFlow<F>(state: ImportFlow<F>, event: ImportEvent<F>): { state: ImportFlow<F>; importFile?: F } {
  switch (event.type) {
    case 'picked':
      return event.file === undefined ? { state } : { state: { step: 'confirm', file: event.file, backedUp: false } }
    case 'backedUp':
      return state.step === 'confirm' ? { state: { ...state, backedUp: true } } : { state }
    case 'confirmed':
      return state.step === 'confirm' ? { state: { step: 'idle' }, importFile: state.file } : { state }
    case 'cancelled':
      return { state: { step: 'idle' } }
  }
}
