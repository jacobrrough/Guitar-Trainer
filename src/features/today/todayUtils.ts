import { SKILLS_BY_ID } from '../../training/skills'
import type { Attempt, AttemptResult, Block, BlockKind, Goal, SessionRecord } from '../../training/types'

export const GOAL_OPTIONS: Array<{ id: Goal; label: string }> = [
  { id: 'songs', label: 'Songs' },
  { id: 'rhythm', label: 'Rhythm & chords' },
  { id: 'lead', label: 'Lead' },
  { id: 'technique', label: 'Technique' },
  { id: 'all-round', label: 'All-round' },
]

export const MINUTE_OPTIONS = [10, 20, 30, 45] as const

export type BlockIconName = 'Flame' | 'Target' | 'Repeat' | 'Music' | 'RotateCcw' | 'ClipboardCheck' | 'Ear'

export const BLOCK_META: Record<BlockKind, { label: string; icon: BlockIconName }> = {
  warmup: { label: 'Warm-up', icon: 'Flame' },
  focus: { label: 'Focus', icon: 'Target' },
  second: { label: 'Second skill', icon: 'Repeat' },
  song: { label: 'Song', icon: 'Music' },
  review: { label: 'Review', icon: 'RotateCcw' },
  test: { label: 'Skill check', icon: 'ClipboardCheck' },
  ear: { label: 'Ear training', icon: 'Ear' },
}

/** Whole minutes practised: sum of attempt durations. */
export function minutesThisWeek(attempts: Pick<Attempt, 'durationSec'>[]): number {
  const sec = attempts.reduce((sum, a) => sum + (Number.isFinite(a.durationSec) ? a.durationSec : 0), 0)
  return Math.round(sec / 60)
}

export function pct(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100)
}

export function streakText(streak: number): string {
  if (streak <= 0) return 'No streak yet'
  return `\u{1F525} ${streak}-day streak`
}

export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

/** Title of a block; `songTitle` is looked up by the caller for song blocks. */
export function blockTitle(block: Block, songTitle?: string): string {
  switch (block.kind) {
    case 'test':
      return `Skill check: ${block.test}`
    case 'song': {
      const title = songTitle ?? `Song #${block.songId}`
      return `${title} · Level ${block.level + 1}${block.speed < 1 ? ` · ${Math.round(block.speed * 100)}% speed` : ''}`
    }
    default: {
      const name = SKILLS_BY_ID[block.skillId]?.name ?? block.skillId
      return `${name} · ${Math.round(block.tempo)} bpm`
    }
  }
}

export function blockStatusLabel(status: Block['status']): string {
  return status === 'done' ? 'Done ✓' : status === 'skipped' ? 'Skipped' : status === 'active' ? 'In progress' : 'Pending'
}

export function isFinished(block: Block): boolean {
  return block.status === 'done' || block.status === 'skipped'
}

export function allFinished(session: Pick<SessionRecord, 'plan'>): boolean {
  return session.plan.blocks.length > 0 && session.plan.blocks.every(isFinished)
}

export function noneDone(session: Pick<SessionRecord, 'plan'>): boolean {
  return !session.plan.blocks.some((b) => b.status === 'done')
}

/** Signed median timing error as readable text. */
export function timingText(ms: number | null): string {
  if (ms === null) return 'timing: not enough hits'
  const r = Math.round(ms)
  if (Math.abs(r) < 5) return 'timing: right on the beat'
  return `timing: ${r > 0 ? '+' : ''}${r} ms (${r > 0 ? 'late' : 'early'})`
}

export function repSummaryText(result: Pick<AttemptResult, 'perfects' | 'goods' | 'misses'>): string {
  return `${result.perfects} perfect · ${result.goods} good · ${result.misses} missed`
}

/** Latest attempt of the given session that belongs to the block. */
export function attemptForBlock(attempts: Attempt[], sessionId: number | undefined, block: Block): Attempt | undefined {
  if (sessionId === undefined) return undefined
  const match = attempts.filter((a) => {
    if (a.sessionId !== sessionId) return false
    if (block.kind === 'song') return a.songId === block.songId
    if (block.kind === 'test') return false
    return a.skillId === block.skillId
  })
  return match.sort((a, b) => b.at - a.at)[0]
}

export function bandLabel(band: string): string {
  return band.charAt(0).toUpperCase() + band.slice(1)
}
