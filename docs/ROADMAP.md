# Roadmap

## Done (v0.1)

- Chromatic tuner with per-string targets, custom tunings, adjustable A4
- Metronome: 30–300 bpm, time signatures, subdivisions, accents, tap tempo
- Song library in IndexedDB; import audio + Guitar Pro / MusicXML / MIDI chart
- Audio-only import with on-device AI transcription (Basic Pitch) + tempo estimation
- Six generated difficulty levels per song (note thinning + chord reduction)
- Scrolling note highway with real-time pitch scoring, streaks, speed control,
  count-in, results and per-level best scores
- Latency calibration that measures down the same path a song takes (media element out,
  microphone in), so the number is the one scoring needs
- The app's own guitar is a recorded steel-string guitar (37 sampled notes, CC BY 3.0);
  bundled songs, drill guides, the demo riff and ear-training notes are rendered from it
- iPhone-ready PWA: install banner, offline service worker, iOS audio unlock and
  audio session handling, wake lock, phone layout; Capacitor config for a native build
- Coach (Phases 0–3 of ADAPTIVE_TRAINING.md): Today page with planned sessions,
  generated exercises with a click track and a guitar guide, learner model and progress page,
  placement / checkpoint / monthly skill checks, recommendations, plateau detection,
  dedicated legato / slide / bend / ear-training drills, milestones, training data
  export and import, home-screen badge
- Scoring from spectral peaks: a note or chord is hit when its own harmonics rise and
  is timed from the stroke; whole chords are judged (which strings were struck, and
  that it was not another chord); bends are judged on the reached pitch
- A virtual player proves the scoring: recordings of a real guitar go through the
  analyser and tracker the app uses, for every lesson, bundled song and exercise, in
  a dozen listening conditions (`scoring.sim.test.ts`, `scoring.patterns.sim.test.ts`,
  the opt-in `scoring.matrix.test.ts`); a virtual student plays calibration, a lesson
  and three songs through the real app in a browser (`npm run test:student`)
- Section practice in the song player: loop a bar range (or the weakest bars of the last
  run) with automatic speed steps
- Safari / iOS code audit with a device checklist (`SAFARI_AUDIT.md`)
- First steps for real beginners: tier-0 open-string and first-fret drills, a
  planner mode that keeps new learners on tier 0–1 with a slowed sparse song, and
  "Listen first" on every drill with a guide track
- Zero-to-first-song path (`BEGINNER_EXPERIENCE.md`): Start Here wizard with mic check
  and guided tuning, a ten-lesson First steps course with illustrated cards, bundled
  public-domain songs played by the app's guitar, finger numbers and string names on the
  note lane, left-handed mirroring, and plain-language copy throughout

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
- Scoring is proven in simulation on everything the ten lessons and the bundled songs
  ask for, and on every exercise at the tempo it starts at. At speed it is not all there
  yet. Measured on the recorded guitar, played exactly as written: a strum pattern at its
  target tempo (120 bpm) reads 23 of 24 strums in a quiet room but 16 of 24 through the
  phone-microphone model; power chords at 140 bpm read 30 of 32 (28 through the phone
  model, 21 played very quietly); let-ring arpeggios and fast runs across ringing strings
  lose a note or two in thirty. Strumming the open strings with no finger down still
  passes as E minor on some strums (90 in 1000 over all chord material; it was 361). The
  cases the tracker does not meet are kept in the tests as expected failures (the lists
  in `scoring.patterns.sim.test.ts` and `scoring.chords.sim.test.ts`), not hidden.
- The virtual player strums up-strokes like down-strokes (low string first) and ignores
  palm muting, so real up-strokes and muted power chords are untested.
- A hammer-on or pull-off is scored as a note; whether it was picked is not checked.
- Vibrato is scored as a held note; its depth and rate are not measured yet.
- Safari needs a user gesture before audio starts (the Play button provides it).
- iOS behaviour has been verified under Chromium emulation and by code audit only; see
  the device checklist in `SAFARI_AUDIT.md`.
