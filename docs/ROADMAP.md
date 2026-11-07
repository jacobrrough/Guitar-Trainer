# Roadmap

## Done (v0.1)

- Chromatic tuner with per-string targets, custom tunings, adjustable A4
- Metronome: 30–300 bpm, time signatures, subdivisions, accents, tap tempo
- Song library in IndexedDB; import audio + Guitar Pro / MusicXML / MIDI chart
- Audio-only import with on-device AI transcription (Basic Pitch) + tempo estimation
- Six generated difficulty levels per song (note thinning + chord reduction)
- Scrolling note highway with real-time pitch scoring, streaks, speed control,
  count-in, results and per-level best scores
- Latency calibration wizard
- Synthesised demo song for instant onboarding
- iPhone-ready PWA: install banner, offline service worker, iOS audio unlock and
  audio session handling, wake lock, phone layout; Capacitor config for a native build

## Next

1. **Section practice** – loop a bar range, auto-slowdown until clean, then speed up.
2. **Tab view** – render the real tablature with alphaTab under/instead of the
   highway, with a synced cursor; print/export.
3. **Better transcription** – stem separation in the browser with
   [demucs-rs](https://github.com/nikhilunni/demucs-rs) (WebGPU) before Basic Pitch;
   let the user choose the guitar stem; optional isolated-guitar playback mix.
4. **Beat grid editing** – tap-to-set tempo/offset for transcribed songs; manual
   nudge of chart offset for tabs that do not line up with the recording.
5. **Chord detection for scoring** – chroma-based matching so strummed chords are
   judged on more than one detected pitch.
6. **Progress & practice stats** – per-song history, accuracy by section, daily streak.
7. **Lessons** – generated exercises (scales, chord changes, string skipping) that
   use the same highway and scorer.
8. **Offline PWA** – service worker precache so the app and models work offline.
9. **Open chart interchange** – import/export the CC0 `feedpak` format and plain JSON.
10. **Native builds** – finish the Capacitor iOS wrapper (background audio session,
    Files integration, TestFlight); Tauri for desktop with ASIO/low-latency drivers.

## Known limitations

- Transcription of full mixes is rough; the model works best on exposed guitar.
  Stem separation is the planned fix.
- Polyphonic scoring accepts any chord tone (lenient by design).
- Safari needs a user gesture before audio starts (the Play button provides it).
