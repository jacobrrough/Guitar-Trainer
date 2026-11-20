import { KEEP_AWAKE_CLIP } from './keepAwakeClip'

/**
 * Keeping an iPhone's screen on without the Wake Lock API.
 *
 * iOS holds the screen awake while a video is playing, but only if the video has a picture and a
 * sound track, is not muted, is not set to loop and has not reached its end. So a tiny silent clip
 * is played un-muted and wound back by hand before it ends. Its sound track is pure silence:
 * nothing can be heard, and it plays inside whatever audio session the app has already chosen
 * (see `setAudioSessionType`), next to the song and the microphone.
 *
 * iOS also refuses to start a video with sound unless that happens in a tap. The screens that need
 * this open the microphone first, so by the time they ask the tap is long over, and guided tuning
 * starts by itself with no tap on its screen at all. The way round it: a tap made before the clip is
 * needed calls `load()` on it, which plays nothing but lets iOS start that same element later
 * without a tap. iOS does not count every touch as a tap (lifting the finger after a scroll, for
 * one) and will not say whether it did, so this is repeated on each tap until the clip has played.
 */

/** When the video stand-in is used. Only on iOS, and only where the real API cannot do the job. */
export function videoFallbackNeeded(p: { ios: boolean; hasWakeLock: boolean; standalone: boolean; iosVersion: number | null; refused: boolean }): boolean {
  if (!p.ios) return false
  // Old iOS and app wrappers have no Wake Lock API at all.
  if (!p.hasWakeLock) return true
  // A request the phone refused (Low Power Mode does that) is respected: the screen may then lock, as
  // the owner has asked the phone to save power. The video stand-in has never been tried on a real
  // iPhone next to the microphone, so it is kept to the phones that have no other way.
  if (p.refused) return false
  // Installed apps before iOS 18.4: the request succeeds but the screen still locks.
  return p.standalone && p.iosVersion !== null && p.iosVersion < 18.04
}

/** The parts of a <video> element used here, so the rules can be tested without a browser. */
export interface AwakeVideo {
  src: string
  muted: boolean
  loop: boolean
  playsInline: boolean
  currentTime: number
  readonly paused: boolean
  play(): Promise<void>
  pause(): void
  load(): void
  addEventListener(type: 'timeupdate' | 'ended', listener: () => void): void
}

export interface KeepAwakeEnv {
  createVideo(): AwakeVideo
  isVisible(): boolean
  onVisibilityChange(listener: () => void): void
  /** Called inside every tap, click or key press. */
  onTap(listener: () => void): void
  random(): number
}

export interface KeepAwake {
  /** Sets the clip up so the next tap can unlock it. Plays nothing. */
  prepare(): void
  /** Keeps the screen on until the returned function is called. */
  acquire(): () => void
}

/** Wind back once playback passes this point: far from the end of the clip even if an update comes late. */
const REWIND_AFTER_S = 0.5
/** Wind back to somewhere in the first part, not always the same spot, as a plain repeat would be. */
const REWIND_SPAN_S = 0.4

export function createKeepAwake(env: KeepAwakeEnv): KeepAwake {
  let video: AwakeVideo | null = null
  let users = 0
  /** The clip has started at least once, which proves the phone now lets it start without a tap. */
  let played = false

  const wanted = () => users > 0 && env.isVisible()

  const play = () => {
    if (!video || !wanted()) return
    // Refused when this is not a tap and the clip is not unlocked yet: the tap listener tries again.
    video.play().then(
      () => {
        played = true
      },
      () => undefined,
    )
  }

  const stop = () => {
    if (video && !video.paused) video.pause()
  }

  const prepare = () => {
    if (video) return
    const v = env.createVideo()
    v.src = KEEP_AWAKE_CLIP
    v.muted = false
    v.loop = false
    v.playsInline = true
    v.addEventListener('timeupdate', () => {
      if (v.currentTime > REWIND_AFTER_S) v.currentTime = env.random() * REWIND_SPAN_S
    })
    v.addEventListener('ended', () => {
      if (!wanted()) return
      v.currentTime = 0
      play()
    })
    env.onTap(() => {
      if (wanted()) {
        if (v.paused) play()
      } else if (!played) {
        // Not needed yet: unlock it for later (see the note at the top of the file).
        v.load()
      }
    })
    // A video left playing would keep the audio system busy while the app is in the background.
    env.onVisibilityChange(() => (wanted() ? play() : stop()))
    video = v
  }

  return {
    prepare,
    acquire() {
      prepare()
      users++
      play()
      let released = false
      return () => {
        if (released) return
        released = true
        users--
        if (users === 0) stop()
      }
    },
  }
}

function browserEnv(): KeepAwakeEnv {
  return {
    createVideo() {
      const video = document.createElement('video')
      // Without this an iPhone opens every video full screen.
      video.setAttribute('playsinline', '')
      video.setAttribute('aria-hidden', 'true')
      // Keep it off AirPlay screens and speakers.
      video.setAttribute('x-webkit-airplay', 'deny')
      video.disableRemotePlayback = true
      video.tabIndex = -1
      video.preload = 'auto'
      video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none'
      document.body.appendChild(video)
      return video
    },
    isVisible: () => document.visibilityState === 'visible',
    onVisibilityChange: (listener) => document.addEventListener('visibilitychange', listener),
    onTap: (listener) => {
      // Capture phase, so a screen that stops the event from spreading cannot hide the tap.
      for (const type of ['touchend', 'click', 'keydown']) document.addEventListener(type, listener, { capture: true, passive: true })
    },
    random: Math.random,
  }
}

let shared: KeepAwake | null = null

/** The one clip shared by every screen, so a tap on any of them unlocks it for all. Null outside a browser. */
export function keepAwakeVideo(): KeepAwake | null {
  if (typeof document === 'undefined') return null
  shared ??= createKeepAwake(browserEnv())
  return shared
}
