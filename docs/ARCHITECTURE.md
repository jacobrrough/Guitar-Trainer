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
├── db/             Dexie database (songs + training tables) and React hooks
├── training/       the Coach: skills graph, learner model, exercise generators,
│                   session planner, tests, recommendations, store, orchestration
└── features/       UI: today (session + block runner), progress, test flow,
                    library (+ import dialog, demo song), play (Player engine,
                    highway, scoring), tuner, metronome, settings
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
   timing window (±45 ms perfect, up to 170 ms late), with repeated-note attack
   gating, streak multipliers and miss detection. Bend notes carry the pitch to
   reach and are judged within 25 cents of it. For charts with chords the worklet
   also posts a 12-bin chroma vector per frame (`audio/pitch/chroma.ts`); the
   tracker sums it over a chord's window and calls the chord hit when the cosine
   match to the chord's pitch-class template is ≥ 0.75 and at least 60 % of its
   pitch classes are present. The latency setting shifts the scoring clock to
   compensate for audio I/O delay; the Settings page measures it with a
   click-and-strum calibration.

5. **Section practice.** `PlayPage` passes a bar range and pass count to the
   `Player`; on a loop finish the pure helpers in `sectionLoop.ts` step the speed
   up (≥ 85 % accuracy) or down (< 70 %) and nothing is recorded as a song play.

## Training layer (Coach)

Design: `ADAPTIVE_TRAINING.md`. The code mirrors its sections and is pure apart from
`store.ts` and `coach.ts`:

| Module | Role |
|---|---|
| `types.ts`, `constants.ts` | contracts and every tunable number |
| `skills.ts` | 25-skill prerequisite graph with tips and generator ids |
| `performance.ts`, `learner.ts`, `review.ts` | attempt performance and reliability, Elo-style rating update, tempo ceiling, rust, bands, review scheduling, song items |
| `exercises/` | `ChartBuilder` (beats → chart), thirteen generators (chromatic, melody, scale runs, string skipping, chord changes, strum patterns, power-chord riffs, subdivisions, steady beat, legato, slides, bends, match-the-pitch), registry, backing audio via `audio/synth.ts` |
| `planner.ts` | session templates, focus selection, song level targeting, test insertion, in-session tempo adaptation |
| `assessment.ts`, `recommend.ts`, `plateau.ts` | placement ladder, checkpoint and monthly tests, test scheduling, rule-based recommendations, plateau detection |
| `milestones.ts`, `milestoneStore.ts` | band, tempo, unlock, streak, song and test milestones; deduplicated by key in a Dexie v3 table |
| `store.ts`, `useTraining.ts` | Dexie tables, streaks, export/import, read-only live-query hooks |
| `coach.ts` | orchestration: plan today → build exercise → record attempt → update model → adapt plan; song plays; tests |

The play engine was split into a reusable `Player` (song / exercise / test modes,
section looping, count-in, mic scoring) that `PlayPage`, the block runner and the
test flow wrap. `ScoreTracker` reports timing statistics, per-bar accuracy and
detection coverage, which become the `AttemptResult` the learner model consumes.
Ear-training exercises (`interaction: 'ear'`) bypass the highway: `EarTrainer`
plays each chart note as a synthesised reference and listens for a stable pitch,
then hands the block runner the same `AttemptResult` shape. Attempts record how
chords were scored (`chordScoring`), and only pitch-scored attempts keep the
provisional cap on chord skills.

## iOS / PWA layer

- `vite-plugin-pwa` generates the manifest and a Workbox service worker that precaches
  the app shell, alphaTab, the TensorFlow.js worker and the Basic Pitch model, so the
  installed app works offline.
- `app/platform.ts` detects iOS, Safari, standalone mode and the Capacitor wrapper and
  wraps the Audio Session API; `app/InstallBanner.tsx` explains Share → Add to Home
  Screen on iOS and uses `beforeinstallprompt` elsewhere.
- `AudioEngine.unlock()` is called synchronously in tap handlers to create/resume the
  context before any `await`, and asks for a `playback` audio session so the ringer
  switch does not mute the metronome, count-in or ear trainer; the play page also primes
  the `<audio>` element inside the gesture so the post-count-in `play()` is allowed.
- `platform.keepAudioContextRunning` resumes a context left `interrupted` by a call or
  app switch and reopens a muted mic track; the `Player` pauses when the page is hidden
  or iOS pauses the element behind its back. A saved input device that is gone falls
  back to the default microphone.
- In production the worklet module is fetched (through the service worker, so it works
  offline) and loaded from a blob URL; the service worker uses `prompt` update mode so a
  deploy never reloads a session mid-song.
- `app/useWakeLock.ts` keeps the screen on, with a hidden muted video fallback where the
  Wake Lock API is missing; the shell pads for the safe areas; songs are stored as
  `ArrayBuffer`s.
- `SAFARI_AUDIT.md` lists every finding of the code audit against iOS 16.4–18 and a
  15-minute device checklist. iOS has not been exercised on hardware yet.

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
  to the results screen, persistence, an end-to-end AI transcription of a
  synthetic WAV, the Coach flow (setup → today's plan → first block → stored
  attempts), a section loop run, the ear trainer's first prompt, the Progress page
  and a training-data export. `BASE_URL=http://localhost:5173 SKIP_TRANSCRIBE=1`
  runs the fast subset against a dev server.

Note on TensorFlow.js: Basic Pitch declares `@tensorflow/tfjs ^3`, but 3.21 crashes
inside Web Workers (`window is not defined` in `setTimeoutCustom`). `package.json`
pins 4.22 through an npm `override` so a single, worker-safe copy is bundled.
