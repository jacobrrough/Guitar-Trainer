import { useEffect, useState } from "react";
import { audioEngine } from "../../audio/AudioEngine";
import { createTunerFeed, type TunerReading } from "./tunerFeed";

export type { TunerReading } from "./tunerFeed";

/** Smoothed pitch reading from the shared audio engine; `null` until something is heard. */
export function useTuner(
  active: boolean,
  a4: number,
  clarityThreshold: number,
): { reading: TunerReading | null; level: number } {
  const [reading, setReading] = useState<TunerReading | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) return;
    const feed = createTunerFeed({
      a4,
      clarityThreshold,
      onReading: setReading,
      onLevel: setLevel,
    });
    const unsubscribe = audioEngine.subscribe(feed.frame);
    return () => {
      unsubscribe();
      // Fades the last reading at once, so nothing looks live after the microphone has stopped.
      feed.stop();
    };
  }, [active, a4, clarityThreshold]);

  return { reading, level };
}
