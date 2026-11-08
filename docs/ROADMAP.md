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
- Coach (Phases 0–3 of ADAPTIVE_TRAINING.md): Today page with planned sessions,
  generated exercises with synthesised backing, learner model and progress page,
  placement / checkpoint / monthly skill checks, recommendations, plateau detection,
  dedicated legato / slide / bend / ear-training drills, milestones, training data
  export and import, home-screen badge
- Chroma-based chord scoring: strummed chords are judged on their pitch-class profile,
  so chord skills are no longer rating-capped; bends are judged on the reached pitch
- Section practice in the song player: loop a bar range (or the weakest bars of the last
  run) with automatic speed steps
- Safari / iOS code audit with a device checklist (`SAFARI_AUDIT.md`)
- First steps for real beginners: tier-0 open-string and first-fret drills, a
  planner mode that keeps new learners on tier 0–1 with a slowed sparse song, and
  "Listen first" on every drill with a guide track

## Next

1. **Tab view** – render the real tablature with alphaTab under/instead of the
   highway, with a synced cursor; print/export.
2. **Better transcription** – stem separation in the browser with
   [demucs-rs](https://github.com/nikhilunni/demucs-rs) (WebGPU) before Basic Pitch;
   let the user choose the guitar stem; optional isolated-guitar playback mix.
3. **Beat grid editing** – tap-to-set tempo/offset for transcribed songs; manual
   nudge of chart offset for tabs that do not line up with the recording.
4. **Practice stats** – per-song history, accuracy by section, calendar view.
5. **Reminders** – optional Web Push through a tiny relay (iOS 16.4+ installed apps);
   the only Phase 3 item deferred, because it needs a server.
6. **Open chart interchange** – import/export the CC0 `feedpak` format and plain JSON.
7. **Native builds** – finish the Capacitor iOS wrapper (background audio session,
   Files integration, TestFlight); Tauri for desktop with ASIO/low-latency drivers.
8. **Ear training depth** – intervals and chord quality recognition on top of pitch
   matching; vibrato depth/rate measurement for `lead.vibrato`.

## Known limitations

- Transcription of full mixes is rough; the model works best on exposed guitar.
  Stem separation is the planned fix.
- Chord scoring checks that a chord's pitch classes are ringing (12-bin chroma), not
  the exact voicing or fingering. Charts without chords keep the single-pitch path.
- Vibrato is scored as a held note; its depth and rate are not measured yet.
- Safari needs a user gesture before audio starts (the Play button provides it).
- iOS behaviour has been verified under Chromium emulation and by code audit only; see
  the device checklist in `SAFARI_AUDIT.md`.
