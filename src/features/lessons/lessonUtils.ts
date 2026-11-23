import type { Chart, VoiceChart } from '../../chart/types'
import { lessonById, lessonTool, nextAvailableLesson, songStepLabel } from '../../lessons/course'
import { lessonVocalSongHint } from '../../lessons/material'
import type { Lesson, LessonPlay, LessonProgress, LessonSongView } from '../../lessons/types'
import type { RangeEdges } from '../../music/keys'
import { songKey, vocalSong, type VocalSong } from '../../songs/vocal'
import { instrumentOfLessonId, profileIdFor, type InstrumentId } from '../../training/instruments'
import type { Profile } from '../../training/types'
import { voiceIsSetUp } from '../../training/voicePlan'
import { NOT_COUNTED, notCountedCopy, type RunVerdict } from '../play/runVerdict'
import type { ScoreSummary } from '../play/scoring'
import { voiceResultCopy } from '../play/voice/voiceCopy'
import { MATCH_COPY } from '../voice/noteMatch'
import { RANGE_COPY } from '../voice/rangeFinder'

/**
 * The lesson screens show two courses, guitar and singing. Which one a lesson belongs to is read from
 * its id (`instrumentOfLessonId`), never passed around, so a screen cannot show a singing lesson in a
 * guitarist's words. Everything a guitarist is told here is word for word what it was before singing
 * existed; the tests pin it.
 */

export type StepId = 'learn' | 'tune' | 'tool' | 'try' | 'play' | 'done'

/**
 * The steps of a lesson, in order. A lesson without a practice round may run a tool in its place: the
 * guitar course its guided tuner ('tune'), the singing course the range finder or "meet the note" ('tool').
 */
export function lessonSteps(lesson: Lesson): StepId[] {
  const steps: StepId[] = ['learn']
  const tool = lessonTool(lesson)
  if (lesson.drill) steps.push('try')
  else if (tool === 'tuner') steps.push('tune')
  else if (tool) steps.push('tool')
  if (lesson.play) steps.push('play')
  steps.push('done')
  return steps
}

export const STEP_LABEL: Record<StepId, string> = { learn: 'Learn', tune: 'Tune up', tool: 'Try it', try: 'Try', play: 'Play', done: 'Done' }

/** What a step of this lesson is called: a tool by its own name, and a song is played on a guitar and sung in a singing lesson. */
export function stepLabel(lesson: Lesson, step: StepId): string {
  if (step === 'tool') {
    const tool = lessonTool(lesson)
    if (tool === 'range') return RANGE_COPY.title
    if (tool === 'match') return MATCH_COPY.title
  }
  if (step === 'play') return songStepLabel(lesson)
  return STEP_LABEL[step]
}

/** The steps that stand where a practice round stands: one saved mark (`drillDone`) says any of them was done. */
const isMiddleStep = (step: StepId): boolean => step === 'try' || step === 'tune' || step === 'tool'

/** The step that follows `from` in this lesson; the finish when nothing else does. */
export function stepAfter(lesson: Lesson, from: StepId): StepId {
  const steps = lessonSteps(lesson)
  return steps[steps.indexOf(from) + 1] ?? 'done'
}

/** The marks of one lesson that are still on their way to being stored. See `markQueue`. */
export interface MarkQueue {
  /** Hands over a write to the lesson's row that has been started. */
  add(write: Promise<unknown>): void
  /** Resolves once no write that was handed over is still on its way. It never rejects. */
  settled(): Promise<void>
}

/**
 * Keeps track of the writes to a lesson's row (the cards were read, the tool was used, the round or the
 * song was done), so that the finish can wait for them.
 *
 * The trap: a mark is stored by reading the row and writing it back with the mark on it, and the lesson
 * moves on without waiting for that. The finish writes the row as well. Shown while a mark is still on
 * its way, it stores "done" first, and the mark then writes the row back as it was read before, which
 * puts the lesson back to "not done". That happens every time the finish comes straight after a mark:
 * in a lesson that ends on its tool, and when the cards are read again in a lesson that only had its
 * finish left.
 *
 * A write that could not be stored is over too: it does not hold the finish back, nor refuse it.
 */
export function markQueue(): MarkQueue {
  let last: Promise<unknown> = Promise.resolve()
  return {
    add(write) {
      last = Promise.allSettled([last, write])
    },
    async settled() {
      // Again while something was handed over in the meantime: the finish goes last, whenever it asked.
      let seen: Promise<unknown>
      do {
        seen = last
        await seen
      } while (seen !== last)
    },
  }
}

/**
 * The first step of a lesson the learner has not done yet, from what is saved: the cards until they
 * were read, the practice round (or the tool in its place) until it was passed, the song until it was
 * played or sung, and then the finish. Nothing that is still open is ever jumped over.
 */
export function firstOpenStep(lesson: Lesson, progress: LessonProgress | null | undefined): StepId {
  if (!progress?.learnSeen) return 'learn'
  for (const step of lessonSteps(lesson)) {
    if (isMiddleStep(step) && !progress.drillDone) return step
    if (step === 'play' && !progress.playDone) return step
  }
  return 'done'
}

/**
 * Where a lesson opens. A lesson that was left half way (the app was closed, or reloaded by the phone)
 * opens at the first step still to do, so the cards and a passed practice round need not be repeated.
 * A finished lesson is opened to go through it again, from the first card.
 */
export function resumeStep(lesson: Lesson, progress: LessonProgress | null | undefined): StepId {
  return !progress || progress.status === 'done' ? 'learn' : firstOpenStep(lesson, progress)
}

/** Where to go when the last card has been read: on, in order; or, after reading the cards again in a lesson that was left half way, back to where it was left. */
export function stepAfterCards(lesson: Lesson, progress: LessonProgress | null | undefined): StepId {
  const next = lessonSteps(lesson)[1] ?? 'done'
  if (!progress || progress.status === 'done' || !progress.learnSeen) return next
  return firstOpenStep(lesson, progress)
}

export interface ResumeOffer {
  step: StepId
  title: string
  body: string
  /** Label of the button that carries on at `step`. */
  action: string
}

/** What a singer is told about the tool of a lesson: what comes next, the button that goes there, and what was done once it is behind them. */
const TOOL_RESUME = {
  range: { next: 'Next the app finds your easy notes.', action: 'Find my easy notes', done: 'found your easy notes' },
  match: { next: 'Next you hear a note and find it with your voice.', action: 'Meet the note', done: 'met the note' },
} as const

/** What to say to a learner who comes back to a lesson they left half way; null when the lesson simply starts at its cards. */
export function resumeOffer(lesson: Lesson, progress: LessonProgress | null | undefined): ResumeOffer | null {
  const step = resumeStep(lesson, progress)
  if (step === 'learn') return null
  const title = 'Welcome back'
  const tool = lessonTool(lesson)
  const voiceTool = tool === 'range' || tool === 'match' ? TOOL_RESUME[tool] : null
  if (step === 'tune') return { step, title, body: 'You have read the cards of this lesson. Next you tune your guitar.', action: 'Tune up' }
  if (step === 'tool') {
    return { step, title, body: `You have read the cards of this lesson. ${voiceTool?.next ?? 'Next you try it out.'}`, action: voiceTool?.action ?? 'Carry on' }
  }
  if (step === 'try') return { step, title, body: 'You have read the cards of this lesson. Next comes the practice round.', action: 'Go to the practice' }
  if (step === 'play') {
    const sung = instrumentOfLessonId(lesson.id) === 'voice'
    const before = lesson.drill
      ? 'You have read the cards and done the practice round.'
      : voiceTool
        ? `You have read the cards and ${voiceTool.done}.`
        : sung
          ? 'You have read the cards.'
          : 'You have read the cards and tuned your guitar.'
    return sung
      ? { step, title, body: `${before} Next you sing the song.`, action: 'Sing the song' }
      : { step, title, body: `${before} Next you play the song.`, action: 'Play the song' }
  }
  return { step, title, body: 'You have done every part of this lesson. All that is left is to finish it.', action: 'Finish the lesson' }
}

/** Fraction of scored notes that were hit (0..1); 0 when nothing was scored. */
export function hitFraction(s: { perfects: number; goods: number; total: number }): number {
  return s.total > 0 ? (s.perfects + s.goods) / s.total : 0
}

export function feedbackLine(s: { perfects: number; goods: number; total: number }): string {
  if (s.total === 0) return 'We did not hear any notes this time.'
  return `You hit ${s.perfects + s.goods} of ${s.total} notes.`
}

/** What the learner is told before the lesson's song starts: the song's own line, and how much of it they play here. */
export function lessonSongHint(view: LessonSongView, description = ''): string {
  const how =
    view === 'chords'
      ? 'Strum the whole chord, every string of it, each time the notes reach the line.'
      : view === 'outline'
        ? 'Here you play its main notes, one at a time.'
        : 'Here you play all of it, slowed down a little.'
  return [description, how].filter(Boolean).join(' ')
}

/**
 * The line before the song of this lesson. A guitar lesson says how much of the song is played
 * (`description` is the guitar song's own line). A singing lesson says what its level of the song asks
 * for, from the song to sing itself: a sung song is never thinned out or slowed down, so the guitar's
 * line would be untrue of it.
 */
export function songHint(lesson: Lesson, play: LessonPlay, description = ''): string {
  return instrumentOfLessonId(lesson.id) === 'voice' ? lessonVocalSongHint(play) : lessonSongHint(play.view, description)
}

/**
 * The closing line of a lesson. The lesson's own line says what the learner played or sang, so it is
 * only shown when the song really was; someone who carried on without it is told so, kindly.
 */
export function doneText(lesson: Lesson, progress: Pick<LessonProgress, 'playDone'> | null | undefined): string {
  if (!lesson.play || progress?.playDone) return lesson.done
  if (instrumentOfLessonId(lesson.id) === 'voice') {
    return 'You have been through this lesson, but its song has not been sung all the way yet. Open the lesson again whenever you like and sing it.'
  }
  return 'You have been through this lesson, but its song has not been played all the way yet. Open the lesson again whenever you like and play it.'
}

/** All "If … then …" mistakes of a lesson's cards, in card order. */
export function lessonMistakes(lesson: Lesson): string[] {
  return lesson.learn.flatMap((c) => c.mistakes ?? [])
}

/** The heading over the "If … then …" lines of a card. The singing copy never says that something went wrong. */
export function mistakesHeading(lesson: Lesson): string {
  return instrumentOfLessonId(lesson.id) === 'voice' ? 'If it does not work yet' : 'If something goes wrong'
}

/**
 * One tip for the learner: when the round went well, a word of encouragement;
 * otherwise a common mistake from the lesson (rotating with `round`) or, failing
 * that, one of the skill's own tips.
 *
 * A sung practice round turns the order round: the tips of the skill first, then the lesson's lines.
 * The cards of a singing lesson are also about its song (words, headphones, the starting note), and
 * after a round on "la" the first of those lines can be about something the singer has not met yet.
 */
export function tipFor(lesson: Lesson, fraction: number, round: number, skillTips: string[] = []): string {
  const sung = instrumentOfLessonId(lesson.id) === 'voice'
  if (fraction >= 0.9) return sung ? 'Lovely. You were right on the notes. Keep that easy feeling.' : 'Lovely and clean. Keep that relaxed feeling.'
  const pool = sung ? [...skillTips, ...lessonMistakes(lesson)] : [...lessonMistakes(lesson), ...skillTips]
  if (pool.length === 0) return sung ? 'Listen to it once more, then sing it again. There is no hurry.' : 'Try it a little slower and keep your hand relaxed.'
  return pool[Math.max(0, round - 1) % pool.length]
}

export interface RoundCopy {
  /** The headline: how many notes, or that the run did not count. */
  title: string
  /** Why the run did not count and what to do about it; null for a run that counted. */
  body: string | null
  /** One tip for a run that counted; null for one that did not. */
  tip: string | null
}

/**
 * The words on the result card of a round (a practice round or the lesson's song).
 *
 * A singer reads how many notes they were on, and one tip: what the run itself showed (under the note,
 * not heard, an octave lower) when it showed something, otherwise a tip for the round (`tipFor`).
 * There is no line about timing for a singer: being a little behind the click is not what they need to
 * hear about. `about.voice` is the chart's own word about itself (`chart.voice`), so a round of slides
 * is never told not to slide.
 */
export function roundCopy(
  lesson: Lesson,
  run: { verdict: RunVerdict; summary: ScoreSummary; fraction: number; round: number },
  about: { skillTips?: string[]; voice?: Pick<VoiceChart, 'glide'> } = {},
): RoundCopy {
  const sung = instrumentOfLessonId(lesson.id) === 'voice'
  if (run.verdict !== 'counted') {
    if (sung) return { ...notCountedCopy(run.verdict, 'voice'), tip: null }
    if (run.verdict === 'unscored') {
      return {
        title: 'We did not hear any notes this time.',
        body: 'Check that the microphone is allowed and that the phone is close to your guitar, then try again. If the guitar may be out of tune, tune it first.',
        tip: null,
      }
    }
    return { ...NOT_COUNTED[run.verdict], tip: null }
  }
  const tip = tipFor(lesson, run.fraction, run.round, about.skillTips)
  if (!sung) return { title: feedbackLine(run.summary), body: null, tip }
  const said = voiceResultCopy(run.summary, about.voice)
  return { title: said.line, body: null, tip: said.tip ?? tip }
}

/** Under the result of a practice round: whether it is enough to move on. The same words for both courses. */
export function practiceNote(passed: boolean, reached: boolean): string {
  if (!passed) return 'Listen first, then go again. It gets easier each time you try.'
  if (reached) return 'That is enough to move on. You can go again if you want more practice.'
  return 'Not quite there yet, and that is fine. You can move on and come back to this later, or go again now.'
}

/**
 * Shown in place of a practice round that could not be built. A guitarist reads the reason in brackets,
 * as always. A singer does not: the reason of a sung round is written in note numbers ("The range 55 to
 * 48 is too small…"), which nobody new to singing can use. They read what they can do instead.
 */
export function practiceTrouble(lesson: Lesson, reason: string | null): string {
  if (instrumentOfLessonId(lesson.id) === 'voice') {
    return 'We could not set up this practice. You can carry on with the lesson. Finding your easy notes again on the My voice page may help.'
  }
  return `We could not set up this practice.${reason ? ` (${reason})` : ''}`
}

/** Under the result of the lesson's song. */
export function songNote(lesson: Lesson, passed: boolean): string {
  if (instrumentOfLessonId(lesson.id) === 'voice') {
    return passed
      ? 'Well sung. You can go again, or carry on to finish the lesson.'
      : 'Have another go: listen first, then sing each note as its bar reaches the line. You can also carry on and come back to this song later.'
  }
  return passed
    ? 'Well played. You can go again, or carry on to finish the lesson.'
    : 'Have another go: watch the notes come down and play each one as it reaches the line. You can also carry on and come back to this song later.'
}

/** Shown after a sung song whose top notes were missed twice in a row: the Coach has moved it to a lower key. */
export const KEY_LOWERED_LINE = 'That one sat high for you, so we moved the song down a little.'

export function lessonStatus(lessonId: string, progress: LessonProgress[] | undefined): LessonProgress['status'] {
  return progress?.find((p) => p.id === lessonId)?.status ?? 'locked'
}

/**
 * The lesson a page address opens. While the singing side is switched off (`voiceOn` false) a singing
 * lesson is not found, exactly like an id that does not exist: nothing of the singing side may be
 * reached by typing an address.
 */
export function lessonOnScreen(id: string | undefined, voiceOn: boolean): Lesson | undefined {
  const lesson = lessonById(id ?? '')
  if (!lesson) return undefined
  return voiceOn || instrumentOfLessonId(lesson.id) === 'guitar' ? lesson : undefined
}

/**
 * The profile a screen was handed, when it is the one of `instrument`; undefined when it is not there
 * yet, or is the other instrument's.
 *
 * The trap: a live query that is asked for another row goes on answering with the row it had until the
 * new one has been read. Right after the switch from guitar to singing, a page that asks for the singing
 * profile is still handed the guitarist's for a moment. What belongs to one learner (the lock of the
 * lessons, the end of the course, the easy notes) must never be read from the other's row.
 */
export function ownProfile<P extends Pick<Profile, 'id'>>(instrument: InstrumentId, profile: P | undefined): P | undefined {
  return profile !== undefined && profile.id === profileIdFor(instrument) ? profile : undefined
}

/**
 * Whether the course of an instrument may be shown, and its rows made:
 * - `open`: yes. The guitar course always is: it is made the first time it is looked at, as it always
 *   was, without waiting for the profile.
 * - `waiting`: the singing profile has not been read yet (see `ownProfile` for what counts as read).
 * - `set-up`: the singer has not been through the singing set-up. The singing course gets its rows
 *   from that set-up and from nothing else, so the page sends them there and writes nothing.
 */
export type CourseGate = 'open' | 'waiting' | 'set-up'

export function courseGate(instrument: InstrumentId, profile: Pick<Profile, 'id' | 'experience' | 'placementDoneAt'> | undefined): CourseGate {
  if (instrument === 'guitar') return 'open'
  const own = ownProfile(instrument, profile)
  if (!own) return 'waiting'
  return voiceIsSetUp(own) ? 'open' : 'set-up'
}

/**
 * Where a learner stands in one course. The lesson table holds the rows of both courses, so only the
 * rows of `course` are counted: finished singing lessons must not fill the guitar's bar, or the other
 * way round.
 */
export function courseSummary(course: Lesson[], progress: LessonProgress[] | undefined): { done: number; next: Lesson | undefined; label: string } {
  const rows = progress ?? []
  const own = new Set(course.map((l) => l.id))
  const done = rows.filter((p) => own.has(p.id) && p.status === 'done').length
  const next = nextAvailableLesson(rows, course)
  const label = done >= course.length ? `All ${course.length} lessons done` : `Lesson ${next?.number ?? done + 1} of ${course.length}`
  return { done, next, label }
}

export interface CourseCopy {
  /** Under the page title. */
  subtitle: string
  /** Heading of the list of songs the lessons have opened. */
  songsTitle: string
  /** Shown while that list is empty. */
  noSongs: string
  /** The button beside a song. */
  songAction: string
}

/** The words of the course page for the course it shows. */
export function courseCopy(instrument: InstrumentId, course: Lesson[]): CourseCopy {
  if (instrument !== 'voice') {
    return {
      subtitle: 'Ten short lessons, from holding the guitar to playing your first songs.',
      songsTitle: 'Songs you can play now',
      noSongs: 'Finish a lesson and your first songs will appear here.',
      songAction: 'Play',
    }
  }
  // The first singing lessons open no song yet, so "finish a lesson" would promise one too early.
  const first = course.find((l) => l.unlocks.length > 0)
  return {
    subtitle: 'Ten short lessons, from finding your easy notes to singing your first whole song.',
    songsTitle: 'Songs you can sing now',
    noSongs: first ? `Your first song appears here after lesson ${first.number}.` : 'Your songs will appear here.',
    songAction: 'Sing',
  }
}

/**
 * Over the songs a lesson has opened that are wider than the singer's easy notes, the one line that
 * says why they wait, and the same said of a single song where it would have been sung.
 */
export const COMES_LATER = {
  title: 'Comes later',
  why: (songs: number): string => `${songs === 1 ? 'This one needs' : 'These need'} a few more notes than your easy notes hold right now.`,
  thisSong: 'This song needs a few more notes than your easy notes hold right now. You can carry on and come back to it later.',
} as const

/**
 * The songs to sing behind these ids, split by whether they fit the singer's easy notes: `ready` can
 * be sung now, `later` are wider than the range and are listed under "Comes later" (they must not be
 * sung). An id that is not a song to sing is left out. Both lists keep the order of the ids.
 */
export function songsToSing(ids: readonly string[], range: RangeEdges): { ready: VocalSong[]; later: VocalSong[] } {
  const ready: VocalSong[] = []
  const later: VocalSong[] = []
  for (const id of ids) {
    const song = vocalSong(id)
    if (!song) continue
    if (songKey(song, range).fits) ready.push(song)
    else later.push(song)
  }
  return { ready, later }
}

/**
 * Whether the singer is asked how the round felt once it is over. Only after slides, the one exercise
 * that goes looking for the top of the voice: there "Tight" has to win over whatever the round scored.
 */
export function asksHowItFelt(chart: Pick<Chart, 'voice'>): boolean {
  return chart.voice?.glide === true
}

export const FELT_COPY = {
  question: 'How did the slides feel?',
  easy: 'Easy',
  ok: 'OK',
  tight: 'Tight',
} as const

/**
 * What the singer reads after answering. `lowered` says whether "Tight" really took a note off the top:
 * a range that is already the smallest the app works with stays as it is, and the reply must not claim otherwise.
 */
export function feltReply(felt: 'easy' | 'ok' | 'tight', lowered: boolean): string {
  if (felt === 'easy') return 'Good. Easy is how it should feel.'
  if (felt === 'ok') return 'Good. Stop while it is easy, every time.'
  return lowered
    ? 'Thank you for saying so. The app stays a little lower from now on, where it can.'
    : 'Thank you for saying so. Your easy notes are already as few as the app can work with, so take the slides gently and stop early.'
}
