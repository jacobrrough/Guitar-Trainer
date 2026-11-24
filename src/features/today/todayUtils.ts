import { levelIndex, VOICE_LEVELS } from '../../songs/vocal'
import { instrumentOfBlockId, instrumentOfSkillId, skillById, type InstrumentId } from '../../training/instruments'
import { stepWithin } from '../../training/learner'
import type { Attempt, AttemptResult, Block, BlockKind, Goal, Profile, Recommendation, SessionRecord, SkillDef } from '../../training/types'
import { singPath } from '../sing/singPage'

export const GOAL_OPTIONS: Array<{ id: Goal; label: string }> = [
  { id: 'songs', label: 'Songs' },
  { id: 'rhythm', label: 'Rhythm & chords' },
  { id: 'lead', label: 'Lead' },
  { id: 'technique', label: 'Technique' },
  { id: 'all-round', label: 'All-round' },
]

export const MINUTE_OPTIONS = [10, 20, 30, 45] as const

/** A singing day is offered for 10, 20 or 30 minutes: a voice tires, and there is no longer day planned for one. */
const VOICE_MINUTE_OPTIONS = [10, 20, 30] as const

/** The lengths of a day an instrument is offered. */
export function minuteOptionsFor(instrument: InstrumentId): readonly Profile['dailyMinutes'][] {
  return instrument === 'voice' ? VOICE_MINUTE_OPTIONS : MINUTE_OPTIONS
}

/**
 * Which of the offered lengths is shown as chosen: the longest one that is not more than the stored
 * minutes, which is the stored length itself wherever that is on offer. A singing profile can say 45
 * (a restored backup), and the Coach then plans the longest singing day: that is the button to light,
 * or none would be.
 */
export function shownMinutes(minutes: number, options: readonly number[]): number {
  const under = options.filter((m) => m <= minutes)
  return under.length > 0 ? Math.max(...under) : Math.min(...options)
}

/** Where "milestones seen up to here" is remembered on this device. Each instrument has its own strip. */
export function milestonesSeenKey(instrument: InstrumentId): string {
  return instrument === 'voice' ? 'gt.milestonesSeenAt.voice' : 'gt.milestonesSeenAt'
}

export type BlockIconName = 'Flame' | 'Target' | 'Repeat' | 'Music' | 'RotateCcw' | 'ClipboardCheck' | 'Ear'

export const BLOCK_META: Record<BlockKind, { label: string; icon: BlockIconName }> = {
  warmup: { label: 'Warm-up', icon: 'Flame' },
  focus: { label: 'Main exercise', icon: 'Target' },
  second: { label: 'Another exercise', icon: 'Repeat' },
  song: { label: 'Song', icon: 'Music' },
  review: { label: 'Recap', icon: 'RotateCcw' },
  test: { label: 'Skill check', icon: 'ClipboardCheck' },
  ear: { label: 'Ear training', icon: 'Ear' },
}

/** Whole minutes practised: sum of attempt durations. Runs that did not count (speaker bleed) add nothing. */
export function minutesThisWeek(attempts: Pick<Attempt, 'durationSec' | 'bleed'>[]): number {
  const sec = attempts.reduce((sum, a) => sum + (!a.bleed && Number.isFinite(a.durationSec) ? a.durationSec : 0), 0)
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

/**
 * The step a block, or a round that was built, is on, in the words of its skill ("6 beats"). Null for
 * a skill that moves by tempo: every guitar skill, and the singing skills that get faster. A stored
 * step is read as a step that exists, as everywhere else (`stepWithin`).
 */
export function stepLabel(skill: Pick<SkillDef, 'steps'> | undefined, step: unknown): string | null {
  const steps = skill?.steps ?? []
  if (steps.length === 0) return null
  return steps[stepWithin(step, steps.length - 1, 0)].label
}

/**
 * Title of a block; `songTitle` is looked up by the caller for song blocks.
 *
 * Whose block it is is read from the block: its skill for an exercise, its id for a song or a check
 * (`voice-…` is a singing plan). A song to sing is named by its level, never by a speed: it has one.
 * A step exercise is named by its step where another exercise shows its tempo.
 */
export function blockTitle(block: Block, songTitle?: string, simple = false): string {
  const sung = instrumentOfBlockId(block.id) === 'voice'
  switch (block.kind) {
    case 'test':
      // A singer has the weekly check alone, and the check page calls it this.
      if (sung) return 'Your weekly check'
      return block.test === 'monthly' ? 'Monthly skill check' : block.test === 'placement' ? 'Starting check' : 'Weekly skill check'
    case 'song': {
      const title = songTitle ?? `Song #${block.songId}`
      if (sung) return `${title} · ${VOICE_LEVELS[levelIndex(block.level)].name}`
      return `${title} · Level ${block.level + 1}${block.speed < 1 ? ` · ${Math.round(block.speed * 100)}% speed` : ''}`
    }
    default: {
      const skill = skillById(block.skillId)
      const name = skill?.name ?? block.skillId
      // Ear training has no tempo to show.
      if (simple || block.kind === 'ear') return name
      return `${name} · ${stepLabel(skill, block.params.step) ?? `${Math.round(block.tempo)} bpm`}`
    }
  }
}

/**
 * Plain-words pace line for an exercise block (the bpm lives in the block runner's Details).
 * A step exercise has no pace to speak of (its tempo never changes): the line names its first step.
 */
export function blockPaceText(block: Block): string | null {
  if (block.kind === 'song' || block.kind === 'test' || block.kind === 'ear') return null
  const step = stepLabel(skillById(block.skillId), block.params.step)
  if (step !== null) return `First round: ${step}`
  const slowly = instrumentOfSkillId(block.skillId) === 'voice' ? 'Sing it slowly, with the clicks' : 'Play it slowly, with the clicks'
  return block.tempo < 70 ? slowly : block.tempo < 100 ? 'At a steady pace, with the clicks' : 'At a lively pace, with the clicks'
}

/**
 * Where "Start" on a block leads: the block runner, or the check itself. A singer's check says whose
 * it is in its address, so it stays a singer's check whatever the switch shows by the time it opens.
 */
export function blockPath(block: Block): string {
  if (block.kind !== 'test') return `/today/block/${block.id}`
  return instrumentOfBlockId(block.id) === 'voice' ? `/test/${block.test}?instrument=voice` : `/test/${block.test}`
}

/**
 * The button on a card of advice: its label and where it leads; null for advice with nothing to tap.
 * `blocks` are those of today's plan: practice is offered only while a block of that skill is still to do.
 *
 * A singer's song opens on its own page, on the level the card is about. One card ("Time to sing a
 * song") names a song and no level: that one opens where the song was last sung. A singer has the
 * weekly check alone and no sound-sync card (a sung result does not depend on the sync).
 */
export function adviceAction(rec: Pick<Recommendation, 'id' | 'action'>, instrument: InstrumentId, blocks: Block[] | undefined): { label: string; to: string } | null {
  const a = rec.action
  if (!a) return null
  const sung = instrument === 'voice'
  switch (a.type) {
    case 'calibrate':
      return sung ? null : { label: 'Calibrate', to: '/settings?calibrate=1' }
    case 'song':
      if (sung) return { label: 'Sing', to: rec.id === 'play-music' ? singPath(a.songId) : singPath(a.songId, a.level) }
      return { label: 'Play song', to: `/play/${a.songId}` }
    case 'test':
      if (sung) return a.test === 'checkpoint' ? { label: 'Start the check', to: '/test/checkpoint?instrument=voice' } : null
      return { label: 'Start test', to: `/test/${a.test}` }
    case 'practice': {
      const block = blocks?.find((b) => b.kind !== 'song' && b.kind !== 'test' && b.skillId === a.skillId && b.status === 'pending')
      return block ? { label: 'Go to block', to: blockPath(block) } : null
    }
    default:
      return null
  }
}

/** "5 of 8 notes" from attempt counts (perfects + goods of total). */
export function notesHitText(r: Pick<AttemptResult, 'perfects' | 'goods' | 'total'>): string {
  return `${r.perfects + r.goods} of ${r.total} notes`
}

/** Timing in words, for beginners. */
export function timingWords(ms: number | null): string {
  if (ms === null) return 'Not enough notes to judge your timing'
  if (Math.abs(ms) < 25) return 'right with the click'
  return ms > 0 ? 'a little behind the click' : 'a little ahead of the click'
}

const SIMPLE_BANDS: Record<string, string> = { new: 'New', learning: 'Learning', developing: 'Solid', solid: 'Strong', mastered: 'Mastered' }
export function simpleBandLabel(band: string): string {
  return SIMPLE_BANDS[band] ?? bandLabel(band)
}

const REASON_WORDS: Record<string, string> = {
  'low coverage': 'we could not hear you clearly for much of it',
  'speaker bleed': 'the microphone was hearing the speaker',
  'calibration stale': 'sound sync is out of date',
  'timing bias': 'your timing drifted',
}
export function reasonText(reason: string): string {
  return REASON_WORDS[reason] ?? reason
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

/** Latest counted attempt of the given session that belongs to the block (a bleed run is not the block's result). */
export function attemptForBlock(attempts: Attempt[], sessionId: number | undefined, block: Block): Attempt | undefined {
  if (sessionId === undefined) return undefined
  const match = attempts.filter((a) => {
    if (a.sessionId !== sessionId || a.bleed) return false
    if (block.kind === 'song') return a.songId === block.songId
    if (block.kind === 'test') return false
    return a.skillId === block.skillId
  })
  return match.sort((a, b) => b.at - a.at)[0]
}

export function bandLabel(band: string): string {
  return band.charAt(0).toUpperCase() + band.slice(1)
}
