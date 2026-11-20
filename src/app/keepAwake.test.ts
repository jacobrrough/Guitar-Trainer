import { describe, expect, it, vi } from 'vitest'
import { createKeepAwake, videoFallbackNeeded } from './keepAwake'
import type { AwakeVideo, KeepAwakeEnv } from './keepAwake'
import { KEEP_AWAKE_CLIP } from './keepAwakeClip'

/**
 * Stand-in for an iPhone's <video>: like the real one it refuses to start with sound unless the
 * call comes from a tap, or the element was used inside a tap before.
 */
function fakePhone() {
  let inTap = false
  let allowed = false
  let visible = true
  const listeners: Record<string, Array<() => void>> = {}
  const taps: Array<() => void> = []
  const visibility: Array<() => void> = []
  const state = { paused: true }
  const video = {
    src: '',
    muted: false,
    loop: false,
    playsInline: false,
    currentTime: 0,
    get paused() {
      return state.paused
    },
    play: vi.fn(async () => {
      if (inTap) allowed = true
      if (!allowed) throw new Error('NotAllowedError')
      state.paused = false
    }),
    pause: vi.fn(() => {
      state.paused = true
    }),
    load: vi.fn(() => {
      if (inTap) allowed = true
    }),
    addEventListener(type: string, listener: () => void) {
      ;(listeners[type] ??= []).push(listener)
    },
  }
  const env: KeepAwakeEnv = {
    createVideo: () => video as AwakeVideo,
    isVisible: () => visible,
    onVisibilityChange: (listener) => void visibility.push(listener),
    onTap: (listener) => void taps.push(listener),
    random: () => 0.5,
  }
  return {
    env,
    video,
    /** A tap on the screen; `handler` is what the tapped button does. */
    tap(handler?: () => void) {
      inTap = true
      taps.forEach((listener) => listener())
      handler?.()
      inTap = false
    },
    /** A touch the phone does not count as a tap, such as lifting the finger after a scroll. */
    scrollEnd() {
      taps.forEach((listener) => listener())
    },
    show(next: boolean) {
      visible = next
      visibility.forEach((listener) => listener())
    },
    emit(type: 'timeupdate' | 'ended') {
      listeners[type]?.forEach((listener) => listener())
    },
    /** Lets pending play() promises settle. */
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  }
}

describe('videoFallbackNeeded', () => {
  const iphone = { ios: true, hasWakeLock: true, standalone: false, iosVersion: 17.05, refused: false }

  it('is never used outside iOS', () => {
    expect(videoFallbackNeeded({ ios: false, hasWakeLock: false, standalone: true, iosVersion: null, refused: true })).toBe(false)
  })
  it('is not used where the Wake Lock API works (Safari tab, or an installed app from iOS 18.4)', () => {
    expect(videoFallbackNeeded(iphone)).toBe(false)
    expect(videoFallbackNeeded({ ...iphone, standalone: true, iosVersion: 18.04 })).toBe(false)
    expect(videoFallbackNeeded({ ...iphone, standalone: true, iosVersion: 26.01 })).toBe(false)
  })
  it('is used where the API is missing (old iOS, app wrappers)', () => {
    expect(videoFallbackNeeded({ ...iphone, hasWakeLock: false })).toBe(true)
  })
  it('is used in an installed app before iOS 18.4, where the lock is granted but does nothing', () => {
    expect(videoFallbackNeeded({ ...iphone, standalone: true, iosVersion: 16.04 })).toBe(true)
    expect(videoFallbackNeeded({ ...iphone, standalone: true, iosVersion: 18.03 })).toBe(true)
  })
  it('is not used when a working API refuses (Low Power Mode): that choice is the owner’s', () => {
    expect(videoFallbackNeeded({ ...iphone, refused: true })).toBe(false)
  })
})

describe('the keep-awake clip', () => {
  const bytes = Buffer.from(KEEP_AWAKE_CLIP.replace('data:video/mp4;base64,', ''), 'base64')

  /** Child boxes of an MP4 box: [type, start of content, end]. */
  function boxes(start: number, end: number): Array<[string, number, number]> {
    const found: Array<[string, number, number]> = []
    for (let at = start; at + 8 <= end; ) {
      const size = bytes.readUInt32BE(at)
      if (size < 8) break
      found.push([bytes.toString('latin1', at + 4, at + 8), at + 8, at + size])
      at += size
    }
    return found
  }
  const child = (parent: [string, number, number], type: string) => {
    const hit = boxes(parent[1], parent[2]).find(([t]) => t === type)
    if (!hit) throw new Error(`no ${type} box`)
    return hit
  }

  it('is an MP4 with both a picture track and a sound track', () => {
    // An iPhone only keeps the screen on for a video that has sound as well as picture.
    expect(KEEP_AWAKE_CLIP.startsWith('data:video/mp4;base64,')).toBe(true)
    const top = boxes(0, bytes.length)
    expect(top[0][0]).toBe('ftyp')
    const moov = top.find(([t]) => t === 'moov')!
    const tracks = boxes(moov[1], moov[2]).filter(([t]) => t === 'trak')
    const kinds = tracks.map((trak) => {
      const mdia = child(trak, 'mdia')
      const handler = bytes.toString('latin1', child(mdia, 'hdlr')[1] + 8, child(mdia, 'hdlr')[1] + 12)
      const stsd = child(child(child(mdia, 'minf'), 'stbl'), 'stsd')
      return `${handler}:${bytes.toString('latin1', stsd[1] + 12, stsd[1] + 16)}`
    })
    expect(kinds.sort()).toEqual(['soun:mp4a', 'vide:avc1'])
  })

  it('is long enough to be rewound well before it ends', () => {
    const moov = boxes(0, bytes.length).find(([t]) => t === 'moov')!
    const mvhd = child(moov, 'mvhd')
    const seconds = bytes.readUInt32BE(mvhd[1] + 16) / bytes.readUInt32BE(mvhd[1] + 12)
    expect(seconds).toBeGreaterThanOrEqual(3)
  })

  it('stays small', () => {
    expect(bytes.length).toBeLessThan(8000)
  })
})

describe('createKeepAwake', () => {
  it('plays the clip with its sound track on and without looping', async () => {
    // A muted or looping video does not stop an iPhone from locking.
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    phone.tap(() => keep.acquire())
    await phone.settle()
    expect(phone.video.src).toBe(KEEP_AWAKE_CLIP)
    expect(phone.video.muted).toBe(false)
    expect(phone.video.loop).toBe(false)
    expect(phone.video.playsInline).toBe(true)
    expect(phone.video.paused).toBe(false)
  })

  it('rewinds before the end instead of looping', async () => {
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    phone.tap(() => keep.acquire())
    await phone.settle()
    phone.video.currentTime = 0.3
    phone.emit('timeupdate')
    expect(phone.video.currentTime).toBe(0.3)
    phone.video.currentTime = 0.62
    phone.emit('timeupdate')
    expect(phone.video.currentTime).toBeLessThan(0.5)
  })

  it('starts again if the clip ever reaches its end', async () => {
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    phone.tap(() => keep.acquire())
    await phone.settle()
    phone.video.currentTime = 6
    phone.video.pause()
    phone.emit('ended')
    await phone.settle()
    expect(phone.video.currentTime).toBe(0)
    expect(phone.video.paused).toBe(false)
  })

  it('can start later without a tap once the learner has tapped anything, and that tap plays nothing', async () => {
    // The tuner and the player switch it on after the microphone has opened, long after the tap.
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    keep.prepare()
    phone.tap()
    expect(phone.video.load).toHaveBeenCalledTimes(1)
    expect(phone.video.play).not.toHaveBeenCalled()
    keep.acquire()
    await phone.settle()
    expect(phone.video.paused).toBe(false)
  })

  it('is not fooled by a touch the phone does not count as a tap', async () => {
    // Guided tuning starts listening by itself: the only taps come before it, and the first touch
    // after the app opens is often the end of a scroll, which unlocks nothing.
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    keep.prepare()
    phone.scrollEnd()
    phone.tap()
    expect(phone.video.play).not.toHaveBeenCalled()
    keep.acquire()
    await phone.settle()
    expect(phone.video.paused).toBe(false)
  })

  it('stops reloading the clip on taps once it has played', async () => {
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    keep.prepare()
    phone.tap()
    const release = keep.acquire()
    await phone.settle()
    release()
    const loads = phone.video.load.mock.calls.length
    phone.tap()
    phone.scrollEnd()
    expect(phone.video.load.mock.calls.length).toBe(loads)
    expect(phone.video.paused).toBe(true)
  })

  it('refused outside a tap, it starts at the next tap', async () => {
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    keep.acquire()
    await phone.settle()
    expect(phone.video.paused).toBe(true)
    phone.tap()
    await phone.settle()
    expect(phone.video.paused).toBe(false)
    // Already playing: further taps must not restart it.
    const plays = phone.video.play.mock.calls.length
    phone.tap()
    expect(phone.video.play.mock.calls.length).toBe(plays)
    expect(phone.video.load).not.toHaveBeenCalled()
  })

  it('plays only while something needs the screen on', async () => {
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    keep.prepare()
    phone.tap()
    const releaseTuner = keep.acquire()
    const releasePlayer = keep.acquire()
    await phone.settle()
    releaseTuner()
    releaseTuner()
    expect(phone.video.paused).toBe(false)
    releasePlayer()
    expect(phone.video.paused).toBe(true)
    // Nothing brings it back while nobody needs it.
    phone.tap()
    phone.show(false)
    phone.show(true)
    phone.emit('ended')
    await phone.settle()
    expect(phone.video.paused).toBe(true)
  })

  it('stops while the app is in the background and returns with it', async () => {
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    phone.tap(() => keep.acquire())
    await phone.settle()
    phone.show(false)
    expect(phone.video.paused).toBe(true)
    phone.show(true)
    await phone.settle()
    expect(phone.video.paused).toBe(false)
  })

  it('does not start while the app is in the background', async () => {
    const phone = fakePhone()
    const keep = createKeepAwake(phone.env)
    keep.prepare()
    phone.tap()
    phone.show(false)
    keep.acquire()
    await phone.settle()
    expect(phone.video.play).not.toHaveBeenCalled()
  })
})
