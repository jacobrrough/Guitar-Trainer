/**
 * What is different about a singer's day, in one place: the options the Coach hands the planner for a
 * voice, and the few rules a voice has that a guitar does not (docs/SINGING.md §5, §6 and §12).
 *
 * Everything here is pure. coach.ts reads and writes the database; this file only decides, so each
 * rule can be read, and broken in a test, without one.
 */
import { songKey, type VocalSong } from '../songs/vocal'
import { VOICE_CHECK_OPTIONS, isTestDue, type CheckpointOptions } from './assessment'
import { UNLOCK_RATING } from './constants'
import { newSkillState, stepWithin } from './learner'
import { VOICE_PLANNER_COPY, maxStepFor, type PlannerInput, type SessionTemplate } from './planner'
import type { Attempt, AttemptResult, InstrumentId, Milestone, MilestoneType, Prefs, Profile, SessionPlan, SkillState, SongItemState, SongSummary, VoiceProfile, VoiceRange } from './types'
import { VOICE_SKILLS } from './voiceSkills'

/** Every block of a singing plan starts with this: it is how a stored session is known to be a singer's. */
export const VOICE_BLOCK_PREFIX = 'voice-'

/**
 * Minutes per block. A voice day always opens with a warm-up, the shortest day too, and has no
 * ear-training block. Singing is offered for 10, 20 or 30 minutes; a profile that says 45 gets the
 * 30-minute day, the longest there is.
 */
export const VOICE_TEMPLATES: Record<Prefs['dailyMinutes'], SessionTemplate> = {
  10: { warmup: 2, focus: 4, second: 0, song: 4, review: 0 },
  20: { warmup: 3, focus: 6, second: 0, song: 7, review: 4 },
  30: { warmup: 3, focus: 7, second: 5, song: 10, review: 5 },
  45: { warmup: 3, focus: 7, second: 5, song: 10, review: 5 },
}

/** The shortest day there is for a voice: after a tired day, and when a quick session is asked for. */
export const VOICE_SHORTEST_DAY: Prefs['dailyMinutes'] = 10

/** A song is sung at its own speed and no other: slowed down, its lines outlast the breath. */
export const VOICE_SONG_SPEEDS = [1]

/** The longest a sung round is written out, in bars: a voice needs its rests. */
export const VOICE_ROUND_BARS = 8

/** The options of `planSession` that a voice sets. Everything else is planned as for any instrument. */
export type VoicePlanOptions = Required<Pick<PlannerInput, 'idPrefix' | 'warmupCategories' | 'maxBars' | 'templates' | 'songSpeeds' | 'copy' | 'sameDrillBy' | 'loopWeakBars' | 'maxSteps'>> &
  Pick<PlannerInput, 'excludeCategories'>

/**
 * How far up each ladder this voice can go: a small range does not hold a slide to the octave or a
 * jump of a sixth. Without a range every step is within reach.
 */
export function voiceMaxSteps(range?: Pick<VoiceRange, 'low' | 'high'>): Record<string, number> {
  return Object.fromEntries(VOICE_SKILLS.filter((s) => (s.steps?.length ?? 0) > 0).map((s) => [s.id, maxStepFor(s, range)]))
}

/**
 * The day the singer said "My voice is tired", and the day after it: short, and with nothing that
 * stretches the voice. `daysSinceTired` is whole days since that day; undefined when it was never said.
 */
export function isGentleDay(daysSinceTired: number | undefined): boolean {
  return daysSinceTired !== undefined && daysSinceTired >= 0 && daysSinceTired <= 1
}

/**
 * What the planner is told for a voice (docs/SINGING.md §6, the table of planner options, and §12.12,
 * §12.13, §12.16). A gentle day leaves out the skills that go higher and lower.
 */
export function voicePlanOptions(range: Pick<VoiceRange, 'low' | 'high'> | undefined, gentle = false): VoicePlanOptions {
  return {
    idPrefix: VOICE_BLOCK_PREFIX,
    warmupCategories: ['pitch', 'range'],
    maxBars: VOICE_ROUND_BARS,
    templates: VOICE_TEMPLATES,
    songSpeeds: VOICE_SONG_SPEEDS,
    copy: VOICE_PLANNER_COPY,
    // Twelve skills share four generators: another skill is another exercise.
    sameDrillBy: 'skill',
    // No loop of single bars: a bar is not a breath. The song page loops a whole line instead.
    loopWeakBars: false,
    maxSteps: voiceMaxSteps(range),
    ...(gentle ? { excludeCategories: ['range' as const] } : {}),
  }
}

/** Added to the explanation of a gentle day, so the short plan is not a surprise. */
export const GENTLE_DAY_LINE = 'A short, gentle day, because your voice was tired.'

/** The plan with the line that explains a gentle day put first. */
export function withGentleDayLine(plan: SessionPlan): SessionPlan {
  return { ...plan, explanation: [GENTLE_DAY_LINE, ...plan.explanation].slice(0, 6) }
}

/**
 * Whether the singer has been through the set-up. Asked of what they answered there, never of whether
 * the profile row exists: the range finder stores its result on that row before the set-up is finished,
 * and so does anything that merely loads the singing profile.
 */
export function voiceIsSetUp(profile: Pick<Profile, 'experience' | 'placementDoneAt'>): boolean {
  return profile.experience !== undefined && profile.placementDoneAt !== undefined
}

/**
 * The check a singer is due, if any. There is one kind, the weekly one.
 * - No starting check: the set-up marks it done whatever was answered, and a profile that has not been
 *   through the set-up is not sent to one either.
 * - No monthly check. Nothing ever records one for a voice, so by the guitar's rule one would be due on
 *   day 28 and on every day after it, and would hide the weekly check for good. Asked as if a monthly
 *   check had been taken this moment, the rule answers for the weekly check alone.
 * - It never waits for the sound sync: when a sung note begins is no part of its result.
 * - Not on a gentle day (`gentle`). A check is five minutes of being measured, on slides and jumps as
 *   much as on anything else, and it would be the longest block of a ten-minute day meant as rest.
 *   Nothing is lost: it is still due the day after.
 */
export function voiceCheckDue(profile: Profile, now: number, gentle = false): 'checkpoint' | null {
  if (gentle || !profile.placementDoneAt) return null
  return isTestDue({ ...profile, lastMonthlyAt: now }, now, 0) === 'checkpoint' ? 'checkpoint' : null
}

/**
 * The options of `checkpointTasks` for a singer's weekly check: the sung pass mark, "Sing …" for
 * "Play …", rounds of at most eight bars, no "full speed" on the song task, and for every step
 * exercise the highest step this voice can hold, so no task asks for a slide or a jump the range has no
 * room for. (Where in the range a task is sung is not decided here: `exerciseForTask` places it when
 * the task is built, in the range of that moment.)
 */
export function voiceCheckOptions(range?: Pick<VoiceRange, 'low' | 'high'>): CheckpointOptions {
  return { ...VOICE_CHECK_OPTIONS, paramsFor: (skill) => ((skill.steps?.length ?? 0) > 0 ? { maxStep: maxStepFor(skill, range) } : {}) }
}

/** Said when a check of another kind is handed in for a voice. */
export const VOICE_ONLY_WEEKLY_CHECK = 'Singing has one check, the weekly one. This one was not saved.'

/** Said when every task of a sung check heard only the app itself. */
export const VOICE_CHECK_HEARD_ITSELF = 'The microphone was only hearing the app, not your voice, so this check was not saved. Use headphones or turn the guide off, then try again.'

/** A skill a song asks for is "under way" from this rating on. */
export const SONG_NEEDS_RATING = 50

/**
 * Whether the Coach may offer a song by itself: it fits the singer's range in some key, and the skills
 * it asks for are under way. (The library is wider: it lists every song that fits.)
 */
export function coachOffersSong(song: VocalSong, voice: VoiceProfile, ratingOf: (skillId: string) => number): boolean {
  if (!songKey(song, voice.range, voice.keyNudge?.[song.id]).fits) return false
  return (song.needs ?? []).every((id) => ratingOf(id) >= SONG_NEEDS_RATING)
}

/** This many missed top notes in one run say the song sits too high... */
export const KEY_TOO_HIGH_TOP_MISSES = 2
/** ...and this many such runs in a row move it down. */
export const KEY_TOO_HIGH_RUNS = 2

/** A run whose top notes came out low or not at all: the sign that the key is too high, not the level too hard. */
export function satHigh(run: Pick<AttemptResult, 'voice'>): boolean {
  return (run.voice?.topMissed ?? 0) >= KEY_TOO_HIGH_TOP_MISSES
}

/**
 * The key choice ("Lower" / "Higher", in semitones from the chosen key) that puts a song one semitone
 * lower than it is now, or null when there is nothing lower: the range has no room, or the song is
 * already as far down as a key choice goes.
 *
 * A stored choice can ask for more than the range gives, so it is first read as what it really moved.
 * Otherwise "one lower" could be a number that changes nothing.
 */
export function lowerKeyNudge(song: VocalSong, range: Pick<VoiceRange, 'low' | 'high'>, stored: number | undefined): number | null {
  const chosen = songKey(song, range)
  if (!chosen.fits) return null
  const current = songKey(song, range, stored).shift
  const applied = current - chosen.shift
  return songKey(song, range, applied - 1).shift < current ? applied - 1 : null
}

/** When the Coach last moved a song down, read from its items; undefined when it never did. */
export function keyLoweredAt(items: Pick<SongItemState, 'keyLoweredAt'>[]): number | undefined {
  const times = items.map((i) => i.keyLoweredAt).filter((t): t is number => typeof t === 'number')
  return times.length > 0 ? Math.max(...times) : undefined
}

/** True while a song that was moved down has not been sung in its new key yet: the next plan says why it is lower. */
export function keyMovedDown(items: Pick<SongItemState, 'keyLoweredAt' | 'lastAt'>[]): boolean {
  const lowered = keyLoweredAt(items)
  if (lowered === undefined) return false
  return items.every((i) => i.lastAt === null || i.lastAt <= lowered)
}

/**
 * The runs a singer's advice may be worked out from. A song run sung up to the moment the Coach last
 * moved that song down was in the old key, and the Coach has already answered it: the key went down and
 * the level stayed. Left in, two such runs would read as "hard twice, going back a level" on a card,
 * beside a plan that says the song was moved down a little and keeps the level.
 */
export function runsInPresentKey<T extends Pick<Attempt, 'kind' | 'songId' | 'at'>>(runs: T[], songItems: Pick<SongItemState, 'songId' | 'keyLoweredAt'>[]): T[] {
  const lowered = new Map<number, number>()
  for (const item of songItems) {
    if (typeof item.keyLoweredAt === 'number') lowered.set(item.songId, Math.max(lowered.get(item.songId) ?? -Infinity, item.keyLoweredAt))
  }
  if (lowered.size === 0) return runs
  return runs.filter((run) => run.kind !== 'song' || run.songId === undefined || run.at > (lowered.get(run.songId) ?? -Infinity))
}

/** The reason of a song block whose song was moved down since it was last sung. */
export const MOVED_DOWN = 'That one sat high for you, so we moved the song down a little.'

/**
 * The plan with that reason on the songs it is true of. The planner knows levels, not keys: left alone
 * it would say the level "was hard last time" about a song whose only trouble was its key.
 */
export function withKeyReasons(plan: SessionPlan, library: SongSummary[], songItems: Record<string, SongItemState>): SessionPlan {
  const items = Object.values(songItems)
  const reworded = new Map<string, string>()
  const blocks = plan.blocks.map((b) => {
    if (b.kind !== 'song' || !keyMovedDown(items.filter((i) => i.songId === b.songId))) return b
    const title = library.find((s) => s.id === b.songId)?.title
    const reason = title ? `${title}: ${MOVED_DOWN}` : MOVED_DOWN
    reworded.set(b.reason, reason)
    return { ...b, reason }
  })
  if (reworded.size === 0) return plan
  // The planner repeats the reason of the day's song in its explanation.
  return { ...plan, blocks, explanation: plan.explanation.map((line) => reworded.get(line) ?? line) }
}

/** The skill everything else in singing is built on. */
export const VOICE_FIRST_SKILL_ID = 'voice.pitch.match'
/** Where a singer who skips the first steps starts on its ladder. */
const VOICE_START_STEP = 1

/**
 * "Match a note" for a singer who has sung before, or who leaves the first-steps course: at the unlock
 * line, on its second step. With it the skills of the next tier are open on the first day; without it
 * such a singer would have to earn their way up from the three closest notes.
 * What was already earned is kept: a rating or a step above the starting point, and the rounds sung.
 */
export function seededFirstSkill(existing: SkillState | undefined, range: Pick<VoiceRange, 'low' | 'high'> | undefined, now: number): SkillState {
  const skill = VOICE_SKILLS.find((s) => s.id === VOICE_FIRST_SKILL_ID)
  if (!skill) throw new Error(`Unknown skill ${VOICE_FIRST_SKILL_ID}`)
  const last = (skill.steps?.length ?? 1) - 1
  const start = Math.min(VOICE_START_STEP, maxStepFor(skill, range))
  const state = existing ?? newSkillState(VOICE_FIRST_SKILL_ID, 0, now)
  return { ...state, rating: Math.max(state.rating, UNLOCK_RATING), step: Math.max(stepWithin(state.step, last, 0), start) }
}

/** Milestones whose key names neither a skill nor a song: the two instruments would share one key, and a key is stored once. */
const SHARED_KEY_TYPES: MilestoneType[] = ['streak', 'test']

/**
 * Milestones as they are stored for an instrument. A singer's are stamped, and a streak or a passed
 * check gets a key of its own (`voice:streak:7`), so three days of singing are not swallowed by three
 * days of guitar. A guitar milestone is stored exactly as it always was.
 */
export function milestonesFor(instrument: InstrumentId, milestones: Milestone[]): Milestone[] {
  if (instrument !== 'voice') return milestones
  return milestones.map((m) => ({ ...m, instrument, key: SHARED_KEY_TYPES.includes(m.type) ? `voice:${m.key}` : m.key }))
}
