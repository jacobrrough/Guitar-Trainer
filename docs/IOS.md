# Guitar Trainer on iPhone

The app is built iPhone-first as an installable web app (PWA). That is deliberate:
it is free to distribute, needs no Mac or developer account, updates instantly, and
Safari on iOS 16.4+ has what we need (AudioWorklet, getUserMedia, Web Workers,
IndexedDB, Wake Lock outside home-screen apps). Some of it needs a workaround on
particular versions; see `docs/SAFARI_AUDIT.md` for the code-level audit.
Transcription falls back from WebGL to CPU when the worker has no usable WebGL. A native wrapper for the App
Store is prepared with Capacitor (see the end of this page).

## Install on an iPhone

The hosted build lives at <https://jacobrrough.github.io/Guitar-Trainer/>.

1. Open the site in **Safari**. Chrome, Edge and Firefox on iOS 16.4+ can also add a home-screen
   web app, but in-app browsers (Instagram, Facebook, Mail links...) cannot.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch it from the home screen. It runs full screen, works offline after the first
   visit, and its storage is exempt from Safari's 7-day eviction of website data.

The app must be served over HTTPS; GitHub Pages (the included workflow) qualifies.

## Audio setup that actually works on a phone

| Situation | What to do |
|---|---|
| **Best:** audio interface (USB-C / Lightning, class compliant, e.g. iRig HD, Focusrite Scarlett Solo, Apogee Jam) | Plug in, pick it under Settings → Input device, run *Calibrate*. Headphones from the interface. |
| Wired headphones + built-in mic | Works well for acoustic and clean tones. Calibrate once. |
| Bluetooth headphones | Playable, but expect 150–250 ms of latency. Calibration compensates for scoring, but the count-in and your own picking will feel late. Prefer wired. |
| Phone speaker, no headphones | The song leaks from the speaker into the mic and gets "played" for you. Turn on **Settings → Speaker mode** (echo cancellation) and keep the volume moderate. Scores are less reliable in this mode. |

Other iOS details handled by the app:

- Audio starts only from a tap. The Start button unlocks the audio engine and the
  song element synchronously, before the count-in. If Safari still refuses (older
  versions), the next tap starts the song immediately without a count-in.
- With the microphone on, the app requests a *play-and-record* audio session
  (Audio Session API, used where `navigator.audioSession` exists) so playback keeps using the
  speaker at full volume. Without the mic it requests a *playback* session so the
  metronome and count-in are not muted by the ringer switch.
- The screen stays awake while you play, tune or run the metronome (Wake Lock API in Safari
  16.4+). Home-screen web apps only honour it from iOS 18.4; on 16.4 to 18.3 (and in a
  Capacitor wrapper, which has no Wake Lock API) the app plays a hidden muted video instead.
- After a phone call, Siri or an app switch the app resumes the audio engine and reopens the
  microphone; a song that was playing is paused rather than silently scored.
- Audio is stored as raw bytes in IndexedDB rather than as Blobs, which have a
  history of corruption on iOS.
- Transcription resampling falls back to a JavaScript resampler on Safari versions
  whose OfflineAudioContext cannot render 22.05 kHz.

## Formats

Safari decodes **MP3, M4A/AAC, WAV, AIFF, FLAC and CAF**. It does not decode
**OGG Vorbis** on most iOS versions; convert those first. Guitar Pro (.gp, .gp3–.gp5, .gpx), MusicXML
and MIDI files open from the Files app through the normal file picker.

## Limitations on iOS

- The microphone and Web Audio stop when the app goes to the background or the screen
  locks, and the app pauses the song. Scoring cannot run in the background.
- Safari caps the storage of a *non-installed* site and may evict it after 7 days
  without use. Install to the home screen to keep your library.
- The microphone permission is typically asked again each time an installed web app is
  launched from a cold start (iOS does not persist it for home-screen apps).
- A new version of the app is applied the next time every window of it has been closed
  (swipe it away in the app switcher); it never reloads mid-song.
- Transcription of a full song takes longer on a phone (expect about a minute for a
  4-minute track on a recent iPhone; longer on older models). It runs in a worker,
  so the UI stays responsive, but keep the app in the foreground.

## Layout

The play screen adapts: in portrait the level and speed controls move to a second
row and the highway shows less look-ahead so notes stay readable; in landscape the
controls return to the header and the HUD shrinks. Tap the highway to pause and
resume. Rotating to landscape gives the most comfortable highway.

## Native app with Capacitor (optional)

`capacitor.config.ts` is already in the repo. Building for a device needs a Mac
with Xcode. A free Apple ID can sideload to your own iPhone (the build expires after
7 days and must be re-installed); the $99/year developer program is only needed for
TestFlight or the App Store.

```bash
npm install
npm run build
npx cap add ios          # creates ios/ (once)
npm run cap:ios          # build, copy dist/ into the project and open Xcode
```

Then in Xcode:

1. Set your Team under *Signing & Capabilities* and pick a unique bundle id.
2. In `ios/App/App/Info.plist` add
   `NSMicrophoneUsageDescription` = "Guitar Trainer listens to your guitar to score what you play."
3. Optional: add `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace` so
   songs can be dropped in through Files.
4. Run on your iPhone.

The web code detects the wrapper through `window.Capacitor` and skips the install
banner. Audio, storage and the audio session behave as in Safari because Capacitor uses
WKWebView, with these differences: there is no service worker (no offline cache, the files
ship inside the app), no `navigator.wakeLock` (the hidden-video fallback is used) and the
WebView's IndexedDB can be purged by iOS under storage pressure, so use Export regularly.

## Checklist for a real device (not yet done)

The 15-minute version with expected results is the *Device checklist* in `docs/SAFARI_AUDIT.md`.

This build was verified in Chromium with iPhone viewport/touch emulation and a fake
microphone. These need a real iPhone:

- [ ] Start from the home-screen app: count-in clicks, then song audio, no "tap again" notice
- [ ] Tuner reads a plucked string within a second; needle stable
- [ ] Mic on + song playing through headphones: notes register and score
- [ ] Mic on + phone speaker: Speaker mode reduces self-scoring
- [ ] Latency calibration completes with ≥ 3 of 8 strums detected
- [ ] Import an MP3 from Files and a Guitar Pro file from Files
- [ ] AI transcription finishes on a 1-minute clip
- [ ] Screen stays on during a song; rotating keeps the song running
- [ ] Library survives closing the app and relaunching
