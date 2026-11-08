import { describe, expect, it } from "vitest";
import {
  holdInTune,
  ordinal,
  stringLabel,
  STRING_MNEMONIC,
  verdictFor,
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
