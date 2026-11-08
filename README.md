# Guitar Trainer

A free, open-source guitar trainer in the spirit of Yousician and Rocksmith, built for the
browser. Load a song you own, pick a difficulty, play along on your real guitar and get
scored in real time. Comes with a chromatic tuner and a metronome. No account, no
subscription, no servers: your audio and progress never leave your device.

> Status: early but playable (v0.1). See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.

## Features

- **First steps for complete beginners** – a Start Here wizard (played before? acoustic or
  electric? which hand strums? minutes a day), a microphone check and a guided string-by-string
  tune-up, then a ten-lesson course: hold it and pick it, first frets, crossing strings, your
  first chords, three-chord songs, rhythm and a first riff. Every lesson is learn (an illustrated
  card), try (a drill with the part played first) and play (a bundled public-domain tune).
- **Daily coach** – open the app and get today's session: warm-up, a focused technique
  exercise at the right tempo, your song at the right level, a review of earlier
  material, and a skill check when one is due. Every block is scored and feeds a per-skill
  rating; tempos adapt rep by rep; weekly checkpoints and monthly assessments keep the
  plan honest. Brand-new players start with first steps (open strings, first frets,
  half notes, the sparsest song level) and can hear every drill before playing it;
  drills then cover picking, chords, legato, slides, bends and ear training
  (listen, then find the note). Milestones mark bands, tempos, unlocks and streaks.
  Progress page with a skill map, rating history and milestones; training data can be
  exported and imported as JSON. Design: [docs/ADAPTIVE_TRAINING.md](docs/ADAPTIVE_TRAINING.md).
- **Play along with difficulty levels** – every song gets six auto-generated levels, from a
  sparse "one note per bar" skeleton up to the full transcription. Low levels keep the
  structurally important notes (downbeats, long notes, phrase starts) and simplify chords
  (root → power chord → triad → full voicing). Yousician-style progression, Rocksmith-style
  note thinning.
- **Scrolling note highway** – strings as colour-coded lanes, fret numbers (or note names),
  sustain tails, chord names, technique marks (hammer-on, slide, bend…), count-in, streaks and
  multipliers, results with per-level best scores.
- **Real-time pitch scoring** – McLeod pitch detection running in an AudioWorklet on the audio
  thread; timing windows, repeated-note attack gating, a latency calibration wizard for
  Bluetooth headphones and USB interfaces. Strummed chords are judged on a 12-bin chroma
  profile (are the chord's notes actually ringing?), bends on the pitch you reach.
- **Slow-down and section practice** – 50–100 % speed without changing pitch; loop any bar
  range, and let the player step the speed up when a pass is clean or down when it is not.
- **Three ways to get a chart**
  - Guitar Pro (`.gp`, `.gp3`–`.gp5`, `.gpx`) and MusicXML via [alphaTab] – repeats, tempo
    changes, capo and techniques are preserved.
  - MIDI – pick the track; string/fret positions are assigned automatically.
  - Nothing at all – the app listens to the audio with Spotify's [Basic Pitch] model, running
    locally in a Web Worker, and estimates the tempo. Best with exposed guitar parts.
- **Tuner** – chromatic with per-string targets for standard, drop, open, 7-string, bass and
  ukulele tunings; adjustable reference pitch.
- **Metronome** – 30–300 bpm, time signatures, subdivisions, accents, tap tempo, keyboard
  control, sample-accurate clicks.
- **Demo song** – a synthesised riff so you can try everything without any files.
- **Installable PWA** – offline-capable service worker, home-screen icons, iOS audio
  session handling, wake lock, phone layout with tap-to-pause, and an icon badge while
  today's session is still waiting.

## On your iPhone

The app is published from this repository with GitHub Pages at
**<https://jacobrrough.github.io/Guitar-Trainer/>** (the `CI & Deploy` workflow builds and
publishes every push to the default branch).

Guitar Trainer is built iPhone-first as an installable web app: open it in Safari, tap
**Share → Add to Home Screen**, and it runs full screen, offline, with your songs saved on
the device. Plug a guitar in through a class-compliant interface or use wired headphones
with the built-in mic; calibrate once in Settings. Details, limitations and the optional
native build with Capacitor are in [docs/IOS.md](docs/IOS.md).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # unit tests (Vitest)
npm run build      # production build in dist/
npm run preview    # serve the production build
npm run test:e2e   # Playwright smoke test against the build (uses a fake microphone)
npm run typecheck
```

Deploying is a static upload of `dist/`. The included GitHub Actions workflow runs the tests and
publishes to GitHub Pages on every push to `main` (enable it once in *Settings → Pages →
Source: GitHub Actions*). For hosting under a sub-path, build with `BASE_PATH=/your-path/`.

## How to use it

1. **Settings** – choose your input (audio interface or microphone) and run *Calibrate* once
   with the speakers/headphones you practise with.
2. **Today** – pick your goals and daily minutes, take the placement test (or start as a
   beginner), then do the session the coach lays out. One block a day keeps the streak.
   Ear-training blocks play a reference note and listen for you to find it on the guitar.
3. **Songs → Add song** – pick the recording, then the chart source. Fix the title/artist, pick
   the track for Guitar Pro/MIDI files, set a chart offset if the recording has a count-in.
4. **Play** – start at the suggested level. 90 %+ accuracy unlocks a "level up" suggestion;
   under 60 % the game suggests an easier level or a slower speed. Turn on *Loop* to drill a
   bar range (or the weakest bars of your last run) with automatic speed steps.
5. **Settings → Your data** – export a JSON backup of your training history, import one on
   another device, or reset the coach.
6. **Progress / Tuner / Metronome** – available any time from the sidebar.

Plug the guitar in through an audio interface for the cleanest detection; a laptop microphone
works for acoustic and clean tones. Distorted tones: lower *Detection sensitivity* in Settings.
Use headphones when scoring: a speaker next to the microphone would score the song itself.
The app plays drums-only backing for synthesised content while the mic is on (the speaker
icon brings the part back), warns when the count-in is heard through the speaker, and does
not let such a run move your ratings.

## Built on open source

All dependencies are permissively licensed (MIT / Apache-2.0 / MPL-2.0). The research behind
the choices, including projects we deliberately do not depend on, is in
[docs/OPEN_SOURCE_LANDSCAPE.md](docs/OPEN_SOURCE_LANDSCAPE.md).

| Piece | Library |
|---|---|
| Guitar Pro / MusicXML parsing, tab model | [alphaTab] (MPL-2.0) |
| Audio → notes | [Basic Pitch] (Apache-2.0) on TensorFlow.js |
| MIDI parsing | [@tonejs/midi] (MIT) |
| Music theory | [tonal] (MIT) |
| Local storage | [Dexie] (Apache-2.0) |
| Pitch detection, metronome, difficulty, highway, scoring | our own code (MIT) |

[alphaTab]: https://github.com/coderline/alphaTab
[Basic Pitch]: https://github.com/spotify/basic-pitch-ts
[@tonejs/midi]: https://github.com/Tonejs/Midi
[tonal]: https://github.com/tonaljs/tonal
[Dexie]: https://dexie.org

## Where it's going

See [docs/ROADMAP.md](docs/ROADMAP.md); the Coach's remaining phases are in
[docs/ADAPTIVE_TRAINING.md](docs/ADAPTIVE_TRAINING.md) §13.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Short version: Vite + React + TypeScript
PWA; one `AudioContext`; an AudioWorklet posts pitch frames; every chart source converts
into one `Chart` model; difficulty levels are derived deterministically; IndexedDB holds
songs, charts and scores.

## Browser support

Safari on iOS 16.4+ (17+ recommended for mic + speaker handling), Chrome on Android, and
Chrome/Edge, Firefox, Safari 16.4+ on desktop. AudioWorklet, `OfflineAudioContext`, Web
Workers and IndexedDB are required. See [docs/IOS.md](docs/IOS.md) for phone specifics.

## Contributing

Issues and pull requests are welcome. Good first areas: section looping, tab view, beat-grid
editing, chord detection, translations. Please keep new dependencies permissively licensed and
never commit copyrighted audio or tabs.

## License

MIT – see [LICENSE](LICENSE). Bundled model weights for Basic Pitch are Apache-2.0
(`public/models/basic-pitch/LICENSE`).
