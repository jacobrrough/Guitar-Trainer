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
│   ├── pitch/spectrum.ts      spectral peaks of the last 4096 samples (what scoring listens to)
│   ├── pitch/frameAnalyzer.ts framing shared by the worklet and the scoring simulation
│   ├── pitch/pitch-processor  AudioWorkletProcessor posting {freq, clarity, rms, peaks, flux, fluxBand}
│   ├── instrument/            the recorded guitar: sample bank + sampler; string model as fallback voice
│   ├── guitar.ts              the app's guitar voice: loads the sample pack, renders in synth.worker.ts
│   ├── synth.ts               offline renderer: strings (sampled or modelled), drums, loudness mastering
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
├── lessons/        the First steps course: lesson content, progress store
├── songs/          bundled public-domain songs built with ChartBuilder, played by the app's guitar
├── components/diagrams  SVG instruction set: chord boxes, fretboard spots, posture, pick grip
└── features/       UI: onboarding (Start Here wizard), lessons (course + lesson pages),
                    today (session + block runner), progress, test flow, library
                    (+ import dialog, demo song), play (Player engine, highway,
                    scoring), tuner (+ guided tune-up), metronome, settings
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
   and reduces chords (root → the two lowest neighbouring strings → triad → full
   voicing). This is deterministic and cheap, so levels are generated on load rather
   than stored.

3. **Play.** The song plays through an `<audio>` element (`playbackRate` with
   `preservesPitch` gives slow-down practice for free). A `PlaybackClock`
   extrapolates `currentTime` between updates. Each animation frame the
   `HighwayRenderer` draws notes approaching a hit line; strings are lanes.

4. **Scoring.** The microphone feeds the `pitch-processor` worklet. Every 512
   samples it posts a frame: a single-pitch estimate (McLeod; used by the tuner and
   the on-screen indicator), the spectral peaks of the last 4096 samples
   (`pitch/spectrum.ts`) and the attack strength of the last hop, wide-band and
   band-limited. `ScoreTracker` (`features/play/scoring.ts`) calls a note or chord
   hit when its own harmonics have *risen* out of their recent trough, which a fresh
   stroke does and a string that is still ringing, a drum or another note does not.
   The rise must hold for two frames after a settle time that depends on pitch, and
   the hit is timed from the attack, not from when the pitch became clear (±45 ms
   perfect, 100 ms good, accepted from 130 ms early to 170 ms late). Guards reject
   the octave above and below, let one stroke score a pitch once, ignore beating
   between ringing strings, and tell chords that share notes apart (share of strings
   struck, pitch classes left silent, energy foreign to the chord). Bends are judged
   against the pitch to reach. The tracker listens through the count-in and across
   loop wraps: when the song position steps back, what was heard is re-timed, not
   discarded, and the last notes of a loop pass stay open until their sound has had
   time to arrive. The latency setting is pure input/output delay, scaled by playback
   speed; frames are judged at the time they were captured. Settings measures it with
   a click-and-strum calibration (`calibration.ts`, `clickTrack.ts`): the clicks are a
   piece of audio played by a media element, and the answers are timed on that
   element's clock with the same sum the player uses for a song, so the number is the
   delay of the very path a song takes. `PlaybackClock` smooths the element's clock
   and keeps steering towards it (in its first 100 ms a browser's media clock is not
   settled; an offset picked up there must not stay for the whole song). While the microphone scores, the
   app's own songs and drills play their click track only; the guitar part is a
   listening guide, because a phone speaker would play it into the microphone. A run
   in which the microphone delivered nothing, or heard the app's own guitar part, is
   shown as "not counted" and never saved (`runVerdict.ts`).

   **The guitar voice.** `audio/guitar.ts` loads one MP3 (`public/samples`, 37 notes
   of a recorded steel-string guitar, CC BY 3.0, built by
   `scripts/build-guitar-samples.mjs`), decodes it once and hands the samples to
   `synth.worker.ts`. Bundled songs, drill guides, the demo riff and ear-training
   notes are rendered from it (`instrument/sampler.ts`: nearest recording, resampled,
   with neighbouring recordings for repeated notes). If the pack cannot be loaded the
   string model plays instead; a render waits at most 15 s for a slow download, a
   failed load is tried again (after a while, when the connection returns, when the
   app is reopened), and a worker that fails or goes silent is replaced by a render on
   the main thread. Stored audio carries the renderer version and voice in its name,
   and bundled charts carry a revision, so songs already in a library are brought up
   to date in the background, also once the recordings arrive late.

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
| `exercises/` | `ChartBuilder` (beats → chart), fifteen generators (open strings, first frets, chromatic, melody, scale runs, string skipping, chord changes, strum patterns, power-chord riffs, subdivisions, steady beat, legato, slides, bends, match-the-pitch), registry, backing audio via `audio/synth.ts` |
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
plays each chart note on the app's guitar as a reference and listens for a stable pitch,
then hands the block runner the same `AttemptResult` shape.

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
  offline) and loaded from a blob URL. The service worker uses `prompt` update mode so a
  deploy never reloads a session mid-song; `app/appUpdate.ts` switches to a downloaded
  version while the app is still opening, otherwise shows an "Update now" bar on the main
  screens, and checks for a new version when the app returns to the foreground. Settings
  shows the build and a "Check for updates" button. The reload that ends a switch goes
  through the same check (`onNeedReload`): if the learner started something in the
  moment the switch took, it waits for the next quiet moment instead.
- `app/useWakeLock.ts` keeps the screen on. Where the Wake Lock API is missing or known
  not to work (home-screen apps before iOS 18.4) `app/keepAwake.ts` plays a tiny silent
  clip instead, un-muted and wound back before it ends, which is what makes an iPhone
  hold the display (untested on hardware). `app/storage.ts` asks for persistent storage
  where that shows no prompt. The shell pads for the safe areas; songs are stored as
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
- `src/features/play/scoring.sim.test.ts` (part of `npm test`) is a virtual player: the
  recorded guitar plays every lesson drill and lesson song through the same analyser
  and tracker the app uses, at 44.1 and 48 kHz, with click-track bleed, a phone
  microphone model, latency, slow speed, quiet playing, silence, the click alone,
  wrong notes and skipped notes. `FULL_SIM=1 npx vitest run
  src/features/play/scoring.matrix.test.ts` runs every song and exercise in every
  scenario (about twenty minutes) and prints one line per case.
- `npm run test:student` – the virtual student, end to end in Chromium: a new learner
  goes through the set-up and lesson 1 while a recorded-guitar performance is fed in as
  the microphone, in step with the song. The rig models a device with a long sound
  round trip (about 270 ms); the app is not told and has to find it with its own
  calibration, which the student runs first. Played right it must pass on screen and be judged in time (mostly "perfect", no
  steady lead or lag); played on the wrong frets, or not at all, it must not pass. It
  then plays the lesson's song at the lesson's slower speed and three bundled songs from
  the library, strummed chords included. Last comes a day of practice: the student leaves
  the course, reads today's plan out of the app's own storage, and plays its first
  exercise and its song as the Coach planned them (the performance is rendered on the
  spot from the stored block), checking the round card, the skill score and the plan.
  It builds the app first, so the performances and the app always come from the same code.
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
