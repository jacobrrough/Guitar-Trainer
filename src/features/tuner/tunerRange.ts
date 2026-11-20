import { midiToFreq } from "../../music/pitch";
import { DEFAULT_TUNING, TUNINGS, type Tuning } from "../../music/tunings";

/**
 * The lowest pitch the detector can follow. It looks at 2048 samples at a time and needs the wave to
 * repeat within four fifths of that, which at a phone's 48,000 samples a second is 29.3 Hz.
 */
export const DETECTOR_FLOOR_HZ = 30;
/** The detector's usual lower limit; a tuning never raises it. */
const USUAL_MIN_HZ = 55;
/** A string is listened for down to this fraction of its note: about six semitones flat. */
const FLAT_ROOM = 0.7;
/** A tuning is only offered if its lowest string would still be heard this many semitones flat. */
const MIN_FLAT_SEMITONES = 3;

/**
 * Lower limit (Hz) to give the pitch detector for a tuning, so its lowest string is heard even when
 * it is well flat. The usual limit of 55 Hz sits above a bass's low E (41 Hz) and too close under
 * the low string of dropped guitar tunings.
 */
export function tunerMinFreq(strings: number[], a4 = 440): number {
  const lowest = midiToFreq(Math.min(...strings), a4);
  return Math.max(DETECTOR_FLOOR_HZ, Math.min(USUAL_MIN_HZ, lowest * FLAT_ROOM));
}

function canFollow(tuning: Tuning): boolean {
  const lowest = midiToFreq(Math.min(...tuning.strings));
  return lowest * 2 ** (-MIN_FLAT_SEMITONES / 12) >= DETECTOR_FLOOR_HZ;
}

/**
 * The tunings the tuner offers. A 5-string bass is left out: its low B (31 Hz) sits at the very
 * bottom of what the detector can follow, so a B string that had gone flat would never register.
 */
export const TUNER_TUNINGS: Tuning[] = TUNINGS.filter(canFollow);

/** The tuner's tuning for a saved id; one the tuner does not offer falls back to standard. */
export function tunerTuning(id: string): Tuning {
  return TUNER_TUNINGS.find((t) => t.id === id) ?? DEFAULT_TUNING;
}
