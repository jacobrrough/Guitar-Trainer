/**
 * The numbers sung scoring rests on, and the arithmetic that follows from them. Everything is in
 * seconds of real time and in cents; the tracker scales the seconds by the playback speed. Nothing is
 * a number of frames: a frame is 512 samples of whatever rate the microphone runs at, 11 or 12 ms on a
 * phone's own microphone and 21 or 32 ms through a wireless headset's, which puts the whole audio
 * context at 24 or 16 kHz. The two numbers that are in samples (`hopSamples`, `windowCentreSamples`)
 * are the detector's own and are turned into seconds with the rate (`frameSeconds`, `windowCentre`).
 * Only what is about the detector's frames as such counts them: one frame that jumps away and back is
 * a slip, and two frames with more than one dropped frame between them are not one held sound.
 *
 * Where a value differs from the design (docs/SINGING.md, section 3) the measurement that moved it is
 * written beside it. The measurements are those of voice.sim.test.ts: the virtual singer through the
 * phone microphone model at 44.1 and 48 kHz, and at 16 and 24 kHz for what depends on the frame length.
 */
import type { VoiceChart, VoiceJudge } from '../../../chart/types'
import { midiToFreq } from '../../../music/pitch'

/**
 * How far a voice may move from one detector frame to the next, in cents, as it was measured: with
 * frames of 512 samples at 44.1 kHz, 86 of them a second. The rule itself is a pace
 * (`VOICE.steadyRate`), worked out from these two, so that the number is written down once.
 */
const STEADY_STEP = 60
const STEADY_STEP_FRAMES_A_SECOND = 44100 / 512

export const VOICE = {
  /**
   * The pitch standard of everything sung: A4 in Hz. What the app plays for singing (the starting
   * note, the guide voice, the recorded chords under a song) is at 440 and cannot follow the guitar's
   * "Reference pitch" setting (430 to 450 Hz): the chords are recordings. So a sung chart is read
   * against 440 whatever that setting says: the tracker's verdicts, the dot on screen, and the range
   * the detector listens in (`voiceDetector`). Read against the setting, a singer exactly on the app's
   * own notes was 31 cents flat with it at 432: no note perfect from "In tune" on, so never a clean
   * round; with it at 430 or 450 not one note of "Performance" counted.
   */
  a4: 440,
  /**
   * A frame is a voice from this clarity on. Room noise alone reads at most 0.59. A quiet, breathy
   * voice through the phone model reads 0.68 to 0.87 (a full voice 0.97 and up), which is where the
   * click's kick drum (0.65 to 0.78) and a strummed chord (up to 0.89) read too: clarity cannot tell
   * those from a soft voice. The kick is left out by `steadyRate`; chords stay off the scored track.
   */
  clarity: 0.6,
  /** ... and from this level on, whatever the room. */
  minRms: 0.004,
  /**
   * In a room that is not silent the level to reach is this many times the quiet fifth of what was
   * heard during the count-in. The design said 3, and that shut quiet singing out: through the phone
   * model (room at 0.0032) a singer at `level: 0.02`, who arrives at three times the room, came to a
   * Coach accuracy of 0.56 to 0.68, and a quiet breathy one (`breath: 0.4`) to 0.67 to 0.87. At 2 both
   * have every note perfect, down to `level: 0.015`; a voice at 1.6 times the room (`level: 0.01`) is
   * still not heard, and the room alone still scores nothing.
   */
  floorFactor: 2,
  /** The quiet fifth: a click or a cough during the count-in does not raise the level. */
  floorPercentile: 0.2,
  /** Never ask for more than this, or nobody could sing over a noisy room. */
  gateCap: 0.02,
  /** Under this many seconds of count-in there is no measurement, only `minRms`. */
  floorSeconds: 0.25,
  /** The detector hands over a frame every 512 samples (AudioEngine's worklet), at any sample rate ... */
  hopSamples: 512,
  /** ... and reports the pitch of the middle of its 2048-sample window. */
  windowCentreSamples: 1024,
  /** A note begun a little early: frames this long before its start can count for it. */
  early: 0.1,
  /** Lateness is not wrong pitch: frames up to this long after a note's end can still count for it ... */
  late: 0.25,
  /**
   * ... but credit from outside a note's own span, early and late together, stops at this share of its
   * judged length. It is under every share that makes a hit (0.5 at the least), so a singer who is on
   * the neighbouring notes' pitches is never credited through them. The design capped the late credit
   * only. A singer 120 cents flat on a falling scale is in tune with each next note before it starts,
   * and the early window (0.10 s) is more than half the judged part of an eighth note at 100 bpm
   * (0.165 s): so the early credit is under the same cap, and the two share it.
   */
  outsideShare: 0.35,
  /** Scoops and consonants: the start of a note is not required. */
  onsetSkip: 0.12,
  onsetShare: 0.3,
  /** Nor is its very end. */
  release: 0.06,
  releaseShare: 0.15,
  /** The judged part of a note is never shorter than this. */
  minJudged: 0.08,
  /**
   * Vibrato: a frame outside the band still counts when the mean of the note's own frames over this
   * long is inside it, provided the note as a whole turns out to be on pitch (its median inside the
   * band). The second half is not in the design and closes a hole in it: right after a step of a
   * semitone the frames of two pitches share the window, and a steady offset averaged out for a moment.
   * 60 cents flat at a band of 50 scored the falling semitones of a tune that way (2 notes in 30), and
   * 120 cents flat at a band of 80 scored 4 quick notes in 18.
   *
   * The length is the design's. Measured on swings of 50, 80 and 100 cents at 4.5 to 7 a second, at
   * bands of 50 and 35: with 0.12 s a slow wide swing (100 cents at 4.5) on long notes was good only;
   * 0.17 s and 0.22 s leave every case clean. The shorter of the two lets less of a neighbouring note in.
   */
  vibratoMean: 0.17,
  /** With less than this voiced in the window there is no mean. */
  vibratoVoiced: 0.09,
  /** Every frame in the window has to be within this many cents of the note: further off it is another note, not a swing. */
  vibratoReach: 150,
  /** One frame over this many cents from both its neighbours is the detector slipping, and is dropped. */
  slip: 900,
  /**
   * A pitch that moves faster than a voice does is not a held pitch, and is not listened to. Not in
   * the design. Without it the click's kick drum, whose pitch falls through the detector's range, was
   * "a voice" for 0.08 s on every strong beat: under quick notes a silent run was heard during 4 notes
   * in 18 and saved as a run with nothing right, instead of "could not hear you".
   *
   * Measured at 44.1 kHz, from one frame to the next (11.6 ms): the kick falls 46 to 276 cents; the
   * singer moves at most 12, with a vibrato of 80 cents at 7 a second 42, of 100 cents 56. The line
   * between them was drawn at 60 cents a frame. This is that measurement, kept as the number the rule
   * comes from; nothing reads it frame by frame any more ...
   */
  steadyStep: STEADY_STEP,
  /**
   * ... because it is this many cents a second (5168), and that is the rule: a frame may lie this far
   * from the one before it for every second between the two. As a number of cents a frame it meant
   * something else at every sample rate. At 16 kHz a frame is 32 ms, and a vibrato of 80 cents at 6 a
   * second moves 91 cents in that time: more than half of its frames were thrown away and the short
   * notes of an echo were lost (Coach accuracy 0.84; 0.89 at 24 kHz). And where frames are shorter
   * than at 44.1 kHz a drum falls less from one to the next, and passed.
   *
   * What this cannot mend: at 16 kHz the detector's window is 128 ms long, most of one swing of a
   * vibrato, and what it reports of a low voice (A2) swinging 80 cents is blurred. Such a singer comes
   * to 0.71 there, and to a clean round from 24 kHz up on the echo and on quarter notes.
   *
   * And what it costs: that window also smears the step from one note to the next into a glide, which
   * is slower than a vibrato, so no pace can tell the two apart. A singer steadily 60 cents off passes
   * through the band on the way, and on eighth notes at 16 kHz that makes 4 notes in 18 good (it was 1
   * or 2 at 60 cents a frame): Coach accuracy 0.18, far from a pass. From 24 kHz up it is none.
   */
  steadyRate: STEADY_STEP * STEADY_STEP_FRAMES_A_SECOND,
  /** A note under this long is a quick note: a hit needs `shortInTune` seconds in tune, whatever the share. */
  shortNote: 0.25,
  shortInTune: 0.08,
  /** Perfect: this share of the note in tune, and a median error within `max(perfectFloor, perfectOfBand x band)` cents. */
  perfectShare: 0.8,
  perfectFloor: 25,
  perfectOfBand: 0.6,
  /** Voiced for less than this share of its judged length, a note was not heard (which is not the same as sung off the note). */
  silentShare: 0.25,
  /** The app's own cue and its tail: nothing heard from this long before a cue to this long after it is credited. */
  cueBefore: 0.05,
  cueAfter: 0.3,
  /**
   * The cue is coming back through the microphone when this long of it is heard within `ownSoundCents`
   * (any octave), beginning no later than `ownSoundOnset` after the cue began and with nothing on that
   * pitch in the `ownSoundQuiet` before it. A speaker is on time; a person humming along starts later,
   * and one who was already singing did not start with the cue.
   */
  ownSound: 0.15,
  ownSoundCents: 60,
  ownSoundOnset: 0.15,
  ownSoundQuiet: 0.25,
  /** With sustain on, a long note let go more than this before its written end is good at most. */
  sustainGap: 0.25,
  /**
   * A note is settled this long after the last moment anything could still count for it, or later
   * where frames are long (see `settleWait`). The frames of that moment are still on their way then:
   * the pitch of a frame lies half a window before its stamp, a frame that may be a slip waits for the
   * next one, and the clock runs ahead of the frames it is handed by up to `settleLead`. At 44.1 kHz
   * that is 23 + 12 + 65 ms, this tenth of a second. At 16 kHz it is 64 + 32 + 65 ms: with a tenth of
   * a second there and the clock 50 ms ahead, the last late frame of a note arrived after its verdict.
   */
  settleAfter: 0.1,
  settleLead: 0.065,
  /**
   * A slide up to a note: this long, within `slideWithin` of the note's start, more than `slideCents`
   * under it. What is still the note before, held over for no longer than `late`, does not count: that
   * is a singer who is late, and on a rising line it would otherwise read as a slide into every note.
   */
  slideCents: 100,
  slideWithin: 0.2,
  slideSeconds: 0.06,
  /** "The key sits too high" looks at the notes within this many semitones of the top of the piece. */
  topSemitones: 3,
  /** A good is worth what the Coach counts it as, so the best run on the song page is the one the Coach ranks first. */
  perfectPoints: 100,
  goodPoints: 80,
} as const

/** Seconds from the pitch a frame reports to the frame's time stamp. */
export function windowCentre(sampleRate: number): number {
  return VOICE.windowCentreSamples / sampleRate
}

/** Seconds from one detector frame to the next: 11.6 ms at 44.1 kHz, 32 ms at 16 kHz. */
export function frameSeconds(sampleRate: number): number {
  return VOICE.hopSamples / sampleRate
}

/**
 * Real seconds from the last moment anything could count for a note to its verdict: long enough for
 * the frames of that moment to have arrived, at this sample rate (see `VOICE.settleAfter`).
 */
export function settleWait(sampleRate: number): number {
  return Math.max(VOICE.settleAfter, windowCentre(sampleRate) + frameSeconds(sampleRate) + VOICE.settleLead)
}

/** The windows of one note, in song time. */
export interface NoteWindows {
  /** The part of the note that has to be sung: its length without the way in and the way out. */
  judged: number
  onsetSkip: number
  /** How long before its start, and after its end, a frame can still count for the note. */
  early: number
  late: number
  /** The most that frames outside the note's own span can add, in seconds. */
  outside: number
  /** Seconds in tune that make the note a hit. */
  need: number
}

/** `duration` is the note's length in song time; `speed` turns the real-time constants into song time. */
export function noteWindows(duration: number, judge: VoiceJudge, speed = 1): NoteWindows {
  const onsetSkip = Math.min(VOICE.onsetSkip * speed, VOICE.onsetShare * duration)
  const release = Math.min(VOICE.release * speed, VOICE.releaseShare * duration)
  const judged = Math.max(VOICE.minJudged * speed, duration - onsetSkip - release)
  const outside = Math.min(VOICE.late * speed, VOICE.outsideShare * judged)
  const quick = duration < VOICE.shortNote * speed
  return { judged, onsetSkip, early: VOICE.early * speed, late: outside, outside, need: Math.max(judge.minShare * judged, quick ? VOICE.shortInTune * speed : 0) }
}

/**
 * How close the median has to be for a perfect. It follows the band, so that a singer comfortably
 * inside it can earn a clean round at every level: the Coach counts a good as 0.8 and asks for 0.85.
 */
export function perfectCents(judge: VoiceJudge): number {
  return judge.perfectCents ?? Math.max(VOICE.perfectFloor, VOICE.perfectOfBand * judge.band)
}

/** Points of a run: no multiplier and no streak bonus, so more notes in tune always means more points. */
export function voiceScore(perfects: number, goods: number): number {
  return perfects * VOICE.perfectPoints + goods * VOICE.goodPoints
}

/**
 * What the pitch detector is set to for a sung chart: an octave and a tone either side of the lanes
 * (a low voice sings a high tune an octave down, and may be flat on top of that), inside what a voice
 * can do. The narrow range is what keeps the detector off the click and off octave errors.
 *
 * The lanes are where the app's own notes are, at `VOICE.a4`. The second argument is from before that
 * was settled and is best left out: handing over the guitar's reference pitch moves the range away
 * from the notes by up to 40 cents.
 */
export function voiceDetector(voice: Pick<VoiceChart, 'low' | 'high'>, a4: number = VOICE.a4): { minFreq: number; maxFreq: number; threshold: number } {
  return { minFreq: Math.max(60, midiToFreq(voice.low - 14, a4)), maxFreq: Math.min(1200, midiToFreq(voice.high + 14, a4)), threshold: 0.9 }
}
