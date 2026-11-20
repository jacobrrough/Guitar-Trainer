/** A difference this large (seconds) between our clock and the element's is a jump (seek, loop, long stall), not drift. */
const SNAP = 0.04
/** While drifting, our clock closes at most this share of the time that has passed: it slows or hurries, it never steps. */
const STEER = 0.2

/**
 * Smooth song-time clock on top of an HTMLMediaElement. `currentTime` only updates a few times per
 * second in some browsers, so between updates the clock runs on the wall clock. It keeps steering
 * towards the element: in the first moments of playback the element's own clock is not settled yet
 * (Chromium's runs up to 70 ms ahead for about 100 ms), and an offset picked up there must not stay
 * for the whole song. Small differences are closed gradually, so song time never runs backwards;
 * a real jump of the element is followed at once.
 */
export class PlaybackClock {
  private readonly el: HTMLMediaElement
  private readonly now: () => number
  private base = 0
  private baseWall = 0
  private lastElTime = -1
  private lastReturned = Number.NEGATIVE_INFINITY

  /** `now` is the wall clock in milliseconds (replaceable in tests). */
  constructor(el: HTMLMediaElement, now: () => number = () => performance.now()) {
    this.el = el
    this.now = now
  }

  reset(): void {
    this.lastElTime = -1
    this.lastReturned = Number.NEGATIVE_INFINITY
  }

  private anchor(elTime: number, wall: number): number {
    this.lastElTime = elTime
    this.base = elTime
    this.baseWall = wall
    this.lastReturned = elTime
    return elTime
  }

  get time(): number {
    const el = this.el
    const ct = el.currentTime
    if (el.paused || el.ended) {
      this.reset()
      return ct
    }
    const wall = this.now()
    if (this.lastElTime < 0) return this.anchor(ct, wall)
    const elapsed = ((wall - this.baseWall) / 1000) * el.playbackRate
    let value = this.base + elapsed
    // A changed `currentTime` is a fresh reading; an unchanged one may simply be stale.
    if (ct !== this.lastElTime) {
      this.lastElTime = ct
      const error = ct - value
      if (Math.abs(error) > SNAP) return this.anchor(ct, wall)
      value += Math.max(-STEER * elapsed, Math.min(STEER * elapsed, error))
      this.base = value
      this.baseWall = wall
    }
    if (value < this.lastReturned) value = this.lastReturned
    this.lastReturned = value
    return value
  }
}
