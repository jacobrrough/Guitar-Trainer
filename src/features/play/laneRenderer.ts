/**
 * What the player draws a chart with. Like the tracker (runTracker.ts), the renderer follows from the
 * chart alone: a sung chart (`chart.voice`) gets the pitch lanes, every other chart the highway. The
 * player hands both the same state on every frame and each reads what it needs from it.
 */
import type { Chart } from '../../chart/types'
import { HighwayRenderer, type HighwayState } from './Highway'
import { VoiceLanesRenderer, type VoiceLanesState } from './voice/VoiceLanes'

/** One frame as the player describes it: everything the highway reads, and what the pitch lanes read besides. */
export type LaneState = HighwayState & VoiceLanesState

export interface LaneRenderer {
  /** CSS pixel width of the last layout. */
  readonly width: number
  /** Call when the canvas has changed size. */
  resize(): void
  draw(state: LaneState): void
}

export function createLaneRenderer(chart: Pick<Chart, 'voice'>, canvas: HTMLCanvasElement): LaneRenderer {
  return chart.voice ? new VoiceLanesRenderer(canvas) : new HighwayRenderer(canvas)
}
