import { Mic, MicOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { updateSettings, useSettings } from "../../app/settings";
import { useWakeLock } from "../../app/useWakeLock";
import { audioEngine } from "../../audio/AudioEngine";
import { useMicActive } from "../../audio/useMicActive";
import {
  Button,
  Card,
  Field,
  PageHeader,
  Select,
  cx,
} from "../../components/ui";
import { midiToFreq, midiToName } from "../../music/pitch";
import { stringColor } from "../../music/strings";
import { Gauge } from "./TunerGauge";
import { TUNER_TUNINGS, tunerMinFreq, tunerTuning } from "./tunerRange";
import {
  GAUGE_CENTS,
  stringLabel,
  tunerView,
  verdictFor,
  type TunerMode,
} from "./tuningGuide";
import { useTuner } from "./useTuner";

export function TunerPage() {
  const settings = useSettings();
  const tuning = tunerTuning(settings.tunerTuningId);
  const minFreq = tunerMinFreq(tuning.strings, settings.a4);
  // Follows the audio engine, so a microphone that another screen closed never shows as listening.
  const listening = useMicActive();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<TunerMode>("auto");
  const [details, setDetails] = useState(false);
  const { reading, level } = useTuner(
    listening,
    settings.a4,
    settings.clarityThreshold,
  );
  useWakeLock(listening);

  // Take over a microphone the guided tune-up left running; hand ours on the same way when leaving.
  useEffect(() => {
    audioEngine.claimMic();
    return () => audioEngine.releaseMic();
  }, []);

  // A microphone taken over from another screen, or opened under another tuning, has the wrong
  // range: make the detector reach this tuning's lowest string.
  useEffect(() => {
    if (listening) audioEngine.configureDetector({ minFreq });
  }, [listening, minFreq]);

  const start = async () => {
    setError(null);
    audioEngine.unlock();
    try {
      await audioEngine.startMic({
        deviceId: settings.inputDeviceId || undefined,
        minFreq,
        threshold: 0.93,
        echoCancellation: settings.echoCancellation,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not access the microphone",
      );
    }
  };
  const stop = () => audioEngine.stopMic();

  // Which string are we tuning, how far off is it, and what should the player do?
  const view = useMemo(
    () =>
      reading ? tunerView(reading.midiFloat, target, tuning.strings) : null,
    [reading, target, tuning],
  );

  const active = !!reading && !reading.stale;
  const inTune = !!view && view.inTune;
  const farOff = !!view && Math.abs(view.cents) > GAUGE_CENTS;
  const verdict = active && view ? view.verdict : verdictFor(null);
  const targetFreq = view ? midiToFreq(view.targetMidi, settings.a4) : 0;

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
              {listening
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
                  target {targetFreq.toFixed(1)} Hz
                </>
              ) : (
                "No pitch yet"
              )}
            </div>
          )}
          {active && verdict.detail && (
            <div
              className="max-w-sm text-center text-xs text-muted"
              data-testid="tuner-detail"
            >
              {verdict.detail}
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
                value={tuning.id}
                onChange={(e) =>
                  updateSettings({ tunerTuningId: e.target.value })
                }
              >
                {TUNER_TUNINGS.map((t) => (
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
