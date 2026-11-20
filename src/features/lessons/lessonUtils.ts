import type { Lesson, LessonProgress, LessonSongView } from '../../lessons/types'

export type StepId = 'learn' | 'tune' | 'try' | 'play' | 'done'

/** The steps of a lesson, in order. Lesson 2 swaps the drill for the guided tuner. */
export function lessonSteps(lesson: Lesson): StepId[] {
  const steps: StepId[] = ['learn']
  if (lesson.drill) steps.push('try')
  else if (lesson.id === 'l02-tune') steps.push('tune')
  if (lesson.play) steps.push('play')
  steps.push('done')
  return steps
}

export const STEP_LABEL: Record<StepId, string> = { learn: 'Learn', tune: 'Tune up', try: 'Try', play: 'Play', done: 'Done' }

/**
 * The first step of a lesson the learner has not done yet, from what is saved: the cards until they
 * were read, the practice round (or the tuner) until it was passed, the song until it was played, and
 * then the finish. Nothing that is still open is ever jumped over.
 */
export function firstOpenStep(lesson: Lesson, progress: LessonProgress | null | undefined): StepId {
  if (!progress?.learnSeen) return 'learn'
  for (const step of lessonSteps(lesson)) {
    if ((step === 'try' || step === 'tune') && !progress.drillDone) return step
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

/** What to say to a learner who comes back to a lesson they left half way; null when the lesson simply starts at its cards. */
export function resumeOffer(lesson: Lesson, progress: LessonProgress | null | undefined): ResumeOffer | null {
  const step = resumeStep(lesson, progress)
  if (step === 'learn') return null
  const title = 'Welcome back'
  if (step === 'tune') return { step, title, body: 'You have read the cards of this lesson. Next you tune your guitar.', action: 'Tune up' }
  if (step === 'try') return { step, title, body: 'You have read the cards of this lesson. Next comes the practice round.', action: 'Go to the practice' }
  if (step === 'play') {
    const before = lesson.drill ? 'You have read the cards and done the practice round.' : 'You have read the cards and tuned your guitar.'
    return { step, title, body: `${before} Next you play the song.`, action: 'Play the song' }
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
 * The closing line of a lesson. The lesson's own line says what the learner played, so it is only
 * shown when the song really was played; someone who carried on without it is told so, kindly.
 */
export function doneText(lesson: Lesson, progress: Pick<LessonProgress, 'playDone'> | null | undefined): string {
  if (!lesson.play || progress?.playDone) return lesson.done
  return 'You have been through this lesson, but its song has not been played all the way yet. Open the lesson again whenever you like and play it.'
}

/** All "If … then …" mistakes of a lesson's cards, in card order. */
export function lessonMistakes(lesson: Lesson): string[] {
  return lesson.learn.flatMap((c) => c.mistakes ?? [])
}

/**
 * One tip for the learner: when the round went well, a word of encouragement;
 * otherwise a common mistake from the lesson (rotating with `round`) or, failing
 * that, one of the skill's own tips.
 */
export function tipFor(lesson: Lesson, fraction: number, round: number, skillTips: string[] = []): string {
  if (fraction >= 0.9) return 'Lovely and clean. Keep that relaxed feeling.'
  const pool = [...lessonMistakes(lesson), ...skillTips]
  if (pool.length === 0) return 'Try it a little slower and keep your hand relaxed.'
  return pool[Math.max(0, round - 1) % pool.length]
}

export function lessonStatus(lessonId: string, progress: LessonProgress[] | undefined): LessonProgress['status'] {
  return progress?.find((p) => p.id === lessonId)?.status ?? 'locked'
}
