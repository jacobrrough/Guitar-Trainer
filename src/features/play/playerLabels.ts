/**
 * What the player says, and the few things it decides, that differ between a guitar chart and a sung
 * one. The chart alone chooses (`chart.voice`), as it chooses the tracker and the lanes.
 *
 * Kept out of Player.tsx so they can be tested without a browser. The tests are in
 * voice/voiceCopy.test.ts; the guitar's words are pinned there letter for letter, because nothing a
 * guitarist reads may change when singing is added.
 */
import type { Chart } from '../../chart/types'
import { voiceDetector } from './voice/judge'

export interface PlayerLabels {
  /** Tooltip of the speaker button, with the guide track on and off, and its name for a screen reader. */
  guideOn: string
  guideOff: string
  guideToggle: string
  /** The same, as the last words of the line under the start button. */
  guideOnShort: string
  guideOffShort: string
  /** Under the start button while the guide track is off: why it is off. */
  guideOffWhy: string
  /** Shown during "Listen first". */
  listenNotice: string
  /** The count-in clicks came back through the microphone while something with pitches was about to play. */
  bleedNotice: string
  /** What is offered next to that notice. */
  bleedAction: 'speaker-mode' | null
  /** Sung runs: one of the app's own notes was heard as only a speaker plays it. */
  ownSoundNotice: string
  /** Sung runs: the headphones or the speaker changed while the guide was playing. */
  deviceChangedNotice: string
  micError(message: string): string
  /** The browser would not start the sound (not for want of a tap); `message` is what it reported. */
  playbackError(message: string): string
  /** The line under the start button when the screen gives no hint of its own. */
  readyLine(notes: number, speed: number): string
  /** Under the start button of a check. */
  testLine: string
  /** The word that flashes by the line when a note is judged; null = nothing is flashed. */
  judgement(kind: 'perfect' | 'good' | 'miss'): string | null
}

export const GUITAR_LABELS: PlayerLabels = {
  guideOn: 'Guitar part on: it plays along with the drums',
  guideOff: 'Guitar part muted: only the drums play',
  guideToggle: 'Toggle the guitar part',
  guideOnShort: 'guitar part on',
  guideOffShort: 'guitar part muted',
  guideOffWhy: 'The guitar part is muted so the microphone hears you, not the speaker. Tap the speaker icon to hear it, or Listen first.',
  listenNotice: 'Listen first: the part is played for you and nothing is scored.',
  bleedNotice: 'The microphone is hearing the speaker, so this run will not count towards your progress. Use headphones, or turn on speaker mode.',
  bleedAction: 'speaker-mode',
  // Neither can happen on a guitar chart; the words are here so that the two lists have the same shape.
  ownSoundNotice: 'The microphone is hearing the speaker, so this run will not count towards your progress.',
  deviceChangedNotice: 'The sound moved to another speaker or headphones.',
  micError: (message) => `Microphone: ${message}. You can still play along without scoring.`,
  playbackError: (message) => `Playback failed: ${message}`,
  readyLine: (notes, speed) => `${notes} notes · ${Math.round(speed * 100)}% speed`,
  testLine: 'Test: one attempt, no pausing.',
  judgement: (kind) => (kind === 'perfect' ? 'Perfect!' : kind === 'good' ? 'Good' : 'Miss'),
}

export const VOICE_LABELS: PlayerLabels = {
  guideOn: 'Guide voice on: it sings your notes with you',
  guideOff: 'Guide voice off: you hear the click and the starting notes',
  guideToggle: 'Toggle the guide voice',
  guideOnShort: 'guide on',
  guideOffShort: 'guide off',
  guideOffWhy: 'The guide voice is off so the microphone hears you, not the speaker. With headphones on, tap the speaker icon to sing with it. Or tap Listen first.',
  listenNotice: 'Listen first: the guide sings it for you and nothing is scored.',
  bleedNotice: 'The microphone is hearing the speaker, so this run will not count. Use headphones, or turn the guide off.',
  // Speaker mode (echo cancellation) is no way out for singing: it would take the voice out with the guide.
  bleedAction: null,
  // "Seems": a singer with headphones on who joins in with the guide from its first moment is heard exactly as the speaker would be.
  ownSoundNotice: 'The microphone seems to be hearing the guide, so this run will not count. Use headphones, or turn the guide off.',
  deviceChangedNotice: 'Your headphones or speaker changed, so this run is for practice and will not be saved. Start again when you are ready.',
  micError: (message) => `Microphone: ${message}. You can still sing along without scoring.`,
  // The browser's own words are passed on as they are (someone may be asked for help with them); ours stay plain.
  playbackError: (message) => `The sound did not start. Tap play to try again. (${message})`,
  // No speed: a sung piece is never slowed down.
  readyLine: (notes) => `${notes} ${notes === 1 ? 'note' : 'notes'} to sing`,
  testLine: 'Check: one go, no pausing.',
  // A note that did not count is shown on its bar, with an arrow to where the note is. No word is flashed at the singer for it.
  judgement: (kind) => (kind === 'perfect' ? 'Perfect!' : kind === 'good' ? 'Good' : null),
}

export function playerLabels(chart: Pick<Chart, 'voice'>): PlayerLabels {
  return chart.voice ? VOICE_LABELS : GUITAR_LABELS
}

/**
 * Whether the guide track is switched on when nothing has been tapped yet: at mount, when the track
 * arrives, and when the microphone is switched back on.
 *
 * A guitar chart follows speaker mode, as it always has: with echo cancellation the guitar part stays
 * out of the microphone. A sung chart follows "I use headphones" and nothing else: echo cancellation
 * does not keep a guide voice from scoring the notes it sings, so on a bare speaker the guide is off.
 */
export function guideStartsOn(o: { voice: boolean; hasGuide: boolean; echoCancellation: boolean; voiceHeadphones: boolean }): boolean {
  return o.hasGuide && (o.voice ? o.voiceHeadphones : o.echoCancellation)
}

/**
 * What becomes of the guide switch when the guide track appears or goes away while the player is on
 * screen. The track of a sung piece is rendered after the page has opened, and again for the next
 * level or round, so for a moment there is none.
 *
 * - `keep`: a guitar chart. A guitar part that arrives late stays off until it is tapped, as it always has.
 * - `off`: the track of a sung chart went away. The switch goes off with it, and that swaps nothing
 *   (without a track the scored track is what plays). Left on, it would do nothing until the next
 *   track arrived, and then start playing it at that moment, in the middle of a run if one had begun.
 * - `set`: the track of a sung chart arrived and nothing is playing: the switch goes where it starts
 *   (`guideStartsOn`).
 * - `wait`: it arrived during a run. Setting the switch swaps the sound, so that waits until the
 *   sound may be swapped (`soundMaySwap`).
 */
export function guideTrackStep(o: { voice: boolean; hasGuide: boolean; idle: boolean }): 'keep' | 'off' | 'set' | 'wait' {
  if (!o.voice) return 'keep'
  if (!o.hasGuide) return 'off'
  return o.idle ? 'set' : 'wait'
}

/**
 * Whether the track the player plays may be changed for another now: before a run and after one, never
 * from the count-in to the end (a pause is still the run), never while only listening.
 *
 * `starting`: a start is under way. "Try again" restarts and starts in one go, so the phase reads
 * `ready` for a moment while the start is already running; a swap then would put a track that has not
 * been touched inside a tap under the count-in, and an iPhone may refuse to play it.
 */
export function soundMaySwap(o: { phase: 'ready' | 'countin' | 'playing' | 'paused' | 'finished'; starting: boolean; listening: boolean }): boolean {
  return (o.phase === 'ready' || o.phase === 'finished') && !o.starting && !o.listening
}

/**
 * Whether what is about to play could score the run if the microphone hears it, which is when hearing
 * the count-in clicks through the microphone has to stop the run from counting.
 *
 * Guitar: the guitar part, or a real recording; a click alone cannot play a note. Sung: the guide
 * voice only. The scored track of a sung chart does have pitches in it (the starting note, the calls),
 * but the tracker gives no credit while one sounds, so a bare phone playing it is how singing is
 * meant to be scored. That is why `backingIsClick` is not asked for a sung chart: a screen that left
 * it out would otherwise turn every run on a bare phone into "the microphone hears the speaker".
 */
export function ownSoundCounts(o: { voice: boolean; guideOn: boolean; backingIsClick: boolean }): boolean {
  return o.voice ? o.guideOn : o.guideOn || !o.backingIsClick
}

/** How long after the microphone was opened a change of devices is still the microphone opening (seconds). */
export const DEVICE_SETTLE_SEC = 3

/**
 * Whether a change of audio devices (`devicechange`: headphones pulled out, a headset connecting)
 * makes the run in progress practice instead of a result.
 *
 * Only a sung run with the guide on: the guide was playing into headphones, and from this moment it
 * may be coming out of the speaker and scoring itself. The event does not say which way the change
 * went, so the run is not blamed on the speaker; it simply no longer stands for the whole piece.
 * From the count-in on, because the count-in is already the run; a pause is still the run.
 *
 * One exception. Opening the microphone raises the same event by itself: the browser's list of
 * devices changes when the permission is granted, and a wireless headset changes to its call mode.
 * So an event in the first moments after this player opened the microphone (`sinceMicOpened`,
 * seconds) is taken for that, or every first run with headphones would be practice.
 */
export function deviceChangeMakesPartial(o: {
  voice: boolean
  guideOn: boolean
  listening: boolean
  phase: 'ready' | 'countin' | 'playing' | 'paused' | 'finished'
  sinceMicOpened: number
}): boolean {
  if (!o.voice || !o.guideOn || o.listening) return false
  if (o.sinceMicOpened < DEVICE_SETTLE_SEC) return false
  return o.phase === 'countin' || o.phase === 'playing' || o.phase === 'paused'
}

/**
 * The player's own detector: the whole neck of a guitar, and the threshold its microphone has always
 * been opened with. Set again at every start, because the microphone may have been opened by another
 * screen (or by a sung chart before this one) with a different range.
 */
export const PLAYER_DETECTOR = { minFreq: 55, maxFreq: 1500, threshold: 0.9 } as const

/**
 * What the pitch detector is set to for a run of this chart.
 *
 * It takes no reference pitch. A guitar chart's range is the same whatever A is tuned to, and a sung
 * chart is read against the app's own A = 440 (`VOICE.a4`), where its starting note, its guide voice
 * and its chords are; the guitar's "Reference pitch" setting has no say in anything that is sung.
 */
export function detectorFor(chart: Pick<Chart, 'voice'>): { minFreq: number; maxFreq: number; threshold: number } {
  return chart.voice ? voiceDetector(chart.voice) : { ...PLAYER_DETECTOR }
}
