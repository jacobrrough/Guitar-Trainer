import { describe, expect, it } from "vitest";
import { FrameAnalyzer } from "../../audio/pitch/frameAnalyzer";
import { midiToFreq } from "../../music/pitch";
import { TUNINGS } from "../../music/tunings";
import {
  DETECTOR_FLOOR_HZ,
  TUNER_TUNINGS,
  tunerMinFreq,
  tunerTuning,
} from "./tunerRange";

/** A plucked low string: weak fundamental, strong overtones, dying away. */
function pluck(sampleRate: number, f0: number, seconds = 0.8): Float32Array {
  const out = new Float32Array(Math.floor(sampleRate * seconds));
  const amps = [0.15, 1, 0.8, 0.5, 0.35, 0.25];
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    let v = 0;
    amps.forEach((a, k) => {
      const n = k + 1;
      v += a * Math.exp(-t * (0.8 + 0.5 * n)) * Math.sin(2 * Math.PI * f0 * n * t + n);
    });
    out[i] = 0.08 * v;
  }
  return out;
}

/** Cents off for every frame the tuner would accept, through the detector exactly as the app builds it. */
function heard(sampleRate: number, f0: number, minFreq: number): number[] {
  const analyzer = new FrameAnalyzer(sampleRate, {
    windowSize: 2048,
    hop: 512,
    minFreq,
    maxFreq: 1500,
    threshold: 0.93,
  });
  const signal = pluck(sampleRate, f0);
  const cents: number[] = [];
  for (let i = 0; i + 128 <= signal.length; i += 128) {
    const frame = analyzer.push(signal.subarray(i, i + 128));
    if (frame && frame.freq > 0 && frame.clarity >= 0.9 && frame.rms > 0.003)
      cents.push(1200 * Math.log2(frame.freq / f0));
  }
  return cents.sort((a, b) => a - b);
}

const lowest = (strings: number[]) => midiToFreq(Math.min(...strings));
const flat = (freq: number, semitones: number) => freq * 2 ** (-semitones / 12);

describe("tuner range", () => {
  it("bass standard is offered and the 5-string bass is not", () => {
    const ids = TUNER_TUNINGS.map((t) => t.id);
    expect(ids).toContain("standard");
    expect(ids).toContain("bass-standard");
    expect(ids).toContain("7-string");
    expect(ids).toContain("ukulele");
    expect(ids).not.toContain("bass-5");
  });

  it("a saved tuning the tuner no longer offers falls back to standard", () => {
    expect(tunerTuning("bass-5").id).toBe("standard");
    expect(tunerTuning("bass-standard").id).toBe("bass-standard");
    expect(tunerTuning("nope").id).toBe("standard");
  });

  it("standard guitar keeps the detector's usual range; lower tunings reach lower", () => {
    expect(tunerMinFreq([40, 45, 50, 55, 59, 64])).toBe(55);
    expect(tunerMinFreq([67, 60, 64, 69])).toBe(55);
    expect(tunerMinFreq([36, 43, 48, 53, 57, 62])).toBeCloseTo(45.8, 1);
    expect(tunerMinFreq([28, 33, 38, 43])).toBe(DETECTOR_FLOOR_HZ);
    // A different reference pitch moves the strings, and the range with them.
    expect(tunerMinFreq([36, 43, 48, 53, 57, 62], 432)).toBeLessThan(45.8);
  });

  it("every tuning on offer is heard on its lowest string: in tune, and three semitones flat", () => {
    for (const tuning of TUNER_TUNINGS) {
      const min = tunerMinFreq(tuning.strings);
      for (const sampleRate of [44100, 48000]) {
        for (const semitones of [0, 3]) {
          const cents = heard(sampleRate, flat(lowest(tuning.strings), semitones), min);
          const label = `${tuning.id} at ${sampleRate} Hz, ${semitones} flat`;
          expect(cents.length, label).toBeGreaterThan(20);
          expect(Math.abs(cents[cents.length >> 1]), label).toBeLessThan(3);
        }
      }
    }
  });

  it("reaching lower does not upset the other strings: every string of every tuning reads true", () => {
    for (const tuning of TUNER_TUNINGS) {
      const min = tunerMinFreq(tuning.strings);
      for (const midi of tuning.strings) {
        const cents = heard(48000, midiToFreq(midi), min);
        const label = `${tuning.id}, string at note ${midi}`;
        expect(cents.length, label).toBeGreaterThan(20);
        // No frame an octave out, and the middle of the readings on the note.
        expect(Math.abs(cents[0]), label).toBeLessThan(50);
        expect(Math.abs(cents[cents.length - 1]), label).toBeLessThan(50);
        expect(Math.abs(cents[cents.length >> 1]), label).toBeLessThan(3);
      }
    }
  });

  it("a tuning left out could not be followed once its lowest string goes flat", () => {
    const dropped = TUNINGS.filter((t) => !TUNER_TUNINGS.includes(t));
    expect(dropped.length).toBeGreaterThan(0);
    for (const tuning of dropped) {
      const cents = heard(48000, flat(lowest(tuning.strings), 3), DETECTOR_FLOOR_HZ / 2);
      expect(cents, tuning.id).toHaveLength(0);
    }
  });
});
