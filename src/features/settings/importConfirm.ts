/**
 * Importing and resetting training data, the part both data screens (Settings and Progress) share:
 * the words, and the rule that a picked file is never imported until the learner has said yes.
 *
 * One app holds two instruments. While the singing side is switched off every sentence here reads as
 * it did before singing existed. Once it is on, the words say which side a step touches: what a file
 * replaces depends on the file (see `BackupContents`), and there are three resets where there was one.
 */
import type { InstrumentId } from '../../training/types'

/** Under the Export heading. */
export const EXPORT_NOTE = 'Save your lessons, practice history, skill checks and skill ratings as a backup file.'

/** Under the Import heading. */
export const IMPORT_NOTE =
  'Loads a backup file. This replaces the training data on this device, so you will be asked before anything changes.'

/** Under the Export heading: with the singing side on, it says that the one file holds both instruments. */
export function exportNote(voiceOn: boolean): string {
  return voiceOn ? `${EXPORT_NOTE} One file holds both guitar and singing.` : EXPORT_NOTE
}

/** Under the Import heading: with the singing side on, it says what each kind of backup replaces. */
export function importNote(voiceOn: boolean): string {
  if (!voiceOn) return IMPORT_NOTE
  return 'Loads a backup file. A backup made before singing was added replaces your guitar data only. A newer backup replaces guitar and singing. You will be asked before anything changes.'
}

/** Shown before the one reset of a device without the singing side. */
export const RESET_WARNING =
  'This deletes your lessons, practice history, skill checks and skill ratings on this device. It cannot be undone. Your songs are kept.'

/** What a reset removes: one instrument's training data, or both. */
export type ResetScope = InstrumentId | 'both'

/** The three resets a device with the singing side offers, in the order they are shown. */
export const RESET_SCOPES: readonly ResetScope[] = ['guitar', 'voice', 'both']

const RESET_LABEL: Record<ResetScope, string> = { guitar: 'Reset guitar…', voice: 'Reset singing…', both: 'Reset both…' }

export function resetLabel(scope: ResetScope): string {
  return RESET_LABEL[scope]
}

/**
 * Shown before a reset: what goes, and what stays. Without a scope it is the one reset of a device
 * that has no singing side, worded as ever. The easy notes are named for singing because they are
 * stored with the singing profile and go with it: the singer will be asked to find them again.
 */
export function resetWarning(scope?: ResetScope): string {
  switch (scope) {
    case 'guitar':
      return 'This deletes your guitar lessons, practice history, skill checks and skill ratings on this device. It cannot be undone. Your singing is not touched. Your songs are kept.'
    case 'voice':
      return 'This deletes your singing lessons, practice history, skill checks and skill ratings on this device, and your easy notes. It cannot be undone. Your guitar data is not touched. Your songs are kept.'
    case 'both':
      return 'This deletes all your lessons, practice history, skill checks and skill ratings on this device, for guitar and for singing, and your easy notes. It cannot be undone. Your songs are kept.'
    default:
      return RESET_WARNING
  }
}

/** The line shown once a reset is done. */
export function resetDone(scope?: ResetScope): string {
  switch (scope) {
    case 'guitar':
      return 'Guitar training data reset.'
    case 'voice':
      return 'Singing training data reset.'
    case 'both':
      return 'Guitar and singing training data reset.'
    default:
      return 'Training data reset.'
  }
}

/** What the store is asked to delete: one side, or everything when no side is named (`resetTrainingData`). */
export function resetSide(scope?: ResetScope): InstrumentId | undefined {
  return scope === 'guitar' || scope === 'voice' ? scope : undefined
}

/**
 * What a backup file holds, as far as the question before an import has to say.
 * - Version 1 was written before singing existed. It is a guitar backup: importing it replaces the
 *   guitar data and leaves every singing row alone, whatever else the file carries.
 * - Version 2 holds both instruments and replaces both. It holds singing when it carries the singing
 *   profile (profile row 2). Without one, an import still clears both sides: the singing on the
 *   device is gone afterwards, which is the one thing the question must not keep quiet about.
 */
export interface BackupContents {
  version: 1 | 2
  singing: boolean
}

/**
 * Reads what a picked file holds, by the same marks the store goes by when it imports one. Null for
 * anything that is not a backup this app can read: the question then stays the general one, and the
 * import itself says what is the matter with the file.
 */
export function backupContents(json: string): BackupContents | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const { version, profiles } = data as { version?: unknown; profiles?: unknown }
  if (version === 1) return { version, singing: false }
  if (version !== 2) return null
  if (profiles === undefined) return { version, singing: false }
  if (!Array.isArray(profiles)) return null
  return { version, singing: profiles.some((p: unknown) => !!p && typeof p === 'object' && (p as { id?: unknown }).id === 2) }
}

/**
 * Shown before an import, with the buttons to save a backup first, go ahead or cancel. `backup` is
 * what the file holds; the screens pass it once the singing side is on. Without it the question is the
 * one a device with a single instrument always got.
 *
 * `singerHere` is whether this device has singing that an import could take away. Only one question
 * reads it: a newer backup without singing clears the singing of the device, and says so. On a device
 * that never sang there is nothing to clear, and a line about lost singing progress would only puzzle
 * (after the release that is every guitarist restoring their own backup): the question is then the one
 * it always was. Not told, the device is taken to have singing, so the warning is never left out by mistake.
 */
export function importWarning(fileName: string, backup?: BackupContents | null, singerHere = true): string {
  if (!backup || (backup.version === 2 && !backup.singing && !singerHere)) {
    return `“${fileName}” replaces all the training data on this device: your lessons, practice history, skill checks and skill ratings. Anything you did after that backup was made will be gone. Your songs are kept.`
  }
  if (backup.version === 1) {
    return `“${fileName}” is a guitar backup. It replaces the guitar training data on this device: your guitar lessons, practice history, skill checks and skill ratings. Anything you did on guitar after that backup was made will be gone. Your singing stays as it is. Your songs are kept.`
  }
  if (backup.singing) {
    return `“${fileName}” holds guitar and singing. It replaces all the training data on this device, for both: your lessons, practice history, skill checks and skill ratings. Anything you did after that backup was made will be gone. Your songs are kept.`
  }
  return `“${fileName}” holds guitar and no singing, and it replaces all the training data on this device: your lessons, practice history, skill checks and skill ratings. Your singing progress on this device will be gone, your easy notes too, and so will anything you did on guitar after that backup was made. Your songs are kept.`
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
