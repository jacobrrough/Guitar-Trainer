import { ArrowLeft, Check, Mic } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useSettings } from "../../app/settings";
import { audioEngine } from "../../audio/AudioEngine";
import { Illustration } from "../../components/diagrams";
import { Button, Card, PageHeader, cx } from "../../components/ui";
import { centsOff } from "../../music/pitch";
import { midiToName } from "../../music/pitch";
import { getTuning } from "../../music/tunings";
import { Gauge } from "./TunerGauge";
import {
  MNEMONIC_WORDS,
  STRING_MNEMONIC,
  WRONG_STRING_CENTS,
  holdInTune,
  ordinal,
  verdictFor,
  type VerdictTone,
} from "./tuningGuide";
import { useTuner } from "./useTuner";

const toneClass: Record<VerdictTone, string> = {
  idle: "text-muted",
  low: "text-amber-300",
  high: "text-amber-300",
  near: "text-amber-200",
  ok: "text-ok",
  "wrong-string": "text-bad",
};

const FAR_MS = 1200;
const TICK_MS = 900;

export interface GuidedTunerProps {
  onDone?: () => void;
  onSkip?: () => void;
  /** Begin listening immediately when the microphone is already running. */
  autoStart?: boolean;
}

export function GuidedTuner({ onDone, onSkip, autoStart }: GuidedTunerProps) {
  const settings = useSettings();
  const tuning = getTuning(settings.tunerTuningId);
  const total = tuning.strings.length;
  const [listening, setListening] = useState(
    () => !!autoStart && audioEngine.micActive,
  );
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [ticked, setTicked] = useState(false);
  const [farOff, setFarOff] = useState(false);
  const { reading } = useTuner(
    listening,
    settings.a4,
    settings.clarityThreshold,
  );

  const history = useRef<Array<{ at: number; cents: number }>>([]);
  const farSince = useRef<number | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ cents: number | null }>({ cents: null });

  const finished = step >= total;
  const targetMidi = finished ? 0 : tuning.strings[step];
  const active = !!reading && !reading.stale;
  const cents =
    active && !finished
      ? centsOff(reading.freq, targetMidi, settings.a4)
      : null;

  useEffect(() => {
    latest.current.cents = cents;
  }, [cents]);

  useEffect(
    () => () => {
      audioEngine.stopMic();
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  const goTo = useCallback((i: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
    history.current = [];
    farSince.current = null;
    latest.current.cents = null;
    setTicked(false);
    setFarOff(false);
    setStep(i);
  }, []);

  // Sample the pitch ten times a second: detect "far off" and "held in tune".
  useEffect(() => {
    if (!listening || finished || ticked) return;
    const id = setInterval(() => {
      const now = performance.now();
      const c = latest.current.cents;
      if (c === null) {
        farSince.current = null;
        setFarOff(false);
        return;
      }
      history.current.push({ at: now, cents: c });
      if (history.current.length > 200) history.current.shift();
      if (Math.abs(c) > WRONG_STRING_CENTS) {
        farSince.current ??= now;
        setFarOff(now - farSince.current >= FAR_MS);
      } else {
        farSince.current = null;
        setFarOff(false);
      }
      if (holdInTune(history.current, now)) {
        setTicked(true);
        advanceTimer.current = setTimeout(() => goTo(step + 1), TICK_MS);
      }
    }, 100);
    return () => clearInterval(id);
  }, [listening, finished, ticked, step, goTo]);

  const start = async () => {
    setError(null);
    audioEngine.unlock();
    try {
      await audioEngine.startMic({
        deviceId: settings.inputDeviceId || undefined,
        threshold: 0.93,
        echoCancellation: settings.echoCancellation,
      });
      setListening(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not access the microphone",
      );
      setListening(false);
    }
  };

  const header = (
    <PageHeader
      title="Guided tune-up"
      subtitle="We will tune one string at a time, thickest first."
    />
  );

  if (finished) {
    return (
      <div data-testid="guided-tuner">
        {header}
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ok/20 text-ok">
            <Check className="h-9 w-9" />
          </div>
          <h2 className="text-2xl font-bold">
            All {total === 6 ? "six" : total} strings in tune
          </h2>
          <p className="text-muted">Nice work. Your guitar is ready to play.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => goTo(0)}>
              Tune again
            </Button>
            <Button
              variant="primary"
              onClick={onDone}
              data-testid="guided-done"
            >
              Done
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const n = total - step;
  const position =
    step === 0
      ? " (the thickest one)"
      : step === total - 1
        ? " (the thinnest one)"
        : "";
  const name = midiToName(targetMidi, false);
  const hint =
    step === 0
      ? "the thickest one"
      : step === total - 1
        ? "the thinnest one"
        : `the ${ordinal(n)} string`;
  const verdict = ticked
    ? { text: "In tune", tone: "ok" as const }
    : verdictFor(cents, farOff, hint);
  const mnemonicOn =
    tuning.id === "standard" && total === MNEMONIC_WORDS.length;
  const inTune = ticked || (cents !== null && Math.abs(cents) <= 5);

  return (
    <div data-testid="guided-tuner">
      {header}
      {error && (
        <Card className="mb-4 border-bad/40 bg-bad/10 text-sm text-red-200">
          {error}. Check the browser permission prompt, then try again.
        </Card>
      )}
      <Card className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-xs uppercase tracking-wide text-muted">
          Step {step + 1} of {total}
        </p>
        <h2 className="text-2xl font-bold">
          Tune the {ordinal(n)} string{position}
        </h2>
        <div data-testid="guided-string" className="flex items-baseline gap-2">
          <span
            className={cx(
              "text-6xl font-bold",
              inTune ? "text-ok" : "text-slate-50",
            )}
          >
            {name}
          </span>
          {ticked && (
            <Check
              className="h-8 w-8 self-center text-ok"
              aria-label="In tune"
            />
          )}
        </div>
        {mnemonicOn ? (
          <p className="text-sm text-muted" aria-label={STRING_MNEMONIC}>
            {MNEMONIC_WORDS.map((w, i) => (
              <span
                key={i}
                className={cx(i === step ? "font-bold text-accent" : "")}
              >
                {w}
                {i < MNEMONIC_WORDS.length - 1 ? " " : ""}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-sm text-muted">
            Thickest string first, then work towards the thinnest.
          </p>
        )}
        {listening ? (
          <>
            <Gauge cents={cents ?? 0} active={active} inTune={inTune} />
            <p
              data-testid="guided-verdict"
              className={cx("text-xl font-semibold", toneClass[verdict.tone])}
              aria-live="polite"
            >
              {verdict.text}
            </p>
            {(verdict.tone === "low" || verdict.tone === "high") && (
              <div className="w-48 text-muted">
                <Illustration
                  id="tuning-pegs"
                  handedness={settings.handedness}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="max-w-sm text-muted">
              Tap below so we can listen to your guitar. Your phone or computer
              microphone is fine.
            </p>
            <Button variant="primary" size="lg" onClick={start}>
              <Mic className="h-5 w-5" /> Start listening
            </Button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => goTo(step - 1)}
            disabled={step === 0}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button
            variant={ticked ? "primary" : "secondary"}
            onClick={() => goTo(step + 1)}
            data-testid="guided-next"
          >
            Next string
          </Button>
        </div>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted underline hover:text-slate-200"
          >
            Skip tuning for now
          </button>
        )}
      </Card>
    </div>
  );
}

export function GuidedTunerPage() {
  return (
    <div>
      <Link
        to="/tuner"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to tuner
      </Link>
      <GuidedTuner onDone={undefined} autoStart />
    </div>
  );
}
