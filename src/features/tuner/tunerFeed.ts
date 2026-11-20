import { freqToMidi, midiToName } from "../../music/pitch";

export interface TunerReading {
  freq: number;
  /** Nearest chromatic MIDI note. */
  midi: number;
  /** Fractional MIDI value. */
  midiFloat: number;
  cents: number;
  name: string;
  octave: number;
  clarity: number;
  rms: number;
  /** When the frame behind this reading arrived (the feed's clock). */
  at: number;
  /** True when no clear pitch has been heard for a while; the last reading is shown faded. */
  stale: boolean;
}

export interface FeedFrame {
  freq: number;
  clarity: number;
  rms: number;
}

/** A reading older than this is shown faded and no longer counts as hearing the string. */
export const STALE_MS = 700;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface TunerFeedOptions {
  a4: number;
  clarityThreshold: number;
  onReading: (reading: TunerReading) => void;
  onLevel: (rms: number) => void;
  now?: () => number;
}

/**
 * Turns the detector's frames into smoothed readings. A reading goes stale on a timer of its own,
 * not when the next frame happens to arrive: frames stop altogether when the microphone is closed or
 * the phone interrupts the audio, and the last pitch must not stay on screen as if it were still heard.
 */
export function createTunerFeed(options: TunerFeedOptions): {
  frame: (frame: FeedFrame) => void;
  stop: () => void;
} {
  const { a4, clarityThreshold, onReading, onLevel } = options;
  const now = options.now ?? (() => performance.now());
  const history: number[] = [];
  let lastUpdate = 0;
  let last: TunerReading | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const expire = () => {
    staleTimer = null;
    if (!last || last.stale) return;
    last = { ...last, stale: true };
    onReading(last);
  };

  return {
    frame(frame) {
      if (stopped) return;
      const t = now();
      if (t - lastUpdate < 33) return;
      lastUpdate = t;
      onLevel(frame.rms);
      const valid =
        frame.freq > 0 &&
        frame.clarity >= clarityThreshold &&
        frame.rms > 0.003;
      if (!valid) {
        history.length = 0;
        return;
      }
      history.push(frame.freq);
      if (history.length > 5) history.shift();
      const freq = median(history);
      const midiFloat = freqToMidi(freq, a4);
      const midi = Math.round(midiFloat);
      last = {
        freq,
        midi,
        midiFloat,
        cents: (midiFloat - midi) * 100,
        name: midiToName(midi, false),
        octave: Math.floor(midi / 12) - 1,
        clarity: frame.clarity,
        rms: frame.rms,
        at: t,
        stale: false,
      };
      onReading(last);
      if (staleTimer !== null) clearTimeout(staleTimer);
      staleTimer = setTimeout(expire, STALE_MS);
    },
    /** Listening has ended: fade the last reading now and empty the level meter. */
    stop() {
      if (stopped) return;
      stopped = true;
      if (staleTimer !== null) clearTimeout(staleTimer);
      expire();
      onLevel(0);
    },
  };
}
