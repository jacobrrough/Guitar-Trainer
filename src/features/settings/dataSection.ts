/**
 * Helpers for the Settings page that need no screen to be tried out: the "Your data" card (file name,
 * status lines, what happens after an import), the words of the "Singing" card, and the words of the
 * sound-sync dialog for each instrument.
 */
import { voiceEnabled } from '../../app/features'
import { installVocalSongs } from '../../songs/vocal/install'
import { importTrainingData, peekProfile } from '../../training/store'
import type { InstrumentId, Profile } from '../../training/types'
import { voiceIsSetUp } from '../../training/voicePlan'
import { calibrationAdvice } from './calibration'
import { backupContents, type BackupContents } from './importConfirm'

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** File name for a training-data export made on `date` (local calendar day). */
export function exportFileName(date: Date): string {
  return `guitar-trainer-training-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

/** Status message shown after a successful import. */
export function importStatusText(counts: { attempts: number; skills: number }): string {
  const a = counts.attempts === 1 ? 'attempt' : 'attempts'
  const s = counts.skills === 1 ? 'skill rating' : 'skill ratings'
  return `Imported ${counts.attempts} ${a} and ${counts.skills} ${s}.`
}

/** Human readable message for an unknown thrown value. */
export function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return 'Something went wrong.'
}

/** A picked backup file waiting for a yes, with what it holds when that was looked at (`backupContents`). */
export interface PickedBackup<F> {
  file: F
  backup: BackupContents | null
  /**
   * Whether this device has singing the import would take away. Looked at only for a file whose
   * question depends on it (a newer backup without singing); otherwise left out.
   */
  singerHere?: boolean
}

/**
 * Whether a singing profile holds anything an import could take away: a singer who has been through
 * the set-up, or easy notes that were found. A row that merely exists holds nothing: it is written the
 * first time anything loads the singing profile to change it.
 */
export function holdsSinging(singer: Pick<Profile, 'experience' | 'placementDoneAt' | 'voice'>): boolean {
  return voiceIsSetUp(singer) || singer.voice?.range !== undefined
}

/** The same, asked of this device. It only reads: looking at a file must not create a singing profile. */
export async function deviceHoldsSinging(): Promise<boolean> {
  return holdsSinging(await peekProfile('voice'))
}

/**
 * What the file picker handed over, made ready for the question before an import. With one instrument
 * the question is the same for every file, so the file is not read until the learner has said yes, as
 * it never was. With the singing side on it is read here, because what it replaces depends on what it
 * holds. A file that cannot be read still waits for the yes: the import then says what is the matter.
 *
 * A newer backup without singing clears the singing of the device, so for such a file the device is
 * asked whether it has any (`singerHere`): the question warns of losing it only where there is some to
 * lose. A device that cannot be asked is taken to have it.
 */
export async function pickBackup<F extends { text(): Promise<string> }>(
  file: F | undefined,
  voiceOn: boolean,
  singerHere: () => Promise<boolean> = deviceHoldsSinging,
): Promise<PickedBackup<F> | undefined> {
  if (!file) return undefined
  if (!voiceOn) return { file, backup: null }
  let backup: BackupContents | null
  try {
    backup = backupContents(await file.text())
  } catch {
    return { file, backup: null }
  }
  if (!backup || backup.version !== 2 || backup.singing) return { file, backup }
  return { file, backup, singerHere: await singerHere().catch(() => true) }
}

/**
 * Whether the songs to sing belong on this device: the singing side is switched on and the singer has
 * been through the set-up. A singing profile that merely exists is not enough (the range finder and
 * any screen that loads the profile create the row); the set-up writes the songs itself when it ends.
 */
export function wantsSongsToSing(voiceOn: boolean, singer: Pick<Profile, 'experience' | 'placementDoneAt'>): boolean {
  return voiceOn && voiceIsSetUp(singer)
}

/** What restoring a backup is made of. The screens use the device's own (`restoreBackup` without a second argument). */
export interface RestoreSteps {
  /** Replaces the training data with the file's; resolves to the rows put in. */
  importData(json: string): Promise<{ attempts: number; skills: number }>
  /** Whether a singer who needs the songs to sing is on the device now. Asked after the import, of what it left. */
  singerIsSetUp(): Promise<boolean>
  installSongs(): Promise<void>
}

const ON_THIS_DEVICE: RestoreSteps = {
  importData: importTrainingData,
  singerIsSetUp: async () => wantsSongsToSing(voiceEnabled(), await peekProfile('voice')),
  installSongs: installVocalSongs,
}

/**
 * Imports a backup, and then sees to the songs to sing. A backup holds no songs. The rows of the songs
 * to sing are tiny and are written again here, so a singer restored onto a new phone finds a library
 * and not an empty page. It runs after every import, of either kind of file: a guitar backup leaves the
 * singer of this device in place, and that singer needs the songs just the same.
 *
 * A file that is refused throws as the import does, and nothing else happens. If only the songs could
 * not be written, the import still stands and is reported as done: every song is written the first
 * time it is opened anyway.
 */
export async function restoreBackup(json: string, steps: RestoreSteps = ON_THIS_DEVICE): Promise<{ attempts: number; skills: number }> {
  const counts = await steps.importData(json)
  try {
    if (await steps.singerIsSetUp()) await steps.installSongs()
  } catch {
    // The training data is in. A missing song row is made when the song is first asked for.
  }
  return counts
}

/** What the "Singing" card of Settings says. Kept here so one test can read every word. */
export const SINGING_CARD = {
  title: 'Singing',
  none: 'We do not know your easy notes yet.',
  find: 'Find my easy notes',
  findAgain: 'Find them again',
  headphones: 'I use headphones',
  headphonesOn: 'You hear the guide voice and the chords while you sing. If the microphone ever picks them up from a speaker, that run is not counted and this switches itself off again.',
  headphonesOff: 'Without headphones you sing to a click and your starting note, so the microphone hears only you. Turn this on when you wear headphones.',
} as const

/** Everything the sound-sync dialog says. A piece of three is one sentence whose middle part is set in bold. */
export interface SyncWords {
  intro(clicks: number): readonly [string, string, string]
  /** Where to put the phone and what to listen through. */
  place: string
  /** Before the first click. */
  ready: string
  /** While the clicks play. */
  running: string
  /** The measurement, once it worked. */
  result(ms: number): readonly [string, string, string]
  /** How many clicks were heard, and what to do when the gaps scattered. */
  heard(samples: number, clicks: number, steady: boolean): string
  /** The button that keeps the measurement. */
  use(ms: number): string
  /** For a run that heard too few clicks. */
  advice(heard: number, clicks: number, floor: number): string
}

/** The guitar's words, exactly as the dialog has always said them. */
const GUITAR_SYNC: SyncWords = {
  intro: (clicks) => [
    `You will hear ${clicks} clicks. Rest your fingers lightly across the strings so they do not ring, and `,
    'strum on each click',
    '. The app measures how long your sound takes to arrive and lines up the scoring to match.',
  ],
  place: 'Use the speakers or headphones you normally play with, and keep the phone where you usually keep it.',
  ready: 'Get ready…',
  running: 'Strum on every click…',
  result: (ms) => ['Your sound reaches the app about ', `${ms} ms`, ' after the beat.'],
  heard: (samples, clicks, steady) =>
    `${samples} of ${clicks} clicks heard${steady ? '.' : '. The gap varied a lot between clicks, so this is rough: measure again and strum right on each click.'}`,
  use: (ms) => `Use ${ms} ms`,
  advice: calibrationAdvice,
}

/** A room this noisy hides the clicks (the same level `calibrationAdvice` goes by for the guitar). */
const NOISY_ROOM = 0.03

/**
 * A singer has nothing to strum. The phone can time its own clicks coming back from its speaker, and
 * with headphones on (where no click reaches the microphone) a clap on each click does the same job.
 * The number of milliseconds is left out: it is nothing a singer can use, and the app keeps it anyway.
 */
const VOICE_SYNC: SyncWords = {
  intro: (clicks) => [
    `You will hear ${clicks} clicks. `,
    'Let the phone listen to its own clicks, or clap along with them',
    '. The app measures how long sound takes to come back, so the notes you sing line up with what you see.',
  ],
  place: 'Use the speaker or headphones you normally sing with, and keep the phone where you usually keep it. With headphones on, clap along: the phone cannot hear clicks that only you can hear.',
  ready: 'Get ready…',
  running: 'Listening for the clicks…',
  result: () => ['The phone heard the clicks come back. ', 'The app now knows how long sound takes here', ', and will line up your singing to match.'],
  heard: (samples, clicks, steady) =>
    `${samples} of ${clicks} clicks heard${steady ? '.' : '. The gap changed a lot from click to click, so this is rough. Measure again in a quiet room, with the phone lying still.'}`,
  use: () => 'Use this',
  advice: (heard, clicks, floor) =>
    floor > NOISY_ROOM
      ? 'It is noisy here, so the clicks did not stand out. Find a quieter spot, then try again.'
      : `We heard ${heard} of ${clicks} clicks. Turn the sound of the phone up a little, or clap along close to the phone, and watch the bar jump on each click.`,
}

/** The words of the sound-sync dialog for one instrument; the guitar's unless told otherwise. */
export function syncWords(instrument: InstrumentId = 'guitar'): SyncWords {
  return instrument === 'voice' ? VOICE_SYNC : GUITAR_SYNC
}
