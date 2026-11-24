/**
 * What the check screens say and decide that needs no screen to be tried out: how a task result is put
 * into words, whose check a page address asks for, which skill a weekly check looks at first, and every
 * word of the pages for each instrument.
 *
 * A function that takes an instrument answers for the guitar when none is given, in the words the
 * guitar screens have always used. A singer's words name no tempo for a step exercise, no percent and
 * no milliseconds: when a sung note begins is no part of a sung result (docs/SINGING.md §12.10).
 */
import type { VoiceChart } from '../../chart/types'
import { DEFAULT_RANGES, type RangeAroundEasy } from '../../music/keys'
import { VOICE_LEVELS, levelIndex } from '../../songs/vocal/levels'
import { reachesMark } from '../../training/assessment'
import { GOOD_HIT_WEIGHT, MIN_HITS_FOR_TIMING } from '../../training/constants'
import { skillById } from '../../training/instruments'
import { stepWithin } from '../../training/learner'
import type { AttemptResult, InstrumentId, LearnerModel, PassCriteria, Profile, SkillDef, TestTask, TestType, VoiceProfile } from '../../training/types'
import type { ScoreSummary } from '../play/scoring'
import { voiceResultCopy } from '../play/voice/voiceCopy'

export type FailedCriterion = 'accuracy' | 'timing' | 'spread'

/** Accuracy as the pass rule counts it (0..1): a note that is a little early or late counts for less than a clean one. */
export function ruleAccuracy(result: Pick<AttemptResult, 'perfects' | 'goods' | 'total'>): number {
  return result.total > 0 ? (result.perfects + GOOD_HIT_WEIGHT * result.goods) / result.total : 0
}

/**
 * Which parts of the pass rule a result misses; empty when the task is passed. Mirrors `meetsCriteria`,
 * and asks the same `reachesMark` about the notes: compared on its own here, a sung task of 43 notes
 * that were all only just in tune read "Not yet" beside "on the note for 43 of 43 notes".
 */
export function failedCriteria(criteria: PassCriteria, result: AttemptResult): FailedCriterion[] {
  const failed: FailedCriterion[] = []
  if (!reachesMark(ruleAccuracy(result), criteria.minAccuracy)) failed.push('accuracy')
  const hits = result.perfects + result.goods
  const timingOff = result.timingMedianMs === null ? hits >= MIN_HITS_FOR_TIMING : Math.abs(result.timingMedianMs) > criteria.maxMedianMs
  if (timingOff) failed.push('timing')
  if (result.timingStdevMs !== null && result.timingStdevMs > criteria.maxStdevMs) failed.push('spread')
  return failed
}

/**
 * The accuracy to show, in whole percent. A result under the pass mark is never rounded up to it:
 * "85%" next to "below 85%" would read as a mistake.
 */
export function shownAccuracyPct(accuracy: number, minAccuracy: number): number {
  const rounded = Math.round(Math.max(0, Math.min(1, accuracy)) * 100)
  // "Under the mark" as the pass rule reads it: a result that passes is never shown one percent short either.
  if (reachesMark(accuracy, minAccuracy)) return rounded
  return Math.min(rounded, Math.ceil(minAccuracy * 100) - 1)
}

const BADGE: Record<FailedCriterion, string> = { accuracy: 'accuracy below target', timing: 'timing off target', spread: 'timing not steady' }

/** The same three for a singer: what there is to do next, never a word about time. */
const SUNG_BADGE: Record<FailedCriterion, string> = { accuracy: 'a few more notes to go', timing: 'one more go', spread: 'one more go' }

/** Short label for the result badge: which part of the rule was missed. */
export function verdictBadge(failed: FailedCriterion[], instrument: InstrumentId = 'guitar'): string {
  if (failed.length === 0) return 'on target'
  if (instrument === 'voice') return [...new Set(failed.map((f) => SUNG_BADGE[f]))].join(' · ')
  return failed.map((f) => BADGE[f]).join(' · ')
}

/**
 * The missed parts of the rule for a singer, a sentence each, counted in notes.
 * The pass marks of a sung check are set so that when a note begins never decides a task. If a result
 * should ever miss on it all the same (it could not be measured), the sentence says so plainly, with
 * no number: there is nothing in a count of milliseconds that a singer can act on.
 */
function sungReasons(criteria: PassCriteria, result: AttemptResult): string[] {
  return failedCriteria(criteria, result).map((f) => {
    if (f === 'accuracy') {
      const needed = Math.min(result.total, Math.ceil(criteria.minAccuracy * result.total))
      const close = result.goods > 0 ? `${result.goods} of your notes ${result.goods === 1 ? 'was' : 'were'} only just in tune, and such a note counts a little less. ` : ''
      // On a short task the mark can take every note; "about 4 of 4" would read oddly, and so would "all 1 notes".
      if (result.total === 1) return `${close}This one note is needed here.`
      return `${close}${needed >= result.total ? `All ${result.total}` : `About ${needed} of ${result.total}`} notes are needed here.`
    }
    if (f === 'timing') return 'We could not tell where your notes began this time. Wait for your turn, then sing it once more another day.'
    return 'Your notes came in at very different moments. Listen for the click, and come in when it is your turn.'
  })
}

/**
 * One plain sentence for each missed part of the rule, with the number that was needed.
 * For a sung result (`instrument` 'voice') the sentences count notes and never speak of milliseconds.
 */
export function failureReasons(criteria: PassCriteria, result: AttemptResult, instrument: InstrumentId = 'guitar'): string[] {
  if (instrument === 'voice') return sungReasons(criteria, result)
  const part = Math.round(GOOD_HIT_WEIGHT * 100)
  return failedCriteria(criteria, result).map((f) => {
    if (f === 'accuracy') {
      const got = shownAccuracyPct(ruleAccuracy(result), criteria.minAccuracy)
      const close = result.goods > 0 ? ` A note that is a little early or late counts as ${part}% of a note, and ${result.goods} of yours were.` : ''
      return `Accuracy: you scored ${got}%, and ${Math.round(criteria.minAccuracy * 100)}% is needed.${close}`
    }
    if (f === 'timing') {
      const ms = result.timingMedianMs
      if (ms === null) return 'Timing: it could not be measured this time.'
      return `Timing: most of your notes came ${ms > 0 ? 'after' : 'before'} the beat, by about ${Math.round(Math.abs(ms))} ms. ${criteria.maxMedianMs} ms or less is needed.`
    }
    return `Steadiness: some notes came early and some late (spread ${Math.round(result.timingStdevMs ?? 0)} ms). ${criteria.maxStdevMs} ms or less is needed.`
  })
}

/** The pass rule in one line, shown before a task is played. For a singer it is said in notes. */
export function passRuleText(criteria: PassCriteria, instrument: InstrumentId = 'guitar'): string {
  if (instrument === 'voice') {
    return `To pass: be on the note for about ${Math.round(criteria.minAccuracy * 10)} notes in every 10. A note that is only just in tune counts a little less.`
  }
  return `To pass: ${Math.round(criteria.minAccuracy * 100)}% accuracy with steady timing. A note that is a little early or late counts as ${Math.round(GOOD_HIT_WEIGHT * 100)}% of a note.`
}

/**
 * Whose check a page address asks for. `asked` is its `?instrument=` (null when there is none),
 * `active` the instrument on screen. While the singing side is off every check is the guitar's,
 * whatever the address asks for. Once it is on, an address that names an instrument gets it, and one
 * that says nothing, or something else, gets the instrument on screen.
 */
export function checkInstrument(asked: string | null, active: InstrumentId, voiceOn: boolean): InstrumentId {
  if (!voiceOn) return 'guitar'
  if (asked === 'voice' || asked === 'guitar') return asked
  return active
}

/**
 * Whether an instrument has this kind of check. Singing has the weekly one alone: a starting check and
 * a monthly check rate every skill from a fixed list of guitar tasks.
 */
export function checkOffered(type: TestType, instrument: InstrumentId): boolean {
  return instrument === 'guitar' || type === 'checkpoint'
}

/**
 * The skill a weekly check looks at first: the pinned one, else the weakest one practised, else the
 * first of the instrument. Only skills of the given list are considered. A learner model can hold more
 * (on a device that plays and sings, a state whose skill was retired), and a check built around a skill
 * the list does not have would open without its first task.
 */
export function focusSkillFor(model: Pick<LearnerModel, 'skills'>, profile: Pick<Profile, 'pinnedSkillId'>, skills: Pick<SkillDef, 'id'>[]): string {
  const ids = new Set(skills.map((s) => s.id))
  if (profile.pinnedSkillId && ids.has(profile.pinnedSkillId)) return profile.pinnedSkillId
  let best: { id: string; rating: number } | null = null
  for (const [id, st] of Object.entries(model.skills)) {
    if (!ids.has(id)) continue
    if (!best || st.rating < best.rating) best = { id, rating: st.rating }
  }
  return best?.id ?? skills[0].id
}

/**
 * The range a sung task is built in: the singer's stored one, else the lower starting range. A singer
 * always has a range to sing in, and the same one for an exercise and for a song, so the two are never
 * an octave apart.
 */
export function singingRange(voice: Pick<VoiceProfile, 'range'>): RangeAroundEasy {
  const range = voice.range
  return range ? { low: range.low, high: range.high, easy: range.easy } : DEFAULT_RANGES.lower
}

/** A song being made ready for a sung task, as far as the task has to know (`useVocalRunState` has the whole of it). */
export type SongOnItsWay = { status: 'none' | 'preparing' | 'failed' } | { status: 'ready'; run: { fits: boolean } }

/**
 * Where a song task of a sung check stands while its song is made ready: wait, sing, or leave the task
 * out. `live` is the song as it is being made at this moment; `held` is the run the task opened with,
 * once there was one.
 *
 * The held run decides for as long as the task lasts. The singing profile is read live, and a range or
 * a key changed elsewhere sends the live state back to "preparing", to another run, or to none: none of
 * that may swap the chart under a task that has begun, or drop it. A song that cannot be made ready,
 * that is no song to sing, or that does not fit the singer's range is left out of the check: it was
 * never sung, so it is no miss.
 */
export function sungSongStep(live: SongOnItsWay, held: { fits: boolean } | null): 'waiting' | 'sing' | 'left-out' {
  const run = held ?? (live.status === 'ready' ? live.run : null)
  if (run) return run.fits ? 'sing' : 'left-out'
  return live.status === 'preparing' ? 'waiting' : 'left-out'
}

/**
 * The one tip under a sung task of a check, from what the tracker heard of the run. A task of a check
 * is sung once, so the tip does not end by asking for another go: on the card of a task that went
 * well, "try again" would point at a button that is not there.
 */
export function sungTaskTip(summary: ScoreSummary, voice?: Pick<VoiceChart, 'glide'>): string | null {
  return voiceResultCopy(summary, voice, { anotherGo: false }).tip
}

/**
 * The tile on a task's card that says how it is paced. The guitar's is its tempo, for every task.
 * A singer's step exercise has one tempo for good, so its step is named instead, in the step's own
 * words; a song to sing has one speed and names its level; only an exercise that speeds up says how fast.
 */
export function taskPace(task: Pick<TestTask, 'generatorId' | 'skillIds' | 'params'>, instrument: InstrumentId = 'guitar'): { label: string; value: string } {
  const tempo = `${Math.round(task.params.tempo)} bpm`
  if (instrument !== 'voice') return { label: 'Target tempo', value: tempo }
  if (task.generatorId === 'song') return { label: 'Level', value: VOICE_LEVELS[levelIndex(Number(task.params.level))].name }
  const steps = skillById(task.skillIds[0] ?? '')?.steps ?? []
  if (steps.length > 0) return { label: 'This step', value: steps[stepWithin(task.params.step, steps.length - 1, 0)].label }
  return { label: 'Speed', value: tempo }
}

const SECONDS_PER_TASK = 35

export function estimateMinutes(taskCount: number): number {
  return Math.max(1, Math.round((taskCount * SECONDS_PER_TASK) / 60))
}

/** Everything the check pages say that differs between the instruments. */
export interface CheckWords {
  title(type: TestType): string
  blurb(type: TestType): string
  /** "3 tasks", "Up to 9 tasks". */
  count(type: TestType, tasks: number): string
  mic: string
  rulesHeading: string
  rules: readonly string[]
  /** Under "Task 2 of 3": a song, or an exercise. */
  kind(song: boolean): string
  /** Heading over the skills a task is evidence for. */
  measures: string
  /** What stands there for a song task, which names no skill. */
  songMeasure: string
  /** Before the pass rule on a task's card. */
  beforeRule: string
  /** The button that starts a task. */
  start: string
  /** Asked before leaving a check that has begun. */
  leave: string
  preparing: string
  nothing: { title: string; subtitle: string }
  /** When no task of a check could be played. */
  noTasks: string
  /** Shown while a song to sing is arranged for the singer. */
  gettingSongReady: string
  /** Said when a step of the check breaks and the error itself has no words: building it, opening a task, making a task, saving. */
  trouble: { build: string; prepare: string; task: string; save: string }
  /** The line of the report for a task that was left out. */
  skipped(title: string): string
  /** Heading over the skills whose rating moved. */
  changes(placement: boolean): string
  /** How a moved skill is described when its number is not shown (singing only). */
  moved(up: boolean): string
  nextFocus: string
}

const TEST_TITLES: Record<TestType, string> = {
  placement: 'Placement test',
  checkpoint: 'Weekly checkpoint',
  monthly: 'Monthly assessment',
}

const TEST_BLURBS: Record<TestType, string> = {
  placement: 'A ladder of short tasks that gets easier to harder. It stops after two misses in a row and sets your starting levels.',
  checkpoint: 'A focus task, a retention task and a song stretch to see what has moved since last time.',
  monthly: 'The ladder again, starting one tier below your level, to re-measure your skills.',
}

const countOf = (tasks: number) => `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`

/** The guitar's words, as the check pages have always had them. */
const GUITAR_CHECK: CheckWords = {
  title: (type) => TEST_TITLES[type],
  blurb: (type) => TEST_BLURBS[type],
  count: (type, tasks) => (type === 'placement' ? `Up to ${tasks} tasks` : countOf(tasks)),
  mic: 'Mic required',
  rulesHeading: 'Rules',
  rules: [
    'One attempt per task. There is no retry.',
    'No pausing or seeking once a task starts.',
    'Everything plays at full speed after a count-in.',
    'Nothing is saved unless you finish the test.',
  ],
  kind: (song) => (song ? 'Song stretch' : 'Skill task'),
  measures: 'Measures',
  songMeasure: 'Song playing',
  beforeRule: 'A count-in plays first.',
  start: 'Play task',
  leave: 'Leave the test? Your progress will not be saved.',
  preparing: 'Preparing your test…',
  nothing: { title: 'Nothing to test yet', subtitle: 'Practise a few skills first, then come back.' },
  noTasks: 'No tasks could be played, so nothing was saved.',
  gettingSongReady: 'Getting your song ready…',
  trouble: { build: 'Could not build the test.', prepare: 'Could not prepare the task.', task: 'This task could not be generated.', save: 'Could not save the test.' },
  skipped: (title) => `${title}: skipped (song not in your library)`,
  changes: (placement) => (placement ? 'Starting ratings' : 'Rating changes'),
  moved: (up) => (up ? 'up' : 'down'),
  nextFocus: 'Next focus',
}

/**
 * A singer's words. Singing has the weekly check alone, so the title and the opening line are the same
 * for every kind. The page that opens a check says that a tired voice may stop: nothing here is worth
 * singing through a sore throat for, and the check is still there the next day.
 */
const VOICE_CHECK: CheckWords = {
  title: () => 'Your weekly check',
  blurb: () => 'A short look at what you have been practising, to see what has changed since last time.',
  count: (_type, tasks) => countOf(tasks),
  mic: 'Microphone needed',
  rulesHeading: 'How it works',
  rules: [
    'Each task is sung once, from start to finish.',
    'After the count-in, listen first. Then sing when it is your turn.',
    'A task cannot be paused once it has started.',
    'Nothing is saved unless you finish the check.',
    'If your voice feels tired or sore, stop. The check will still be here tomorrow.',
  ],
  kind: (song) => (song ? 'A song' : 'An exercise'),
  measures: 'What it checks',
  songMeasure: 'Singing a song',
  beforeRule: 'A count-in comes first. Then listen, and sing when it is your turn.',
  start: 'Sing this task',
  leave: 'Leave the check? Nothing from it will be saved.',
  preparing: 'Getting your check ready…',
  nothing: { title: 'Nothing to check yet', subtitle: 'Sing a few exercises first, then come back.' },
  noTasks: 'No task could be sung, so nothing was saved.',
  gettingSongReady: 'Getting your song ready…',
  trouble: {
    build: 'We could not get your check ready. Please try again.',
    prepare: 'We could not get this task ready. Please try again.',
    task: 'This task could not be made ready.',
    save: 'We could not save your check. Please try again.',
  },
  skipped: (title) => `${title}: left out this time, because the song could not be made ready`,
  changes: () => 'What changed',
  moved: (up) => (up ? 'stronger' : 'needs a little more practice'),
  nextFocus: 'What to practise next',
}

/** The words of the check pages for one instrument; the guitar's unless told otherwise. */
export function checkWords(instrument: InstrumentId = 'guitar'): CheckWords {
  return instrument === 'voice' ? VOICE_CHECK : GUITAR_CHECK
}
