import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Check } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSettings } from '../../app/settings'
import { Illustration } from '../../components/diagrams'
import { Button, Card, cx } from '../../components/ui'
import { db } from '../../db/db'
import { COURSE, lessonById, nextLessonAfter } from '../../lessons/course'
import { finishLesson } from '../../lessons/finish'
import { initialiseCourse, patchLessonProgress } from '../../lessons/store'
import type { Lesson } from '../../lessons/types'
import { builtInSong } from '../../songs'
import { GuidedTuner } from '../tuner/GuidedTuner'
import { STEP_LABEL, lessonSteps, type StepId } from './lessonUtils'
import { PlayStep, TryStep } from './PlayerSteps'

function Stepper({ steps, current, lesson }: { steps: StepId[]; current: StepId; lesson: Lesson }) {
  const index = steps.indexOf(current)
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label={`Lesson ${lesson.number} steps`}>
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={s === current ? 'step' : undefined}>
          <span
            className={cx(
              'flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-semibold',
              i < index ? 'bg-ok/30 text-green-200' : i === index ? 'bg-accent text-slate-950' : 'bg-panel-2 text-muted',
            )}
          >
            {i < index ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <span className={cx('hidden sm:inline', i === index ? 'font-medium text-slate-100' : 'text-muted')}>{STEP_LABEL[s]}</span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-line" />}
        </li>
      ))}
    </ol>
  )
}

function Frame({ lesson, steps, current, children }: { lesson: Lesson; steps: StepId[]; current: StepId; children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-3 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <Link to="/lessons" aria-label="Back to lessons" className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-slate-200 hover:bg-panel-2">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Lessons</span>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {lesson.number}. {lesson.title}
          </div>
        </div>
        <Stepper steps={steps} current={current} lesson={lesson} />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl p-4">{children}</div>
      </main>
    </div>
  )
}

function LearnStep({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const settings = useSettings()
  const [i, setI] = useState(0)
  const card = lesson.learn[i]
  const last = i === lesson.learn.length - 1
  return (
    <div data-testid="lesson-learn" data-card={i}>
      <div className="mb-2 text-xs uppercase tracking-wide text-muted">
        Card {i + 1} of {lesson.learn.length}
      </div>
      <Card>
        {card.illustration && (
          <div className="mb-4 flex justify-center rounded-lg bg-panel-2 p-3">
            <Illustration id={card.illustration} handedness={settings.handedness} className="max-h-56 w-full max-w-sm text-slate-200" />
          </div>
        )}
        <h2 className="text-xl font-semibold">{card.title}</h2>
        <div className="mt-2 space-y-2 text-slate-200">
          {card.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        {card.mistakes && card.mistakes.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-panel-2 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">If something goes wrong</div>
            <ul className="list-disc space-y-1 pl-5 text-slate-200">
              {card.mistakes.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <div className="mt-4 flex justify-between gap-2">
        <Button variant="ghost" onClick={() => setI(i - 1)} disabled={i === 0}>
          Back
        </Button>
        <Button variant="primary" onClick={() => (last ? onDone() : setI(i + 1))} data-testid="lesson-next">
          {last ? 'Continue' : 'Next'}
        </Button>
      </div>
    </div>
  )
}

function TuneStep({ onDone }: { onDone: () => void }) {
  return (
    <div data-testid="lesson-tune">
      <h2 className="mb-1 text-xl font-semibold">Tune up</h2>
      <p className="mb-4 text-muted">Pluck each string, lowest first, and follow the arrow until it shows a tick.</p>
      <GuidedTuner onDone={onDone} onSkip={onDone} />
    </div>
  )
}

function DoneStep({ lesson }: { lesson: Lesson }) {
  const navigate = useNavigate()
  const next = nextLessonAfter(lesson.id)
  const [saved, setSaved] = useState<{ courseComplete: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    void finishLesson(lesson.id)
      .then((r) => !cancelled && setSaved(r))
      .catch(() => !cancelled && setSaved({ courseComplete: false }))
    return () => {
      cancelled = true
    }
  }, [lesson.id])
  const songs = lesson.unlocks.map((id) => builtInSong(id)).filter((s) => !!s)
  return (
    <div data-testid="lesson-done" className="text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-ok/20 text-green-300">
        <Check className="h-8 w-8" />
      </div>
      <h2 className="text-2xl font-bold">{saved?.courseComplete ? 'First steps complete' : `Lesson ${lesson.number} done`}</h2>
      <p className="mx-auto mt-2 max-w-md text-slate-200">{lesson.done}</p>
      {songs.length > 0 && (
        <Card className="mx-auto mt-5 max-w-md text-left">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">New songs for you</div>
          <ul className="mt-2 space-y-1">
            {songs.map((s) => (
              <li key={s.id} className="font-medium">
                {s.title}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {next ? (
          <Button variant="primary" size="lg" onClick={() => navigate(`/lessons/${next.id}`)} disabled={!saved} data-testid="next-lesson">
            Next lesson
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={() => navigate('/')} disabled={!saved} data-testid="graduate">
            Start daily sessions
          </Button>
        )}
        <Button variant="secondary" size="lg" onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    </div>
  )
}

/** One lesson as a short walk through Learn, Try, Play and Done. */
export function LessonPage() {
  const { lessonId } = useParams()
  // Keyed so moving to the next lesson starts again at its first card.
  return <LessonFlow key={lessonId} lessonId={lessonId} />
}

function LessonFlow({ lessonId }: { lessonId: string | undefined }) {
  const lesson = lessonById(lessonId ?? '')
  const navigate = useNavigate()
  const [step, setStep] = useState<StepId>('learn')
  const [ready, setReady] = useState(false)
  const progress = useLiveQuery(async () => (lessonId ? ((await db.lessons.get(lessonId)) ?? null) : null), [lessonId], undefined)

  useEffect(() => {
    let cancelled = false
    initialiseCourse(COURSE.map((l) => l.id))
      .catch(() => {})
      .finally(() => !cancelled && setReady(true))
    return () => {
      cancelled = true
    }
  }, [])

  const steps = useMemo(() => (lesson ? lessonSteps(lesson) : []), [lesson])

  if (!lesson) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-muted">
        <p>We could not find that lesson.</p>
        <Link to="/lessons" className="underline">
          Back to lessons
        </Link>
      </div>
    )
  }
  if (!ready || progress === undefined) return <div className="flex h-dvh items-center justify-center text-muted">Loading…</div>
  if (!progress || progress.status === 'locked') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">Lesson {lesson.number} is waiting</p>
        <p className="text-muted">Finish the lesson before it first, and this one opens up.</p>
        <Link to="/lessons">
          <Button variant="primary">Back to lessons</Button>
        </Link>
      </div>
    )
  }

  const after = (from: StepId) => steps[steps.indexOf(from) + 1] ?? 'done'
  const go = (to: StepId) => () => setStep(to)
  const markLearnt = () => {
    void patchLessonProgress(lesson.id, { learnSeen: true, startedAt: progress.startedAt ?? Date.now() }).catch(() => {})
    setStep(after('learn'))
  }

  if (step === 'try' && lesson.drill) {
    return <TryStep key={lesson.id} lesson={lesson} drill={lesson.drill} onExit={() => navigate('/lessons')} onContinue={go(after('try'))} />
  }
  if (step === 'play' && lesson.play) {
    return <PlayStep key={lesson.id} lesson={lesson} play={lesson.play} onExit={() => navigate('/lessons')} onContinue={go(after('play'))} />
  }
  return (
    <Frame lesson={lesson} steps={steps} current={step}>
      {step === 'learn' && <LearnStep key={lesson.id} lesson={lesson} onDone={markLearnt} />}
      {step === 'tune' && (
        <TuneStep
          onDone={() => {
            void patchLessonProgress(lesson.id, { drillDone: true }).catch(() => {})
            setStep(after('tune'))
          }}
        />
      )}
      {step === 'done' && <DoneStep lesson={lesson} />}
    </Frame>
  )
}
