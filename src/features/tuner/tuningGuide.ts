import { midiToName } from "../../music/pitch";

export type VerdictTone =
  | "idle"
  | "low"
  | "high"
  | "near"
  | "ok"
  | "wrong-string";

export interface Verdict {
  text: string;
  tone: VerdictTone;
  /** A second, smaller line: what to do when the first line may not fit. */
  detail?: string;
}

/** Standard-tuning mnemonic, thickest string first. */
export const STRING_MNEMONIC = "Eddie Ate Dynamite, Good Bye Eddie";
export const MNEMONIC_WORDS = [
  "Eddie",
  "Ate",
  "Dynamite",
  "Good",
  "Bye",
  "Eddie",
];

/** Within this many cents the string counts as in tune on the gauge. */
export const IN_TUNE_CENTS = 5;
/** Within this many cents it is "nearly there". */
export const NEAR_CENTS = 15;
/** The gauge ends here. Past it the needle sits at its stop, so the words say "keep going". */
export const GAUGE_CENTS = 50;
/** More than a semitone and a half out: "much too low". */
export const FAR_CENTS = 150;
/**
 * A pitch this close to another open string's note, and closer to it than to the string being tuned,
 * is taken for that other string. Neighbouring strings are 400 to 500 cents apart, so a string that is
 * one, two or three semitones out is still told which way to turn.
 */
export const OTHER_STRING_CENTS = 100;
/**
 * Said with "much too low". Tightening a long way is how strings get broken, most often by turning
 * the peg of a string other than the one being plucked.
 */
export const WRONG_PEG_HINT =
  "If the sound does not rise as you turn, stop: you may be turning another string's peg.";
/** In auto mode the nearest string is trusted this far; further out the words name the string they mean. */
export const AUTO_SURE_CENTS = 100;

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "6 · E thickest", "5 · A", "1 · E thinnest". `index` 0 is the thickest string. */
export function stringLabel(
  index: number,
  total: number,
  name: string,
): string {
  const n = total - index;
  const suffix =
    index === 0 ? " thickest" : index === total - 1 ? " thinnest" : "";
  return `${n} · ${name}${suffix}`;
}

/**
 * "the thickest string (E)", "the 5th string (A)", "the thinnest string (E)". Thickest and thinnest
 * are only used when the strings run low to high (a ukulele's first string is not its thickest).
 */
export function describeString(strings: number[], index: number): string {
  const ordered = strings.every((m, i) => i === 0 || m > strings[i - 1]);
  const which =
    ordered && index === 0
      ? "thickest"
      : ordered && index === strings.length - 1
        ? "thinnest"
        : ordinal(strings.length - index);
  return `the ${which} string (${midiToName(strings[index], false)})`;
}

/**
 * Plain-language one-liner for a pitch `cents` away from its target. `otherString` (the caller has
 * decided the pitch belongs to a different string) swaps it for the wrong-string message, which
 * `stringHint` completes.
 */
export function verdictFor(
  cents: number | null,
  otherString = false,
  stringHint = "the thickest one",
): Verdict {
  if (cents === null)
    return { text: "Pluck the string and let it ring", tone: "idle" };
  if (otherString)
    return {
      text: `That sounds like a different string: pluck ${stringHint}`,
      tone: "wrong-string",
    };
  const abs = Math.abs(cents);
  if (abs <= IN_TUNE_CENTS) return { text: "In tune", tone: "ok" };
  if (abs <= NEAR_CENTS) return { text: "Nearly there", tone: "near" };
  const low = cents < 0;
  const tone = low ? "low" : "high";
  if (abs <= GAUGE_CENTS)
    return {
      text: low
        ? "Too low: tighten the peg a little"
        : "Too high: loosen it a little",
      tone,
    };
  const keep = low ? "keep tightening the peg" : "keep loosening the peg";
  const much = abs > FAR_CENTS ? "Much too" : "Too";
  return { text: `${much} ${low ? "low" : "high"}: ${keep}`, tone };
}

/** The open string whose note is nearest the heard pitch (a tie goes to the earlier string). */
export function nearestString(heard: number, strings: number[]): number {
  let best = 0;
  for (let i = 1; i < strings.length; i++) {
    if (Math.abs(strings[i] - heard) < Math.abs(strings[best] - heard))
      best = i;
  }
  return best;
}

/**
 * The different open string the heard pitch (a fractional MIDI number) belongs to, or null when it
 * is better explained as string `target` out of tune.
 */
export function otherStringHeard(
  heard: number,
  strings: number[],
  target: number,
): number | null {
  const own = Math.abs(heard - strings[target]) * 100;
  let other: number | null = null;
  let dist = Infinity;
  strings.forEach((midi, i) => {
    if (i === target || midi === strings[target]) return;
    const d = Math.abs(heard - midi) * 100;
    if (d < dist) {
      dist = d;
      other = i;
    }
  });
  return dist <= OTHER_STRING_CENTS && dist < own ? other : null;
}

/**
 * What to tell someone tuning string `target` (the guided tune-up, or a string picked by hand).
 * `other` is the string the pitch was taken for (`otherStringHeard`), or null. Even then the advice
 * is not a dead end: the second line says which way to turn if they are on the right string after all.
 */
export function targetVerdict(
  heard: number | null,
  strings: number[],
  target: number,
  other: number | null,
): Verdict {
  if (heard === null) return verdictFor(null);
  const cents = (heard - strings[target]) * 100;
  const wanted = describeString(strings, target);
  if (other !== null) {
    const turn =
      cents < 0
        ? "much too low: keep tightening its peg"
        : "much too high: keep loosening its peg";
    return {
      ...verdictFor(cents, true, wanted),
      detail: `It sounds like ${describeString(strings, other)}. If you are already on ${wanted}, it is ${turn}.`,
    };
  }
  const verdict = verdictFor(cents);
  if (Math.abs(cents) <= FAR_CENTS) return verdict;
  const hints: string[] = [];
  // Nearer another string's note: the direction is right for this string, so say which one is meant.
  if (nearestString(heard, strings) !== target)
    hints.push(`Make sure you are plucking ${wanted}.`);
  if (cents < 0) hints.push(WRONG_PEG_HINT);
  return hints.length ? { ...verdict, detail: hints.join(" ") } : verdict;
}

export type TunerMode = "auto" | "chromatic" | number;

export interface TunerView {
  /** The big note letter. */
  label: string;
  octave: number;
  /** Cents from the note being tuned to. */
  cents: number;
  /** The open string being tuned, or null in chromatic mode. */
  stringIndex: number | null;
  /** MIDI number of the note being tuned to. */
  targetMidi: number;
  verdict: Verdict;
  inTune: boolean;
}

/**
 * What the tuner page shows for a heard pitch (a fractional MIDI number). Auto mode always tunes to
 * the nearest open string: a note between two strings is never "in tune", it is too low or too high
 * for a string, and the words name that string. Only chromatic mode shows any note as in tune.
 */
export function tunerView(
  heard: number,
  mode: TunerMode,
  strings: number[],
): TunerView {
  if (mode === "chromatic") {
    const midi = Math.round(heard);
    const cents = (heard - midi) * 100;
    return {
      label: midiToName(midi, false),
      octave: Math.floor(midi / 12) - 1,
      cents,
      stringIndex: null,
      targetMidi: midi,
      verdict: verdictFor(cents),
      inTune: Math.abs(cents) <= IN_TUNE_CENTS,
    };
  }
  // A string picked under another tuning may not exist in this one.
  const picked = typeof mode === "number" && mode >= 0 && mode < strings.length;
  const stringIndex = picked ? mode : nearestString(heard, strings);
  const midi = strings[stringIndex];
  const cents = (heard - midi) * 100;
  const abs = Math.abs(cents);
  const name = describeString(strings, stringIndex);
  let verdict: Verdict;
  if (picked)
    verdict = targetVerdict(
      heard,
      strings,
      stringIndex,
      otherStringHeard(heard, strings, stringIndex),
    );
  else if (abs <= IN_TUNE_CENTS)
    verdict = { text: `In tune: ${name}`, tone: "ok" };
  else if (abs <= AUTO_SURE_CENTS) verdict = verdictFor(cents);
  else
    verdict = {
      text: `Too ${cents < 0 ? "low" : "high"} for ${name}`,
      tone: cents < 0 ? "low" : "high",
      detail: `If that is the string you are tuning, keep ${cents < 0 ? "tightening" : "loosening"} its peg. If not, tap your string below.`,
    };
  return {
    label: midiToName(midi, false),
    octave: Math.floor(midi / 12) - 1,
    cents,
    stringIndex,
    targetMidi: midi,
    verdict,
    inTune: abs <= IN_TUNE_CENTS,
  };
}

export interface HoldSample {
  /** When the reading was heard. */
  at: number;
  cents: number;
}

/**
 * Adds a reading to the hold history unless it is already there. The screen keeps showing the last
 * reading for a moment after the sound stops; looking at it again must not count as hearing it again.
 */
export function recordReading(
  history: HoldSample[],
  reading: HoldSample,
): boolean {
  const last = history[history.length - 1];
  if (last && reading.at <= last.at) return false;
  history.push(reading);
  if (history.length > 200) history.shift();
  return true;
}

/** True when readings covered the last `windowMs` and every one stayed within `tolerance` cents. */
export function holdInTune(
  history: HoldSample[],
  now: number,
  windowMs = 1500,
  tolerance = 8,
): boolean {
  const start = now - windowMs;
  const recent = history.filter((h) => h.at >= start && h.at <= now);
  if (recent.length < 2) return false;
  // Readings must span (nearly) the whole window and still be arriving.
  if (recent[0].at - start > 300) return false;
  if (now - recent[recent.length - 1].at > 300) return false;
  // The string has to keep sounding: two short blips far apart are not a hold.
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].at - recent[i - 1].at > 400) return false;
  }
  return recent.every((h) => Math.abs(h.cents) <= tolerance);
}

/**
 * Whether the app has a page to go back to. The router gives the first page of a visit the key
 * "default"; someone who opened the tune-up page directly has nothing behind it.
 */
export function canGoBack(locationKey: string): boolean {
  return locationKey !== "default";
}
