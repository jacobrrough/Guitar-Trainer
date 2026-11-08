import type { Lesson, LessonProgress } from '../../lessons/types'

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

/** Fraction of scored notes that were hit (0..1); 0 when nothing was scored. */
export function hitFraction(s: { perfects: number; goods: number; total: number }): number {
  return s.total > 0 ? (s.perfects + s.goods) / s.total : 0
}

export function feedbackLine(s: { perfects: number; goods: number; total: number }): string {
  if (s.total === 0) return 'We did not hear any notes this time.'
  return `You hit ${s.perfects + s.goods} of ${s.total} notes.`
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
