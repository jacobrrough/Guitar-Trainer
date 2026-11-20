import { describe, expect, it } from "vitest";
import {
  canGoBack,
  describeString,
  holdInTune,
  ordinal,
  otherStringHeard,
  recordReading,
  stringLabel,
  STRING_MNEMONIC,
  targetVerdict,
  tunerView,
  verdictFor,
  WRONG_PEG_HINT,
} from "./tuningGuide";

describe("tuningGuide", () => {
  it("ordinals", () => {
    expect([1, 2, 3, 4, 5, 6, 11, 12, 13, 21].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "5th",
      "6th",
      "11th",
      "12th",
      "13th",
      "21st",
    ]);
  });
  it("string labels", () => {
    expect(stringLabel(0, 6, "E")).toBe("6 · E thickest");
    expect(stringLabel(1, 6, "A")).toBe("5 · A");
    expect(stringLabel(5, 6, "E")).toBe("1 · E thinnest");
  });
  it("mnemonic has six words", () => {
    expect(STRING_MNEMONIC.split(/\s+/)).toHaveLength(6);
  });
  it("verdicts", () => {
    expect(verdictFor(null, false).tone).toBe("idle");
    expect(verdictFor(-30, false)).toEqual({
      text: "Too low: tighten the peg a little",
      tone: "low",
    });
    expect(verdictFor(30, false).text).toBe("Too high: loosen it a little");
    expect(verdictFor(10, false).text).toBe("Nearly there");
    expect(verdictFor(-3, false)).toEqual({ text: "In tune", tone: "ok" });
    const w = verdictFor(200, true);
    expect(w.tone).toBe("wrong-string");
    expect(w.text).toContain("different string");
  });
  it("holdInTune", () => {
    const steady = Array.from({ length: 60 }, (_, i) => ({
      at: i * 33,
      cents: 4,
    }));
    expect(holdInTune(steady, 1980)).toBe(true);
    expect(holdInTune(steady.slice(30), 1980)).toBe(false); // only ~1s of data
    const wobble = steady.map((h, i) => (i === 40 ? { ...h, cents: 20 } : h));
    expect(holdInTune(wobble, 1980)).toBe(false);
    expect(holdInTune(steady, 4000)).toBe(false); // readings stopped
    expect(holdInTune([], 1000)).toBe(false);
  });
});

const STD = [40, 45, 50, 55, 59, 64];
const OFFSETS = [-5, -3, -2, -1, 1, 2, 3, 5];

/** What the guided tuner (or a string picked by hand) says for string `target` when it is `semitones` out. */
function chosen(target: number, semitones: number, strings = STD) {
  const heard = strings[target] + semitones;
  return targetVerdict(
    heard,
    strings,
    target,
    otherStringHeard(heard, strings, target),
  );
}

describe("a chosen string that is far out", () => {
  it("names strings the way a beginner counts them", () => {
    expect(describeString(STD, 0)).toBe("the thickest string (E)");
    expect(describeString(STD, 1)).toBe("the 5th string (A)");
    expect(describeString(STD, 5)).toBe("the thinnest string (E)");
    // The ukulele's first string is not its thickest.
    expect(describeString([67, 60, 64, 69], 0)).toBe("the 4th string (G)");
  });

  it("thickest string two semitones flat: keep tightening, not 'a different string'", () => {
    const v = chosen(0, -2);
    expect(v.tone).toBe("low");
    expect(v.text).toBe("Much too low: keep tightening the peg");
  });

  it("thickest string 1, 2, 3 and 5 semitones flat always says which way to turn", () => {
    expect(chosen(0, -1)).toEqual({
      text: "Too low: keep tightening the peg",
      tone: "low",
    });
    // A long way to tighten: warn about the classic way to break a string.
    for (const s of [-2, -3, -5])
      expect(chosen(0, s)).toEqual({
        text: "Much too low: keep tightening the peg",
        tone: "low",
        detail: WRONG_PEG_HINT,
      });
  });

  it("thinnest string 1, 2, 3 and 5 semitones sharp always says which way to turn", () => {
    expect(chosen(5, 1)).toEqual({
      text: "Too high: keep loosening the peg",
      tone: "high",
    });
    for (const s of [2, 3, 5])
      expect(chosen(5, s)).toEqual({
        text: "Much too high: keep loosening the peg",
        tone: "high",
      });
  });

  it("5th string, each case in turn", () => {
    expect(chosen(1, -1).text).toBe("Too low: keep tightening the peg");
    expect(chosen(1, -2)).toEqual({
      text: "Much too low: keep tightening the peg",
      tone: "low",
      detail: WRONG_PEG_HINT,
    });
    // Three flat is nearer the thickest string's note: still a direction, plus a check.
    expect(chosen(1, -3)).toEqual({
      text: "Much too low: keep tightening the peg",
      tone: "low",
      detail: `Make sure you are plucking the 5th string (A). ${WRONG_PEG_HINT}`,
    });
    // Five flat is exactly the thickest string's note: most likely the wrong string, but not a dead end.
    expect(chosen(1, -5)).toEqual({
      text: "That sounds like a different string: pluck the 5th string (A)",
      tone: "wrong-string",
      detail:
        "It sounds like the thickest string (E). If you are already on the 5th string (A), it is much too low: keep tightening its peg.",
    });
    expect(chosen(1, 1).text).toBe("Too high: keep loosening the peg");
    expect(chosen(1, 2)).toEqual({
      text: "Much too high: keep loosening the peg",
      tone: "high",
    });
    expect(chosen(1, 3)).toEqual({
      text: "Much too high: keep loosening the peg",
      tone: "high",
      detail: "Make sure you are plucking the 5th string (A).",
    });
    expect(chosen(1, 5)).toEqual({
      text: "That sounds like a different string: pluck the 5th string (A)",
      tone: "wrong-string",
      detail:
        "It sounds like the 4th string (D). If you are already on the 5th string (A), it is much too high: keep loosening its peg.",
    });
  });

  it("every string, 1 to 5 semitones out: 'different string' only next to another string's note, and the way to turn is always there", () => {
    for (let target = 0; target < STD.length; target++) {
      for (const s of OFFSETS) {
        const heard = STD[target] + s;
        const v = chosen(target, s);
        const turn = s < 0 ? "tightening" : "loosening";
        const nearOther = STD.some(
          (m, i) => i !== target && Math.abs(heard - m) <= 1,
        );
        if (v.tone === "wrong-string") {
          expect(nearOther, `string ${target} ${s}`).toBe(true);
          expect(v.detail, `string ${target} ${s}`).toContain(turn);
        } else {
          expect(v.tone, `string ${target} ${s}`).toBe(s < 0 ? "low" : "high");
          expect(v.text, `string ${target} ${s}`).toContain(turn);
        }
      }
    }
  });

  it("a guitar that is two semitones flat all over never hears 'a different string'", () => {
    for (let target = 0; target < STD.length; target++)
      expect(chosen(target, -2).tone, `string ${target}`).toBe("low");
  });

  it("the wrong string, plucked in tune, is called out", () => {
    // Asked for the 5th string, plucked the thickest.
    expect(otherStringHeard(40.1, STD, 1)).toBe(0);
    // Close to the target is never another string, whatever else is near.
    expect(otherStringHeard(45.4, STD, 1)).toBeNull();
  });

  it("small errors read as before", () => {
    expect(chosen(2, 0).text).toBe("In tune");
    expect(targetVerdict(50.1, STD, 2, null).text).toBe("Nearly there");
    expect(targetVerdict(49.7, STD, 2, null).text).toBe(
      "Too low: tighten the peg a little",
    );
    expect(targetVerdict(null, STD, 2, null).tone).toBe("idle");
  });
});

describe("auto tuner: a string that is far out", () => {
  const auto = (string: number, semitones: number) =>
    tunerView(STD[string] + semitones, "auto", STD);

  it("5th string a whole tone flat is not 'In tune'", () => {
    const v = auto(1, -2); // G2
    expect(v.inTune).toBe(false);
    expect(v.verdict.tone).toBe("low");
    expect(v.stringIndex).toBe(1);
    expect(v.label).toBe("A");
    expect(v.cents).toBeCloseTo(-200);
    expect(v.verdict).toEqual({
      text: "Too low for the 5th string (A)",
      tone: "low",
      detail:
        "If that is the string you are tuning, keep tightening its peg. If not, tap your string below.",
    });
  });

  it("tightening a string up through every semitone shows green only on an open string's note", () => {
    for (let midi = 34; midi <= 70; midi++) {
      const v = tunerView(midi, "auto", STD);
      const open = STD.includes(midi);
      expect(v.inTune, `midi ${midi}`).toBe(open);
      expect(v.verdict.tone === "ok", `midi ${midi}`).toBe(open);
    }
  });

  it("one semitone out: the nearest string is the right one, with the way to turn", () => {
    for (let string = 0; string < STD.length; string++) {
      const flat = auto(string, -1);
      expect(flat.stringIndex).toBe(string);
      expect(flat.verdict).toEqual({
        text: "Too low: keep tightening the peg",
        tone: "low",
      });
      const sharp = auto(string, 1);
      expect(sharp.stringIndex).toBe(string);
      expect(sharp.verdict).toEqual({
        text: "Too high: keep loosening the peg",
        tone: "high",
      });
    }
  });

  it("two semitones out: names the string it is comparing with, and how to pick another", () => {
    expect(auto(0, -2).verdict.text).toBe("Too low for the thickest string (E)");
    expect(auto(0, 2).verdict.text).toBe("Too high for the thickest string (E)");
    expect(auto(2, -2).verdict.text).toBe("Too low for the 4th string (D)");
    expect(auto(5, 2).verdict.text).toBe("Too high for the thinnest string (E)");
    expect(auto(5, 2).verdict.detail).toBe(
      "If that is the string you are tuning, keep loosening its peg. If not, tap your string below.",
    );
  });

  it("three semitones out: the note is nearer the next string, and the words say which string is meant", () => {
    const v = auto(1, -3); // F#2: two above the thickest string, three below the 5th
    expect(v.stringIndex).toBe(0);
    expect(v.inTune).toBe(false);
    expect(v.verdict.text).toBe("Too high for the thickest string (E)");
    expect(v.verdict.detail).toContain("tap your string below");
  });

  it("five semitones out: lands on the next string's note, and says which string is in tune", () => {
    const v = auto(1, -5); // the 5th string sounding E2
    expect(v.stringIndex).toBe(0);
    expect(v.verdict).toEqual({
      text: "In tune: the thickest string (E)",
      tone: "ok",
    });
    // Below the thickest string there is no other string to mistake it for.
    expect(auto(0, -5).verdict.text).toBe("Too low for the thickest string (E)");
    expect(auto(5, 5).verdict.text).toBe("Too high for the thinnest string (E)");
  });

  it("a string picked by hand uses the same advice as the guided tune-up", () => {
    expect(tunerView(38, 0, STD).verdict).toEqual(chosen(0, -2));
    expect(tunerView(40, 1, STD).verdict).toEqual(chosen(1, -5));
    expect(tunerView(40, 1, STD).inTune).toBe(false);
    // A string index left over from a tuning with more strings falls back to auto.
    expect(tunerView(40, 9, STD).stringIndex).toBe(0);
  });

  it("chromatic mode still shows any note in tune", () => {
    const v = tunerView(43.02, "chromatic", STD);
    expect(v.label).toBe("G");
    expect(v.octave).toBe(2);
    expect(v.stringIndex).toBeNull();
    expect(v.inTune).toBe(true);
    expect(v.verdict.text).toBe("In tune");
  });
});

describe("holding a string in tune", () => {
  it("a reading is recorded once, however often it is looked at", () => {
    const history: Array<{ at: number; cents: number }> = [];
    expect(recordReading(history, { at: 100, cents: 2 })).toBe(true);
    expect(recordReading(history, { at: 100, cents: 2 })).toBe(false);
    expect(recordReading(history, { at: 133, cents: 3 })).toBe(true);
    expect(history).toHaveLength(2);
  });

  it("a pitch that stopped arriving cannot finish the hold", () => {
    const history: Array<{ at: number; cents: number }> = [];
    // In tune for half a second, then the audio stops and the last value stays on screen.
    for (let at = 0; at <= 500; at += 100)
      recordReading(history, { at, cents: 3 });
    const frozen = { at: 500, cents: 3 };
    for (let now = 600; now <= 3000; now += 100) {
      recordReading(history, frozen);
      expect(holdInTune(history, now), `at ${now}`).toBe(false);
    }
  });

  it("two short blips far apart are not a hold", () => {
    const history = [
      { at: 200, cents: 1 },
      { at: 1400, cents: 1 },
    ];
    expect(holdInTune(history, 1500)).toBe(false);
  });

  it("leaving this page goes back where the learner came from, or home", () => {
    expect(canGoBack("default")).toBe(false);
    expect(canGoBack("k3x9")).toBe(true);
  });
});
