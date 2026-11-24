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
| Phone speaker, no headphones | The microphone hears the speaker, so the song would score itself. While the mic is on, the app's own songs and drills play the click track only; tap the speaker icon to hear the guitar part. If the part is on and the count-in is heard through the speaker, the run is shown as "did not count" and nothing is saved. For real recordings use headphones, or turn on **Settings → Speaker mode** (echo cancellation), which iOS pays for with phone-call playback quality. Sync your sound (calibration) works here too: the click's own echo is a valid measurement of the delay. |

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
  Capacitor wrapper, which has no Wake Lock API) the app plays a tiny silent video clip
  instead, which is what keeps an iPhone's screen on. That stand-in has not been tried on
  a real iPhone yet: if the screen still locks on those versions, raise Auto-Lock in the
  iOS settings while you practise. In Low Power Mode iOS refuses the wake lock and the app
  respects that.
- After a phone call, Siri or an app switch the app resumes the audio engine and reopens the
  microphone; a song that was playing is paused rather than silently scored.
- Audio is stored as raw bytes in IndexedDB rather than as Blobs, which have a
  history of corruption on iOS.
- Transcription resampling falls back to a JavaScript resampler on Safari versions
  whose OfflineAudioContext cannot render 22.05 kHz.

## Singing on a phone

The singing side (see `docs/SINGING.md`) is in the build behind a flag and has not been
tried on a real phone or with a real voice. What it adds to the picture above:

| Situation | What happens |
|---|---|
| Phone speaker, no headphones (the default) | The singer hears a click and one starting note before the tune; from "Whole tune" on that note is all the help there is. On the two echo levels of a song and in exercises the guide voice sings its turn first. The guide never sings while the singer is scored, and the app gives no credit for anything heard while one of its own notes sounds, so a phone on a table cannot sing a song into its own microphone. |
| Wired headphones | Answer "Yes" to "Are you wearing headphones?" in the singing set-up, or tick **Settings → Singing → I use headphones**. The guide then sings the singer's notes along with them (in exercises and on the first four levels of a song; the last two levels leave the tune to the singer) and a song gets its strummed chords. |
| Guide on, but the phone hears itself | Two checks: the count-in clicks heard through the microphone, and one of the app's own notes coming back on time and on pitch. Either makes the run "did not count"; the app turns "I use headphones" and the guide off, and the next try can count. A singer who really wears headphones and joins the guide from its very first moment looks the same to the microphone; the notice says how to turn the guide back on. |
| Headphones pulled out in the middle of a run with the guide on | The browser reports a change of audio devices and the run becomes practice: nothing is saved. A change in the first 3 seconds after the microphone opens is ignored, because granting the permission and a headset connecting raise the same event. How real headsets behave here is unchecked. |
| Bluetooth headset | Opening the microphone can switch a wireless headset to its call mode, which puts the whole audio context at 16 or 24 kHz. Scoring measures in seconds, not in frames, and is simulated at both rates. At 16 kHz the pitch detector's window is 128 ms long: a low voice with a wide vibrato is counted but not clean, a singer steadily a little off is given a note here and there, and the count-in check can miss a faint speaker. Expect the 150–250 ms of delay as on the guitar. |

Other details:

- **Speaker mode is not offered for singing.** Echo cancellation would take the voice out
  together with the guide. The setting still applies to the microphone as the learner left
  it; what it does to a long held note is one of the device checks.
- **Sound delay.** A sung result is judged on pitch; when a note begins is measured and
  never fails a run. The notes are still lined up with the same latency setting the guitar
  uses (simulated clean at 60 and 250 ms of delay with the setting matched), so the
  singing set-up offers **Sync your sound** on its phone step when the phone has never
  been measured. It can be skipped.
- **Pitch standard.** Singing is judged against A = 440 Hz whatever "Reference pitch" says,
  because the starting notes and the recorded chords are at 440.
- **Low starting notes.** Under 110 Hz the guide voice adds the octave above, because a
  phone speaker plays almost nothing that low. Whether a low voice can hear its starting
  note from the speaker is unchecked.
- **Screen awake.** The range finder, "My voice" and "Meet the note" ask for the wake lock
  while the microphone listens, and a sung run while it plays, through the same
  `useWakeLock` as the tuner and the guitar player. The caveats above apply unchanged:
  home-screen apps before iOS 18.4 get the silent-clip stand-in, which has not been tried
  on a real iPhone.
- **Back to the guitar.** A voice screen narrows the pitch detector to a voice and sets it
  back to the guitar's range (55 to 1500 Hz) when it closes, so the tuner still reads both
  E strings afterwards.
- **Opening a song.** A song to sing is arranged for the singer's range and rendered when
  it is opened ("Getting your song ready"). The chords are rendered in a worker, the rest
  on the main thread; on an old phone the page may not answer for a second or more.

The device checks for singing, with what to expect, are the numbered list in
`docs/SINGING.md` §11. None of them has been done.

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
- New versions arrive by themselves. The app looks for one when it is opened and when it
  comes back to the foreground. A version that is already downloaded is switched to while
  the app is opening, or the next time the app is put away on a quiet screen; otherwise
  the main screens show an **Update now** bar. It never reloads in the middle of a song,
  a lesson, tuning or a test. **Settings → About** shows which version is running and has
  a **Check for updates** button. After an update that changes the guitar sound, the
  bundled songs are rendered again in the background the next time the app opens.
- The app asks iOS to keep its saved songs and progress (persistent storage). For an app
  on the home screen this is granted without a question; Settings → About shows whether
  the data is protected.
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
   (Once the singing side is released: "… listens to your guitar or your voice to score what you play or sing.")
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
The checks for the singing side are a list of their own, `docs/SINGING.md` §11; they need the
preview key (`localStorage['gt.voice'] = '1'`) while the singing side is not released.

This build was verified in Chromium with iPhone viewport/touch emulation and a fake
microphone. These need a real iPhone:

- [ ] Start from the home-screen app: count-in clicks, then song audio, no "tap again" notice
- [ ] Tuner reads a plucked string within a second; needle stable
- [ ] Mic on + song playing through headphones: notes register and score
- [ ] Mic on + phone speaker: Speaker mode reduces self-scoring
- [ ] Sync your sound (Settings → Advanced): the dots light on each click and the result is plausible (speaker 20–80 ms, wired headphones 40–150 ms, Bluetooth 150–300 ms)
- [ ] Import an MP3 from Files and a Guitar Pro file from Files
- [ ] AI transcription finishes on a 1-minute clip
- [ ] Screen stays on during a song; rotating keeps the song running
- [ ] Library survives closing the app and relaunching
- [ ] Settings → About shows the build of the last deploy; "Check for updates" answers
- [ ] "Listen first" in lesson 1 sounds like a recorded acoustic guitar, also on the very
      first launch over mobile data (if it sounds like a synthesiser, the recordings did
      not load: it should correct itself within a minute of being online)
- [ ] After Sync your sound, lesson 1's practice round played on the beat reads mostly
      "perfect" (not all early or all late), with the phone speaker and with headphones
- [ ] The same round with nothing played says "We did not hear any notes", and nothing is saved
- [ ] A call or Siri during the count-in: the song does not start by itself afterwards,
      and the next tap counts in again
- [ ] Headphones unplugged or AirPods removed in the middle of a song: the run is paused
      or reported as not counted, never saved as a low score
- [ ] A loop of two bars over Bluetooth headphones: the last note before the loop point
      is judged, pass after pass
