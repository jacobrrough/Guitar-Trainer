import { db } from '../db/db'
import { MAX_KEY_NUDGE, MIN_RANGE_SPAN } from '../music/keys'
import { profileIdFor } from './instruments'
import { defaultProfile, localDateString, peekSession } from './store'
import type { VoiceProfile, VoiceRange } from './types'

/**
 * What only a singer has: the easy notes, a key choice per song, and the day they said their voice was
 * tired. It lives on the singing profile (row 2) and not in the settings, because a backup carries the
 * profiles and no settings.
 *
 * Everything here writes that one row and nothing else. A singer who has not been through the set-up yet
 * can already have a range (the set-up saves it on the way), so "this row exists" does not mean "set up".
 */
const VOICE_ROW = profileIdFor('voice')

/**
 * The smallest range that is ever stored (eight notes, a five-note scale with room to spare: the first
 * step of every exercise is built to fit in it) and the furthest a song may be moved from the key chosen
 * for it. Both are the key maths' own numbers, so the store and the arranger cannot drift apart.
 */
const SMALLEST_SPAN = MIN_RANGE_SPAN
const MAX_NUDGE = MAX_KEY_NUDGE

/**
 * The lowest and highest note a stored range may hold (C2 and D6). Below the bottom the app cannot
 * recognise its own starting note, so it could no longer tell a singer from its own speaker; above the
 * top no voice the app is made for sings in comfort. The range finder already treats a find outside
 * these as a mistake; the same holds for a range entered by hand, a semitone at a time.
 */
export const LOWEST_RANGE_NOTE = 36
export const HIGHEST_RANGE_NOTE = 86

/** Read-only, so a live query may call it. Empty until the singer has saved something. */
export async function loadVoiceProfile(): Promise<VoiceProfile> {
  return (await db.profile.get(VOICE_ROW))?.voice ?? {}
}

/**
 * Changes the voice part of the singing profile and stores the row, keeping everything else on it.
 * A missing row is created with the defaults of a new profile, started at `now`. Call it inside a
 * transaction that holds the profile table, so two quick changes cannot overwrite each other.
 */
async function changeVoice(change: (voice: VoiceProfile) => VoiceProfile, now = Date.now()): Promise<VoiceProfile> {
  const profile = (await db.profile.get(VOICE_ROW)) ?? defaultProfile(now, 'voice')
  const voice = change(profile.voice ?? {})
  await db.profile.put({ ...profile, voice })
  return voice
}

/**
 * The range as it is stored. Its edges have to be whole notes at least `SMALLEST_SPAN` apart, or it is
 * refused: nothing could be placed in it.
 *
 * An easy note outside the edges is not a reason to refuse. It happens honestly: the hum was at the very
 * bottom of the voice and the lowest comfortable note is two above the lowest one found, or the easy note
 * was the top note and the singer has just said "Tight". Refusing would leave the old range in place, and
 * that is the one that felt tight. The easy note is moved onto the nearest edge instead, which is where
 * an exercise placed around it would have ended up anyway.
 */
function storable(range: VoiceRange): VoiceRange {
  const whole = [range.low, range.high, range.easy].every((note) => Number.isInteger(note))
  if (!whole || range.high - range.low < SMALLEST_SPAN) {
    throw new Error('This range cannot be saved. It needs whole notes, and at least eight notes from the lowest to the highest.')
  }
  if (range.low < LOWEST_RANGE_NOTE || range.high > HIGHEST_RANGE_NOTE) {
    throw new Error('This range cannot be saved. It goes lower or higher than the app can follow.')
  }
  const easy = Math.max(range.low, Math.min(range.high, range.easy))
  return easy === range.easy ? range : { ...range, easy }
}

/**
 * Saves the singer's easy notes. A range the exercises could not be placed in is refused, and nothing is
 * stored (see `storable`). What is stored comes back, so the caller sees an easy note that was moved.
 *
 * Today's singing plan was chosen for the old range: which steps fit, which songs fit, in which key. If
 * nothing in it has been sung yet it is deleted, so the next visit to Today makes a plan for the new
 * range. Once something was sung the plan stays, and its remaining blocks pick up the new range when they
 * are built. The guitar plan and the plans of other days are not touched. "Today" is the day of `now`.
 *
 * "Sung" is a block that is done or active, or any round recorded for the plan, counted or not. The
 * rounds have to be asked as well: a block stays pending in the stored plan until its last round, and
 * the range can change between two rounds (a singer who says a slide felt tight). Deleting the plan then
 * would take the day away from under the block that is being sung.
 *
 * One more plan stays: that of a day the singer ended with "My voice is tired". Its blocks were skipped,
 * so nothing in it may have been sung, and without this a new range would bring up a fresh plan on the
 * very day the singer asked to stop.
 */
export async function saveVoiceRange(range: VoiceRange, now = Date.now()): Promise<VoiceProfile> {
  const stored = storable(range)
  const today = localDateString(new Date(now))
  return db.transaction('rw', db.profile, db.sessions, db.attempts, async () => {
    const voice = await changeVoice((before) => ({ ...before, range: stored }), now)
    if (voice.tiredOn === today) return voice
    const plan = await peekSession(today, 'voice')
    if (plan?.id === undefined) return voice
    const sung = plan.plan.blocks.some((block) => block.status === 'done' || block.status === 'active') || (await db.attempts.where('sessionId').equals(plan.id).count()) > 0
    if (!sung) await db.sessions.delete(plan.id)
    return voice
  })
}

/**
 * Remembers that a song was moved up or down from the key chosen for it ("Lower", "Higher"), by the id
 * of the bundled song. Whole semitones, never more than three either way. A song that is back in its own
 * key is forgotten, so the profile only lists the songs that were moved. Whether the moved song still
 * fits the range is decided where the key is chosen, not here.
 */
export function setKeyNudge(builtinId: string, semitones: number): Promise<VoiceProfile> {
  const nudge = Number.isFinite(semitones) ? Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, Math.round(semitones))) : 0
  return db.transaction('rw', db.profile, () =>
    changeVoice(({ keyNudge: before = {}, ...rest }) => {
      const { [builtinId]: _moved, ...others } = before
      const keyNudge = nudge === 0 ? others : { ...others, [builtinId]: nudge }
      return Object.keys(keyNudge).length > 0 ? { ...rest, keyNudge } : rest
    }),
  )
}

/** Marks the local date (YYYY-MM-DD) on which the singer said "My voice is tired". The Coach plans the day after it gently. */
export function markTiredOn(date: string): Promise<VoiceProfile> {
  return db.transaction('rw', db.profile, () => changeVoice((before) => ({ ...before, tiredOn: date })))
}
