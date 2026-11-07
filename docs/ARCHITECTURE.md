# Architecture

Guitar Trainer is a single-page web app. There is no backend: audio files, charts
and scores live in the browser's IndexedDB, and all signal processing and machine
learning run on the user's device. It is installable as a PWA and can be hosted on
any static file host (GitHub Pages included).

```
src/
├── app/            settings store (localStorage) and the shell layout
├── audio/          AudioContext owner, mic input, pitch-detection worklet, metronome
│   ├── AudioEngine.ts         single AudioContext + MediaStream + worklet node
│   ├── pitch/fft.ts           radix-2 FFT
│   ├── pitch/mpm.ts           McLeod Pitch Method (NSDF via FFT autocorrelation)
│   ├── pitch/pitch-processor  AudioWorkletProcessor posting {freq, clarity, rms}
│   └── metronome/             pure lookahead scheduler + click synthesis
├── music/          pitch math, tunings, string colours, string/fret assignment (Viterbi)
├── chart/          the app's own chart model + importers + difficulty generator
│   ├── types.ts               Chart, ChartNote, Beat, TempoEvent …
│   ├── timing.ts              tick→seconds map, beat grids
│   ├── difficulty.ts          salience scoring and level generation
│   └── importers/             guitarpro.ts (alphaTab), midi.ts (@tonejs/midi),
│                              transcribe.ts + transcribe.worker.ts (Basic Pitch),
│                              tempo-estimate.ts
├── db/             Dexie database (songs table) and React hooks
└── features/       UI: library (+ import dialog, demo song), play (highway, scoring),
                    tuner, metronome, settings (+ latency calibration)
```

## Data flow

1. **Import.** The user picks an audio file plus, optionally, a chart source.
   - Guitar Pro / MusicXML → `alphaTab` parses the score; we run its MIDI generator
     so repeats and tempo changes are expanded, then walk the tick lookup to emit
     one `ChartNote` per note with string/fret/time/duration/techniques.
   - MIDI → `@tonejs/midi` gives pitches and times; `music/fretboard.ts` assigns
     string/fret by minimising a fingering cost over the whole track.
   - Audio only → main thread decodes and resamples to 22.05 kHz mono with an
     `OfflineAudioContext`; a Web Worker runs Spotify's Basic Pitch (TensorFlow.js)
     and returns note events; `tempo-estimate.ts` lays a beat grid; frets are assigned
     as for MIDI.
   The result is a `Chart` stored next to the audio `Blob` in IndexedDB.

2. **Difficulty.** `generateLevels(chart)` derives six charts from the full one.
   Each note group (notes struck together) gets a *salience*: beat position
   (downbeat > beat > off-beat > 16th), note length, phrase starts, chord size.
   Level *n* keeps the top *k%* of groups by salience (15/30/50/70/85/100%), always
   keeps the strongest group of every bar, enforces a minimum spacing at low levels,
   and reduces chords (root → power chord → triad → full voicing). This is
   deterministic and cheap, so levels are generated on load rather than stored.

3. **Play.** The song plays through an `<audio>` element (`playbackRate` with
   `preservesPitch` gives slow-down practice for free). A `PlaybackClock`
   extrapolates `currentTime` between updates. Each animation frame the
   `HighwayRenderer` draws notes approaching a hit line; strings are lanes.

4. **Scoring.** The microphone feeds the `pitch-processor` worklet, which runs
   McLeod pitch detection every 512 samples and posts frames to the main thread.
   `PitchSmoother` median-filters frames and flags attacks (level jumps).
   `ScoreTracker` matches detected pitches against pending note groups inside a
   timing window (±45 ms perfect, up to 170 ms late), with octave tolerance on
   chords, repeated-note attack gating, streak multipliers and miss detection.
   The latency setting shifts the scoring clock to compensate for audio I/O delay;
   the Settings page measures it with a click-and-strum calibration.

## Key decisions

- **Browser-first.** Zero install, works on phones and laptops, trivial to host.
  Desktop/mobile wrappers (Tauri, Capacitor) can come later without a rewrite.
- **Worklet-based detection.** Pitch detection on the audio thread keeps latency to
  a few milliseconds and the UI smooth; the FFT-based NSDF makes a 2048-sample window
  cheap enough at ~100 frames/s.
- **One chart model.** Every source converts into the same `Chart`, so the highway,
  difficulty generator and scorer never care where notes came from.
- **Lazy heavy deps.** alphaTab (~1.3 MB) and the TensorFlow.js worker (~1.8 MB)
  load only when a Guitar Pro file is imported or a transcription runs.
- **Permissive licensing.** Only MIT/Apache/MPL dependencies; see
  `OPEN_SOURCE_LANDSCAPE.md`.

## Testing

- `npm test` – Vitest unit tests for the DSP (pitch detector on synthetic tones),
  fretboard assignment, difficulty generation, timing maps, scoring, tempo
  estimation, the importers (alphaTex → chart, MIDI → chart) and a model
  integration test that runs the real Basic Pitch weights on a synthetic signal
  with the TensorFlow.js CPU backend (~10 s).
- `npm run test:e2e` – Playwright smoke test against the production build using
  Chromium's fake microphone: navigation, metronome, tuner, demo song play-through
  to the results screen, persistence, and an end-to-end AI transcription of a
  synthetic WAV. `BASE_URL=http://localhost:5173 SKIP_TRANSCRIBE=1` runs the fast
  subset against a dev server.

Note on TensorFlow.js: Basic Pitch declares `@tensorflow/tfjs ^3`, but 3.21 crashes
inside Web Workers (`window is not defined` in `setTimeoutCustom`). `package.json`
pins 4.22 through an npm `override` so a single, worker-safe copy is bundled.
