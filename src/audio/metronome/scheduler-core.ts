export interface MetronomeSettings {
  bpm: number
  beatsPerBar: number
  /** Clicks per beat: 1 = quarter, 2 = eighth, 3 = triplet, 4 = sixteenth. */
  subdivision: number
  accentFirst: boolean
}

export type ClickAccent = 'high' | 'mid' | 'low'

export interface ClickEvent {
  /** AudioContext time at which the click sounds. */
  time: number
  /** 0-based beat within the bar. */
  beat: number
  /** 0-based subdivision within the beat. */
  sub: number
  accent: ClickAccent
}

export interface SchedulerState {
  nextTime: number
  beat: number
  sub: number
}

export function clickAccent(beat: number, sub: number, settings: MetronomeSettings): ClickAccent {
  if (sub !== 0) return 'low'
  if (beat === 0 && settings.accentFirst) return 'high'
  return 'mid'
}

/**
 * Pure lookahead step: emits every click strictly before `until` and returns
 * the advanced state. Called repeatedly from a timer ("A Tale of Two Clocks").
 */
export function scheduleWindow(
  state: SchedulerState,
  settings: MetronomeSettings,
  until: number,
): { events: ClickEvent[]; state: SchedulerState } {
  const events: ClickEvent[] = []
  let { nextTime, beat, sub } = state
  const interval = 60 / settings.bpm / settings.subdivision
  while (nextTime < until) {
    events.push({ time: nextTime, beat, sub, accent: clickAccent(beat, sub, settings) })
    nextTime += interval
    sub++
    if (sub >= settings.subdivision) {
      sub = 0
      beat = (beat + 1) % settings.beatsPerBar
    }
  }
  return { events, state: { nextTime, beat, sub } }
}

/** Tap-tempo estimate from tap timestamps (ms); returns null with fewer than 2 taps. */
export function tapTempo(taps: number[], maxGapMs = 2500): number | null {
  const recent: number[] = []
  for (let i = taps.length - 1; i > 0; i--) {
    const gap = taps[i] - taps[i - 1]
    if (gap > maxGapMs || gap <= 0) break
    recent.push(gap)
    if (recent.length >= 7) break
  }
  if (recent.length === 0) return null
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length
  return Math.round(60000 / avg)
}
