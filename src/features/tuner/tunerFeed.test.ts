import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_MS, createTunerFeed, type TunerReading } from "./tunerFeed";
import { holdInTune, recordReading, type HoldSample } from "./tuningGuide";

const clear = { freq: 110, clarity: 0.99, rms: 0.05 };
const silence = { freq: 0, clarity: 0, rms: 0.0001 };

function listen() {
  const readings: TunerReading[] = [];
  const levels: number[] = [];
  const feed = createTunerFeed({
    a4: 440,
    clarityThreshold: 0.9,
    onReading: (r) => readings.push(r),
    onLevel: (l) => levels.push(l),
    now: () => Date.now(),
  });
  return { feed, readings, levels, last: () => readings[readings.length - 1] };
}

describe("tuner feed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns a clear frame into a reading", () => {
    const { feed, last } = listen();
    feed.frame(clear);
    expect(last()).toMatchObject({
      name: "A",
      octave: 2,
      midi: 45,
      stale: false,
      at: 10_000,
    });
    expect(last().cents).toBeCloseTo(0);
  });

  it("the reading goes stale when frames simply stop arriving", () => {
    const { feed, last } = listen();
    feed.frame(clear);
    vi.advanceTimersByTime(STALE_MS - 1);
    expect(last().stale).toBe(false);
    vi.advanceTimersByTime(2);
    expect(last().stale).toBe(true);
    expect(last().name).toBe("A");
  });

  it("the reading goes stale at once when listening stops, and the level drops to zero", () => {
    const { feed, last, levels } = listen();
    feed.frame(clear);
    vi.advanceTimersByTime(100);
    feed.stop();
    expect(last().stale).toBe(true);
    expect(levels[levels.length - 1]).toBe(0);
    // Nothing more is reported after stopping.
    const count = levels.length;
    vi.advanceTimersByTime(5000);
    feed.frame(clear);
    expect(levels).toHaveLength(count);
    expect(last().stale).toBe(true);
  });

  it("a string that keeps ringing stays live, and silence after it goes stale on time", () => {
    const { feed, last } = listen();
    for (let i = 0; i < 40; i++) {
      feed.frame(clear);
      vi.advanceTimersByTime(40);
    }
    expect(last().stale).toBe(false);
    for (let i = 0; i < 20; i++) {
      feed.frame(silence);
      vi.advanceTimersByTime(40);
    }
    expect(last().stale).toBe(true);
  });

  it("each reading carries the time it was heard, so a repeat can be told from a new one", () => {
    const { feed, readings } = listen();
    feed.frame(clear);
    vi.advanceTimersByTime(50);
    feed.frame(clear);
    expect(readings.map((r) => r.at)).toEqual([10_000, 10_050]);
  });
});

/**
 * The guided tune-up as it runs: the detector sends a frame about every 11 ms while `sounding(ms)`
 * says the string rings, and ten times a second the screen looks at the latest reading and asks
 * whether the string has been held in tune. Returns when the string was ticked, or null.
 */
function tuneUp(sounding: (ms: number) => boolean, totalMs = 4000): number | null {
  let latest: TunerReading | null = null;
  const feed = createTunerFeed({
    a4: 440,
    clarityThreshold: 0.9,
    onReading: (r) => (latest = r),
    onLevel: () => {},
    now: () => Date.now(),
  });
  const history: HoldSample[] = [];
  const began = Date.now();
  for (let ms = 0; ms <= totalMs; ms += 1) {
    if (ms % 11 === 0 && sounding(ms)) feed.frame(clear);
    if (ms % 100 === 0) {
      const cur = latest as TunerReading | null;
      if (cur && !cur.stale) {
        recordReading(history, { at: cur.at, cents: (cur.midiFloat - 45) * 100 });
        if (holdInTune(history, Date.now())) return Date.now() - began;
      }
    }
    vi.advanceTimersByTime(1);
  }
  return null;
}

describe("feed and hold together", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a string left ringing in tune is ticked after about a second and a half", () => {
    const at = tuneUp(() => true);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(1200);
    expect(at!).toBeLessThanOrEqual(1700);
  });

  it("a string whose sound breaks up for a moment is still ticked", () => {
    // A fifth of a second without a clear pitch, every second.
    expect(tuneUp((ms) => ms % 1000 < 800)).not.toBeNull();
  });

  it("frames that stop while the string was in tune never tick it", () => {
    expect(tuneUp((ms) => ms < 600)).toBeNull();
  });

  it("short plucks with silence between them never tick it", () => {
    expect(tuneUp((ms) => ms % 1000 < 300)).toBeNull();
  });
});
