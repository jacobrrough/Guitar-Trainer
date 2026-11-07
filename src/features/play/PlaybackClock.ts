/**
 * Smooth song-time clock on top of an HTMLMediaElement. `currentTime` only
 * updates a few times per second in some browsers; we extrapolate with the
 * wall clock between updates and snap back when the element disagrees.
 */
export class PlaybackClock {
  private readonly el: HTMLMediaElement
  private base = 0
  private baseWall = 0
  private lastElTime = -1

  constructor(el: HTMLMediaElement) {
    this.el = el
  }

  reset(): void {
    this.lastElTime = -1
  }

  get time(): number {
    const el = this.el
    const ct = el.currentTime
    if (el.paused || el.ended) {
      this.lastElTime = -1
      return ct
    }
    const now = performance.now()
    if (this.lastElTime < 0) {
      this.lastElTime = ct
      this.base = ct
      this.baseWall = now
      return ct
    }
    const estimate = this.base + ((now - this.baseWall) / 1000) * el.playbackRate
    if (ct !== this.lastElTime) {
      this.lastElTime = ct
      if (Math.abs(estimate - ct) > 0.04) {
        this.base = ct
        this.baseWall = now
        return ct
      }
      this.base = estimate
      this.baseWall = now
    }
    return estimate
  }
}
