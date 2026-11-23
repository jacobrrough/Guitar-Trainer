/**
 * The Coach for a singer, on a real database (fake-indexeddb). Two things are held here at once:
 * everything a singer does lands on the singing side, stamped, in the singer's own range, in words
 * meant for a voice; and nothing a singer does moves a single row of the guitar side.
 *
 * The pure rules (planner, learner, checks, advice) have their own tests. These go through coach.ts
 * and the store, as the screens do.
 */
import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSettings, updateSettings, type AppSettings } from '../app/settings'
import { db } from '../db/db'
import { createDemoSong } from '../features/library/demoSong'
import { COURSE } from '../lessons/course'
import { finishLesson } from '../lessons/finish'
import { completeLesson, courseProgress } from '../lessons/store'
import { installBuiltInSongs } from '../songs'
import { VOCAL_SONGS, VOICE_LEVELS, levelDurations, songKey, vocalSong } from '../songs/vocal'
import { vocalSongRecord } from '../songs/vocal/install'
import { checkpointTasks, evaluateTask } from './assessment'
import {
  attemptForTask,
  coachRecommendations,
  completeExerciseBlock,
  completeFirstSteps,
  completeSongBlock,
  exerciseForBlock,
  exerciseForTask,
  finishExerciseBlock,
  finishTest,
  finishedLessons,
  getOrCreateTodaySession,
  markVoiceTired,
  recordExerciseRep,
  recordFelt,
  recordLessonDrill,
  recordSongPlay,
  skipPlacement,
  skipSessionBlock,
  songSummaries,
  startFirstSteps,
  updatePrefs,
  type FirstStepsSetup,
} from './coach'
import { DRILL_REV, UNLOCK_RATING, VOICE_TEST_PASS } from './constants'
import { exerciseParams } from './exercises'
import { skillById, skillsFor } from './instruments'
import { listMilestones } from './milestoneStore'
import { fitSongPasses, maxStepFor } from './planner'
import { SKILLS } from './skills'
import { getSession, listTests, loadLearnerModel, loadProfile, peekProfile, recentAttempts, resetTrainingData, saveProfile, saveSession } from './store'
import { completeTestBlock, saveFinishedTest } from './testBlocks'
import type { AttemptResult, Block, ExerciseBlock, ExerciseParams, Profile, SessionRecord, SkillState, SongBlock, SongItemState, TestBlock, TestTask, VoiceRange } from './types'
import { GENTLE_DAY_LINE, MOVED_DOWN, VOICE_CHECK_HEARD_ITSELF, VOICE_ONLY_WEEKLY_CHECK, lowerKeyNudge, voiceCheckOptions, voiceIsSetUp } from './voicePlan'
import { loadVoiceProfile, saveVoiceRange, setKeyNudge } from './voiceProfile'

// The guitar wizard also installs the bundled guitar songs, which renders audio. Not what is tested here.
vi.mock('../songs', async (importOriginal) => ({ ...(await importOriginal<typeof import('../songs')>()), installBuiltInSongs: vi.fn(async () => {}) }))

// The real store, with one thing noted on the way in: the stamp a session carries when it is handed
// over to be saved. Afterwards it cannot be told any more, because saving writes the stamp onto the
// record whenever the ids of its blocks give it away. `justBefore` lets a case do what another tab
// could do in the moment between a plan being made and being stored.
const handedOver = vi.hoisted(() => ({ stamps: [] as Array<string | undefined>, justBefore: undefined as (() => Promise<unknown>) | undefined }))
vi.mock('./store', async (importOriginal) => {
  const real = await importOriginal<typeof import('./store')>()
  const saveSession: typeof real.saveSession = async (record) => {
    handedOver.stamps.push(record.instrument)
    const first = handedOver.justBefore
    handedOver.justBefore = undefined
    await first?.()
    return real.saveSession(record)
  }
  return { ...real, saveSession }
})

// The singing course is written in another part of the app. These ten stand-ins have its ids and the
// skills its lessons drill, which is all the Coach reads of a course.
vi.mock('../lessons/voiceCourse', () => {
  const lessons: [string, string | null][] = [
    ['v01-voice', null],
    ['v02-meet', null],
    ['v03-match', 'voice.pitch.match'],
    ['v04-steps', 'voice.pitch.steps'],
    ['v05-words', 'voice.pitch.echo'],
    ['v06-five', 'voice.pitch.five-note'],
    ['v07-hold', 'voice.pitch.hold'],
    ['v08-jumps', 'voice.interval.thirds'],
    ['v09-slides', 'voice.range.slides'],
    ['v10-song', 'voice.pitch.match'],
  ]
  return {
    VOICE_COURSE: lessons.map(([id, skillId], i) => ({
      id,
      number: i + 1,
      title: id,
      subtitle: '',
      minutes: 5,
      learn: [],
      drill: skillId ? { skillId, generatorId: 'voiceEcho', tempo: 60, rounds: 3, passAccuracy: 0.7, hint: '' } : null,
      play: null,
      unlocks: [],
      done: '',
    })),
  }
})

const DAY = 86_400_000
const NOW = new Date(2026, 10, 9, 9, 0, 0)
const TODAY = '2026-11-09'
const at = NOW.getTime()
const VOICE_LESSONS = ['v01-voice', 'v02-meet', 'v03-match', 'v04-steps', 'v05-words', 'v06-five', 'v07-hold', 'v08-jumps', 'v09-slides', 'v10-song']
const GUITAR_LESSONS = COURSE.map((l) => l.id)

/** The sound sync was never measured on this device. Nothing a singer does may wait for it. */
const neverSynced: Pick<AppSettings, 'calibratedAt'> = {}
const synced: Pick<AppSettings, 'calibratedAt'> = { calibratedAt: at - DAY }

/** The "Lower voice" starting range: eight notes, the smallest range the app stores. */
const SMALL: VoiceRange = { low: 48, high: 55, easy: 52, source: 'default', at: 1 }
/** A whole octave: every step of every ladder fits. */
const OCTAVE: VoiceRange = { low: 48, high: 60, easy: 53, source: 'measured', at: 1 }
/** Wide enough for the two songs that span nine notes of the scale. */
const WIDE: VoiceRange = { low: 45, high: 59, easy: 52, source: 'measured', at: 1 }

const guitarSetup: FirstStepsSetup = { experience: 'new', handedness: 'left', guitarType: 'electric', dailyMinutes: 20 }

/** A sung round: every note in tune unless told otherwise. No timing spread is ever measured on a voice. */
function sung(partial: Partial<AttemptResult> = {}): AttemptResult {
  return {
    perfects: 8,
    goods: 0,
    misses: 0,
    total: 8,
    timingMedianMs: 60,
    timingStdevMs: null,
    coverage: 1,
    durationSec: 40,
    playedTempo: 60,
    targetTempo: 60,
    speed: 1,
    voice: { medianCents: 4, topMissed: 0 },
    ...partial,
  }
}
const clean = () => sung()
/** Neither clean nor rough: three notes in four. */
const soso = () => sung({ perfects: 6, misses: 2 })
const rough = () => sung({ perfects: 4, misses: 4 })

/** A round on the guitar. */
function played(partial: Partial<AttemptResult> = {}): AttemptResult {
  return { perfects: 18, goods: 2, misses: 0, total: 20, timingMedianMs: 5, timingStdevMs: 20, coverage: 0.9, durationSec: 40, playedTempo: 60, targetTempo: 60, speed: 1, ...partial }
}

/** A singer who has been through the set-up. */
async function singer(experience: FirstStepsSetup['experience'] = 'played', range: VoiceRange = SMALL, dailyMinutes: Profile['dailyMinutes'] = 20): Promise<Profile> {
  await saveVoiceRange(range, at)
  return startFirstSteps({ experience, dailyMinutes }, at, 'voice')
}

/** A guitar learner who is past the first check, with something stored in every table. */
async function guitarist(): Promise<void> {
  await saveProfile({ ...(await loadProfile()), placementDoneAt: at - 10 * DAY, experience: 'played', streak: 2, longestStreak: 2, lastSessionDate: '2026-11-08' })
  await db.skillStates.put({ skillId: SKILLS[0].id, rating: 42, confidence: 4, tempoCeiling: 70, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 6, lastPracticedAt: at - DAY })
  await db.lessons.bulkPut(GUITAR_LESSONS.map((id, i) => ({ id, status: i === 0 ? ('done' as const) : i === 1 ? ('available' as const) : ('locked' as const) })))
}

const isVoiceLesson = (id: string) => /^v\d\d-/.test(id)
/** Everything the guitar side has stored, and the two settings that belong to the guitar. */
async function guitarSide() {
  const settings = getSettings()
  return {
    profile: await db.profile.get(1),
    states: (await db.skillStates.toArray()).filter((s) => !s.skillId.startsWith('voice.')),
    lessons: (await db.lessons.toArray()).filter((l) => !isVoiceLesson(l.id)),
    sessions: (await db.sessions.toArray()).filter((s) => s.instrument !== 'voice'),
    attempts: (await db.attempts.toArray()).filter((a) => a.instrument !== 'voice'),
    tests: (await db.tests.toArray()).filter((t) => t.instrument !== 'voice'),
    milestones: (await db.milestones.toArray()).filter((m) => m.instrument !== 'voice'),
    songItems: (await db.songItems.toArray()).filter((i) => i.instrument !== 'voice'),
    songs: (await db.songs.toArray()).filter((s) => s.instrument !== 'voice').map((s) => s.id),
    handedness: settings.handedness,
    guitarType: settings.guitarType,
  }
}

/** Everything the singing side has stored. */
async function voiceSide() {
  return {
    profile: await db.profile.get(2),
    states: (await db.skillStates.toArray()).filter((s) => s.skillId.startsWith('voice.')),
    lessons: (await db.lessons.toArray()).filter((l) => isVoiceLesson(l.id)),
    sessions: (await db.sessions.toArray()).filter((s) => s.instrument === 'voice'),
    attempts: (await db.attempts.toArray()).filter((a) => a.instrument === 'voice'),
    tests: (await db.tests.toArray()).filter((t) => t.instrument === 'voice'),
    milestones: (await db.milestones.toArray()).filter((m) => m.instrument === 'voice'),
    songItems: (await db.songItems.toArray()).filter((i) => i.instrument === 'voice'),
    songs: (await db.songs.toArray()).filter((s) => s.instrument === 'voice').map((s) => s.id),
  }
}

const voiceDay = (now: Date = NOW, extra: { forceNew?: boolean; quick?: boolean } = {}) => getOrCreateTodaySession({ settings: neverSynced, now, instrument: 'voice', ...extra })
const guitarDay = (now: Date = NOW, extra: { forceNew?: boolean } = {}) => getOrCreateTodaySession({ settings: synced, now, ...extra })

const isExercise = (b: Block): b is ExerciseBlock => b.kind !== 'song' && b.kind !== 'test'
const exercisesOf = (s: SessionRecord) => s.plan.blocks.filter(isExercise)
const songsOf = (s: SessionRecord) => s.plan.blocks.filter((b): b is SongBlock => b.kind === 'song')
const testsOf = (s: SessionRecord) => s.plan.blocks.filter((b): b is TestBlock => b.kind === 'test')
const blockOf = (s: SessionRecord, kind: ExerciseBlock['kind']) => s.plan.blocks.find((b): b is ExerciseBlock => b.kind === kind)!
const voiceSkill = (id: string) => {
  const skill = skillById(id)
  if (!skill) throw new Error(`No skill ${id}`)
  return skill
}

/** A block of a singing skill as the planner writes it, for the cases that need one block and nothing else. */
function voiceBlock(skillId: string, kind: ExerciseBlock['kind'] = 'focus', params: Partial<ExerciseParams> = {}, index = 0, date = TODAY): ExerciseBlock {
  const skill = voiceSkill(skillId)
  const tempo = typeof params.tempo === 'number' ? params.tempo : skill.startTempo
  const ladder = skill.steps ? { step: 0, startStep: 0 } : {}
  return {
    id: `voice-${date}-${index}-${kind}`,
    kind,
    status: 'pending',
    minutes: 4,
    skillId,
    generatorId: skill.generators[0],
    params: { tempo, bars: 8, startTempo: tempo, maxTempo: skill.targetTempo, minTempo: skill.minTempo, ...ladder, ...params },
    tempo,
    reps: 3,
    reason: 'test',
  }
}

async function storedSession(blocks: Block[], instrument: 'guitar' | 'voice' = 'voice', date = TODAY): Promise<SessionRecord> {
  const record: SessionRecord = { date, plan: { date, minutes: 20, dayFactor: 1, blocks, explanation: [] }, minutesDone: 0, completedBlockIds: [], startedAt: 1, instrument }
  return { ...record, id: await saveSession(record) }
}

function guitarBlock(id: string, kind: ExerciseBlock['kind'] = 'focus', skill = SKILLS[0]): ExerciseBlock {
  const generatorId = skill.generators[0]
  return { id, kind, status: 'pending', minutes: 5, skillId: skill.id, generatorId, params: exerciseParams(skill, generatorId, 60), tempo: 60, reps: 3, reason: 'test' }
}

function skillState(skillId: string, rating: number, extra: Partial<SkillState> = {}): SkillState {
  return { skillId, rating, confidence: 5, tempoCeiling: 0, ease: 2.3, intervalDays: 0, plateauStep: 0, attempts: 12, lastPracticedAt: at - DAY, ...extra }
}

/** What a singer must never read: nothing is "played", and there is no guitar. */
const NOT_FOR_A_SINGER = /\b(play\w*|guitar\w*|strings?|fret\w*|strum\w*)\b/i
const BPM = /\bbpm\b/i
/** Words that are never said to a learner, and numbers a beginner cannot use. */
const UNKIND = /\b(wrong|fail\w*|louder|push\w*|belt\w*|tone.deaf)\b/i
const NUMBERS_FOR_EXPERTS = /\b(ratings?|accuracy|cents?)\b|%/i

beforeAll(() => {
  // Only the clock is held still: the database underneath needs its real timers. The store asks the
  // clock which runs are recent, so a fixed date in the tests needs a fixed clock beside it.
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterAll(() => {
  vi.useRealTimers()
})

beforeEach(async () => {
  vi.setSystemTime(NOW)
  await resetTrainingData()
  await db.songs.clear()
  updateSettings({ handedness: 'right', guitarType: 'acoustic' })
  vi.mocked(installBuiltInSongs).mockClear()
})

describe('the singing set-up', () => {
  it('creates the singing profile and its ten lessons, installs the songs to sing, and touches nothing of the guitar', async () => {
    await startFirstSteps(guitarSetup, at)
    const before = await guitarSide()
    expect(before.handedness).toBe('left')
    expect(before.lessons).toHaveLength(GUITAR_LESSONS.length)
    const installs = vi.mocked(installBuiltInSongs).mock.calls.length
    expect(installs).toBe(1)
    // The guitar set-up is what it was: it writes nothing for a singer, not a profile, a lesson or a song.
    expect(await db.songs.count()).toBe(0)
    expect(await db.profile.get(2)).toBeUndefined()
    expect(await courseProgress(VOICE_LESSONS)).toEqual([])

    // A full guitar answer handed over by mistake: its hand and guitar type are not the singer's to set.
    const setup: FirstStepsSetup = { experience: 'new', handedness: 'right', guitarType: 'acoustic', dailyMinutes: 10, goalSongId: 'sing-ode-to-joy' }
    const profile = await startFirstSteps(setup, at + 5, 'voice')

    expect(profile).toMatchObject({ id: 2, instrument: 'voice', experience: 'new', dailyMinutes: 10, goalSongId: 'sing-ode-to-joy', firstStepsStartedAt: at + 5, placementDoneAt: at + 5 })
    expect(profile.firstStepsDoneAt).toBeUndefined()
    expect(await db.profile.get(2)).toEqual(profile)
    const rows = await courseProgress(VOICE_LESSONS)
    expect(rows.map((r) => r.id)).toEqual(VOICE_LESSONS)
    expect(rows.map((r) => r.status)).toEqual(['available', ...VOICE_LESSONS.slice(1).map(() => 'locked')])
    const songs = (await db.songs.toArray()).filter((s) => s.instrument === 'voice')
    expect(songs.map((s) => s.builtinId).sort()).toEqual(VOCAL_SONGS.map((s) => s.id).sort())
    expect(songs.every((s) => s.audioData === undefined)).toBe(true)

    expect(await guitarSide()).toEqual(before)
    expect(vi.mocked(installBuiltInSongs).mock.calls.length).toBe(installs)
  })

  it('is "set up" by what the singer answered, never by the profile row being there', async () => {
    expect(voiceIsSetUp(await peekProfile('voice'))).toBe(false)
    // The range finder saves its result during the set-up: the row exists from then on.
    await saveVoiceRange(SMALL, at)
    expect(await db.profile.get(2)).toBeDefined()
    expect(voiceIsSetUp(await peekProfile('voice'))).toBe(false)
    await startFirstSteps({ experience: 'some', dailyMinutes: 20 }, at, 'voice')
    expect(voiceIsSetUp(await peekProfile('voice'))).toBe(true)
    // The range saved on the way is still there.
    expect((await loadVoiceProfile()).range).toEqual(SMALL)
  })

  it('never asks a singer for a starting check, whatever they answered', async () => {
    for (const experience of ['new', 'some', 'played'] as const) {
      await resetTrainingData()
      const profile = await singer(experience)
      expect(profile.placementDoneAt, experience).toBe(at)
      // "Yes, often" needs no first-steps course: it is over before it starts.
      expect(profile.firstStepsDoneAt, experience).toBe(experience === 'played' ? at : undefined)
      expect(!!profile.firstStepsStartedAt && !profile.firstStepsDoneAt, experience).toBe(experience !== 'played')
      // The lessons are there for every singer, also for one who does not need them: they can be opened from the menu.
      expect((await courseProgress(VOICE_LESSONS)).map((r) => r.status), experience).toEqual(['available', ...VOICE_LESSONS.slice(1).map(() => 'locked')])
      expect(testsOf(await voiceDay()), experience).toEqual([])
    }
  })

  it('starts a singer who has sung before with "Match a note" at the unlock line on its second step, so the next skills are open on day one', async () => {
    await singer('played')
    expect(await db.skillStates.get('voice.pitch.match')).toMatchObject({ rating: UNLOCK_RATING, step: 1, attempts: 0 })
    expect((await db.skillStates.toArray()).map((s) => s.skillId)).toEqual(['voice.pitch.match'])
    const day = await voiceDay()
    const focus = blockOf(day, 'focus')
    expect(voiceSkill(focus.skillId).tier).toBe(1)
    expect(voiceSkill(focus.skillId).prerequisites).toEqual(['voice.pitch.match'])
    // With no history a song starts on the whole tune, not on the echo levels.
    expect(songsOf(day)[0].level).toBe(2)
  })

  it('starts a beginner from nothing: no skill is rated before it was sung', async () => {
    await singer('new')
    expect(await db.skillStates.count()).toBe(0)
    const day = await voiceDay()
    expect(blockOf(day, 'focus').skillId).toBe('voice.pitch.match')
    // The first song: one line at a time, and at its own speed. A song to sing is never slowed down.
    expect(songsOf(day)[0]).toMatchObject({ level: 0, speed: 1 })
  })

  it('gives a singer who leaves the course the same start, and keeps what they had already earned', async () => {
    await singer('new')
    const left = await completeFirstSteps(at + 60_000, 'voice')
    expect(left.id).toBe(2)
    expect(left.firstStepsDoneAt).toBe(at + 60_000)
    expect(await db.skillStates.get('voice.pitch.match')).toMatchObject({ rating: UNLOCK_RATING, step: 1 })

    // Further than the starting point already: nothing is taken away.
    await resetTrainingData()
    await singer('new')
    const earned = skillState('voice.pitch.match', 72, { step: 2 })
    await db.skillStates.put(earned)
    await completeFirstSteps(at + 60_000, 'voice')
    expect(await db.skillStates.get('voice.pitch.match')).toEqual(earned)

    // Not as far: lifted to the starting point, and the rounds sung so far still count.
    await resetTrainingData()
    await singer('new')
    await db.skillStates.put(skillState('voice.pitch.match', 31, { step: 0, attempts: 4 }))
    await completeFirstSteps(at + 60_000, 'voice')
    expect(await db.skillStates.get('voice.pitch.match')).toMatchObject({ rating: UNLOCK_RATING, step: 1, attempts: 4 })
  })

  it('restarting the guitar course keeps every singing row', async () => {
    await singer('new')
    await completeLesson('v01-voice', 'v02-meet', at)
    await db.skillStates.put(skillState('voice.pitch.match', 30))
    // Guitar lessons left over from before a reset: all done, and no course on the guitar profile.
    await db.lessons.bulkPut(GUITAR_LESSONS.map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    const singing = { profile: await db.profile.get(2), lessons: await courseProgress(VOICE_LESSONS), states: await db.skillStates.toArray(), songs: await db.songs.count() }
    expect(singing.lessons).toHaveLength(10)

    await startFirstSteps(guitarSetup, at)

    const guitar = await courseProgress(GUITAR_LESSONS)
    expect(guitar.map((r) => r.status)).toEqual(['available', ...GUITAR_LESSONS.slice(1).map(() => 'locked')])
    expect({ profile: await db.profile.get(2), lessons: await courseProgress(VOICE_LESSONS), states: await db.skillStates.toArray(), songs: await db.songs.count() }).toEqual(singing)
  })

  it('restarting the singing course keeps every guitar lesson', async () => {
    await startFirstSteps(guitarSetup, at)
    await completeLesson(GUITAR_LESSONS[0], GUITAR_LESSONS[1], at)
    await db.lessons.bulkPut(VOICE_LESSONS.map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    const before = await guitarSide()

    await singer('new')

    expect((await courseProgress(VOICE_LESSONS)).map((r) => r.status)).toEqual(['available', ...VOICE_LESSONS.slice(1).map(() => 'locked')])
    expect(await guitarSide()).toEqual(before)
  })

  it('leaves lessons that were finished long ago as they are for a singer who says they have sung before', async () => {
    // Rows left over from before a reset: all done, and no course on the singing profile.
    await db.lessons.bulkPut(VOICE_LESSONS.map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    await singer('played')
    // They are not starting out: nothing is taken back to lesson 1.
    expect((await courseProgress(VOICE_LESSONS)).map((r) => r.status)).toEqual(VOICE_LESSONS.map(() => 'done'))
  })

  it('finishing the last singing lesson ends the singing course only', async () => {
    await startFirstSteps(guitarSetup, at)
    await singer('new')
    await db.lessons.bulkPut(VOICE_LESSONS.slice(0, 9).map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    const before = await guitarSide()
    expect(before.profile?.firstStepsStartedAt).toBe(at)
    expect(await finishedLessons('voice')).toEqual({
      lessonsDone: 9,
      lessonSkillIds: ['voice.pitch.match', 'voice.pitch.steps', 'voice.pitch.echo', 'voice.pitch.five-note', 'voice.pitch.hold', 'voice.interval.thirds', 'voice.range.slides'],
    })
    // The guitar course has finished nothing: a singing lesson teaches the guitar plan nothing.
    expect(await finishedLessons()).toEqual({ lessonsDone: 0, lessonSkillIds: [] })

    // As the lesson screen finishes a lesson: the last row and the end of the course in one transaction.
    await db.transaction('rw', db.lessons, db.profile, async () => {
      await completeLesson('v10-song', null, at + 60_000)
      await completeFirstSteps(at + 60_000, 'voice')
    })

    const voice = await loadProfile('voice')
    expect(voice.firstStepsDoneAt).toBe(at + 60_000)
    expect((await finishedLessons('voice')).lessonsDone).toBe(10)
    const guitar = await loadProfile()
    expect(guitar.firstStepsDoneAt).toBeUndefined()
    expect(await guitarSide()).toEqual(before)
    // A graduate is rated by what was sung in the lessons, not by the starting point of someone who skipped them.
    expect(await db.skillStates.get('voice.pitch.match')).toBeUndefined()
  })

  it('ends it the same way through the lesson screen\'s own "finish this lesson"', async () => {
    await startFirstSteps(guitarSetup, at)
    await singer('new')
    await db.lessons.bulkPut(VOICE_LESSONS.slice(0, 8).map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    const before = await guitarSide()

    expect(await finishLesson('v09-slides', at + 30_000)).toEqual({ courseComplete: false })
    expect((await loadProfile('voice')).firstStepsDoneAt).toBeUndefined()
    expect(await finishLesson('v10-song', at + 60_000)).toEqual({ courseComplete: true })

    expect((await loadProfile('voice')).firstStepsDoneAt).toBe(at + 60_000)
    expect(await db.skillStates.count()).toBe(0)
    expect(await guitarSide()).toEqual(before)
    // And a finished guitar lesson still ends nothing of the singer's.
    await resetTrainingData()
    await startFirstSteps(guitarSetup, at)
    await singer('new')
    for (const id of GUITAR_LESSONS) await finishLesson(id, at + 90_000)
    expect((await loadProfile()).firstStepsDoneAt).toBe(at + 90_000)
    expect((await loadProfile('voice')).firstStepsDoneAt).toBeUndefined()
    expect((await courseProgress(VOICE_LESSONS)).map((r) => r.status)).toEqual(['available', ...VOICE_LESSONS.slice(1).map(() => 'locked')])
  })

  it('keeps the two courses apart when the guitar course is ended', async () => {
    await startFirstSteps(guitarSetup, at)
    await singer('new')
    await completeFirstSteps(at + 60_000)
    expect((await loadProfile()).firstStepsDoneAt).toBe(at + 60_000)
    expect((await loadProfile('voice')).firstStepsDoneAt).toBeUndefined()
    // Leaving the guitar course rates no singing skill.
    expect(await db.skillStates.count()).toBe(0)
  })

  it('changes the preferences and the starting point of the instrument asked for, and of no other', async () => {
    await guitarist()
    await saveVoiceRange(SMALL, at)
    const guitar = await db.profile.get(1)

    await updatePrefs({ dailyMinutes: 30, pinnedSkillId: 'voice.pitch.hold' }, 'voice')
    await skipPlacement(at + 7, 'voice')

    expect(await db.profile.get(2)).toMatchObject({ dailyMinutes: 30, pinnedSkillId: 'voice.pitch.hold', placementDoneAt: at + 7 })
    expect(await db.profile.get(1)).toEqual(guitar)
    await updatePrefs({ dailyMinutes: 10 })
    expect((await db.profile.get(1))?.dailyMinutes).toBe(10)
    expect((await db.profile.get(2))?.dailyMinutes).toBe(30)
  })
})

describe('a day of singing beside a day of guitar', () => {
  it('plans one session for each on the same date, told apart by the ids of their blocks', async () => {
    await guitarist()
    await singer('played')

    // Asked for at the same moment, as two tabs would.
    const [guitar, voice] = await Promise.all([guitarDay(), voiceDay()])

    expect(guitar.id).toBeDefined()
    expect(voice.id).toBeDefined()
    expect(voice.id).not.toBe(guitar.id)
    expect(guitar.instrument).toBe('guitar')
    expect(voice.instrument).toBe('voice')
    expect(voice.date).toBe(TODAY)
    expect(guitar.date).toBe(TODAY)
    expect(voice.plan.blocks.length).toBeGreaterThan(1)
    voice.plan.blocks.forEach((b, i) => expect(b.id).toBe(`voice-${TODAY}-${i}-${b.kind}`))
    guitar.plan.blocks.forEach((b, i) => expect(b.id).toBe(`${TODAY}-${i}-${b.kind}`))
    expect(exercisesOf(voice).every((b) => b.skillId.startsWith('voice.'))).toBe(true)
    expect(exercisesOf(guitar).some((b) => b.skillId.startsWith('voice.'))).toBe(false)
    expect(await db.sessions.count()).toBe(2)
    expect((await getSession(TODAY))?.id).toBe(guitar.id)
    expect((await getSession(TODAY, 'voice'))?.id).toBe(voice.id)

    // Each side gets its own plan back, and a new plan for one replaces only that one.
    expect((await voiceDay()).id).toBe(voice.id)
    expect((await guitarDay()).id).toBe(guitar.id)
    const again = await voiceDay(NOW, { forceNew: true })
    expect(again.id).toBe(voice.id)
    expect(again.instrument).toBe('voice')
    expect((await db.sessions.get(voice.id!))?.instrument).toBe('voice')
    expect(await db.sessions.get(guitar.id!)).toEqual(guitar)
    expect(await db.sessions.count()).toBe(2)
  })

  it('says whose day it is on every plan it hands over to be stored, also on a new plan for the same day', async () => {
    await guitarist()
    await singer('played')
    handedOver.stamps.length = 0
    await voiceDay()
    await voiceDay(NOW, { forceNew: true })
    // Not left to the ids of the blocks: a plan that had none would be stored as a guitar day.
    expect(handedOver.stamps).toEqual(['voice', 'voice'])
    handedOver.stamps.length = 0
    await guitarDay()
    await guitarDay(NOW, { forceNew: true })
    expect(handedOver.stamps).toEqual(['guitar', 'guitar'])
  })

  it('takes the plan another tab stored for the singer in the meantime, never the guitar plan of that day', async () => {
    await guitarist()
    await singer('played')
    const guitar = await guitarDay()
    const fromOtherTab: SessionRecord = {
      date: TODAY,
      plan: { date: TODAY, minutes: 4, dayFactor: 1, blocks: [voiceBlock('voice.pitch.hold')], explanation: ['Planned in the other tab.'] },
      minutesDone: 0,
      completedBlockIds: [],
      startedAt: 5,
      instrument: 'voice',
    }
    handedOver.justBefore = () => db.sessions.add(fromOtherTab)

    const day = await voiceDay()

    expect(day.plan.explanation).toEqual(['Planned in the other tab.'])
    expect(day.instrument).toBe('voice')
    expect(day.id).not.toBe(guitar.id)
    expect(await db.sessions.count()).toBe(2)
    expect(await db.sessions.get(guitar.id!)).toEqual(guitar)
  })

  it('a sung round writes a stamped run and a singing skill, in the singer\'s range, and moves nothing of the guitar', async () => {
    await guitarist()
    await guitarDay()
    await singer('new', SMALL)
    const before = await guitarSide()
    const day = await voiceDay()
    const block = exercisesOf(day)[0]

    const exercise = exerciseForBlock(block, undefined, SMALL)
    expect(exercise.chart.voice).toBeDefined()
    expect(exercise.chart.notes.length).toBeGreaterThan(0)
    expect(exercise.chart.notes.every((n) => n.midi >= SMALL.low && n.midi <= SMALL.high)).toBe(true)
    expect(exercise.params).toMatchObject({ low: SMALL.low, high: SMALL.high, easy: SMALL.easy })
    expect(exercise.backing).not.toBeNull()

    const out = await recordExerciseRep(day, block, exercise, clean(), neverSynced, at)

    expect(out.counted).toBe(true)
    expect(out.attempt).toMatchObject({ instrument: 'voice', skillId: block.skillId, sessionId: day.id, kind: block.kind === 'warmup' ? 'warmup' : 'practice' })
    // What was sung is what is recorded: the range of that moment travels with the run.
    expect(out.attempt.params).toMatchObject({ low: SMALL.low, high: SMALL.high, easy: SMALL.easy, step: 0 })
    expect(out.state.skillId).toBe(block.skillId)
    expect(out.state.skillId.startsWith('voice.')).toBe(true)
    expect(out.state.rating).toBeGreaterThan(0)
    expect(await db.skillStates.get(block.skillId)).toEqual(out.state)
    expect(await recentAttempts({ instrument: 'voice' })).toHaveLength(1)
    expect(await recentAttempts()).toHaveLength(0)
    expect(Object.keys((await loadLearnerModel()).skills)).toEqual([SKILLS[0].id])
    expect(Object.keys((await loadLearnerModel('voice')).skills)).toEqual([block.skillId])
    expect((await db.milestones.toArray()).every((m) => m.instrument === 'voice')).toBe(true)
    expect(await guitarSide()).toEqual(before)
  })

  it('a round on the guitar is stored without a stamp, as it always was, and moves nothing of the singer', async () => {
    await guitarist()
    await singer('played')
    await voiceDay()
    const singing = { profile: await db.profile.get(2), states: (await db.skillStates.toArray()).filter((s) => s.skillId.startsWith('voice.')), session: await getSession(TODAY, 'voice') }
    const block = guitarBlock('b-focus')
    const session = await storedSession([block], 'guitar')

    const out = await completeExerciseBlock(session, block, exerciseForBlock(block), played(), synced, at)

    expect(out.counted).toBe(true)
    expect('instrument' in (await db.attempts.get(out.attempt.id!))!).toBe(false)
    expect((await db.milestones.toArray()).every((m) => m.instrument === undefined)).toBe(true)
    expect({ profile: await db.profile.get(2), states: (await db.skillStates.toArray()).filter((s) => s.skillId.startsWith('voice.')), session: await getSession(TODAY, 'voice') }).toEqual(singing)
  })

  it('stores a singing streak of 3 beside a guitar streak of 3', async () => {
    await guitarist()
    await singer('played')
    await saveProfile({ ...(await loadProfile('voice')), streak: 2, longestStreak: 2, lastSessionDate: '2026-11-08' })
    const strum = guitarBlock('b-focus')
    const guitar = await storedSession([strum], 'guitar')
    const hold = voiceBlock('voice.pitch.hold')
    const voice = await storedSession([hold])

    await completeExerciseBlock(guitar, strum, exerciseForBlock(strum), played(), synced, at)
    expect((await loadProfile()).streak).toBe(3)
    expect((await loadProfile('voice')).streak).toBe(2)
    await completeExerciseBlock(voice, hold, exerciseForBlock(hold, undefined, SMALL), clean(), neverSynced, at + 60_000)

    expect(await loadProfile('voice')).toMatchObject({ streak: 3, longestStreak: 3, lastSessionDate: TODAY })
    expect(await loadProfile()).toMatchObject({ streak: 3, longestStreak: 3, lastSessionDate: TODAY })
    const streaks = (await db.milestones.toArray()).filter((m) => m.type === 'streak')
    expect(streaks.map((m) => [m.key, m.instrument]).sort()).toEqual([
      ['streak:3', undefined],
      ['voice:streak:3', 'voice'],
    ])
    expect((await listMilestones(20, 'voice')).some((m) => m.key === 'voice:streak:3')).toBe(true)
    expect((await listMilestones(20)).some((m) => m.key.startsWith('voice'))).toBe(false)
  })

  it('knows a singing day by the ids of its blocks when the copy it is handed has lost its stamp', async () => {
    await guitarist()
    await singer('played')
    const hold = voiceBlock('voice.pitch.hold')
    const stored = await storedSession([hold])
    const { instrument: _stamp, ...unstamped } = stored
    const guitarStreak = (await loadProfile()).streak

    const out = await completeExerciseBlock(unstamped, hold, exerciseForBlock(hold, undefined, SMALL), clean(), neverSynced, at)

    expect(out.session.instrument).toBe('voice')
    expect((await loadProfile('voice')).lastSessionDate).toBe(TODAY)
    expect(await loadProfile()).toMatchObject({ streak: guitarStreak, lastSessionDate: '2026-11-08' })
    expect((await db.milestones.toArray()).every((m) => m.instrument === 'voice')).toBe(true)
  })

  it('leaves a singing skill out of the guitar plan of the next days, and a guitar skill out of the singing plan', async () => {
    await guitarist()
    await singer('played')
    const first = await voiceDay()
    const focus = blockOf(first, 'focus').skillId
    // The two days before: the same main exercise for the singer, and a guitar day on each as well,
    // stored after the singing one. Read across both instruments, the singer's last two days would not
    // look like the same exercise twice.
    for (const date of ['2026-11-08', '2026-11-07']) {
      await storedSession([voiceBlock(focus, 'focus', {}, 0, date)], 'voice', date)
      await storedSession([guitarBlock(`${date}-0-focus`)], 'guitar', date)
    }
    const next = await voiceDay(NOW, { forceNew: true })
    expect(blockOf(next, 'focus').skillId).not.toBe(focus)
    expect(blockOf(next, 'focus').reason).toContain('Next in line')

    // And the other way round: two guitar days on one exercise are still two days on it with singing days between.
    await db.sessions.clear()
    const guitarFirst = await guitarDay()
    const guitarFocus = blockOf(guitarFirst, 'focus')
    for (const date of ['2026-11-08', '2026-11-07']) {
      await storedSession([{ ...guitarFocus, id: `${date}-0-focus` }], 'guitar', date)
      await storedSession([voiceBlock('voice.pitch.hold', 'focus', {}, 0, date)], 'voice', date)
    }
    const guitarNext = await guitarDay(NOW, { forceNew: true })
    expect(blockOf(guitarNext, 'focus').skillId).not.toBe(guitarFocus.skillId)
  })

  it('does not offer a recap again that the singer was offered on their last singing day, however many guitar days lie between', async () => {
    await singer('played')
    const longAgo = (days: number) => at - days * DAY
    await db.skillStates.bulkPut([
      skillState('voice.pitch.match', 70, { step: 1, lastPracticedAt: longAgo(1) }),
      skillState('voice.pitch.steps', 50, { tempoCeiling: 66, lastPracticedAt: longAgo(6) }),
      skillState('voice.pitch.hold', 50, { step: 1, lastPracticedAt: longAgo(5) }),
      skillState('voice.pitch.echo', 50, { step: 1, lastPracticedAt: longAgo(4) }),
      skillState('voice.range.slides', 50, { step: 0, lastPracticedAt: longAgo(3) }),
    ])
    const first = await voiceDay()
    const recap = blockOf(first, 'review')
    expect(recap).toBeDefined()
    await db.sessions.clear()
    // The last singing day, five days ago, offered that recap. Four guitar days since.
    await storedSession([voiceBlock(recap.skillId, 'review', {}, 0, '2026-11-04')], 'voice', '2026-11-04')
    for (const date of ['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05']) await storedSession([guitarBlock(`${date}-0-review`, 'review')], 'guitar', date)

    const next = await voiceDay(NOW, { forceNew: true })
    expect(blockOf(next, 'review')).toBeDefined()
    expect(blockOf(next, 'review').skillId).not.toBe(recap.skillId)
  })
})

describe('tempos an earlier version stored for the guitar', () => {
  /** A guitar learner from before drill revisions, with a tempo above where the Coach now stops. */
  async function oldGuitarist() {
    const skill = SKILLS[0]
    const { drillRev: _rev, ...profile } = { ...(await loadProfile()), placementDoneAt: at - 10 * DAY }
    await db.profile.put(profile)
    await db.skillStates.put(skillState(skill.id, 50, { tempoCeiling: skill.targetTempo + 30 }))
    return skill
  }

  it('are still corrected when a guitar day is planned', async () => {
    const skill = await oldGuitarist()
    await guitarDay()
    expect((await db.skillStates.get(skill.id))?.tempoCeiling).toBe(skill.targetTempo)
    expect((await loadProfile()).drillRev).toBe(DRILL_REV)
  })

  it('are left alone by a singing day: that correction belongs to the guitar plan', async () => {
    const skill = await oldGuitarist()
    await singer('played')
    const guitar = await guitarSide()
    await voiceDay()
    expect(await guitarSide()).toEqual(guitar)
    expect((await db.skillStates.get(skill.id))?.tempoCeiling).toBe(skill.targetTempo + 30)
    expect((await db.profile.get(1))?.drillRev).toBeUndefined()
  })
})

describe('the plan of a singer', () => {
  it('lasts 10, 20 or 30 minutes and always opens with a warm-up; 45 is the 30-minute day and "quick" the shortest one', async () => {
    for (const [asked, minutes] of [
      [10, 10],
      [20, 20],
      [30, 30],
      [45, 30],
    ] as const) {
      await resetTrainingData()
      await singer('played', SMALL, asked)
      const day = await voiceDay()
      expect(day.plan.minutes, `${asked}`).toBe(minutes)
      expect(day.plan.blocks[0].kind, `${asked}`).toBe('warmup')
      // A round is at most eight bars: a voice needs its rests.
      for (const b of exercisesOf(day)) expect(b.params.bars, `${asked} ${b.skillId}`).toBeLessThanOrEqual(8)
    }
    // The profile still says 45: a quick day is the shortest one, warm-up included, and not one exercise alone.
    const quick = await voiceDay(NOW, { forceNew: true, quick: true })
    expect(quick.plan.minutes).toBe(10)
    expect(quick.plan.blocks.slice(0, 2).map((b) => [b.kind, b.minutes])).toEqual([
      ['warmup', 2],
      ['focus', 4],
    ])
    expect(songsOf(quick).reduce((sum, b) => sum + b.minutes, 0)).toBe(4)
    expect(quick.plan.explanation.join(' ')).not.toMatch(/Quick session/)
  })

  it('builds on what the singing lessons taught, and never on the lessons of the other course', async () => {
    await singer('new', SMALL)
    await skipPlacement(at)
    await db.lessons.bulkPut(VOICE_LESSONS.slice(0, 9).map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    const taught = (await finishedLessons('voice')).lessonSkillIds

    // Nothing is rated yet. The lessons went past the first basics, so the plan does too.
    const day = await voiceDay()
    const focus = voiceSkill(blockOf(day, 'focus').skillId)
    expect(focus.tier).toBeGreaterThanOrEqual(1)
    expect(taught).toContain(focus.id)
    expect(day.plan.explanation.join(' ')).not.toMatch(/First steps/)

    // Nine singing lessons teach the guitar nothing: its plan still starts from the open strings.
    const guitar = await guitarDay()
    expect(guitar.plan.explanation.join(' ')).toMatch(/First steps: open strings/)
    expect(SKILLS.find((s) => s.id === blockOf(guitar, 'focus').skillId)?.tier).toBe(0)
  })

  it('plans and builds for a singer whose range was never saved, and guesses no range into the profile', async () => {
    // The set-up always saves a range on the way. This is the profile of a set-up that was cut short there.
    await startFirstSteps({ experience: 'played', dailyMinutes: 20 }, at, 'voice')
    expect((await loadVoiceProfile()).range).toBeUndefined()

    const day = await voiceDay()

    expect(day.plan.blocks[0].kind).toBe('warmup')
    expect(exercisesOf(day).length).toBeGreaterThan(1)
    expect(songsOf(day).length).toBeGreaterThan(0)
    for (const block of exercisesOf(day)) {
      // No limit is stored with a block when no range says where a ladder ends.
      expect('maxStep' in block.params, block.skillId).toBe(false)
      // Built without a range, an exercise says itself which notes it used: the smallest range there is.
      const exercise = exerciseForBlock(block)
      expect(exercise.chart.notes.length, block.skillId).toBeGreaterThan(0)
      expect(Number(exercise.params.high) - Number(exercise.params.low), block.skillId).toBe(7)
      const out = await recordExerciseRep(day, block, exercise, clean(), neverSynced, at)
      expect(out.attempt.instrument).toBe('voice')
    }
    // Every song is sung as written, so none is left out for its key; the skills a song needs still hold it back.
    const offered = (await songSummaries('voice')).map((s) => s.builtinId)
    expect(offered).toContain('sing-london-bridge')
    expect(offered).not.toContain('sing-amazing-grace')
    // Nothing above invented a range.
    expect((await loadVoiceProfile()).range).toBeUndefined()
  })

  it('stores how far up a ladder this voice can go, and never plans a step the range cannot hold', async () => {
    // "Slides" goes up to note 3, to note 5 (seven semitones) and to note 8 (twelve).
    await singer('played', SMALL)
    await updatePrefs({ pinnedSkillId: 'voice.range.slides' }, 'voice')
    await db.skillStates.put(skillState('voice.range.slides', 55, { step: 2 }))
    const small = blockOf(await voiceDay(), 'focus')
    expect(small.skillId).toBe('voice.range.slides')
    expect(maxStepFor(voiceSkill('voice.range.slides'), SMALL)).toBe(1)
    expect(small.params).toMatchObject({ step: 1, startStep: 1, maxStep: 1 })
    // The exercise it builds is that step, inside the range.
    const exercise = exerciseForBlock(small, undefined, SMALL)
    expect(exercise.params.step).toBe(1)
    expect(exercise.chart.notes.every((n) => n.midi >= SMALL.low && n.midi <= SMALL.high)).toBe(true)

    // A whole octave holds every step: no limit is stored.
    await saveVoiceRange(OCTAVE, at)
    const wide = blockOf(await voiceDay(NOW, { forceNew: true }), 'focus')
    expect(wide.params.step).toBe(2)
    expect('maxStep' in wide.params).toBe(false)
  })

  it('sings every song at its one speed, without a loop of bars, as often as fits the level about to be sung', async () => {
    await singer('new', SMALL)
    // A long tune, so that the number of passes is not at its limit either way.
    const buns = await vocalSongRecord('sing-saints')
    const item = (level: number, extra: Partial<SongItemState>): SongItemState => ({
      key: `${buns.id}:${level}`,
      songId: buns.id,
      level,
      bestAccuracy: 0.8,
      lastAt: at - DAY,
      ease: 2.3,
      intervalDays: 0,
      // On a guitar these bars would be looped first.
      weakBars: [2, 3],
      lastAccuracy: 0.8,
      lastSpeed: 1,
      lowStreak: 0,
      instrument: 'voice',
      ...extra,
    })
    await db.songItems.put(item(0, {}))
    // Every other song the Coach offers was sung more recently, so this one is the song of the day.
    const others = (await songSummaries('voice')).filter((s) => s.id !== buns.id)
    await db.songItems.bulkPut(others.map((s) => ({ ...item(2, { lastAt: at - 3_600_000, weakBars: [] }), key: `${s.id}:2`, songId: s.id })))

    const echo = songsOf(await voiceDay())[0]
    expect(echo).toMatchObject({ songId: buns.id, level: 0, speed: 1 })
    expect(echo.loopBars).toBeUndefined()
    expect(echo.reason).not.toMatch(/tricky bars/)
    const durations = levelDurations(vocalSong('sing-saints')!)
    // An echo level lasts about twice the tune, so it is sung fewer times in the same minutes.
    expect(durations[0]).toBeGreaterThan(durations[2] * 1.5)
    expect(echo.passes).toBe(fitSongPasses(echo.minutes, { duration: durations[0], bpm: buns.bpm }, 1))
    expect(echo.passes).toBeLessThan(fitSongPasses(echo.minutes, { duration: durations[2], bpm: buns.bpm }, 1))

    await db.songItems.put(item(2, { lastAt: at - DAY + 1 }))
    const tune = songsOf(await voiceDay(NOW, { forceNew: true }))[0]
    expect(tune).toMatchObject({ songId: buns.id, level: 2, speed: 1, minutes: echo.minutes })
    expect(tune.loopBars).toBeUndefined()
    expect(tune.passes).toBe(fitSongPasses(tune.minutes, { duration: durations[2], bpm: buns.bpm }, 1))
    expect(tune.passes).toBeGreaterThan(echo.passes!)
  })

  it('keeps a comeback day at the one speed too, and gives a singer who knows one skill more than its warm-up', async () => {
    await singer('played', SMALL)
    await saveProfile({ ...(await loadProfile('voice')), lastSessionDate: '2026-10-20' })
    const back = await voiceDay()
    expect(back.plan.explanation.join(' ')).toMatch(/Welcome back/)
    expect(songsOf(back).length).toBeGreaterThan(0)
    for (const s of songsOf(back)) expect(s.speed).toBe(1)
    for (const b of exercisesOf(back)) {
      const skill = voiceSkill(b.skillId)
      if (skill.minTempo !== undefined) expect(b.tempo, b.skillId).toBeGreaterThanOrEqual(skill.minTempo)
    }
    // Sung exercises are told apart by skill: the one skill this singer knows is recapped as well.
    expect(exercisesOf(back).map((b) => [b.kind, b.skillId])).toEqual([
      ['warmup', 'voice.pitch.match'],
      ['review', 'voice.pitch.match'],
    ])
  })

  it('warms a voice up on a singing skill of its own kind: staying in tune, or higher and lower', async () => {
    await singer('played', SMALL)
    await updatePrefs({ pinnedSkillId: 'voice.pitch.hold' }, 'voice')
    await db.skillStates.bulkPut([skillState('voice.pitch.match', 70, { step: 1 }), skillState('voice.pitch.steps', 50, { tempoCeiling: 66 }), skillState('voice.pitch.hold', 80, { step: 1 })])
    const day = await voiceDay()
    expect(blockOf(day, 'focus').skillId).toBe('voice.pitch.hold')
    // Past the first steps a comfortable skill one tier up is the warm-up. "Hold a note" is rated
    // higher, but it is a breath skill: a long held note is not what a cold voice starts with.
    expect(blockOf(day, 'warmup').skillId).toBe('voice.pitch.steps')
    expect(blockOf(day, 'warmup').reason).toMatch(/wake your voice up gently/)
  })

  it('brings a stored plan back inside the floor and the target of its skills when the day is opened', async () => {
    await singer('played')
    const steps = voiceSkill('voice.pitch.steps')
    const low = voiceBlock(steps.id, 'focus', { tempo: 40 }, 0)
    const high = voiceBlock(steps.id, 'review', { tempo: 120 }, 1)
    const done: ExerciseBlock = { ...voiceBlock(steps.id, 'warmup', { tempo: 40 }, 2), status: 'done' }
    const stored = await storedSession([low, high, done])

    const opened = await voiceDay()

    expect(opened.id).toBe(stored.id)
    const [first, second, third] = opened.plan.blocks as ExerciseBlock[]
    expect(first.tempo).toBe(steps.minTempo)
    expect(first.params).toMatchObject({ tempo: steps.minTempo, startTempo: steps.minTempo })
    expect(second.tempo).toBe(steps.targetTempo)
    // What was sung stays as it was sung.
    expect(third.tempo).toBe(40)
    expect(((await getSession(TODAY, 'voice'))!.plan.blocks[0] as ExerciseBlock).tempo).toBe(steps.minTempo)
    // Even a block that slipped through is never built under the floor: sung too slowly, a line outlasts the breath.
    expect(exerciseForBlock(low, undefined, SMALL).params.tempo).toBe(steps.minTempo)
  })
})

describe('the songs the Coach offers a singer', () => {
  const offered = async () => (await songSummaries('voice')).map((s) => s.builtinId)

  it('lists a song with six levels of the same notes, its lesson, and how long each level lasts', async () => {
    await singer('new', SMALL)
    const list = await songSummaries('voice')
    expect(list.length).toBeGreaterThan(0)
    for (const summary of list) {
      const song = vocalSong(summary.builtinId!)!
      const row = (await db.songs.get(summary.id))!
      expect(row.builtinId).toBe(song.id)
      expect(summary.instrument).toBe('voice')
      expect(summary.title).toBe(song.title)
      expect(summary.levelNoteCounts).toEqual(VOICE_LEVELS.map(() => row.chart.notes.length))
      expect(summary.levelNoteCounts).toHaveLength(6)
      expect(summary.levelNoteCounts[0]).toBeGreaterThan(0)
      expect(summary.lessonLevel).toBe(song.lessonLevel)
      expect(summary.levelDurations).toEqual(levelDurations(song))
    }
  })

  it('leaves out a song that does not fit the range', async () => {
    await singer('new', SMALL)
    const fits = (id: string, range: VoiceRange) => songKey(vocalSong(id)!, range).fits
    expect(fits('sing-london-bridge', SMALL)).toBe(false)
    expect(fits('sing-jingle-bells', SMALL)).toBe(true)
    expect(await offered()).toEqual(['sing-hot-cross-buns', 'sing-mary-lamb', 'sing-ode-to-joy', 'sing-aunt-rhody', 'sing-saints', 'sing-jingle-bells'])
    // No song the Coach may not offer ever becomes a block.
    const day = await voiceDay()
    const ids = new Set((await songSummaries('voice')).map((s) => s.id))
    expect(songsOf(day).length).toBeGreaterThan(0)
    expect(songsOf(day).every((b) => ids.has(b.songId))).toBe(true)

    await saveVoiceRange(WIDE, at)
    expect(await offered()).toEqual(['sing-hot-cross-buns', 'sing-mary-lamb', 'sing-ode-to-joy', 'sing-aunt-rhody', 'sing-saints', 'sing-london-bridge', 'sing-jingle-bells', 'sing-twinkle'])
  })

  it('holds a song back until the skills it needs are under way', async () => {
    await singer('new', WIDE)
    expect(vocalSong('sing-amazing-grace')!.needs).toEqual(['voice.interval.triad'])
    expect(songKey(vocalSong('sing-amazing-grace')!, WIDE).fits).toBe(true)
    expect(await offered()).not.toContain('sing-amazing-grace')
    await db.skillStates.put(skillState('voice.interval.triad', 49))
    expect(await offered()).not.toContain('sing-amazing-grace')
    await db.skillStates.put(skillState('voice.interval.triad', 50))
    expect(await offered()).toContain('sing-amazing-grace')
    expect(await offered()).not.toContain('sing-happy-birthday')
  })

  it('writes the row of a song when it is first needed, and finds the same row afterwards', async () => {
    await singer('new', SMALL)
    await db.songs.clear()
    const first = await songSummaries('voice')
    expect(first.length).toBe(6)
    expect((await db.songs.toArray()).every((s) => s.instrument === 'voice')).toBe(true)
    const again = await songSummaries('voice')
    expect(again.map((s) => s.id)).toEqual(first.map((s) => s.id))
    // The plan needs the rows as well: a day planned with an empty table still has its song.
    await db.songs.clear()
    await db.sessions.clear()
    const day = await voiceDay()
    expect(songsOf(day).length).toBeGreaterThan(0)
    expect((await db.songs.get(songsOf(day)[0].songId))?.instrument).toBe('voice')
  })

  it('keeps the songs to sing out of the guitar list, and the guitar songs out of the singer\'s', async () => {
    await singer('new', SMALL)
    const { audio, ...demo } = await createDemoSong()
    const id = await db.songs.add({ ...demo, audioData: await audio.arrayBuffer(), createdAt: 1, updatedAt: 1, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0 })
    const guitar = await songSummaries()
    expect(guitar.map((s) => s.id)).toEqual([id])
    expect(guitar[0].instrument).toBeUndefined()
    expect((await songSummaries('voice')).some((s) => s.id === id)).toBe(false)
  })
})

describe('a round of a step exercise', () => {
  const holdOn = (step: number, startStep = step, extra: Partial<ExerciseParams> = {}) => voiceBlock('voice.pitch.hold', 'focus', { step, startStep, ...extra })

  it('is followed by the next step after a clean round, at most one above where the block began, and never by another tempo', async () => {
    await singer('played', OCTAVE)
    const block = holdOn(1)
    const session = await storedSession([block])
    const first = await recordExerciseRep(session, block, exerciseForBlock(block, undefined, OCTAVE), clean(), neverSynced, at)
    expect(first.nextParams).toEqual({ step: 2 })
    expect(first.nextTempo).toBe(block.tempo)
    // The run says which step it was sung on: the rating and the next days go by it.
    expect(first.attempt.params?.step).toBe(1)

    const up = holdOn(2, 1)
    const second = await recordExerciseRep(session, up, exerciseForBlock(up, undefined, OCTAVE), clean(), neverSynced, at + 60_000)
    expect(second.attempt.params?.step).toBe(2)
    expect(second.nextParams).toEqual({ step: 2 })
    expect(second.nextTempo).toBe(block.tempo)
  })

  it('is followed by the step below after a rough round: easier, never slower', async () => {
    await singer('played', OCTAVE)
    const block = holdOn(2)
    const session = await storedSession([block])
    const out = await recordExerciseRep(session, block, exerciseForBlock(block, undefined, OCTAVE), rough(), neverSynced, at)
    expect(out.performance.acc).toBeLessThan(0.75)
    expect(out.nextParams).toEqual({ step: 1 })
    expect(out.nextTempo).toBe(block.tempo)
    // On the first step there is nothing below.
    const bottom = holdOn(0)
    const again = await recordExerciseRep(session, bottom, exerciseForBlock(bottom, undefined, OCTAVE), rough(), neverSynced, at + 60_000)
    expect(again.nextParams).toEqual({ step: 0 })
  })

  it('goes a step easier after two rounds in a row on one step that were neither clean nor rough', async () => {
    await singer('played', OCTAVE)
    const block = holdOn(2)
    const session = await storedSession([block])
    const exercise = exerciseForBlock(block, undefined, OCTAVE)
    const first = await recordExerciseRep(session, block, exercise, soso(), neverSynced, at)
    expect(first.performance.acc).toBeCloseTo(0.75, 6)
    expect(first.nextParams).toEqual({ step: 2 })
    const second = await recordExerciseRep(session, block, exercise, soso(), neverSynced, at + 60_000)
    expect(second.nextParams).toEqual({ step: 1 })
    // On the easier step the count starts again.
    const eased = holdOn(1, 2)
    const third = await recordExerciseRep(session, eased, exerciseForBlock(eased, undefined, OCTAVE), soso(), neverSynced, at + 120_000)
    expect(third.nextParams).toEqual({ step: 1 })
    // Another sitting starts fresh, also on the very step the last one ended on.
    const other = { ...session, id: (session.id ?? 0) + 1000 }
    const fresh = await recordExerciseRep(other, eased, exerciseForBlock(eased, undefined, OCTAVE), soso(), neverSynced, at + 180_000)
    expect(fresh.nextParams).toEqual({ step: 1 })
  })

  it('never announces a step the range cannot hold, also when the range got smaller after the day was planned', async () => {
    await singer('played', SMALL)
    // Planned for a wider range: no limit stored with the block, and the top step asked for.
    const block = voiceBlock('voice.range.slides', 'focus', { step: 2, startStep: 2 })
    const session = await storedSession([block])
    const exercise = exerciseForBlock(block, undefined, SMALL)
    expect(exercise.params).toMatchObject({ step: 1, maxStep: 1 })

    const out = await recordExerciseRep(session, block, exercise, clean(), neverSynced, at)

    expect(out.attempt.params).toMatchObject({ step: 1, maxStep: 1 })
    expect(out.nextParams).toEqual({ step: 1 })
  })

  it('stays on its step after a run that did not count', async () => {
    await singer('played', OCTAVE)
    const block = holdOn(2)
    const session = await storedSession([block])
    const out = await recordExerciseRep(session, block, exerciseForBlock(block, undefined, OCTAVE), sung({ bleed: true }), neverSynced, at)
    expect(out.counted).toBe(false)
    expect(out.nextParams).toEqual({ step: 2 })
    expect(out.nextTempo).toBe(block.tempo)
    expect(out.attempt.instrument).toBe('voice')
    expect(await db.skillStates.get('voice.pitch.hold')).toBeUndefined()
  })

  it('opens the next step for the days to come after two clean rounds, as a milestone of its own and never as a tempo', async () => {
    await singer('played', OCTAVE)
    const block = holdOn(1)
    const session = await storedSession([block])
    const exercise = exerciseForBlock(block, undefined, OCTAVE)
    await recordExerciseRep(session, block, exercise, clean(), neverSynced, at)
    const out = await recordExerciseRep(session, block, exercise, clean(), neverSynced, at + 60_000)
    expect(out.state.step).toBe(2)
    const milestones = await db.milestones.toArray()
    const step = milestones.find((m) => m.key === 'step:voice.pitch.hold:2')
    expect(step).toMatchObject({ instrument: 'voice', type: 'tempo', title: 'Hold a note steady: 8 beats' })
    expect(milestones.some((m) => m.key.startsWith('tempo:voice.pitch.hold'))).toBe(false)
    expect(milestones.every((m) => m.instrument === 'voice')).toBe(true)
    for (const m of milestones) expect(`${m.title} ${m.detail}`).not.toMatch(BPM)
  })

  it('moves a later block of the same exercise up a step when the block before it went cleanly', async () => {
    await singer('played', OCTAVE)
    const focus = holdOn(1)
    const recap = voiceBlock('voice.pitch.hold', 'review', { step: 1, startStep: 1 }, 1)
    const other = voiceBlock('voice.pitch.echo', 'second', { step: 1, startStep: 1 }, 2)
    const session = await storedSession([focus, recap, other])

    const out = await completeExerciseBlock(session, focus, exerciseForBlock(focus, undefined, OCTAVE), clean(), neverSynced, at)

    const [, later, untouched] = out.session.plan.blocks as ExerciseBlock[]
    expect(later.params.step).toBe(2)
    expect(untouched.params.step).toBe(1)
    expect(out.session.instrument).toBe('voice')
    expect(out.session.completedBlockIds).toEqual([focus.id])
  })

  it('closes a block early on the singing side', async () => {
    await singer('played', OCTAVE)
    await db.skillStates.put(skillState('voice.pitch.hold', 80, { step: 1 }))
    const block = holdOn(1)
    const session = await storedSession([block])
    const rep = await recordExerciseRep(session, block, exerciseForBlock(block, undefined, OCTAVE), clean(), neverSynced, at)
    // Pinned on another screen between the round and the end of the block.
    await db.skillStates.put({ ...rep.state, pinned: true })
    const out = await finishExerciseBlock(session, block, rep, at + 60_000)
    expect(out.counted).toBe(true)
    expect(out.session.plan.blocks[0].status).toBe('done')
    // Solid by now: the first recap is scheduled, on the singing state as it is stored, not on a copy from the round.
    expect((await db.skillStates.get('voice.pitch.hold'))?.nextReviewAt).toBeGreaterThan(at)
    expect((await db.skillStates.get('voice.pitch.hold'))?.pinned).toBe(true)
    expect((await loadProfile('voice')).lastSessionDate).toBe(TODAY)
    expect((await loadProfile()).lastSessionDate).toBeUndefined()
  })
})

describe('what a sung round opens', () => {
  /** "Match a note" on its last step, one clean round short of the line that opens what builds on it. */
  async function nearlyThere() {
    await db.skillStates.put(skillState('voice.pitch.match', UNLOCK_RATING - 0.5, { step: 3 }))
    const block = voiceBlock('voice.pitch.match', 'focus', { step: 3, startStep: 3 })
    const session = await storedSession([block])
    const out = await recordExerciseRep(session, block, exerciseForBlock(block, undefined, OCTAVE), clean(), neverSynced, at)
    expect(out.ratingBefore).toBeLessThan(UNLOCK_RATING)
    expect(out.state.rating).toBeGreaterThanOrEqual(UNLOCK_RATING)
    return (await db.milestones.toArray()).filter((m) => m.type === 'unlock')
  }

  it('announces the singing skills a round opened, as milestones of the singer', async () => {
    await singer('new', OCTAVE)
    const opened = await nearlyThere()
    expect(opened.map((m) => m.key).sort()).toEqual(['unlock:voice.pitch.echo', 'unlock:voice.pitch.hold', 'unlock:voice.pitch.steps', 'unlock:voice.range.slides'])
    expect(opened.every((m) => m.instrument === 'voice')).toBe(true)
  })

  it('does not announce what the singing lessons already taught: the plan has had those open since the course', async () => {
    await singer('new', OCTAVE)
    await db.lessons.bulkPut(VOICE_LESSONS.slice(0, 9).map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    // Finished guitar lessons teach a singer nothing, and are not asked.
    await db.lessons.bulkPut(GUITAR_LESSONS.map((id) => ({ id, status: 'done' as const, completedAt: 1 })))
    expect(await nearlyThere()).toEqual([])
  })
})

describe('a round of a sung exercise that gets faster', () => {
  it('is never asked for under the floor of its skill, however rough the round', async () => {
    await singer('played', SMALL)
    const steps = voiceSkill('voice.pitch.steps')
    expect(steps.minTempo).toBe(54)
    const block = voiceBlock(steps.id, 'focus', { tempo: 54 })
    const session = await storedSession([block])
    const out = await recordExerciseRep(session, block, exerciseForBlock(block, undefined, SMALL), sung({ perfects: 2, misses: 6, playedTempo: 54, targetTempo: 54 }), neverSynced, at)
    expect(out.nextTempo).toBe(54)
    expect(out.nextParams).toBeUndefined()
    // A clean round still speeds it up.
    const up = await recordExerciseRep(session, block, exerciseForBlock(block, undefined, SMALL), sung({ playedTempo: 54, targetTempo: 54 }), neverSynced, at + 60_000)
    expect(up.nextTempo).toBe(57)
  })

  it('leaves a guitar round exactly as it was: a tempo, and no step', async () => {
    await guitarist()
    const block = { ...guitarBlock('b-focus'), tempo: 80, params: exerciseParams(SKILLS[0], SKILLS[0].generators[0], 80) }
    const session = await storedSession([block], 'guitar')
    const out = await recordExerciseRep(session, block, exerciseForBlock(block), played({ perfects: 5, goods: 0, misses: 15, playedTempo: 80, targetTempo: 80 }), synced, at)
    expect(out.nextTempo).toBe(74)
    expect('nextParams' in out).toBe(false)
  })
})

describe('building an exercise', () => {
  it('refuses a skill it does not know, for a block and for a task of a check', () => {
    const block = { ...guitarBlock('b'), skillId: 'voice.pitch.nothing' }
    expect(() => exerciseForBlock(block)).toThrow(/Unknown skill/)
    const task: TestTask = { id: 't', title: 't', instructions: '', skillIds: ['fret.no-such-skill'], generatorId: 'melody', params: { tempo: 60, bars: 4 }, difficulty: 20, passCriteria: VOICE_TEST_PASS }
    // It used to be built as the first guitar skill, whatever it was.
    expect(() => exerciseForTask(task)).toThrow(/Unknown skill/)
    expect(() => exerciseForTask({ ...task, skillIds: [] })).toThrow(/Unknown skill/)
    expect(exerciseForTask({ ...task, generatorId: 'song' })).toBeNull()
  })

  it('places a task of a check in the range of that moment, and builds a guitar block the same with or without one', () => {
    const hold = voiceSkill('voice.pitch.hold')
    const task: TestTask = { id: 't', title: 't', instructions: '', skillIds: [hold.id], generatorId: 'voiceHold', params: exerciseParams(hold, 'voiceHold', 60, { step: 1, bars: 8 }), difficulty: 20, passCriteria: VOICE_TEST_PASS }
    const high: VoiceRange = { low: 60, high: 67, easy: 64, source: 'default', at: 1 }
    const exercise = exerciseForTask(task, undefined, high)!
    expect(exercise.chart.notes.every((n) => n.midi >= 60 && n.midi <= 67)).toBe(true)
    expect(exercise.params).toMatchObject({ low: 60, high: 67, easy: 64, step: 1 })
    // A check has no listening guide.
    expect(exercise.wantsGuide).toBe(false)
    // Without a range nothing is guessed here: the exercise says itself which range it was built in.
    expect(exerciseForTask(task)!.params).toMatchObject({ low: SMALL.low, high: SMALL.high })

    // A range that travelled with the block (an exercise's own params, stored again) never wins over the range of this moment.
    const stale = voiceBlock(hold.id, 'focus', { step: 1, startStep: 1, low: 60, high: 67, easy: 64 })
    const now = exerciseForBlock(stale, undefined, SMALL)
    expect(now.params).toMatchObject({ low: SMALL.low, high: SMALL.high, easy: SMALL.easy })
    expect(now.chart.notes.every((n) => n.midi >= SMALL.low && n.midi <= SMALL.high)).toBe(true)

    const block = guitarBlock('b')
    const plain = exerciseForBlock(block)
    const withRange = exerciseForBlock(block, undefined, high)
    expect(withRange.params).toEqual(plain.params)
    expect(withRange.id).toBe(plain.id)
    expect(withRange.chart.notes).toEqual(plain.chart.notes)
  })
})

describe('a lesson round of the singing course', () => {
  it('is a singing run although its stand-in block has no singing id', async () => {
    await guitarist()
    await singer('new', SMALL)
    const before = await guitarSide()
    const block = voiceBlock('voice.pitch.match', 'focus', { step: 0 })
    const exercise = exerciseForBlock(block, undefined, SMALL)

    const out = await recordLessonDrill('voice.pitch.match', exercise, clean(), neverSynced, at)

    expect(out.counted).toBe(true)
    expect(out.attempt).toMatchObject({ instrument: 'voice', skillId: 'voice.pitch.match', kind: 'practice' })
    expect(out.attempt.sessionId).toBeUndefined()
    expect((await db.attempts.toArray()).map((a) => a.instrument)).toEqual(['voice'])
    expect(out.state.skillId).toBe('voice.pitch.match')
    expect((await db.milestones.toArray()).every((m) => m.instrument === 'voice')).toBe(true)
    expect(await guitarSide()).toEqual(before)
  })
})

describe('the weekly check of a singer', () => {
  /** A singer forty days in, with enough days sung since the last check. */
  async function dueSinger(): Promise<void> {
    await singer('played', SMALL)
    await saveProfile({ ...(await loadProfile('voice')), placementDoneAt: at - 40 * DAY, sessionsSinceTest: 5, lastSessionDate: '2026-11-08' })
    await db.skillStates.put(skillState('voice.pitch.hold', 55, { step: 1 }))
  }

  /** The tasks of the sung check, built the way the check screen builds them. */
  async function checkTasks(focus = 'voice.pitch.hold'): Promise<TestTask[]> {
    const model = await loadLearnerModel('voice')
    const range = (await loadVoiceProfile()).range
    return checkpointTasks(model, skillsFor('voice'), await songSummaries('voice'), at, focus, voiceCheckOptions(range))
  }

  it('asks in a singer\'s words, by the sung pass mark, and for no step the range cannot hold', async () => {
    await dueSinger()
    // Reached the slide to note 8 in a wider range once; eight notes hold a slide to note 5.
    await db.skillStates.put(skillState('voice.range.slides', 55, { step: 2 }))
    expect(voiceCheckOptions(SMALL)).toMatchObject({ criteria: VOICE_TEST_PASS, verb: 'Sing', maxBars: 8, songsHaveSpeeds: false })
    const [task] = await checkTasks('voice.range.slides')
    expect(task.params).toMatchObject({ step: 1, maxStep: 1 })
    expect(task.instructions).toBe('Sing Slides: up to note 5.')
    expect(task.passCriteria).toEqual({ minAccuracy: 0.8, maxMedianMs: 10000, maxStdevMs: 10000 })
    expect(task.params.bars).toBeLessThanOrEqual(8)
    // It can be built and sung in that range.
    const exercise = exerciseForTask(task, undefined, SMALL)!
    expect(exercise.params.step).toBe(1)
    expect(exercise.chart.notes.every((n) => n.midi >= SMALL.low && n.midi <= SMALL.high)).toBe(true)
    // A whole octave holds the last step, and no limit travels with the task.
    await saveVoiceRange(OCTAVE, at)
    const [wide] = await checkTasks('voice.range.slides')
    expect(wide.params.step).toBe(2)
    expect('maxStep' in wide.params).toBe(false)
  })

  it('is the weekly one and no other: never a starting check, never a monthly one, and it does not wait for the sound sync', async () => {
    await dueSinger()
    // The guitar in the very same position is given the monthly check.
    await saveProfile({ ...(await loadProfile()), placementDoneAt: at - 40 * DAY, sessionsSinceTest: 5, lastSessionDate: '2026-11-08' })
    expect(testsOf(await guitarDay()).map((b) => b.test)).toEqual(['monthly'])

    const day = await voiceDay()
    expect(testsOf(day).map((b) => b.test)).toEqual(['checkpoint'])
    expect(testsOf(day)[0].id.startsWith('voice-')).toBe(true)

    // A singing profile that has not been through the set-up is not sent to a starting check either.
    await resetTrainingData()
    await saveVoiceRange(SMALL, at)
    expect(testsOf(await voiceDay())).toEqual([])
    expect(testsOf(await guitarDay()).map((b) => b.test)).toEqual(['placement'])
  })

  it('is passed on the notes alone, closes its block, and is not offered again the next day', async () => {
    await guitarist()
    await dueSinger()
    const before = await guitarSide()
    const day = await voiceDay()
    const tasks = await checkTasks()
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks[0]).toMatchObject({ skillIds: ['voice.pitch.hold'], passCriteria: { minAccuracy: 0.8, maxMedianMs: 10000, maxStdevMs: 10000 } })
    expect(tasks[0].instructions).toBe('Sing Hold a note steady: 6 beats.')
    // Every note a "good", none perfect, begun a quarter of a second late, and no timing spread at all.
    const result = sung({ perfects: 0, goods: 8, timingMedianMs: 250, timingStdevMs: null })
    const results = tasks.map((t) => ({ taskId: t.id, attempt: attemptForTask(t, result, neverSynced, at, 'voice'), passed: evaluateTask(t, result) }))
    expect(results.every((r) => r.passed)).toBe(true)
    // Never measured, and still evidence: a sung check does not depend on the sound sync.
    expect(results.every((r) => r.attempt.reliable && r.attempt.instrument === 'voice')).toBe(true)

    const record = await saveFinishedTest('checkpoint', tasks, results, at, 'voice')

    expect(record).toMatchObject({ type: 'checkpoint', instrument: 'voice' })
    expect((await listTests(20, 'voice')).map((t) => t.id)).toEqual([record.id])
    expect(await listTests()).toEqual([])
    const profile = await loadProfile('voice')
    expect(profile).toMatchObject({ lastCheckpointAt: at, sessionsSinceTest: 0, lastSessionDate: TODAY })
    expect(profile.lastMonthlyAt).toBeUndefined()
    const after = (await getSession(TODAY, 'voice'))!
    expect(after.id).toBe(day.id)
    expect(testsOf(after)[0].status).toBe('done')
    const runs = (await db.attempts.toArray()).filter((a) => a.kind === 'test')
    expect(runs.length).toBe(tasks.length)
    expect(runs.every((a) => a.instrument === 'voice' && a.sessionId === day.id)).toBe(true)
    const passedAll = (await db.milestones.toArray()).find((m) => m.type === 'test')
    expect(passedAll).toMatchObject({ key: `voice:test:checkpoint:${TODAY}`, instrument: 'voice' })
    expect((await db.skillStates.get('voice.pitch.hold'))?.lastTestedAt).toBe(at)
    expect(await guitarSide()).toEqual(before)

    // Day 41, 42, ...: without the weekly rhythm a check would be due every single day from day 28 on.
    for (const days of [1, 2, 3]) {
      const later = new Date(at + days * DAY)
      vi.setSystemTime(later)
      await saveProfile({ ...(await loadProfile('voice')), sessionsSinceTest: 5, lastSessionDate: TODAY })
      expect(testsOf(await voiceDay(later)), `day ${days}`).toEqual([])
    }
    // A week on, with days sung in between, it comes round again: the weekly one.
    const week = new Date(at + 7 * DAY)
    vi.setSystemTime(week)
    await saveProfile({ ...(await loadProfile('voice')), sessionsSinceTest: 5, lastSessionDate: '2026-11-15' })
    expect(testsOf(await voiceDay(week)).map((b) => b.test)).toEqual(['checkpoint'])
  })

  it('judges a guitar check as before: without a fresh sound sync its runs are weak evidence', async () => {
    const task: TestTask = { id: 't', title: 't', instructions: '', skillIds: [SKILLS[0].id], generatorId: SKILLS[0].generators[0], params: exerciseParams(SKILLS[0], SKILLS[0].generators[0], 80), difficulty: 20, passCriteria: { minAccuracy: 0.8, maxMedianMs: 60, maxStdevMs: 60 } }
    const run = attemptForTask(task, played(), neverSynced, at)
    expect(run.reliable).toBe(false)
    expect('instrument' in run).toBe(false)
    expect(attemptForTask(task, played(), synced, at).reliable).toBe(true)
  })

  it('is told apart from a guitar check by its tasks when nobody says which it is', async () => {
    await guitarist()
    await dueSinger()
    const before = await guitarSide()
    const tasks = await checkTasks()
    const results = tasks.map((t) => ({ taskId: t.id, attempt: attemptForTask(t, clean(), neverSynced, at), passed: true }))
    expect(results[0].attempt.instrument).toBe('voice')
    const record = await saveFinishedTest('checkpoint', tasks, results, at)
    expect(record.instrument).toBe('voice')
    expect((await loadProfile('voice')).lastCheckpointAt).toBe(at)
    expect(await guitarSide()).toEqual(before)
    // The same for a check that is saved without its block being closed.
    const direct = await finishTest('checkpoint', tasks, results, at + DAY)
    expect(direct.instrument).toBe('voice')
    expect((await loadProfile('voice')).lastCheckpointAt).toBe(at + DAY)
    expect(await guitarSide()).toEqual(before)
  })

  it('stores every run of a sung check on the singing side, also of a song task, which names no skill', async () => {
    await guitarist()
    await dueSinger()
    const before = await guitarSide()
    const song = await vocalSongRecord('sing-hot-cross-buns')
    const task: TestTask = {
      id: 'checkpoint-03',
      title: 'Stretch: Hot Cross Buns (Level 3)',
      instructions: 'Sing Hot Cross Buns at Level 3.',
      skillIds: [],
      generatorId: 'song',
      params: { tempo: song.bpm, bars: 0, songId: song.id, level: 2 },
      difficulty: 50,
      passCriteria: VOICE_TEST_PASS,
    }
    // Built without saying whose check it is. A song task cannot tell, so the run carries no stamp yet.
    const run = attemptForTask(task, sung({ perfects: 17, total: 17 }), neverSynced, at)
    expect('instrument' in run).toBe(false)

    const record = await saveFinishedTest('checkpoint', [task], [{ taskId: task.id, attempt: run, passed: true }], at, 'voice')

    expect(record.instrument).toBe('voice')
    expect(record.results[0].attempt.instrument).toBe('voice')
    expect((await db.attempts.toArray()).map((a) => [a.kind, a.songId, a.instrument])).toEqual([['test', song.id, 'voice']])
    expect((await listTests(20, 'voice')).map((t) => t.id)).toEqual([record.id])
    expect((await loadProfile('voice')).lastCheckpointAt).toBe(at)
    expect(await guitarSide()).toEqual(before)
    // Said where the run is built, it is a sung run from the start, and good evidence without a sound sync.
    expect(attemptForTask(task, sung(), neverSynced, at, 'voice')).toMatchObject({ instrument: 'voice', reliable: true, songId: song.id, level: 2 })
  })

  it('knows a check made of one sung song as the singer\'s by the song, when nobody says whose it is', async () => {
    await guitarist()
    await dueSinger()
    // The guitar has a weekly check open on the same day. A sung check must not close it.
    const guitarPlan = await storedSession([{ id: 'b-test', kind: 'test', status: 'pending', minutes: 5, test: 'checkpoint', reason: '' }], 'guitar')
    const voicePlan = await storedSession([{ id: `voice-${TODAY}-0-test`, kind: 'test', status: 'pending', minutes: 5, test: 'checkpoint', reason: '' }])
    const before = await guitarSide()
    const song = await vocalSongRecord('sing-hot-cross-buns')
    const task: TestTask = {
      id: 'checkpoint-03',
      title: 'Stretch: Hot Cross Buns (Level 3)',
      instructions: 'Sing Hot Cross Buns at Level 3.',
      skillIds: [],
      generatorId: 'song',
      params: { tempo: song.bpm, bars: 0, songId: song.id, level: 2 },
      difficulty: 50,
      passCriteria: VOICE_TEST_PASS,
    }
    const run = attemptForTask(task, sung({ perfects: 17, total: 17 }), neverSynced, at)

    const record = await saveFinishedTest('checkpoint', [task], [{ taskId: task.id, attempt: run, passed: true }], at)

    expect(record.instrument).toBe('voice')
    expect(record.results[0].attempt.instrument).toBe('voice')
    expect((await listTests(20, 'voice')).map((t) => t.id)).toEqual([record.id])
    expect(await listTests()).toEqual([])
    expect((await loadProfile('voice')).lastCheckpointAt).toBe(at)
    expect((await db.sessions.get(voicePlan.id!))?.plan.blocks[0].status).toBe('done')
    expect((await db.sessions.get(guitarPlan.id!))?.plan.blocks[0].status).toBe('pending')
    expect(await guitarSide()).toEqual(before)
    // Saved without its block, the same.
    const direct = await finishTest('checkpoint', [task], [{ taskId: task.id, attempt: run, passed: true }], at + DAY)
    expect(direct.instrument).toBe('voice')
    expect(await guitarSide()).toEqual(before)

    // A check made of a guitar song alone stays the guitar's: no stamp, and the guitar's own block is closed.
    const { audio, ...demo } = await createDemoSong()
    const guitarSongId = await db.songs.add({ ...demo, audioData: await audio.arrayBuffer(), createdAt: 1, updatedAt: 1, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0 })
    const guitarTask: TestTask = { ...task, params: { tempo: 90, bars: 0, songId: guitarSongId, level: 2 }, passCriteria: { minAccuracy: 0.8, maxMedianMs: 60, maxStdevMs: 60 } }
    const guitarRun = attemptForTask(guitarTask, played(), synced, at)
    const guitarRecord = await saveFinishedTest('checkpoint', [guitarTask], [{ taskId: guitarTask.id, attempt: guitarRun, passed: true }], at)
    expect('instrument' in guitarRecord).toBe(false)
    expect((await listTests()).map((t) => t.id)).toEqual([guitarRecord.id])
    expect((await db.sessions.get(guitarPlan.id!))?.plan.blocks[0].status).toBe('done')
    expect((await db.attempts.get((await db.attempts.where('songId').equals(guitarSongId).first())!.id!))!.instrument).toBeUndefined()
  })

  it('cannot be saved as a starting check or a monthly check: those would rate a voice by guitar tasks', async () => {
    await dueSinger()
    const before = await db.skillStates.toArray()
    const tasks = await checkTasks()
    const results = tasks.map((t) => ({ taskId: t.id, attempt: attemptForTask(t, clean(), neverSynced, at, 'voice'), passed: true }))
    for (const type of ['placement', 'monthly'] as const) {
      const refusal = await finishTest(type, tasks, results, at, 'voice').then(
        () => null,
        (err: Error) => err.message,
      )
      expect(refusal, type).toBeTruthy()
      expect(refusal, type).not.toMatch(NOT_FOR_A_SINGER)
      await expect(saveFinishedTest(type, tasks, results, at, 'voice')).rejects.toThrow()
    }
    expect(await db.tests.count()).toBe(0)
    expect(await db.attempts.count()).toBe(0)
    expect(await db.skillStates.toArray()).toEqual(before)
    expect(await completeTestBlock('monthly', at, [], 'voice')).toBeNull()
  })

  it('says so in a singer\'s words when the app only heard itself, and saves no check', async () => {
    await dueSinger()
    await voiceDay()
    const tasks = await checkTasks()
    const results = tasks.map((t) => ({ taskId: t.id, attempt: attemptForTask(t, sung({ bleed: true }), neverSynced, at, 'voice'), passed: true }))
    const message = await saveFinishedTest('checkpoint', tasks, results, at, 'voice').then(
      () => '',
      (err: Error) => err.message,
    )
    expect(message).toMatch(/not saved/)
    expect(message).not.toMatch(NOT_FOR_A_SINGER)
    expect(await listTests(20, 'voice')).toEqual([])
    expect(testsOf((await getSession(TODAY, 'voice'))!)[0].status).toBe('pending')
    // The runs are kept as history, on the singing side.
    expect((await db.attempts.toArray()).every((a) => a.instrument === 'voice' && a.bleed)).toBe(true)
    expect((await loadProfile('voice')).lastCheckpointAt).toBeUndefined()
  })

  it('closes the check of the instrument it was taken on, and counts the day for that streak only', async () => {
    await guitarist()
    await dueSinger()
    const guitar = await storedSession([{ id: 'b-test', kind: 'test', status: 'pending', minutes: 5, test: 'checkpoint', reason: '' }], 'guitar')
    const voice = await storedSession([{ id: `voice-${TODAY}-0-test`, kind: 'test', status: 'pending', minutes: 5, test: 'checkpoint', reason: '' }])
    await saveProfile({ ...(await loadProfile('voice')), streak: 2, longestStreak: 2, lastSessionDate: '2026-11-08' })

    const updated = await completeTestBlock('checkpoint', at, [{ durationSec: 90 }], 'voice')

    expect(updated?.id).toBe(voice.id)
    expect(updated?.plan.blocks[0].status).toBe('done')
    expect((await db.sessions.get(guitar.id!))?.plan.blocks[0].status).toBe('pending')
    expect((await loadProfile('voice')).streak).toBe(3)
    expect((await loadProfile()).streak).toBe(2)
    expect((await db.milestones.toArray()).map((m) => [m.key, m.instrument])).toEqual([['voice:streak:3', 'voice']])
  })
})

describe('a song that sits too high', () => {
  /** Half the notes, with the top ones missed low: a hard run, for a reason the key can cure. */
  const high = (now: number) => ({ result: sung({ perfects: 9, goods: 0, misses: 8, total: 17, voice: { medianCents: -30, topMissed: 3 } }), now })
  /** As hard, but the top notes were fine: the level is what is too much. */
  const hard = (now: number) => ({ result: sung({ perfects: 9, goods: 0, misses: 8, total: 17, voice: { medianCents: -5, topMissed: 0 } }), now })

  /** Every other song the Coach offers was sung since, so the song under test is the song of the next day. */
  async function makeItTheNextSong(songId: number): Promise<void> {
    const others = (await songSummaries('voice')).filter((s) => s.id !== songId)
    await db.songItems.bulkPut(
      others.map((s): SongItemState => ({ key: `${s.id}:2`, songId: s.id, level: 2, bestAccuracy: 0.8, lastAt: at + 12 * 3_600_000, ease: 2.3, intervalDays: 0, weakBars: [], lastAccuracy: 0.8, lastSpeed: 1, lowStreak: 0, instrument: 'voice' })),
    )
  }
  const nudgeOf = async (id: string) => (await loadVoiceProfile()).keyNudge?.[id]
  const tomorrow = new Date(at + DAY)

  it('is moved down a little after two such runs in a row, before the level is taken back', async () => {
    await singer('played', SMALL)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    const tune = vocalSong('sing-hot-cross-buns')!
    const key = songKey(tune, SMALL).shift
    // There is room below: the tune spans five notes of an eight-note range.
    expect(songKey(tune, SMALL, -1).shift).toBe(key - 1)

    const first = await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    expect(first.attempt).toMatchObject({ instrument: 'voice', kind: 'song', songId: song.id })
    expect(first.songItem).toMatchObject({ instrument: 'voice', lowStreak: 1 })
    expect(first.keyLowered).toBeFalsy()
    expect(await nudgeOf(tune.id)).toBeUndefined()

    const second = await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)

    expect(second.keyLowered).toBe(true)
    expect(await nudgeOf(tune.id)).toBe(-1)
    expect(songKey(tune, SMALL, await nudgeOf(tune.id)).shift).toBe(key - 1)
    // Key and level never drop on the same day: the two hard runs are not held against the level.
    expect(second.songItem.lowStreak).toBe(0)
    expect(await db.songItems.get(`${song.id}:2`)).toEqual(second.songItem)

    await makeItTheNextSong(song.id)
    vi.setSystemTime(tomorrow)
    const day = await voiceDay(tomorrow)
    const block = songsOf(day)[0]
    expect(block).toMatchObject({ songId: song.id, level: 2, speed: 1 })
    expect(block.reason).toBe('Hot Cross Buns: That one sat high for you, so we moved the song down a little.')
    expect(day.plan.explanation).toContain(block.reason)
    expect(day.plan.explanation.join(' ')).not.toMatch(/hard last time/)
  })

  it('gives no advice to go back a level for the hard runs the song was moved down for', async () => {
    await singer('played', SMALL)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    const backALevel = async (now: number) => (await coachRecommendations(neverSynced, now, 'voice')).filter((r) => r.id === 'song-slow-down')
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    const moved = await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)
    expect(moved.keyLowered).toBe(true)
    // Two hard runs on one level: by the numbers alone the advice would be "going back to level 2".
    // The plan keeps the level and lowers the key, and the advice must not say otherwise.
    expect(await backALevel(at + 400_000)).toEqual([])

    // One hard run in the new key is one hard run: nothing to say yet.
    await recordSongPlay(song, 2, hard(at + 600_000).result, neverSynced, at + 600_000)
    expect(await backALevel(at + 700_000)).toEqual([])
    // Two in the new key, and the top notes were not the trouble: now the level does go back, and the advice says so.
    const second = await recordSongPlay(song, 2, hard(at + 900_000).result, neverSynced, at + 900_000)
    expect(second.keyLowered).toBeFalsy()
    expect(second.songItem.lowStreak).toBe(2)
    const cards = await backALevel(at + 1_000_000)
    expect(cards.map((r) => r.title)).toEqual(['Level 3 was hard twice: going back to level 2.'])
    expect(cards[0].action).toMatchObject({ type: 'song', songId: song.id, level: 1 })
  })

  it('goes by the latest move when a song was moved down on two of its levels', async () => {
    await singer('played', OCTAVE)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)
    // In the new key, on the next level: two more runs with the top notes missed, and it is moved again.
    await recordSongPlay(song, 3, high(at + 600_000).result, neverSynced, at + 600_000)
    const again = await recordSongPlay(song, 3, high(at + 900_000).result, neverSynced, at + 900_000)
    expect(again.keyLowered).toBe(true)
    expect((await db.songItems.get(`${song.id}:2`))?.keyLoweredAt).toBe(at + 300_000)
    expect((await db.songItems.get(`${song.id}:3`))?.keyLoweredAt).toBe(at + 900_000)
    // Those two were answered by the second move, which is marked on another level than the first.
    const cards = (await coachRecommendations(neverSynced, at + 1_000_000, 'voice')).filter((r) => r.id === 'song-slow-down')
    expect(cards).toEqual([])
  })

  it('advises the level back as ever when the key was never the trouble', async () => {
    await singer('played', SMALL)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, hard(at).result, neverSynced, at)
    await recordSongPlay(song, 2, hard(at + 300_000).result, neverSynced, at + 300_000)
    const cards = (await coachRecommendations(neverSynced, at + 400_000, 'voice')).filter((r) => r.id === 'song-slow-down')
    expect(cards.map((r) => r.title)).toEqual(['Level 3 was hard twice: going back to level 2.'])
  })

  it('goes back a level instead when the top notes were not the trouble', async () => {
    await singer('played', SMALL)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, hard(at).result, neverSynced, at)
    const second = await recordSongPlay(song, 2, hard(at + 300_000).result, neverSynced, at + 300_000)
    expect(second.keyLowered).toBeFalsy()
    expect(second.songItem.lowStreak).toBe(2)
    expect(await nudgeOf('sing-hot-cross-buns')).toBeUndefined()
    await makeItTheNextSong(song.id)
    vi.setSystemTime(tomorrow)
    const block = songsOf(await voiceDay(tomorrow))[0]
    expect(block).toMatchObject({ songId: song.id, level: 1 })
    expect(block.reason).toMatch(/going back to level 2/)
    expect(block.reason).not.toMatch(/sat high/)
  })

  it('needs two runs in the new key before it moves again, and the note about it goes once the song was sung in that key', async () => {
    await singer('played', SMALL)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-1)

    // One run in the lower key that is still high, right after two in the old key: not yet.
    const third = await recordSongPlay(song, 2, high(at + 600_000).result, neverSynced, at + 600_000)
    expect(third.keyLowered).toBeFalsy()
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-1)
    expect(third.songItem.lowStreak).toBe(1)
    // Sung in the new key now: the next plan gives its usual reason again.
    await makeItTheNextSong(song.id)
    vi.setSystemTime(tomorrow)
    expect(songsOf(await voiceDay(tomorrow))[0].reason).not.toMatch(/sat high/)

    const fourth = await recordSongPlay(song, 2, high(at + 900_000).result, neverSynced, at + 900_000)
    expect(fourth.keyLowered).toBe(true)
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-2)
  })

  it('counts a clean run in between as the end of the row, and a run that did not count as no run at all', async () => {
    await singer('played', SMALL)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    await recordSongPlay(song, 2, sung({ perfects: 17, total: 17 }), neverSynced, at + 100_000)
    const after = await recordSongPlay(song, 2, high(at + 200_000).result, neverSynced, at + 200_000)
    expect(after.keyLowered).toBeFalsy()
    // The app heard itself: history, nothing more. The run before it still stands.
    const bled = await recordSongPlay(song, 2, sung({ bleed: true, voice: { medianCents: 0, topMissed: 0 } }), neverSynced, at + 300_000)
    expect(bled.counted).toBe(false)
    expect(bled.attempt.instrument).toBe('voice')
    const next = await recordSongPlay(song, 2, high(at + 400_000).result, neverSynced, at + 400_000)
    expect(next.keyLowered).toBe(true)
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-1)
    // The same for a run that was broken off half way: it is no run, so the one before it still stands.
    await recordSongPlay(song, 2, high(at + 500_000).result, neverSynced, at + 500_000)
    const partial = await recordSongPlay(song, 2, sung({ partial: true, voice: { medianCents: 0, topMissed: 0 } }), neverSynced, at + 600_000)
    expect(partial.counted).toBe(false)
    const again = await recordSongPlay(song, 2, high(at + 700_000).result, neverSynced, at + 700_000)
    expect(again.keyLowered).toBe(true)
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-2)
  })

  it('belongs to the song, not to one level of it: a run on another level right after a move does not move it again', async () => {
    // A whole octave of range: room to move this song down three times.
    await singer('played', OCTAVE)
    const tune = vocalSong('sing-hot-cross-buns')!
    expect(songKey(tune, OCTAVE, -3).shift).toBe(songKey(tune, OCTAVE).shift - 3)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    const moved = await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)
    expect(moved.keyLowered).toBe(true)
    // The next level has no item yet. Its first run is the first run in the new key all the same.
    const other = await recordSongPlay(song, 3, high(at + 600_000).result, neverSynced, at + 600_000)
    expect(other.keyLowered).toBeFalsy()
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-1)
    // Two runs in the new key, on whichever levels, do move it.
    const second = await recordSongPlay(song, 3, high(at + 900_000).result, neverSynced, at + 900_000)
    expect(second.keyLowered).toBe(true)
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-2)
    // And back on the first level, the latest move is the one that counts, not the first.
    const back = await recordSongPlay(song, 2, high(at + 1_200_000).result, neverSynced, at + 1_200_000)
    expect(back.keyLowered).toBeFalsy()
    expect(await nudgeOf('sing-hot-cross-buns')).toBe(-2)
  })

  it('is left where it is written for a singer whose range is not known: there is no key to choose yet', async () => {
    await startFirstSteps({ experience: 'played', dailyMinutes: 20 }, at, 'voice')
    expect((await loadVoiceProfile()).range).toBeUndefined()
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    const second = await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)
    expect(second.keyLowered).toBeFalsy()
    expect((await loadVoiceProfile()).keyNudge).toBeUndefined()
    expect(second.songItem.lowStreak).toBe(2)
  })

  it('stays where it is when the range has no room below: then the level steps back as usual', async () => {
    await singer('played', SMALL)
    const tune = vocalSong('sing-mary-lamb')!
    // Eight notes of range and a tune of eight: one key and no other.
    expect(songKey(tune, SMALL, -1).shift).toBe(songKey(tune, SMALL).shift)
    const song = await vocalSongRecord('sing-mary-lamb')
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    const second = await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)
    expect(second.keyLowered).toBeFalsy()
    expect(await nudgeOf('sing-mary-lamb')).toBeUndefined()
    expect(second.songItem.lowStreak).toBe(2)
  })

  it('is moved down from where it really is, when "Higher" was asked for more often than the range had room', async () => {
    await singer('played', SMALL)
    const tune = vocalSong('sing-hot-cross-buns')!
    const chosen = songKey(tune, SMALL).shift
    const top = songKey(tune, SMALL, 3).shift
    // Three times "Higher", and the range had room for one of them.
    expect(top - chosen).toBe(1)
    expect(lowerKeyNudge(tune, SMALL, 3)).toBe(0)
    expect(lowerKeyNudge(tune, SMALL, undefined)).toBe(-1)
    // As far down as the range goes, and as far down as a key choice goes: nothing lower.
    expect(lowerKeyNudge(tune, SMALL, -2)).toBeNull()
    expect(lowerKeyNudge(tune, OCTAVE, -3)).toBeNull()

    await setKeyNudge(tune.id, 3)
    const song = await vocalSongRecord(tune.id)
    await recordSongPlay(song, 2, high(at).result, neverSynced, at)
    const second = await recordSongPlay(song, 2, high(at + 300_000).result, neverSynced, at + 300_000)
    expect(second.keyLowered).toBe(true)
    // One semitone under where it was sung, not one under a number that was never reached.
    expect(songKey(tune, SMALL, await nudgeOf(tune.id)).shift).toBe(top - 1)
  })

  it('is moved inside a block of the day too, and the block is finished as any other', async () => {
    await singer('played', SMALL)
    const song = await vocalSongRecord('sing-hot-cross-buns')
    const block: SongBlock = { id: `voice-${TODAY}-0-song`, kind: 'song', status: 'pending', minutes: 4, songId: song.id, level: 2, speed: 1, passes: 2, reason: 'test' }
    const session = await storedSession([block])
    await recordSongPlay(song, 2, high(at).result, neverSynced, at, session.id)
    const out = await completeSongBlock(session, block, song, high(at + 300_000).result, neverSynced, at + 300_000)
    expect(out.counted).toBe(true)
    expect(out.keyLowered).toBe(true)
    expect(out.session.plan.blocks[0].status).toBe('done')
    expect(out.session.instrument).toBe('voice')
    expect((await loadProfile('voice')).lastSessionDate).toBe(TODAY)
    expect((await db.attempts.toArray()).every((a) => a.instrument === 'voice' && a.sessionId === session.id)).toBe(true)
  })

  it('never touches a guitar song: its item, its run and its milestone stay without a stamp', async () => {
    const { audio, ...demo } = await createDemoSong()
    const id = await db.songs.add({ ...demo, audioData: await audio.arrayBuffer(), createdAt: 1, updatedAt: 1, bestScores: {}, lastLevel: null, lastSpeed: 1, playCount: 0 })
    const song = (await db.songs.get(id))!
    const lowTop = played({ perfects: 20, goods: 0, voice: { medianCents: 0, topMissed: 5 } })
    await recordSongPlay(song, 0, lowTop, synced, at)
    const out = await recordSongPlay(song, 0, lowTop, synced, at + 60_000)
    expect(out.keyLowered).toBeUndefined()
    expect('instrument' in out.songItem).toBe(false)
    expect('keyLoweredAt' in out.songItem).toBe(false)
    expect((await db.attempts.toArray()).every((a) => !('instrument' in a))).toBe(true)
    expect((await db.milestones.toArray()).map((m) => [m.key, m.instrument])).toEqual([[`song:${id}:0`, undefined]])
    expect(await db.profile.get(2)).toBeUndefined()
  })
})

describe('a tight or a tired voice', () => {
  it('"Tight" takes one note off the top of the range, and "Easy" and "OK" change nothing', async () => {
    await singer('played', OCTAVE)
    expect((await recordFelt('easy', at + 1)).range).toEqual(OCTAVE)
    expect((await recordFelt('ok', at + 2)).range).toEqual(OCTAVE)

    const tight = await recordFelt('tight', at + 3)

    expect(tight.range).toMatchObject({ low: OCTAVE.low, high: OCTAVE.high - 1, easy: OCTAVE.easy, source: 'manual', at: at + 3 })
    expect((await loadVoiceProfile()).range).toEqual(tight.range)
  })

  it('never makes the range smaller than eight notes, and moves an easy note that was the top note', async () => {
    await singer('played', SMALL)
    expect((await recordFelt('tight', at + 3)).range).toEqual(SMALL)
    expect((await loadVoiceProfile()).range).toEqual(SMALL)

    await saveVoiceRange({ ...OCTAVE, easy: OCTAVE.high }, at)
    const tight = await recordFelt('tight', at + 4)
    expect(tight.range).toMatchObject({ high: OCTAVE.high - 1, easy: OCTAVE.high - 1 })
  })

  it('plans an untouched day again for the smaller range, and a day in progress picks it up at the next exercise', async () => {
    await singer('played', OCTAVE)
    await updatePrefs({ pinnedSkillId: 'voice.range.slides' }, 'voice')
    await db.skillStates.put(skillState('voice.range.slides', 55, { step: 2 }))
    const first = await voiceDay()
    expect(blockOf(first, 'focus').params.step).toBe(2)

    // Eleven semitones no longer hold a slide to the octave.
    const { range } = await recordFelt('tight', at + 60_000)
    const replanned = await voiceDay()
    expect(replanned.id).not.toBe(first.id)
    expect(blockOf(replanned, 'focus').params).toMatchObject({ step: 1, maxStep: 1 })

    // Something was sung: the plan stays, and what is built next is built for the range of that moment.
    await saveVoiceRange(OCTAVE, at + 120_000)
    const day = await voiceDay(NOW, { forceNew: true })
    const warm = exercisesOf(day)[0]
    await recordExerciseRep(day, warm, exerciseForBlock(warm, undefined, OCTAVE), clean(), neverSynced, at + 180_000)
    const after = await recordFelt('tight', at + 240_000)
    expect((await voiceDay()).id).toBe(day.id)
    const slides = exerciseForBlock(blockOf(day, 'focus'), undefined, after.range)
    expect(slides.params).toMatchObject({ step: 1, maxStep: 1, high: OCTAVE.high - 1 })
    expect(slides.chart.notes.every((n) => n.midi <= OCTAVE.high - 1)).toBe(true)
    expect(range?.high).toBe(OCTAVE.high - 1)
  })

  it('"My voice is tired" ends the day without a mark against the singer', async () => {
    await guitarist()
    await singer('played', OCTAVE)
    const guitar = await guitarSide()
    const day = await voiceDay()
    const warm = exercisesOf(day)[0]
    const done = await completeExerciseBlock(day, warm, exerciseForBlock(warm, undefined, OCTAVE), clean(), neverSynced, at)
    const before = { states: await db.skillStates.toArray(), attempts: await db.attempts.count(), milestones: await db.milestones.count(), profile: await loadProfile('voice') }
    expect(before.profile.streak).toBe(1)

    expect(done.session.plan.blocks[0].status).toBe('done')
    // The screen may still hold the plan as it was before the warm-up: the stored one is what is ended.
    const ended = await markVoiceTired(day, at + 600_000)

    expect(ended.id).toBe(day.id)
    expect(ended.plan.blocks.map((b) => b.status)).toEqual(['done', ...day.plan.blocks.slice(1).map(() => 'skipped')])
    expect(ended.finishedAt).toBeDefined()
    expect(await getSession(TODAY, 'voice')).toEqual(ended)
    expect((await loadVoiceProfile()).tiredOn).toBe(TODAY)
    const profile = await loadProfile('voice')
    expect({ ...profile, voice: undefined }).toEqual({ ...before.profile, voice: undefined })
    expect({ states: await db.skillStates.toArray(), attempts: await db.attempts.count(), milestones: await db.milestones.count() }).toEqual({ states: before.states, attempts: before.attempts, milestones: before.milestones })
    expect(await guitarSide()).toEqual(guitar)
    // The day stays ended: a new range that evening does not bring up a fresh plan.
    await recordFelt('tight', at + 700_000)
    expect((await voiceDay()).id).toBe(day.id)
  })

  it('ends the plan that is stored for the day, also when the screen still holds one that was planned again since', async () => {
    await singer('played', OCTAVE)
    const first = await voiceDay()
    // The range was changed before anything was sung: that plan is gone, and Today has made another.
    await saveVoiceRange({ ...OCTAVE, high: OCTAVE.high - 1 }, at + 60_000)
    expect(await db.sessions.get(first.id!)).toBeUndefined()
    const second = await voiceDay()
    expect(second.id).not.toBe(first.id)

    // "My voice is tired", from a screen that never saw the second plan.
    const ended = await markVoiceTired(first, at + 120_000)

    expect(ended.id).toBe(second.id)
    expect(ended.plan.blocks.every((b) => b.status === 'skipped')).toBe(true)
    expect(await getSession(TODAY, 'voice')).toEqual(ended)
    expect((await db.sessions.toArray()).filter((s) => s.instrument === 'voice')).toHaveLength(1)
    expect((await loadVoiceProfile()).tiredOn).toBe(TODAY)
  })

  it('marks the day the plan was for, also when it is ended after midnight', async () => {
    await singer('played', OCTAVE)
    const day = await voiceDay()
    // Twenty hours on: five in the morning of the next day.
    await markVoiceTired(day, at + 20 * 3_600_000)
    expect((await loadVoiceProfile()).tiredOn).toBe(TODAY)
  })

  it('refuses to end a guitar day that way', async () => {
    await guitarist()
    const session = await guitarDay()
    await expect(markVoiceTired(session, at)).rejects.toThrow()
    expect(await db.sessions.get(session.id!)).toEqual(session)
    expect(await db.profile.get(2)).toBeUndefined()
  })

  it('keeps the weekly check off a gentle day: it waits until the voice has had its rest', async () => {
    await singer('played', OCTAVE, 30)
    await db.skillStates.bulkPut([skillState('voice.range.slides', 55, { step: 1 }), skillState('voice.pitch.hold', 50, { step: 1 }), skillState('voice.pitch.steps', 50, { tempoCeiling: 66 })])
    // Forty days in and enough days sung: the weekly check is due, today and every day until it is taken.
    await saveProfile({ ...(await loadProfile('voice')), placementDoneAt: at - 40 * DAY, sessionsSinceTest: 5, lastSessionDate: '2026-11-08' })
    const usual = await voiceDay()
    expect(testsOf(usual).map((b) => b.test)).toEqual(['checkpoint'])
    await markVoiceTired(usual, at + 600_000)
    // A new plan on the tired day itself is a gentle one too.
    const sameDay = await voiceDay(NOW, { forceNew: true })
    expect(testsOf(sameDay)).toEqual([])
    expect(sameDay.plan.minutes).toBe(10)

    // The day after: ten gentle minutes. A check is five minutes of being measured, slides and jumps included.
    const tomorrow = new Date(at + DAY)
    vi.setSystemTime(tomorrow)
    const gentle = await voiceDay(tomorrow)
    expect(testsOf(gentle)).toEqual([])
    expect(gentle.plan.minutes).toBe(10)
    expect(gentle.plan.explanation.join(' ')).not.toMatch(/check/i)

    // It was only put off: the day after that it is back.
    const later = new Date(at + 2 * DAY)
    vi.setSystemTime(later)
    expect(testsOf(await voiceDay(later)).map((b) => b.test)).toEqual(['checkpoint'])
  })

  it('plans the day after a tired day short and gentle: ten minutes, and nothing that stretches the voice', async () => {
    await singer('played', OCTAVE, 30)
    await updatePrefs({ pinnedSkillId: 'voice.range.slides' }, 'voice')
    await db.skillStates.bulkPut([skillState('voice.range.slides', 55, { step: 1 }), skillState('voice.pitch.hold', 50, { step: 1 }), skillState('voice.pitch.steps', 50, { tempoCeiling: 66 })])
    const usual = await voiceDay()
    expect(usual.plan.minutes).toBe(30)
    expect(blockOf(usual, 'focus').skillId).toBe('voice.range.slides')
    await markVoiceTired(usual, at + 600_000)

    const tomorrow = new Date(at + DAY)
    vi.setSystemTime(tomorrow)
    const gentle = await voiceDay(tomorrow)
    expect(gentle.plan.minutes).toBe(10)
    expect(gentle.plan.blocks[0].kind).toBe('warmup')
    expect(exercisesOf(gentle).length).toBeGreaterThan(1)
    for (const b of exercisesOf(gentle)) expect(voiceSkill(b.skillId).category, b.skillId).not.toBe('range')
    expect(gentle.plan.explanation.join(' ')).toMatch(/tired/)

    // The day after that is an ordinary day again.
    const later = new Date(at + 2 * DAY)
    vi.setSystemTime(later)
    const back = await voiceDay(later)
    expect(back.plan.minutes).toBe(30)
    expect(blockOf(back, 'focus').skillId).toBe('voice.range.slides')
    expect(back.plan.explanation.join(' ')).not.toMatch(/tired/)
  })
})

describe('the advice a singer gets', () => {
  it('is worked out from the singing side alone, never mentions the sound sync, and leaves the guitar advice alone', async () => {
    await singer('played', OCTAVE)
    const block = voiceBlock('voice.pitch.hold', 'focus', { step: 1, startStep: 1 })
    const session = await storedSession([block])
    const exercise = exerciseForBlock(block, undefined, OCTAVE)
    await recordExerciseRep(session, block, exercise, clean(), neverSynced, at)
    await recordExerciseRep(session, block, exercise, clean(), neverSynced, at + 60_000)

    const voice = await coachRecommendations(neverSynced, at + 120_000, 'voice')
    expect(voice.map((r) => r.id)).toContain('step-ratchet')
    // The card knows where the singer stands: the two rounds opened the step after the one they were sung on.
    expect((await db.skillStates.get('voice.pitch.hold'))?.step).toBe(2)
    expect(voice.find((r) => r.id === 'step-ratchet')?.reason).toBe('Next comes: 8 beats.')
    expect(voice.map((r) => r.id)).not.toContain('calibrate')
    for (const r of voice) expect(`${r.title} ${r.reason}`).not.toMatch(NOT_FOR_A_SINGER)
    for (const r of voice) expect(`${r.title} ${r.reason}`).not.toMatch(BPM)

    // The guitar has played nothing: two sung rounds are no reason for a card there.
    const guitar = await coachRecommendations(neverSynced, at + 120_000)
    expect(guitar.map((r) => r.id)).not.toContain('step-ratchet')
    expect(guitar.map((r) => r.id)).not.toContain('calibrate')
    expect(await db.profile.get(1)).toBeDefined()
  })

  it('says nothing about a song the Coach does not offer', async () => {
    await singer('played', WIDE)
    const grace = await vocalSongRecord('sing-amazing-grace')
    const buns = await vocalSongRecord('sing-hot-cross-buns')
    // Sung from the library, where every song that fits is listed.
    await recordSongPlay(grace, 2, sung({ perfects: 35, total: 35 }), neverSynced, at)
    await recordSongPlay(buns, 2, sung({ perfects: 17, total: 17 }), neverSynced, at + 60_000)
    const cards = await coachRecommendations(neverSynced, at + 120_000, 'voice')
    const about = (title: string) => cards.filter((r) => `${r.title} ${r.reason}`.includes(title))
    expect(about('Hot Cross Buns').length).toBeGreaterThan(0)
    expect(about('Amazing Grace')).toEqual([])
    expect(cards.some((r) => r.action?.type === 'song' && r.action.songId === grace.id)).toBe(false)
    expect(cards.some((r) => r.reason.includes('this song'))).toBe(false)
  })
})

describe('what the Coach writes for a singer', () => {
  it('keeps its own sentences for a singer plain and kind', () => {
    for (const sentence of [GENTLE_DAY_LINE, MOVED_DOWN, VOICE_ONLY_WEEKLY_CHECK, VOICE_CHECK_HEARD_ITSELF]) {
      expect(sentence).not.toMatch(NOT_FOR_A_SINGER)
      expect(sentence).not.toMatch(UNKIND)
      expect(sentence).not.toMatch(NUMBERS_FOR_EXPERTS)
      expect(sentence).not.toMatch(BPM)
      // Short sentences: nothing here runs on past a line and a half.
      for (const part of sentence.split(/(?<=[.?!])\s+/)) expect(part.length, part).toBeLessThanOrEqual(90)
    }
  })

  it('never speaks of playing or of a guitar, and names a tempo only on an exercise that gets faster', async () => {
    const sentences: string[] = []
    const collect = (day: SessionRecord) => {
      for (const b of day.plan.blocks) {
        const tempoSkill = isExercise(b) && !voiceSkill(b.skillId).steps
        expect(b.reason, b.id).not.toMatch(NOT_FOR_A_SINGER)
        if (!tempoSkill) expect(b.reason, b.id).not.toMatch(BPM)
        sentences.push(b.reason)
      }
      for (const line of day.plan.explanation) {
        expect(line).not.toMatch(NOT_FOR_A_SINGER)
        expect(line).not.toMatch(BPM)
        sentences.push(line)
      }
    }
    // A beginner, a singer with some history on every kind of day, and the day of a check.
    await singer('new', SMALL, 30)
    collect(await voiceDay())
    await resetTrainingData()
    await singer('played', OCTAVE, 30)
    await db.skillStates.bulkPut([
      skillState('voice.pitch.match', 80, { step: 2 }),
      skillState('voice.pitch.steps', 55, { tempoCeiling: 70 }),
      skillState('voice.pitch.hold', 50, { step: 1 }),
      skillState('voice.range.slides', 45, { step: 1 }),
      skillState('voice.pitch.echo', 78, { step: 1, nextReviewAt: at - DAY }),
    ])
    collect(await voiceDay())
    await saveProfile({ ...(await loadProfile('voice')), placementDoneAt: at - 40 * DAY, sessionsSinceTest: 5, lastSessionDate: '2026-11-08' })
    const check = await voiceDay(NOW, { forceNew: true })
    expect(testsOf(check)).toHaveLength(1)
    collect(check)
    await saveProfile({ ...(await loadProfile('voice')), lastSessionDate: '2026-10-20' })
    collect(await voiceDay(NOW, { forceNew: true }))
    await markVoiceTired(await voiceDay(), at)
    const tomorrow = new Date(at + DAY)
    vi.setSystemTime(tomorrow)
    collect(await voiceDay(tomorrow))
    expect(sentences.length).toBeGreaterThan(20)

    // Milestones of sung rounds and songs.
    const song = await vocalSongRecord('sing-hot-cross-buns')
    await recordSongPlay(song, 2, sung({ perfects: 17, total: 17 }), neverSynced, at)
    const block = voiceBlock('voice.pitch.hold', 'focus', { step: 1, startStep: 1 })
    const session = await storedSession([block], 'voice', '2026-11-12')
    await completeExerciseBlock(session, block, exerciseForBlock(block, undefined, OCTAVE), clean(), neverSynced, at + 3 * DAY)
    // An exercise that gets faster: its milestone names the tempo, and it was sung, not played.
    // Half a point under the next band, and no tempo shown yet: this round earns a band and a tempo.
    await db.skillStates.put(skillState('voice.pitch.steps', 19.5, { tempoCeiling: 0, attempts: 1 }))
    const steps = voiceBlock('voice.pitch.steps', 'second', {}, 1, '2026-11-12')
    await recordExerciseRep(session, steps, exerciseForBlock(steps, undefined, OCTAVE), clean(), neverSynced, at + 3 * DAY + 60_000)
    const milestones = await db.milestones.toArray()
    expect(milestones.map((m) => m.type)).toContain('song')
    expect(milestones.map((m) => m.type)).toContain('band')
    expect(milestones.find((m) => m.key === 'tempo:voice.pitch.steps:60')?.detail).toBe('You sang Step up and down cleanly at 60 bpm.')
    expect(milestones.every((m) => m.instrument === 'voice')).toBe(true)
    for (const m of milestones) {
      expect(`${m.title} ${m.detail}`, m.key).not.toMatch(NOT_FOR_A_SINGER)
      // Numbers a beginner cannot use: no singer is told a rating or a percentage.
      expect(`${m.title} ${m.detail}`, m.key).not.toMatch(/\b(rating|accuracy)\b|%/i)
      const skill = m.skillId ? voiceSkill(m.skillId) : undefined
      if (!skill || skill.steps) expect(`${m.title} ${m.detail}`, m.key).not.toMatch(BPM)
    }
  })
})

describe('two weeks of singing beside the guitar', () => {
  /** The same "luck" on every run of the test. */
  function dice(seed: number): () => number {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  it('keeps every row on its own side, every exercise inside the range and the limits of its skill, and every sentence a singer\'s', async () => {
    const roll = dice(2026)
    await guitarist()
    await singer('new', OCTAVE, 20)
    // Left the course on the first day: the plan starts from the starting point of someone who skipped it.
    await completeFirstSteps(at + 1000, 'voice')
    // They met the slides in a lesson before leaving, so the slides can be pinned for a day below.
    await db.skillStates.put(skillState('voice.range.slides', 45, { step: 2, attempts: 3 }))
    const seen = { gentle: 0, comeback: 0, checks: 0, tight: 0, stepUps: 0, skipped: 0, days: 0 }

    // A week, the day in the middle ended with "My voice is tired"; ten days away; three more days.
    for (const offset of [0, 1, 2, 3, 4, 5, 6, 17, 18, 19]) {
      const now = new Date(at + offset * DAY)
      vi.setSystemTime(now)
      let clock = now.getTime()
      const tick = () => (clock += 90_000)
      const tiredToday = offset === 3
      const dayAfterTired = offset === 4

      // The guitar first: a plan for the day and one round of it. Nothing of the singer may move.
      const singing = await voiceSide()
      const guitarPlan = await guitarDay(now)
      guitarPlan.plan.blocks.forEach((b) => expect(b.id.startsWith('voice-'), b.id).toBe(false))
      const strum = exercisesOf(guitarPlan).find((b) => b.status === 'pending')
      if (strum) await completeExerciseBlock(guitarPlan, strum, exerciseForBlock(strum), played({ playedTempo: strum.tempo, targetTempo: strum.tempo }), synced, tick())
      expect(await voiceSide(), `day ${offset}: the guitar moved a singing row`).toEqual(singing)

      // Then the singer. Nothing of the guitar may move. On the second day the slides are the main exercise.
      if (offset === 1 || offset === 2) await updatePrefs({ pinnedSkillId: offset === 1 ? 'voice.range.slides' : undefined }, 'voice')
      const guitar = await guitarSide()
      let day = await voiceDay(now)
      seen.days++
      expect(day.instrument).toBe('voice')
      for (const line of [...day.plan.explanation, ...day.plan.blocks.map((b) => b.reason)]) {
        expect(line, `day ${offset}`).not.toMatch(NOT_FOR_A_SINGER)
        expect(line, `day ${offset}`).not.toMatch(UNKIND)
        expect(line, `day ${offset}`).not.toMatch(NUMBERS_FOR_EXPERTS)
      }
      if (dayAfterTired) {
        seen.gentle++
        expect(day.plan.minutes).toBe(10)
        expect(testsOf(day)).toEqual([])
        for (const b of exercisesOf(day)) expect(voiceSkill(b.skillId).category, b.skillId).not.toBe('range')
      }
      if (offset === 17) {
        seen.comeback++
        expect(day.plan.explanation.join(' ')).toMatch(/Welcome back/)
        expect(testsOf(day)).toEqual([])
      }
      for (const s of songsOf(day)) expect(s).toMatchObject({ speed: 1 })

      for (let index = 0; index < day.plan.blocks.length; index++) {
        const block = day.plan.blocks[index]
        expect(block.id.startsWith(`voice-${day.date}-`), block.id).toBe(true)
        if (block.status !== 'pending') continue
        if (tiredToday && index === 2) {
          day = await markVoiceTired(day, tick())
          break
        }
        // One day the last block is left out: skipped, with nothing recorded for it.
        if (offset === 5 && index === day.plan.blocks.length - 1) {
          const runs = await db.attempts.count()
          day = await skipSessionBlock(day, block.id, tick())
          expect(day.plan.blocks[index].status).toBe('skipped')
          expect(await db.attempts.count()).toBe(runs)
          seen.skipped++
          continue
        }
        if (isExercise(block)) {
          const skill = voiceSkill(block.skillId)
          let tempo = block.tempo
          let params = block.params
          for (let round = 0; round < block.reps; round++) {
            // As the block runner goes from round to round: the tempo and the step of the round before, the range of this moment.
            const range = (await loadVoiceProfile()).range!
            const current: ExerciseBlock = { ...block, tempo, params }
            const exercise = exerciseForBlock(current, undefined, range)
            const where = `day ${offset} ${block.skillId} round ${round}`
            expect(exercise.chart.notes.length, where).toBeGreaterThan(0)
            expect(exercise.chart.notes.every((n) => n.midi >= range.low && n.midi <= range.high), where).toBe(true)
            expect(exercise.params.tempo, where).toBeGreaterThanOrEqual(skill.minTempo!)
            expect(exercise.params.tempo, where).toBeLessThanOrEqual(skill.targetTempo)
            if (skill.steps) expect(exercise.params.step, where).toBeLessThanOrEqual(maxStepFor(skill, range))
            const luck = roll()
            const heard = { playedTempo: exercise.params.tempo, targetTempo: exercise.params.tempo }
            const result = luck < 0.55 ? sung(heard) : luck < 0.8 ? sung({ ...heard, perfects: 6, misses: 2 }) : luck < 0.93 ? sung({ ...heard, perfects: 4, misses: 4 }) : sung({ ...heard, bleed: true })
            if (round < block.reps - 1) {
              const out = await recordExerciseRep(day, current, exercise, result, neverSynced, tick())
              expect(out.attempt, where).toMatchObject({ instrument: 'voice', sessionId: day.id, params: { low: range.low, high: range.high } })
              expect(out.nextTempo, where).toBeGreaterThanOrEqual(skill.minTempo!)
              expect(out.nextTempo, where).toBeLessThanOrEqual(skill.targetTempo)
              if (skill.steps) {
                // A ladder moves by its step and never by its tempo; no step beyond what this range holds is announced.
                expect(out.nextTempo, where).toBe(block.tempo)
                expect(out.nextParams!.step, where).toBeLessThanOrEqual(maxStepFor(skill, range))
                const sungOn = Number(exercise.params.step)
                expect(Math.abs(out.nextParams!.step - sungOn), where).toBeLessThanOrEqual(1)
                if (out.nextParams!.step > sungOn) seen.stepUps++
                params = { ...params, ...out.nextParams }
              } else {
                expect('nextParams' in out, where).toBe(false)
              }
              tempo = out.nextTempo
            } else {
              let out = await completeExerciseBlock(day, current, exercise, result, neverSynced, tick())
              // The app heard itself on the last round: the block stays open and the round is sung again.
              if (out.counted === false) {
                expect(out.session.plan.blocks[index].status, where).toBe('pending')
                out = await completeExerciseBlock(day, current, exercise, sung(heard), neverSynced, tick())
              }
              expect(out.session.plan.blocks[index].status, where).toBe('done')
              day = out.session
              if (block.skillId === 'voice.range.slides') {
                // "Easy, OK or Tight?" after the slides: tight, every time. The top comes down a note, never under eight notes.
                const felt = await recordFelt('tight', tick())
                expect(felt.range!.high, where).toBe(Math.max(range.low + 7, range.high - 1))
                seen.tight++
              }
            }
          }
        } else if (block.kind === 'song') {
          const row = (await db.songs.get(block.songId))!
          expect(row.instrument).toBe('voice')
          const song = await vocalSongRecord(row.builtinId!)
          const notes = row.chart.notes.length
          const luck = roll()
          const most = Math.ceil(notes * 0.75)
          const half = Math.ceil(notes * 0.5)
          const result =
            luck < 0.5
              ? sung({ perfects: notes, total: notes })
              : luck < 0.75
                ? sung({ perfects: most, misses: notes - most, total: notes })
                : sung({ perfects: half, misses: notes - half, total: notes, voice: { medianCents: -30, topMissed: 3 } })
          for (let pass = 1; pass < (block.passes ?? 1); pass++) await recordSongPlay(song, block.level, result, neverSynced, tick(), day.id)
          day = (await completeSongBlock(day, block, song, result, neverSynced, tick())).session
        } else {
          expect(block.test).toBe('checkpoint')
          const range = (await loadVoiceProfile()).range
          const focus = exercisesOf(day).find((b) => b.kind === 'focus')?.skillId ?? 'voice.pitch.match'
          const tasks = checkpointTasks(await loadLearnerModel('voice'), skillsFor('voice'), await songSummaries('voice'), clock, focus, voiceCheckOptions(range))
          expect(tasks.length).toBeGreaterThan(0)
          const results = tasks.map((task) => {
            expect(`${task.title} ${task.instructions}`).not.toMatch(NOT_FOR_A_SINGER)
            expect(`${task.title} ${task.instructions}`).not.toMatch(UNKIND)
            const exercise = exerciseForTask(task, undefined, range)
            if (exercise) expect(exercise.chart.notes.every((n) => n.midi >= range!.low && n.midi <= range!.high), task.id).toBe(true)
            const result = sung({ perfects: 0, goods: 8 })
            return { taskId: task.id, attempt: attemptForTask(task, result, neverSynced, tick(), 'voice'), passed: evaluateTask(task, result) }
          })
          const record = await saveFinishedTest('checkpoint', tasks, results, tick(), 'voice')
          expect(record.instrument).toBe('voice')
          seen.checks++
          day = (await getSession(day.date, 'voice'))!
          expect(day.plan.blocks[index].status).toBe('done')
        }
      }

      // What the day left behind.
      const stored = (await getSession(day.date, 'voice'))!
      expect(stored.instrument).toBe('voice')
      expect(stored.plan.blocks.every((b) => b.status === 'done' || b.status === 'skipped'), `day ${offset}`).toBe(true)
      expect(stored.finishedAt, `day ${offset}`).toBeDefined()
      if (tiredToday) expect((await loadVoiceProfile()).tiredOn).toBe(day.date)
      for (const a of await db.attempts.toArray()) {
        // A run is on the side of its skill or its song, with no exception.
        if (a.skillId !== undefined) expect(a.instrument, `${a.skillId}`).toBe(a.skillId.startsWith('voice.') ? 'voice' : undefined)
        if (a.songId !== undefined) expect(a.instrument, `song ${a.songId}`).toBe('voice')
      }
      for (const state of await db.skillStates.toArray()) {
        if (!state.skillId.startsWith('voice.')) continue
        const skill = voiceSkill(state.skillId)
        expect(state.tempoCeiling, state.skillId).toBeLessThanOrEqual(skill.targetTempo)
        if (skill.steps) expect(state.step ?? 0, state.skillId).toBeLessThanOrEqual(skill.steps.length - 1)
      }
      for (const m of await db.milestones.toArray()) {
        const sharedKey = m.type === 'streak' || m.type === 'test'
        if (m.instrument === 'voice') {
          if (sharedKey) expect(m.key.startsWith('voice:'), m.key).toBe(true)
          expect(`${m.title} ${m.detail}`, m.key).not.toMatch(NOT_FOR_A_SINGER)
          expect(`${m.title} ${m.detail}`, m.key).not.toMatch(UNKIND)
          expect(`${m.title} ${m.detail}`, m.key).not.toMatch(NUMBERS_FOR_EXPERTS)
        } else {
          expect(m.key.startsWith('voice'), m.key).toBe(false)
          expect(m.skillId?.startsWith('voice.') ?? false, m.key).toBe(false)
        }
      }
      for (const item of await db.songItems.toArray()) expect(item.instrument, item.key).toBe('voice')
      for (const card of await coachRecommendations(neverSynced, tick(), 'voice')) {
        expect(`${card.title} ${card.reason}`, card.id).not.toMatch(NOT_FOR_A_SINGER)
        expect(`${card.title} ${card.reason}`, card.id).not.toMatch(UNKIND)
        expect(`${card.title} ${card.reason}`, card.id).not.toMatch(NUMBERS_FOR_EXPERTS)
        expect(card.id).not.toBe('calibrate')
      }
      expect(await guitarSide(), `day ${offset}: the singer moved a guitar row`).toEqual(guitar)
    }

    // The story went through what it was written for.
    expect(seen).toMatchObject({ days: 10, gentle: 1, comeback: 1, skipped: 1 })
    expect(seen.checks).toBeGreaterThan(0)
    expect(seen.tight).toBeGreaterThan(0)
    expect(seen.stepUps).toBeGreaterThan(0)
    expect(await db.sessions.count()).toBe(20)
    expect((await listTests(20, 'voice')).length).toBe(seen.checks)
    expect(await listTests()).toEqual([])
    // Both streaks count their own days: three in a row after the days away.
    expect((await loadProfile('voice')).streak).toBe(3)
    expect((await loadProfile()).streak).toBe(3)
    expect((await loadVoiceProfile()).range!.high).toBeLessThan(OCTAVE.high)
    expect((await loadVoiceProfile()).range!.high - OCTAVE.low).toBeGreaterThanOrEqual(7)
  }, 60_000)
})
