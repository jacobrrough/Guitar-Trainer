# Safari / iOS audit (iOS 16.4 to 18, Safari and installed web app)

Method: code reading against WebKit behaviour, plus inspection of the production build in `dist/`
(precache list, generated `sw.js`, manifest). No WebKit was available, so anything marked
**device** is unverified and is covered by the checklist at the end.

Severity: **blocker** (feature unusable), **degraded** (works but wrong or fragile), **cosmetic**.
Status: **fixed** = already patched in an editable file, **patch** = diff below for the integrator,
**device** = needs a phone.

## Findings

| # | Sev | Where | What breaks on iOS and when | Status |
|---|---|---|---|---|
| 1 | degraded | `src/app/AppLayout.tsx:42` (with `index.html` `black-translucent`) | Installed app draws under the status bar/Dynamic Island. `<main>` has `pt-6` but no `env(safe-area-inset-top)`, so page titles on Today/Songs/Progress/Tuner/Metronome/Settings sit under the clock. Bottom nav (`:47`) and `<main>` ignore left/right insets in landscape (notch). Player.tsx already handles insets; the app shell does not. | patch |
| 2 | degraded | `src/audio/AudioEngine.ts:79-93` (`unlock`) | Ringer switch on silent mutes all Web Audio on iOS (metronome clicks, count-in, ear-trainer reference notes) unless an audio session of type `playback`/`play-and-record` is active. Only `play-and-record` is requested, and only inside `startMic`. Metronome page and ear trainer's first note play with no mic session. | patch (`setAudioSessionType('playback')` in `unlock` when mic is off) |
| 3 | degraded | `AudioEngine.ts:68-71` (`resume`), no listeners anywhere (`grep statechange\|visibilitychange\|pageshow` finds only `useWakeLock`) | After a phone call, Siri, alarm or app switch WebKit sets the context to the non-standard `"interrupted"` state and it never returns by itself; the mic track also goes muted/ended. Tuner shows "listening" but gets no frames, metronome is silent, Player keeps scoring. | fixed in `platform.ts` (`keepAudioContextRunning`), wired by patch in AudioEngine (resume on visible, pageshow, focus, context/audioSession `statechange`, next tap; reopen the mic track if not live) |
| 4 | degraded | `src/features/play/Player.tsx:392`, phase logic | When iOS pauses the `<audio>` element (call, lock, app switch) phase stays `playing`; `PlaybackClock.time` returns a frozen `currentTime`, so the run is scored as misses and the pause button is wrong. | patch (`pause` event and `visibilitychange` hidden set phase `paused`) |
| 5 | degraded | `src/app/useWakeLock.ts` (old version) | Wake Lock in a home-screen web app resolves but does not keep the screen on before iOS 18.4 (WebKit bug 254545); WKWebView/Capacitor has no `navigator.wakeLock` at all, so the old early return did nothing. Default auto-lock is 30 s, which ends a song (screen lock stops audio). Old code also leaked a sentinel if the hook unmounted while `request()` was in flight, and re-requested without checking the old sentinel. | fixed (hidden muted canvas-stream video fallback on iOS < 18.4 standalone / no API; race fixed). **device**: whether the video keeps the screen on |
| 6 | degraded | `vite.config.ts:12` (old `registerType: 'autoUpdate'`), generated `dist/sw.js` has `skipWaiting()` and `clientsClaim()` | vite-plugin-pwa autoUpdate calls `window.location.reload()` when the new worker activates. After a deploy the first launch reloads within seconds, possibly mid-song or mid-calibration, and loses the run. `main.tsx:35` comment says "updates apply on the next launch", which was not true. | fixed (`registerType: 'prompt'`, `clientsClaim: true` so first install still controls the page). Trade-off: iOS rarely kills the app, so an update shows after the user swipes it away |
| 7 | degraded | `AudioEngine.ts:111-120` | Saved `inputDeviceId` is passed as `{ exact }`. A USB interface that is unplugged, or an id iOS reset, throws `OverconstrainedError` and the mic is dead until the user clears the setting. | patch (retry without deviceId) |
| 8 | degraded | `src/features/progress/ProgressPage.tsx:96-103` | Export uses `<a download>` on a blob and revokes the URL synchronously. Safari cancels the download when the URL is revoked immediately; in an installed app a blob navigation can strand the user in a viewer. `settings/DataSection.tsx` already does share-sheet-first correctly (its `window.open` fallback runs after awaits, so popup blockers will usually stop it). | patch |
| 9 | degraded | `src/chart/importers/transcribe.ts:23-26`, `ImportDialog.tsx:140` (hint) | OGG Vorbis (and some DRM/odd files) fail `decodeAudioData` with an `EncodingError`; user sees a raw DOMException message. The hint advertises OGG. iOS can also give `File.type === ''`, and `ImportDialog.tsx:121` falls back to `audio/mpeg`, so a FLAC/WAV stored with the wrong blob type may refuse to play in `<audio>`. | patch |
| 10 | degraded | `transcribe.ts:23-25` | Decodes through the live `AudioContext` at the device rate (48 kHz): a 10-minute stereo track is ~230 MB of Float32, plus the OfflineAudioContext render. Long files can be jetsammed on older iPhones (tab reload, no error). | not patched; **device** (try a 10 min file). If it fails, cap input at about 8 min or decode in a worker |
| 11 | degraded | `AudioEngine.ts:97`, worklet URL | Production build is fine: `dist/assets/pitch-processor-*.js` is a single self-contained file (no imports), it is in the precache list, and `NavigationRoute` only handles `mode: navigate` requests, so `addModule` is never answered with `index.html`. Unverified: whether WebKit routes worklet module fetches through the service worker; if not, the first offline launch cannot load the worklet. | patch (fetch the worklet through the page, load it from a blob URL, prod only). **device**: offline relaunch then tuner |
| 12 | cosmetic | `index.html` | No `apple-touch-startup-image`; a home-screen launch shows a white flash before CSS. | fixed partly (inline `html{background:#0b0f17}`); full splash images not added |
| 13 | cosmetic | `src/components/ui.tsx:119` | `max-h-[92vh]` on iOS Safari is taller than the visible viewport (URL bar), clipping the sheet bottom; no bottom safe-area padding on the bottom sheet. | patch |
| 14 | degraded | all text/number inputs, e.g. `TextInput`, `ImportDialog` fields (`text-sm`, 14 px) | iOS zooms the page when a field under 16 px is focused, and an installed app does not zoom back out. | fixed (iOS-only `font-size:16px` rule in `index.html`) |
| 15 | cosmetic | `InstallBanner.tsx`, `platform.ts:isSafari` | Old `isSafari` accepted most in-app WebViews (no `Chrome` token); banner said third-party browsers cannot install (outdated since iOS 16.4) and said "iPhone" on iPad. Share button moved into the ••• menu on newer iOS. | fixed |
| 16 | cosmetic | `docs/IOS.md` | Wrong/outdated claims, see below. | fixed |
| 17 | note | `CalibrationDialog.tsx:36-57` | Latency detection uses an rms jump on the worklet frames; the click played through a phone speaker leaks into the mic (echo cancellation off), so the first "attack" per click is often the click itself and the 150 ms lock-out hides the strum. Result then measures acoustic loop latency, not guitar timing. It leaves the mic open after the dialog finishes until the Settings page unmounts (`SettingsPage.tsx:39`). | **device**; recommend calibrating with headphones/interface, and `audioEngine.stopMic()` in `onClose` |
| 18 | note | `Player.tsx:370-371` | `preservesPitch` unprefixed exists from Safari 15.4, so no `webkitPreservesPitch` fallback is needed on 16.4+. WebKit can reset `playbackRate` when a paused element starts. | patch adds `defaultPlaybackRate` and a re-assert; **device** (0.5x must sound half speed and an octave stays put) |

### Checked and fine (no change)

- `Player.tsx primeMediaElement` and `AudioEngine.unlock` run synchronously in the tap; `startMic` awaits come after. Correct for iOS.
- `getUserMedia` constraints (`echoCancellation/noiseSuppression/autoGainControl: false`, `channelCount: 1`): valid; iOS may ignore some. Verify with `track.getSettings()` on device if the tuner is noisy.
- `AudioContext({ latencyHint: 'interactive' })`, `ctx.resume()` in gesture: fine. `outputLatency` is undefined on Safari, code falls back to `baseLatency` (small); real output latency on Bluetooth is not reported, so calibration is the only compensation.
- `OfflineAudioContext(1, n, 22050)` throws on old Safari and falls back to the JS resampler (`transcribe.ts:44-51`): correct.
- Viewport `viewport-fit=cover`, `apple-mobile-web-app-capable`, `apple-touch-icon` (180x180 opaque RGB PNG, confirmed with `file`): good. Vite prefixes `/icons/...` with `base` in HTML.
- Manifest: `display: standalone`, `scope: .`, `start_url: .` work with `createHashRouter`; `orientation: any` is ignored by iOS (landscape works). iOS home-screen creation uses the current URL, so a user who installs while on `#/songs` may get that hash as the start page (**device**, harmless).
- IndexedDB stores audio as `ArrayBuffer` (`db.ts:29`), avoiding the old iOS Blob bug. `getSong` rebuilds a Blob at play time. Fine.
- Precache: 6 MB total with the 4 MiB per-file cap; `.bin`, `.json`, `.js` all matched. First install on cellular downloads about 6 MB.
- `100dvh` is used (`index.css:62`, `Player.tsx` `h-dvh`); `dvh` needs iOS 15.4+. OK.

## docs/IOS.md corrections made

- "other iOS browsers cannot install web apps": outdated, iOS 16.4+ allows Add to Home Screen from Chrome/Edge/Firefox; in-app browsers cannot.
- Audio Session API "iOS 17+" stated as fact: now "where `navigator.audioSession` exists" (feature-detected in code). I could not confirm the shipping version offline.
- "WebGL in workers from iOS 17" removed as a guarantee (worker falls back to CPU in `transcribe.worker.ts`).
- Wake Lock "iOS 16.4+": true for Safari tabs, false for home-screen apps before 18.4 and for WKWebView; text updated.
- Capacitor: claim that wake lock/storage behave as in Safari was wrong (no wake lock API, no service worker, purgeable IndexedDB).
- "Audio stops in the background (no background audio for web apps)": reworded; the actual guarantee is that the mic and Web Audio stop and the app pauses.
- Mic permission re-prompt and update behaviour documented.

## Patches for the integrator

Apply from the repo root by copying the diff to a file and running `patch -p1 < file`, or by hand. The diff below was generated
against the working tree at the time of the audit (it applied cleanly with `patch --dry-run` and the patched tree
passed `tsc -b`), but `AudioEngine.ts`, `Player.tsx` and `ProgressPage.tsx` are being edited by other people;
if a hunk drifts, re-create the change from the hunk's intent. Companion changes already in place:
`platform.ts` exports `keepAudioContextRunning`, `iosBrowser`, `iosVersion`; `setAudioSessionType` is unchanged.

Patch contents by file:

1. `AppLayout.tsx`: safe-area top/bottom/left/right padding on `<main>`, sidebar and bottom nav (finding 1).
2. `ui.tsx`: `92dvh` and bottom safe-area on `Modal` (13).
3. `AudioEngine.ts`: playback session in `unlock` (2), `keepAudioContextRunning` + mic recovery (3), device fallback (7), worklet via fetch/blob (11).
4. `Player.tsx`: pause on `pause` event / page hidden (4), playbackRate hedge (18).
5. `ProgressPage.tsx`: share-sheet export, delayed revoke (8).
6. `ImportDialog.tsx`, `transcribe.ts`: friendly decode error, MIME inference, honest hint (9).

Also recommended, not in the diff: in `CalibrationDialog.tsx` call `audioEngine.stopMic()` in the `onClose` path (17).

```diff
--- a/src/app/AppLayout.tsx
+++ b/src/app/AppLayout.tsx
@@ -14,7 +14,7 @@
 export function AppLayout() {
   return (
     <div className="flex min-h-full flex-col md:flex-row">
-      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel p-4 md:flex">
+      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel p-4 pl-[max(1rem,env(safe-area-inset-left))] pt-[calc(env(safe-area-inset-top)+1rem)] md:flex">
         <div className="mb-8 flex items-center gap-2 px-2">
           <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
           <span className="text-lg font-bold tracking-tight">Guitar Trainer</span>
@@ -39,12 +39,12 @@
         </nav>
         <p className="mt-auto px-2 text-xs text-muted">Free &amp; open source. Everything runs in your browser.</p>
       </aside>
-      <main className="flex-1 overflow-y-auto px-4 pb-24 pt-6 short-landscape:pb-16 short-landscape:pt-3 md:px-8 md:pb-8">
+      <main className="flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+6rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+1.5rem)] short-landscape:pb-[calc(env(safe-area-inset-bottom)+4rem)] short-landscape:pt-3 md:px-8 md:pb-8 md:pt-6">
         <div className="mx-auto w-full max-w-5xl">
           <Outlet />
         </div>
       </main>
-      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-panel/95 backdrop-blur md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
+      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-panel/95 backdrop-blur md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
         {NAV.map(({ to, label, icon: Icon, end }) => (
           <NavLink
             key={to}
--- a/src/components/ui.tsx
+++ b/src/components/ui.tsx
@@ -116,7 +116,8 @@
         role="dialog"
         aria-modal="true"
         aria-label={title}
-        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
+        className={cx('max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-5 shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
+        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
         onClick={(e) => e.stopPropagation()}
       >
         <div className="mb-4 flex items-center justify-between">
--- a/src/audio/AudioEngine.ts
+++ b/src/audio/AudioEngine.ts
@@ -1,4 +1,4 @@
-import { setAudioSessionType } from '../app/platform'
+import { keepAudioContextRunning, setAudioSessionType } from '../app/platform'
 import pitchWorkletUrl from './pitch/pitch-processor.ts?worker&url'
 
 export interface PitchFrame {
@@ -42,10 +42,16 @@
   private _micDeviceId: string | undefined
   private unlocked = false
   private chromaEnabled = false
+  private lastMicOptions: MicOptions = {}
 
   get context(): AudioContext {
     if (!this.ctx) {
       this.ctx = new AudioContext({ latencyHint: 'interactive' })
+      // iOS "interrupted" state (phone call, Siri, app switch) never recovers by itself.
+      keepAudioContextRunning(this.ctx, () => void this.recoverMic())
+      document.addEventListener('visibilitychange', () => {
+        if (document.visibilityState === 'visible') void this.recoverMic()
+      })
     }
     return this.ctx
   }
@@ -79,6 +85,8 @@
   unlock(): void {
     const ctx = this.context
     if (ctx.state !== 'running') void ctx.resume()
+    // Without a mic session iOS mutes Web Audio (metronome, count-in, ear trainer) when the ringer switch is on silent.
+    if (!this._micActive) setAudioSessionType('playback')
     if (this.unlocked) return
     try {
       const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
@@ -94,7 +102,7 @@
 
   private ensureWorklet(): Promise<void> {
     if (!this.workletLoaded) {
-      this.workletLoaded = this.context.audioWorklet.addModule(pitchWorkletUrl).catch((err) => {
+      this.workletLoaded = this.loadWorkletModule().catch((err) => {
         this.workletLoaded = null
         throw err
       })
@@ -102,22 +110,68 @@
     return this.workletLoaded
   }
 
+  /**
+   * In production the worklet is fetched with fetch() (always routed through the service worker, so it
+   * works offline) and loaded from a blob URL; the bundle is a single file with no imports. If that fails
+   * we fall back to the plain URL. In dev the module imports other files, so the URL is used directly.
+   */
+  private async loadWorkletModule(): Promise<void> {
+    const worklet = this.context.audioWorklet
+    if (import.meta.env.PROD) {
+      try {
+        const res = await fetch(pitchWorkletUrl)
+        if (res.ok) {
+          const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }))
+          try {
+            await worklet.addModule(blobUrl)
+            return
+          } finally {
+            URL.revokeObjectURL(blobUrl)
+          }
+        }
+      } catch {
+        /* fall through to the direct URL */
+      }
+    }
+    await worklet.addModule(pitchWorkletUrl)
+  }
+
+  private async openMicStream(options: MicOptions): Promise<MediaStream> {
+    const base = { echoCancellation: options.echoCancellation ?? false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
+    try {
+      return await navigator.mediaDevices.getUserMedia({
+        audio: { ...base, deviceId: options.deviceId ? { exact: options.deviceId } : undefined },
+        video: false,
+      })
+    } catch (err) {
+      // A saved interface that was unplugged (or whose id iOS reset) must not lock the user out of the mic.
+      if (options.deviceId && err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
+        return navigator.mediaDevices.getUserMedia({ audio: base, video: false })
+      }
+      throw err
+    }
+  }
+
+  /** After backgrounding or a call iOS leaves the mic track muted/ended; reopen it. */
+  private async recoverMic(): Promise<void> {
+    if (!this._micActive) return
+    const track = this.stream?.getAudioTracks()[0]
+    if (track && track.readyState === 'live' && !track.muted) return
+    try {
+      await this.startMic(this.lastMicOptions)
+    } catch {
+      this._micActive = false
+    }
+  }
+
   async startMic(options: MicOptions = {}): Promise<void> {
     await this.resume()
     this.stopMic()
     const ctx = this.context
+    this.lastMicOptions = options
     // iOS: ask for a session that records and plays through the speaker at full volume.
     setAudioSessionType('play-and-record')
-    const stream = await navigator.mediaDevices.getUserMedia({
-      audio: {
-        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
-        echoCancellation: options.echoCancellation ?? false,
-        noiseSuppression: false,
-        autoGainControl: false,
-        channelCount: 1,
-      },
-      video: false,
-    })
+    const stream = await this.openMicStream(options)
     await this.ensureWorklet()
     this.stream = stream
     this.source = ctx.createMediaStreamSource(stream)
@@ -148,6 +202,7 @@
     this.worklet.connect(this.sink)
     this.sink.connect(ctx.destination)
     this._micActive = true
+    stream.getAudioTracks()[0]?.addEventListener('unmute', () => void this.recoverMic())
     this._micDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? options.deviceId
   }
 
--- a/src/features/play/Player.tsx
+++ b/src/features/play/Player.tsx
@@ -159,6 +159,28 @@
 
   useWakeLock(phase === 'playing' || phase === 'countin')
 
+  // iOS pauses the <audio> element behind our back (phone call, Siri, lock screen, app switch) and cuts the
+  // mic. Without this the highway keeps "playing" a frozen clock and the run is scored as misses.
+  useEffect(() => {
+    const interrupted = () => {
+      const el = audioRef.current
+      if (!el || phaseRef.current !== 'playing' || el.ended) return
+      el.pause()
+      playbackStartedRef.current = false
+      setPhase('paused')
+    }
+    const onVisibility = () => {
+      if (document.visibilityState === 'hidden') interrupted()
+    }
+    const el = audioRef.current
+    el?.addEventListener('pause', interrupted)
+    document.addEventListener('visibilitychange', onVisibility)
+    return () => {
+      el?.removeEventListener('pause', interrupted)
+      document.removeEventListener('visibilitychange', onVisibility)
+    }
+  }, [setPhase])
+
   // Audio source.
   useEffect(() => {
     const url = URL.createObjectURL(audio)
@@ -367,6 +389,8 @@
     if (!audioEngine.micActive && micStatus !== 'error') await startMic()
     await audioEngine.resume()
     const p = propsRef.current
+    // WebKit can reset the rate when a paused element starts; set the default too and re-assert after play().
+    el.defaultPlaybackRate = p.speed
     el.playbackRate = p.speed
     el.preservesPitch = true
     const loopStart = p.loopBars ? (barStartTime(p.chart, p.loopBars[0]) ?? 0) : 0
@@ -390,6 +414,7 @@
       el.muted = false
       playbackStartedRef.current = true
       await el.play()
+      if (el.playbackRate !== p.speed) el.playbackRate = p.speed
     } catch (err) {
       playbackStartedRef.current = false
       skipCountInRef.current = true
--- a/src/features/progress/ProgressPage.tsx
+++ b/src/features/progress/ProgressPage.tsx
@@ -1,5 +1,6 @@
 import { Award, Download, Trash2, TrendingUp, Upload } from 'lucide-react'
 import { useMemo, useRef, useState } from 'react'
+import { isIOS } from '../../app/platform'
 import { Badge, Button, Card, PageHeader } from '../../components/ui'
 import { masteryBand, effectiveRating } from '../../training/learner'
 import { SKILLS } from '../../training/skills'
@@ -93,14 +94,27 @@
 
   const onExport = async () => {
     const json = await exportTrainingData()
-    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
+    const name = `guitar-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`
+    const blob = new Blob([json], { type: 'application/json' })
+    // iOS (esp. installed web apps): the share sheet is the only reliable way to reach Files.
+    const file = new File([blob], name, { type: 'application/json' })
+    if (isIOS() && navigator.canShare?.({ files: [file] })) {
+      try {
+        await navigator.share({ files: [file], title: name })
+      } catch (err) {
+        if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
+      }
+      return
+    }
+    const url = URL.createObjectURL(blob)
     const a = document.createElement('a')
     a.href = url
-    a.download = `guitar-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`
+    a.download = name
     document.body.appendChild(a)
     a.click()
     a.remove()
-    URL.revokeObjectURL(url)
+    // Safari cancels the download if the URL is revoked synchronously.
+    setTimeout(() => URL.revokeObjectURL(url), 10_000)
   }
 
   const onImport = async (file: File | undefined) => {
--- a/src/features/library/ImportDialog.tsx
+++ b/src/features/library/ImportDialog.tsx
@@ -35,6 +35,13 @@
   }
 }
 
+/** iOS can hand over files with an empty MIME type; <audio> picks its decoder from the blob type. */
+function audioTypeFromName(name: string): string {
+  const ext = name.split('.').pop()?.toLowerCase() ?? ''
+  const map: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf', ogg: 'audio/ogg' }
+  return map[ext] ?? 'audio/mpeg'
+}
+
 export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (id: number) => void }) {
   const settings = useSettings()
   const [audioFile, setAudioFile] = useState<File | null>(null)
@@ -118,7 +125,7 @@
         title: chart.title || audioFile.name,
         artist: chart.artist,
         audio: audioFile,
-        audioType: audioFile.type || 'audio/mpeg',
+        audioType: audioFile.type || audioTypeFromName(audioFile.name),
         audioName: audioFile.name,
         duration,
         chart: { ...chart, duration: Math.max(chart.duration, duration) },
@@ -137,7 +144,7 @@
   return (
     <Modal title="Add a song" onClose={busy ? undefined : onClose} wide>
       <div className="flex flex-col gap-5">
-        <Field label="Audio file" hint="MP3, WAV, FLAC, OGG, M4A… the recording you want to play along with.">
+        <Field label="Audio file" hint="MP3, M4A, WAV, FLAC… the recording you want to play along with. (OGG does not play on iPhone.)">
           <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" disabled={busy} onChange={(e) => onAudio(e.target.files?.[0] ?? null)} className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-slate-100" />
         </Field>
         <div className="grid gap-3 sm:grid-cols-2">
--- a/src/chart/importers/transcribe.ts
+++ b/src/chart/importers/transcribe.ts
@@ -22,7 +22,15 @@
 
 export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
   const data = await blob.arrayBuffer()
-  return audioEngine.context.decodeAudioData(data)
+  try {
+    return await audioEngine.context.decodeAudioData(data)
+  } catch (err) {
+    // WebKit rejects with an EncodingError / "Unable to decode audio data" for OGG Vorbis, DRM'd or truncated files.
+    if (err instanceof DOMException && (err.name === 'EncodingError' || err.name === 'NotSupportedError')) {
+      throw new Error('This device cannot decode that audio file. On iPhone use MP3, M4A, WAV, AIFF or FLAC (OGG is not supported).')
+    }
+    throw err
+  }
 }
 
 async function renderMono(buffer: AudioBuffer, sampleRate: number): Promise<Float32Array> {
```

## Device checklist (about 15 minutes, iPhone, installed from Safari)

Use headphones for rows marked H. Do rows in order; later rows reuse state.

| # | Step | Expected | A failure indicates |
|---|---|---|---|
| 1 | In Safari open the site, Share (or •••) > Add to Home Screen, launch from the icon. Check the banner is gone. | Full-screen, dark first paint (no white flash), page title is below the clock/Dynamic Island, bottom nav above the home bar. | Titles under the status bar: AppLayout patch (finding 1) not applied. White flash: cosmetic, add startup images. Banner still shown: `isStandalone` broken. |
| 2 | Tuner: tap Start, allow the microphone. Pluck the low E. | Needle settles on E within about 1 s. Permission prompt appears once. | No frames: worklet not loaded (see row 9) or mic blocked. Wrong octave or jitter: constraints ignored (AGC/noise suppression on). |
| 3 | Set the ringer switch to silent. Metronome: Start. | Clicks are audible, beat dots follow. | Silent: finding 2 patch missing (`playback` session). |
| 4 | Library: play the demo song with the phone speaker (no headphones). Enable Speaker mode if scoring runs away. | Count-in clicks, then song at full volume, no "tap again" notice, highway moves in time. Volume is not earpiece-quiet. | Earpiece-level volume: audio session not `play-and-record` (API missing on this iOS). "Tap play once more": element priming failed. |
| 5 | In the same song set speed 0.5x, then 1x. | Half speed with unchanged pitch; the highway stays on the beat. | Pitch drops: `preservesPitch` ignored. Highway drifts: playbackRate reset by WebKit (finding 18). |
| 6 | While playing: press the side button (lock), wait 5 s, unlock. Then switch to another app and back. | Song is paused (not "playing" over a frozen highway). Pressing play resumes with sound and the mic still scores. | Still "playing": finding 4 patch missing. Resumes silent: context stuck `interrupted` (finding 3). Mic scores nothing: track not reopened. |
| 7 | Leave a song playing with no touches for 90 s (auto-lock 30 s). | Screen stays on. | Screen locks: Wake Lock and the video fallback both ineffective on this iOS (finding 5), tell users to disable Auto-Lock. |
| 8 | Phone call interruption: call the phone (or set a 1-minute timer and let it ring) during the tuner and during the metronome. Dismiss. | Metronome and tuner continue after dismissing, at most after one tap. | Permanently silent/frozen: `interrupted` not recovered (finding 3). |
| 9 | Offline relaunch: with the app installed and used once online, enable Airplane mode, force-quit and relaunch. Open Tuner. | App loads, library visible, tuner works. | Blank: SW not controlling (check `clientsClaim`). Tuner fails only offline: worklet fetch bypassed the SW (finding 11, blob patch). |
| 10 | H: plug in wired/USB headphones or an interface mid-session, then unplug. Then Bluetooth headphones. | Audio follows the route, mic still works. Bluetooth shows large latency; Settings calibration compensates. | Mic dies after route change: track recovery (finding 3). Unplugged interface leaves mic error: finding 7. |
| 11 | Import: Library > Import, choose an MP3 and then an M4A from the Files app, then a .gp5 file. Try an .ogg once. | MP3/M4A decode and (auto mode) transcribe within a minute or two for 1 minute of audio; GP imports. OGG gives the friendly "cannot decode" message. Song plays after relaunch. | Hang or tab reload on long file: memory (finding 10). Silent playback after import: blob MIME (finding 9). |
| 12 | Settings > Export training data, and Progress > Export. | Share sheet opens, "Save to Files" works for both. | Progress export does nothing or strands the app in a viewer: finding 8. |
| 13 | Settings > Calibrate with headphones, strum a muted string on 8 clicks. Then repeat on the speaker. | At least 3 of 8 detected; result plausible (headphones 60-250 ms). Orange mic dot disappears afterwards. | Speaker run reports click bleed and wrong latency: finding 17. Mic stays on: missing `stopMic`. |
| 14 | Today > Coach: run a Coach block that uses the highway, then a chord/strum block. | Same behaviour as row 4 inside the block runner; rotating to landscape keeps playing; controls clear of notch/home bar. | Transport differences vs Player page: BlockRunner wiring. |
| 15 | Today > Ear trainer block. | Reference note audible (also on silent), mic starts after the tap, your sung/played note is judged only after the reference ends. | No reference note: row 3 cause. Judged on the reference tone: gating (`ignoreUntil`) too short for speaker bleed. |
| 16 | Deploy a new build, reopen the installed app. | App keeps working on the old version, new version appears after swiping the app away and relaunching; no mid-session reload. | Reload mid-session: `vite.config.ts` change not deployed (finding 6). |
