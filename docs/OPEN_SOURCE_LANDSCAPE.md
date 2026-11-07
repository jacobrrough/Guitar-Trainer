# Open-source landscape: what we build on, what we borrow ideas from, what we avoid

Researched November 2026. Licenses were checked against the npm registry and each
project's LICENSE file at the time of writing; re-check before shipping a release.

Guitar Trainer is a free, open-source, browser-based guitar trainer in the spirit of
Yousician / Rocksmith: upload a song, pick a difficulty, play along with your real
guitar, get scored. Plus a tuner and a metronome. Everything runs client-side; no
server, no account, no uploads of your audio to anyone.

## 1. Projects that already do "play along with a real guitar"

| Project | What it is | License | Verdict |
|---|---|---|---|
| [gryf-guitar](https://github.com/merx666/gryf-guitar) | Web (React 19, Tailwind 4, Canvas/Three.js) Rocksmith-style note highway. AudioWorklet YIN pitch detection, Guitar Pro import, tuner, latency-calibration wizard, virtual amp. UI is in Polish. | MIT | **Closest existing project to what we want.** Permissive license; we borrow architecture decisions (AudioWorklet pitch detection, canvas highway, hit windows, latency calibration) and can port code where useful. It is one person's project with no difficulty levels and no audio-to-notes for uploaded songs, which is exactly the gap we fill. |
| [fee[dB]ack](https://github.com/got-feedBack) (formerly Slopsmith) | Multi-instrument (guitar, bass, drums, keys) rhythm-game-style practice platform with real-time note detection; desktop build with low-latency audio engine. | AGPL-3.0 (app); chart format `feedpak` is CC0 | Strong project, but AGPL is viral: importing its code would force our whole app onto AGPL. We do **not** copy code. The CC0 **feedpak** chart spec is worth adopting as an interchange format later so charts can move between the two apps. |
| StringTheory | Unity desktop game that detects notes and chords live and scores them; loads Rocksmith `.psarc`, Guitar Pro and MusicXML. | GPL-3.0 (reported; verify) | Desktop/Unity, GPL. Useful as a reference for chord detection UX, not as a dependency. |
| [YARG](https://github.com/YARC-Official/YARG), FoFiX, Frets on Fire | Plastic-guitar / keyboard rhythm games. | LGPL-3.0 / GPLv2 | Not real-guitar trainers. Only interesting for highway rendering ideas. |
| TuxGuitar, MuseScore | Tab/notation editors with playback. | LGPL / GPL | They play tabs back but do not listen. Good targets to *export* to, not to build on. |

## 2. Libraries we build on (all permissive, all browser-ready)

| Need | Library | License | Notes |
|---|---|---|---|
| Read Guitar Pro (gp3/4/5/gpx/gp), MusicXML, alphaTex; render tab + notation; MIDI synth playback | [@coderline/alphatab](https://github.com/coderline/alphaTab) 1.9.0 | MPL-2.0 (fonts OFL, SoundFont Apache-2.0) | The workhorse for tab-based songs. `ScoreLoader.loadScoreFromBytes` gives us a full score model with string/fret per note and a tempo map; we convert that to our chart format. Can also render scrolling tab as an alternative view to the highway. MPL is file-level copyleft: we can use it as a dependency without relicensing our code. |
| Audio → notes for songs that have no tab | [@spotify/basic-pitch](https://github.com/spotify/basic-pitch-ts) 1.0.1 + [@tensorflow/tfjs](https://github.com/tensorflow/tfjs) | Apache-2.0 (code *and* model) | Lightweight polyphonic transcription (ICASSP 2022). Model is ~0.9 MB and runs entirely in the browser. Audio is resampled to 22.05 kHz and down-mixed to mono. Works best on one instrument at a time, so pairing it with stem separation (below) is the upgrade path. |
| Parse MIDI charts | [@tonejs/midi](https://github.com/Tonejs/Midi) | MIT | Gives notes with seconds + ticks, tempo and time-signature events. |
| Pitch detection (tuner + scoring) | own AudioWorklet implementing McLeod Pitch Method / YIN; [pitchy](https://github.com/ianprime0509/pitchy) (MIT) is the reference implementation of MPM we validate against | MIT | Running detection inside an `AudioWorkletProcessor` keeps latency at one audio block (~3 ms at 128 frames) and keeps the UI thread free. |
| Music theory (note names, intervals, chord naming, scales) | [tonal](https://github.com/tonaljs/tonal) 6.x | MIT | Used for chord naming in difficulty reduction and for the fretboard/scale tools later. |
| Local song storage | [dexie](https://dexie.org) 4.x | Apache-2.0 | IndexedDB wrapper; stores the uploaded audio blob, the chart, generated difficulty levels and high scores. |
| Slow-down practice without pitch change | Native `HTMLMediaElement.preservesPitch` (Chrome, Firefox, Safari) | n/a | Free, zero-dependency time stretching good enough for 50–100%. For higher quality or <50%: [signalsmith-stretch](https://www.npmjs.com/package/signalsmith-stretch) (MIT, WASM) or [@soundtouchjs/audio-worklet](https://www.npmjs.com/package/@soundtouchjs/audio-worklet) (MPL-2.0). |
| Metronome | Web Audio API lookahead scheduler (Chris Wilson's "A Tale of Two Clocks" pattern) | n/a | No library needed; sample-accurate clicks from `OscillatorNode`s scheduled ahead of time. |
| Tempo / beat estimation for uploaded audio | [realtime-bpm-analyzer](https://www.npmjs.com/package/realtime-bpm-analyzer) (Apache-2.0) or [web-audio-beat-detector](https://www.npmjs.com/package/web-audio-beat-detector) (MIT) | permissive | Used to build a beat grid for audio-only uploads so that the difficulty generator knows where downbeats are. Our first version estimates tempo from note onsets instead and lets the user tap/correct the BPM. |

## 3. Upgrade path for better audio-to-tab quality

Transcription of a full mix is the hardest part of this whole product; the reference
pipelines all agree on the same recipe:

1. **Separate the guitar stem** – Demucs v4 `htdemucs_6s` has a dedicated guitar stem.
   - [demucs-rs](https://github.com/nikhilunni/demucs-rs) (Apache-2.0): Rust implementation that runs *in the browser* via WebAssembly + WebGPU; weights 84 MB downloaded from Hugging Face on first use. This is how we will do stem separation client-side.
   - [demucs.cpp](https://github.com/sevagh/demucs.cpp) / freemusicdemixer (MIT) and `demucs-wasm` (npm) are the older WASM route.
   - Demucs code is MIT; the model weights have their own research-oriented terms – review before bundling.
2. **Transcribe the stem** – Basic Pitch (above). For higher guitar-specific accuracy, the CRNN of Riley et al. 2024 ("High Resolution Guitar Transcription via Domain Adaptation", GAPS weights ~99 MB) is what [tabgen](https://github.com/aguilasa/tabgen) uses. Python/PyTorch only today; exporting to ONNX and running with `onnxruntime-web` (MIT) is feasible later.
3. **Beats, key, chords** – tabgen uses madmom, whose models are **CC BY-NC-SA** (non-commercial). We avoid madmom and use permissive beat trackers instead.
4. **String/fret assignment** – dynamic programming over fingering cost (what tabgen and AutoTab/Tuttut do). We implement our own; it is ~100 lines.

Reference pipelines worth reading, not depending on:
[tabgen](https://github.com/aguilasa/tabgen) (Demucs → madmom → Riley CRNN/Basic Pitch → DP fretting → GP5/MusicXML export),
[AutoTab](https://github.com/bmcdonald3/AutoTab) (Demucs → Basic Pitch → Tuttut).
Non-commercial models we skip: MuScriptor (CC BY-NC 4.0), madmom models (CC BY-NC-SA 4.0).

## 4. Things we looked at and rejected

- **essentia.js** – powerful MIR toolkit, but AGPL-3.0 and last published 2022.
- **rubberband-wasm** – excellent time stretching, GPLv2. Native `preservesPitch` and signalsmith-stretch (MIT) cover our needs.
- **Rocksmith `.psarc` support** – DRM-adjacent and the reason Slopsmith was taken down. We support open formats only (Guitar Pro, MusicXML, MIDI, our own JSON, later feedpak).
- **Bundling other people's copyrighted songs** – users bring their own audio; the app never ships music.

## 5. Design ideas borrowed (with attribution) from the projects above

- Hit windows of about ±35 ms "perfect" / ±90 ms "good" and a streak multiplier (gryf-guitar).
- Latency calibration wizard: play with the metronome, measure the offset between click and detected onset, store it per input device (gryf-guitar, Rocksmith).
- Dynamic difficulty = thinning the note chart by salience rather than slowing the song (Rocksmith); the player chooses a fixed level per song and the game can suggest moving up or down based on accuracy (Yousician).
- Open chart format with zero lock-in (feedpak).
