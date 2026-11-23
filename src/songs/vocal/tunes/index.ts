/**
 * The ten songs to sing, in the order the course meets them. All are traditional or long out of copyright.
 *
 * How a tune is written here. Whatever turns a tune into something to sing along with relies on every
 * point, and tunes.test.ts holds each tune to them:
 *
 * - A pitch is counted in semitones above the home note, the "do" of the tune: do re mi fa sol la are
 *   0 2 4 5 7 9, and the sol below home is -5. Every tune ends on 0.
 * - A length is counted in beats (a quarter note is 1; the shortest note is half a beat).
 * - Lines follow one another without a gap. A rest is always written out, as the last step of the line
 *   it follows and never anywhere else, so every line starts with a sung note.
 * - The first `pickupBeats` beats are sung before the first bar line; from there a bar line falls every
 *   `beatsPerBar` beats, and `chords` names one chord for each of those bars. As in a printed score the
 *   last bar is short by the pickup, so the beats of all the lines add up to exactly
 *   `chords.length * beatsPerBar`.
 * - A line is what is sung on one breath, and it is a whole number of bars long when it starts as the
 *   tune does. The trap: four tunes have a line that starts with a shorter pickup of its own ("its fleece",
 *   "the old grey goose", "when the saints", "in a one-horse"). That line and the one before it are not
 *   whole bars, only the two together. So place a line by the beats that come before it, never by
 *   counting bars.
 * - The last note of a line is long enough to cut short for a breath (0.65 s or more at the tune's own
 *   tempo) unless a rest is written after it.
 * - Every sung note has a syllable: a trailing hyphen when the word goes on, '' when the syllable before
 *   is carried to this note, which is then always a different pitch.
 * - No line and no note is the same array in two places, and none of them can be written to: the list,
 *   every tune, line, note and chord row is frozen. An arrangement builds its own arrays, the notes
 *   included: a copied line still holds the tune's own notes.
 *
 * Two tunes ask more of whatever arranges or tests them than the others, and the tests pin both:
 *
 * - When the Saints starts three beats before its first bar line, so the bar before the tune has one
 *   free beat, not the two a starting note and a silent beat need.
 * - Jingle Bells sits on mi for 26 of its 51 notes, and mi is its starting note. Whoever holds that one
 *   note all the way through is on the note for just over half of them; no other tune gives half of its
 *   notes to one held pitch, wherever it is held.
 */
import type { VocalSong } from '../types'
import { amazingGrace } from './amazingGrace'
import { auntRhody } from './auntRhody'
import { happyBirthday } from './happyBirthday'
import { hotCrossBuns } from './hotCrossBuns'
import { jingleBells } from './jingleBells'
import { londonBridge } from './londonBridge'
import { maryLamb } from './maryLamb'
import { odeToJoy } from './odeToJoy'
import { saints } from './saints'
import { twinkle } from './twinkle'

/**
 * Makes a value read-only all the way down. The trap it closes: an arrangement takes the breath off the
 * last note of every line, and done to the tune itself that would shorten the note again every time the
 * song is opened. A write to a tune now throws instead of quietly changing every later arrangement.
 */
function readOnly<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) readOnly(inner)
    Object.freeze(value)
  }
  return value
}

export const VOCAL_TUNES: VocalSong[] = readOnly([
  hotCrossBuns,
  maryLamb,
  odeToJoy,
  auntRhody,
  saints,
  londonBridge,
  jingleBells,
  twinkle,
  amazingGrace,
  happyBirthday,
])
