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
/** Further than this and the player is probably on the wrong string. */
export const WRONG_STRING_CENTS = 150;

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

/** Plain-language one-liner for the tuner. `stringHint` completes the wrong-string message. */
export function verdictFor(
  cents: number | null,
  farOff: boolean,
  stringHint = "the thickest one",
): Verdict {
  if (cents === null)
    return { text: "Pluck the string and let it ring", tone: "idle" };
  if (farOff)
    return {
      text: `That sounds like a different string: pluck ${stringHint}`,
      tone: "wrong-string",
    };
  const abs = Math.abs(cents);
  if (abs <= IN_TUNE_CENTS) return { text: "In tune", tone: "ok" };
  if (abs <= NEAR_CENTS) return { text: "Nearly there", tone: "near" };
  if (cents < 0)
    return { text: "Too low: tighten the peg a little", tone: "low" };
  return { text: "Too high: loosen it a little", tone: "high" };
}

/** True when readings covered the last `windowMs` and every one stayed within `tolerance` cents. */
export function holdInTune(
  history: Array<{ at: number; cents: number }>,
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
  return recent.every((h) => Math.abs(h.cents) <= tolerance);
}
