# Architecture

Guitar Trainer is a single-page web app. There is no backend: audio files, charts
and scores live in the browser's IndexedDB, and all signal processing and machine
learning run on the user's device. It is installable as a PWA and can be hosted on
any static file host (GitHub Pages included).

The app trains two instruments, guitar and voice. The voice side is in the build and
out of sight behind a flag; "Two instruments" below says how the two share one app,
and `SINGING.md` describes the voice side in full.

```
src/
├── app/            settings store (localStorage), the shell layout, and the release
│                   flag of the singing side (features.ts)
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
│   ├── voice.ts               the guide voice for singing: additive harmonics, rendered offline
│   └── metronome/             pure lookahead scheduler + click synthesis
├── music/          pitch math, tunings, string colours, string/fret assignment (Viterbi),
│                   keys.ts: the key of a tune and of an exercise for a singer's range
├── chart/          the app's own chart model + importers + difficulty generator
│   ├── types.ts               Chart, ChartNote, Beat, TempoEvent …
│   ├── timing.ts              tick→seconds map, beat grids
│   ├── difficulty.ts          salience scoring and level generation
│   └── importers/             guitarpro.ts (alphaTab), midi.ts (@tonejs/midi),
│                              transcribe.ts + transcribe.worker.ts (Basic Pitch),
│                              tempo-estimate.ts
├── db/             Dexie database (songs + training tables) and React hooks
├── training/       the Coach: skills graph, learner model, exercise generators,
│                   session planner, tests, recommendations, store, orchestration;
│                   instruments.ts, voiceSkills.ts, voicePlan.ts, voiceProfile.ts for the voice
├── lessons/        the two First steps courses (course.ts, voiceCourse.ts): lesson content,
│                   progress store
├── songs/          bundled public-domain songs built with ChartBuilder, played by the app's guitar
│   └── vocal/                 songs to sing: tunes as data, arranged and rendered when opened
├── components/diagrams  SVG instruction set: chord boxes, fretboard spots, posture, pick grip,
│                   and the drawings of the singing lessons (voiceScenes.tsx)
└── features/       UI: onboarding (Start Here wizard for either instrument), lessons (course +
                    lesson pages), today (session + block runner), progress, test flow, library
                    (+ import dialog, demo song), play (Player engine, highway, scoring;
                    play/voice: voice tracker and pitch lanes), tuner (+ guided tune-up),
                    metronome, settings, voice (range finder, "My voice", "Meet the note"),
                    sing (the page of a song to sing), dev (a hidden check page)
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
| `skills.ts` | the guitar's 27-skill prerequisite graph with tips and generator ids |
| `instruments.ts` | which instrument a stored row, a skill, a lesson or a block belongs to; `skillsFor`, `courseFor`, `activeInstrument` |
| `voiceSkills.ts`, `voicePlan.ts`, `voiceProfile.ts` | the twelve singing skills; the options and rules the Coach uses for a voice; the singer's range, key choices and tired mark on profile row 2 |
| `performance.ts`, `learner.ts`, `review.ts` | attempt performance and reliability, Elo-style rating update, tempo ceiling, rust, bands, review scheduling, song items |
| `exercises/` | `ChartBuilder` (beats → chart), fifteen guitar generators (open strings, first frets, chromatic, melody, scale runs, string skipping, chord changes, strum patterns, power-chord riffs, subdivisions, steady beat, legato, slides, bends, match-the-pitch), four sung ones in `exercises/voice/`, registry, backing audio via `audio/synth.ts` and `audio/voice.ts` |
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

## Two instruments

Design and detail: `SINGING.md`. Guitar and voice share the Player, the Coach, the
lesson engine, the database and every list page. What keeps them apart is small, and
every piece of it defaults to the guitar, so guitar code and guitar data read as they
did before the voice existed.

**Release flag.** `app/features.ts` holds `VOICE_RELEASED` (false) and
`voiceEnabled()`, which is also true on a device that stores `'1'` under the
localStorage key `gt.voice` (the preview key). Every door into the voice side asks it:
the "Guitar | Singing" switch in the shell, the voice routes (`/range`, `/sing/:songId`,
`/start?instrument=voice`, and the hidden `/voice-check`, which is only registered
while the flag or the key is on), and `activeInstrument(settings)`, which answers
guitar while it is off whatever the setting says.

**The instrument dimension.** `InstrumentId` is `'guitar' | 'voice'`
(`training/instruments.ts`). Nothing stored was rewritten for it:

- ids carry the side where they can: singing skills are `voice.*`, singing lessons
  `v01-…` to `v10-…`, the blocks of a singing plan `voice-${date}-${i}-${kind}`, songs
  to sing `sing-…`;
- rows that have no such id carry an optional `instrument` stamp (sessions, attempts,
  tests, milestones, song items, song rows), read as guitar when missing
  (`instrumentOf`);
- the `profile` table has two rows: 1 is the guitar profile, 2 the singing profile
  (`profileIdFor`), which also carries the singer's range, key choices and tired mark;
- Dexie version 5 changes one line, `sessions: '++id, date, &[instrument+date]'`, and
  stamps the stored sessions `'guitar'` in the repository's first `.upgrade()`. The
  compound index gives one plan a day per instrument. A row without a stamp sits
  outside it, so `saveSession` always stamps, and `getSession` falls back to the plain
  `date` index for rows an older copy of the app may still write.

Store functions and hooks take the instrument as a last parameter defaulting to
`'guitar'` (`loadProfile(i)`, `loadLearnerModel(i)`, `getSession(date, i)`,
`listTests(limit, i)`, `useSongs(i)` …). Backups are version 2 (both profiles); a
version 1 file is a guitar backup and replaces the guitar rows only.

**The scoring seam.** The Player knows one thing about scoring: it has a `RunTracker`
(`features/play/runTracker.ts`), feeds it every microphone frame with the song time,
moves it along with the clock, and at the end asks for a summary and an
`AttemptResult`. `createRunTracker(chart, notes, options)` returns the tracker from
the chart alone:

- a chart with `chart.voice` set gets a `VoiceTracker`
  (`features/play/voice/voiceTracker.ts`): a sung note is a stretch of time, and what
  is measured is the share of it sung inside a band of cents around the note, in any
  octave, from the worklet's single-pitch estimate. Spectrum analysis is switched off
  for such a run, and the detector is narrowed to the chart's range;
- every other chart gets `guitarRunTracker`, the `ScoreTracker` and `PitchSmoother`
  the Player always drove, behind the same interface. The guitar simulations hold it
  to the old numbers.

No screen passes a flag, so none can forget one. The renderer follows the same rule
(`laneRenderer.ts`): `HighwayRenderer` for a guitar chart, `VoiceLanesRenderer`
(`voice/VoiceLanes.ts`) for a sung one. The pitch lanes have the highway's surface
(`resize`, `draw`, `width`) and draw height as pitch: each note a bar as long as it
lasts, a dot for the singer's voice on the same hit line, the sung part of a bar
filling in. The words and small rules of the Player that differ between the two
(guide switch, notices, detector range) are in `playerLabels.ts`.

**The app's own sound for singing.** A sung chart lists the notes the app itself
sounds on the scored track (`chart.voice.cues`: the starting note, the guide's turns
of an echo). The tracker gives no credit while one sounds. The melody sung by the
guide voice (`audio/voice.ts`) and the strummed chords are on the guide track only,
which plays while scoring only for a singer who said they wear headphones
(`settings.voiceHeadphones`).

**The vocal song pipeline** (`songs/vocal/`). A song to sing is data: lines of
`[semitones above home, beats, syllable]` and one chord degree per bar (`tunes/`,
`types.ts`). Nothing is rendered or stored per key:

1. `install.ts` writes one light row per song into the song table (`instrument:
   'voice'`, a chart of the tune as written, no audio), on demand
   (`vocalSongRecord`), so results and song items have a row id to hang on;
2. when a song is opened, `music/keys.ts` chooses the key for the singer's range
   (`chooseKey`), `arrange.ts` builds the chart for one of six levels (`levels.ts`:
   echo each line, echo two lines, whole tune, in tune, hold the long notes,
   performance; the speed is always 1) and the chord chart under it;
3. `render.ts` makes the two tracks: the scored track (click and cues) and the guide
   (the same, the melody sung, and the chords from the guitar's own render job in
   `synth.worker.ts`). The last three runs are kept in memory;
4. `useVocalRun.ts` hands a screen the run once both tracks exist, and starts the
   work only after the page has painted.

So a singer whose range changes gets every song in the new key the next time it
opens, and storage does not grow. Apart from the chords, the rendering runs on the
main thread.

**Voice exercises** (`training/exercises/voice/`). Four generators (`voiceEcho`,
`voiceHold`, `voicePattern`, `voiceSlide`) are registered beside the guitar's and
build call-and-answer charts with `VoiceBuilder`, which refuses a note outside the
singer's range, a cue too close to a scored note, or a round over eight bars. The
range reaches a generator when the exercise is built (`exerciseForBlock`,
`exerciseForTask`, `lessonDrillExercise` take it as a last argument), never from the
stored block. Skills where slower is not easier keep one tempo and climb a ladder of
steps (`SkillDef.steps`); `ADAPTIVE_TRAINING.md` §16 says how the Coach reads it.

**Two courses.** `lessons/course.ts` (`COURSE`, ten guitar lessons) and
`lessons/voiceCourse.ts` (`VOICE_COURSE`, ten singing lessons) share the `Lesson`
shape, the progress table and the lesson screens. A lesson's course follows from its
id. A singing lesson may run a tool where a practice round stands (`Lesson.tool`: the
range finder, "Meet the note"), as the guitar course runs its tuner.

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
- `npm run typecheck:tests` – `tsc -p tsconfig.test.json --noEmit`. The app build
  (`tsc -b`) leaves the test files out; this checks them with the same compiler
  options.
- The singing side has its own virtual performer: a computed singer
  (`features/play/voice/virtualSinger.testutil.ts`, built on another model than the
  app's guide voice and sharing no code with it) sings through the same analyser and
  the voice tracker (`simulateVoice.ts`). `voice/voice.sim.test.ts` holds the two
  lists of what must score and what must not, `voice/voice.bleed.sim.test.ts` the
  checks that the app knows its own sound, `training/exercises/voice/voice.sim.test.ts`
  every skill's exercise, `songs/vocal/vocal.sim.test.ts` the songs and
  `lessons/material.voice.test.ts` the lesson rounds and songs. A plain run sings a
  part of each; `FULL_SIM=1` the rest. The singer is a model, not a person.
- `src/features/play/scoring.sim.test.ts` (part of `npm test`) is a virtual player: the
  recorded guitar plays every lesson drill and lesson song through the same analyser
  and tracker the app uses, at 44.1 and 48 kHz, with click-track bleed, a phone
  microphone model, latency, slow speed, quiet playing, silence, the click alone,
  wrong notes and skipped notes. `FULL_SIM=1 npx vitest run
  src/features/play/scoring.matrix.test.ts` runs every song and exercise in every
  scenario (about twelve minutes) and prints one line per case.
  `scoring.patterns.sim.test.ts` plays figures ordinary music is made of (bass walks,
  let-ring arpeggios, power-chord changes, hammer-ons) and `scoring.chords.sim.test.ts`
  every chord exercise from its start tempo to its target tempo, the chord lessons and
  the strummed songs, each heard six ways and each with the ways of not playing it that
  must not score (wrong chords, one string picked, open strings, strums left out). A
  plain test run plays five stand-in cases of the chord gate; `FULL_SIM=1` plays all of
  it (four shards side by side with `CHORDS_SHARD=0/4` … `3/4`). Run the whole chord
  gate and the matrix before and after any change to the scorer.
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
- `npm run test:singer` – `e2e/singer.mjs`, the same rig for the singing side. The
  virtual microphone, the fixture plumbing and the preview server are shared with the
  student in `e2e/lib/virtualMic.mjs`. With the preview key set it opens the hidden
  page `/voice-check` (one generated voice exercise in the real Player) and feeds it
  takes of the computed singer, written and scored in Node first by
  `features/play/voice/e2eVoiceFixtures.test.ts`: in tune an octave below the lanes
  must count, 150 cents flat must be heard and count for nothing, silence and the
  app's scored track alone must be "nothing was scored", and the guide track fed back
  must be known for the app's own sound. It does not yet walk through the set-up, a
  lesson, a song or a day's plan. `E2E_OUTPUT` sends the rendered takes and
  screenshots of either script to another folder.
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
