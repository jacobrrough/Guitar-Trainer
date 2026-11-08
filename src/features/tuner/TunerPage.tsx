import { Mic, MicOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { updateSettings, useSettings } from "../../app/settings";
import { useWakeLock } from "../../app/useWakeLock";
import { audioEngine } from "../../audio/AudioEngine";
import {
  Button,
  Card,
  Field,
  PageHeader,
  Select,
  cx,
} from "../../components/ui";
import { centsOff, midiToFreq, midiToName } from "../../music/pitch";
import { stringColor } from "../../music/strings";
import { TUNINGS, getTuning } from "../../music/tunings";
import { Gauge } from "./TunerGauge";
import { stringLabel, verdictFor, WRONG_STRING_CENTS } from "./tuningGuide";
import { useTuner } from "./useTuner";

type Target = "auto" | "chromatic" | number;

export function TunerPage() {
  const settings = useSettings();
  const tuning = getTuning(settings.tunerTuningId);
  const [listening, setListening] = useState(audioEngine.micActive);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("auto");
  const [details, setDetails] = useState(false);
  const { reading, level } = useTuner(
    listening,
    settings.a4,
    settings.clarityThreshold,
  );
  useWakeLock(listening);

  useEffect(() => () => audioEngine.stopMic(), []);

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
  const stop = () => {
    audioEngine.stopMic();
    setListening(false);
  };

  // Which string are we tuning, and how far off is it?
  const view = useMemo(() => {
    if (!reading) return null;
    let stringIndex: number | null = null;
    if (typeof target === "number") stringIndex = target;
    else if (target === "auto") {
      let best = 0;
      for (let i = 1; i < tuning.strings.length; i++) {
        if (
          Math.abs(tuning.strings[i] - reading.midiFloat) <
          Math.abs(tuning.strings[best] - reading.midiFloat)
        )
          best = i;
      }
      stringIndex = best;
    }
    const chromatic = {
      label: reading.name,
      octave: reading.octave,
      cents: reading.cents,
      stringIndex: null as number | null,
      targetFreq: midiToFreq(reading.midi, settings.a4),
      offString: null as string | null,
    };
    if (stringIndex === null) return chromatic;
    const midi = tuning.strings[stringIndex];
    const cents = centsOff(reading.freq, midi, settings.a4);
    // In auto mode a pitch more than a semitone from every string is some other note
    // (a fretted note, another instrument): show it chromatically and name the nearest string.
    if (target === "auto" && Math.abs(cents) > 100)
      return { ...chromatic, offString: midiToName(midi) };
    return {
      label: midiToName(midi, false),
      octave: Math.floor(midi / 12) - 1,
      cents,
      stringIndex,
      targetFreq: midiToFreq(midi, settings.a4),
      offString: null,
    };
  }, [reading, target, tuning, settings.a4]);

  const active = !!reading && !reading.stale;
  const inTune = !!view && Math.abs(view.cents) <= 5;
  const farOff = !!view && Math.abs(view.cents) > 50;
  const wrongString =
    !!view &&
    view.stringIndex !== null &&
    Math.abs(view.cents) > WRONG_STRING_CENTS;
  const verdict = verdictFor(
    active && view ? view.cents : null,
    wrongString,
    "the string you chose",
  );

  return (
    <div>
      <PageHeader
        title="Tuner"
        subtitle="Chromatic tuner with per-string targets. Plug in or play into the microphone."
        actions={
          <div className="flex gap-2">
            <Link
              to="/tune"
              className="inline-flex h-10 items-center rounded-lg border border-line bg-panel-2 px-4 text-sm font-medium hover:bg-panel"
            >
              Guided tune-up
            </Link>
            {listening ? (
              <Button variant="secondary" onClick={stop}>
                <MicOff className="h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button variant="primary" onClick={start}>
                <Mic className="h-4 w-4" /> Start listening
              </Button>
            )}
          </div>
        }
      />
      {error && (
        <Card className="mb-4 border-bad/40 bg-bad/10 text-sm text-red-200">
          {error}. Check the browser permission prompt, or pick another input
          device in{" "}
          <Link to="/settings" className="underline">
            Settings
          </Link>
          .
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card className="flex flex-col items-center gap-2 py-6">
          <Gauge cents={view?.cents ?? 0} active={active} inTune={inTune} />
          <div
            className={cx(
              "flex items-baseline gap-1 transition-opacity",
              active ? "opacity-100" : "opacity-40",
            )}
          >
            <span
              className={cx(
                "text-7xl font-bold tabular-nums",
                inTune && active ? "text-ok" : "text-slate-50",
              )}
            >
              {view?.label ?? "–"}
            </span>
            <span className="text-2xl text-muted">
              {view ? view.octave : ""}
            </span>
          </div>
          <div
            className={cx(
              "text-center text-lg font-semibold transition-opacity",
              active ? "opacity-100" : "opacity-60",
            )}
          >
            <span
              className={cx(
                verdict.tone === "ok"
                  ? "text-ok"
                  : verdict.tone === "wrong-string"
                    ? "text-bad"
                    : verdict.tone === "idle"
                      ? "text-muted"
                      : "text-amber-300",
              )}
              data-testid="tuner-verdict"
            >
              {listening || view
                ? verdict.text
                : "Press “Start listening” and pluck a string"}
            </span>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={details}
              onChange={(e) => setDetails(e.target.checked)}
            />{" "}
            Details
          </label>
          {details && (
            <div
              className={cx(
                "text-sm tabular-nums text-muted transition-opacity",
                active ? "opacity-100" : "opacity-40",
              )}
            >
              {view ? (
                <>
                  <span
                    className={cx(
                      "font-semibold",
                      inTune
                        ? "text-ok"
                        : farOff
                          ? "text-bad"
                          : "text-amber-300",
                    )}
                  >
                    {view.cents > 0 ? "+" : ""}
                    {view.cents.toFixed(0)} cents
                  </span>
                  <span className="mx-2">·</span>
                  {reading!.freq.toFixed(1)} Hz
                  <span className="mx-2">·</span>
                  target {view.targetFreq.toFixed(1)} Hz
                </>
              ) : (
                "No pitch yet"
              )}
            </div>
          )}
          {farOff && active && view?.stringIndex !== null && (
            <div className="text-xs text-amber-300">
              Far from {view?.label}: you may be on a different string. Tune{" "}
              {view!.cents > 0 ? "down" : "up"} or pick the string manually.
            </div>
          )}
          {active && view?.offString && (
            <div className="text-xs text-muted">
              Hearing {view.label}
              {view.octave}; the nearest open string is {view.offString}. Play
              an open string, or pick one below.
            </div>
          )}
          <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${Math.min(100, Math.sqrt(level) * 220)}%` }}
            />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {tuning.strings.map((midi, i) => {
              const isTarget = view?.stringIndex === i && active;
              const selected = target === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setTarget(selected ? "auto" : i)}
                  className={cx(
                    "flex h-14 min-w-[5.5rem] items-center justify-center rounded-2xl border-2 px-3 text-center text-sm font-semibold leading-tight transition-all",
                    isTarget && inTune
                      ? "scale-110 border-ok bg-ok/20 text-green-200"
                      : isTarget
                        ? "scale-110 bg-panel-2"
                        : "bg-panel-2 text-slate-200",
                    selected ? "ring-2 ring-accent" : "",
                  )}
                  style={{
                    borderColor:
                      isTarget && inTune ? undefined : stringColor(i),
                  }}
                  title={`${midiToName(midi)} · ${midiToFreq(midi, settings.a4).toFixed(1)} Hz`}
                >
                  <span>
                    {stringLabel(
                      i,
                      tuning.strings.length,
                      midiToName(midi, false),
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setTarget("auto")}
              className={cx(
                "rounded-md px-2 py-1",
                target === "auto"
                  ? "bg-accent/20 text-amber-200"
                  : "text-muted hover:text-slate-200",
              )}
            >
              Auto string
            </button>
            <button
              type="button"
              onClick={() => setTarget("chromatic")}
              className={cx(
                "rounded-md px-2 py-1",
                target === "chromatic"
                  ? "bg-accent/20 text-amber-200"
                  : "text-muted hover:text-slate-200",
              )}
            >
              Chromatic
            </button>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <Field label="Tuning">
              <Select
                value={settings.tunerTuningId}
                onChange={(e) =>
                  updateSettings({ tunerTuningId: e.target.value })
                }
              >
                {TUNINGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={`Reference pitch: A4 = ${settings.a4} Hz`}
              className="mt-4"
            >
              <input
                type="range"
                min={430}
                max={450}
                step={1}
                value={settings.a4}
                onChange={(e) => updateSettings({ a4: Number(e.target.value) })}
              />
            </Field>
          </Card>
          <Card className="text-sm text-muted">
            <p className="mb-2 font-medium text-slate-200">Tips</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Pluck one string at a time and let it ring.</li>
              <li>
                Tune up to the note: loosen below the target, then tighten.
              </li>
              <li>Green means in tune.</li>
              <li>
                Using an audio interface? Choose it in Settings for cleaner
                readings.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
