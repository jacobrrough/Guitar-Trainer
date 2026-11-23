import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Check } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { voiceEnabled } from '../../app/features'
import { useSettings } from '../../app/settings'
import { Illustration } from '../../components/diagrams'
import { Button, Card, cx } from '../../components/ui'
import { db } from '../../db/db'
import { courseOfLesson, lessonTool, nextLessonAfter } from '../../lessons/course'
import { forHand } from '../../lessons/fingering'
import { finishLesson } from '../../lessons/finish'
import { initialiseCourse, patchLessonProgress } from '../../lessons/store'
import type { Lesson } from '../../lessons/types'
import { DEFAULT_RANGES, type RangeEdges } from '../../music/keys'
import { instrumentOfLessonId } from '../../training/instruments'
import { useProfile } from '../../training/useTraining'
import { builtInSong } from '../../songs'
import { GuidedTuner } from '../tuner/GuidedTuner'
import { NoteMatch } from '../voice/NoteMatch'
import { RangeFinder } from '../voice/RangeFinder'
import {
  COMES_LATER,
  courseGate,
  doneText,
  lessonOnScreen,
  lessonSteps,
  markQueue,
  mistakesHeading,
  ownProfile,
  resumeOffer,
  songsToSing,
  stepAfter,
  stepAfterCards,
  stepLabel,
  type ResumeOffer,
  type StepId,
} from './lessonUtils'
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
          <span className={cx('hidden sm:inline', i === index ? 'font-medium text-slate-100' : 'text-muted')}>{stepLabel(lesson, s)}</span>
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
  // Left and right in the text follow the way this learner holds the guitar, like the pictures do.
  const say = (text: string) => forHand(text, settings.handedness)
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
            <p key={p}>{say(p)}</p>
          ))}
        </div>
        {card.mistakes && card.mistakes.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-panel-2 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{mistakesHeading(lesson)}</div>
            <ul className="list-disc space-y-1 pl-5 text-slate-200">
              {card.mistakes.map((m) => (
                <li key={m}>{say(m)}</li>
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

/** Shown when a lesson that was left half way is opened again: carry on where it stopped, or read the cards once more. */
function ResumeStep({ offer, onContinue, onCards }: { offer: ResumeOffer; onContinue: () => void; onCards: () => void }) {
  return (
    <div data-testid="lesson-resume" data-step={offer.step} className="text-center">
      <h2 className="text-2xl font-bold">{offer.title}</h2>
      <p className="mx-auto mt-2 max-w-md text-slate-200">{offer.body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="lg" onClick={onContinue} data-testid="lesson-resume-continue">
          {offer.action}
        </Button>
        <Button variant="secondary" size="lg" onClick={onCards} data-testid="lesson-resume-cards">
          Read the cards again
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

/**
 * The tool of a singing lesson, where a guitar lesson has its tuner: the range finder or "meet the
 * note". Each brings its own heading and card. Nothing in a tool is scored, so leaving it either way
 * moves the lesson on, as with the tuner.
 */
function ToolStep({ tool, hasRange, onDone }: { tool: 'range' | 'match'; hasRange: boolean; onDone: () => void }) {
  return (
    <div data-testid="lesson-tool" data-tool={tool}>
      {tool === 'range' ? (
        // "Not now" leaves without easy notes, so it is only offered to a singer who already has some.
        // Without any, the practice rounds and the songs after this lesson would have nothing of the
        // singer's own to be placed in, and the closing line ("the app knows which notes are easy for
        // you") would not be true. Picking a starting point is always on offer in the finder itself.
        <RangeFinder onDone={onDone} onSkip={hasRange ? onDone : undefined} />
      ) : (
        <NoteMatch onDone={onDone} onSkip={onDone} />
      )}
    </div>
  )
}

function DoneStep({ lesson, played, range, marksStored }: { lesson: Lesson; played: boolean; range: RangeEdges; marksStored: () => Promise<void> }) {
  const navigate = useNavigate()
  const next = nextLessonAfter(lesson.id)
  const [saved, setSaved] = useState<{ courseComplete: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    // The finish is the last to write the lesson's row: not before every mark of the lesson that is
    // still on its way has been stored (see `markQueue` for the trap).
    void marksStored()
      .then(() => finishLesson(lesson.id))
      .then((r) => !cancelled && setSaved(r))
      .catch(() => !cancelled && setSaved({ courseComplete: false }))
    return () => {
      cancelled = true
    }
  }, [lesson.id, marksStored])
  // The songs of a singing lesson are songs to sing, and one that is wider than the singer's easy notes
  // is not a new song for them yet: it waits under "Comes later".
  const toSing = instrumentOfLessonId(lesson.id) === 'voice' ? songsToSing(lesson.unlocks, range) : null
  const songs: { id: string; title: string }[] = toSing ? toSing.ready : lesson.unlocks.map((id) => builtInSong(id)).filter((s) => !!s)
  const later = toSing?.later ?? []
  return (
    <div data-testid="lesson-done" className="text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-ok/20 text-green-300">
        <Check className="h-8 w-8" />
      </div>
      <h2 className="text-2xl font-bold">{saved?.courseComplete ? 'First steps complete' : `Lesson ${lesson.number} done`}</h2>
      <p className="mx-auto mt-2 max-w-md text-slate-200">{doneText(lesson, { playDone: played })}</p>
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
      {later.length > 0 && (
        <Card className="mx-auto mt-3 max-w-md text-left">
          <div data-testid="lesson-songs-later">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{COMES_LATER.title}</div>
            <ul className="mt-2 space-y-1 text-slate-200">
              {later.map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">{COMES_LATER.why(later.length)}</p>
          </div>
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
  // While the singing side is switched off, the address of a singing lesson finds nothing.
  const lesson = lessonOnScreen(lessonId, voiceEnabled())
  // The course, its lock and whether it has ended all belong to the lesson's own instrument: a guitar
  // lesson is judged by the guitar profile and a singing lesson by the singing profile, whichever side
  // the switch is on. Never by the other one's row (see `ownProfile`).
  const instrument = lesson ? instrumentOfLessonId(lesson.id) : 'guitar'
  const profile = ownProfile(instrument, useProfile(instrument))
  const courseOver = !!profile?.firstStepsDoneAt
  const course = courseOfLesson(lesson?.id ?? '')
  // The guitar course is made the first time a lesson is opened, as it always was. The singing course
  // gets its rows from the singing set-up and from nothing else, so a typed address cannot start it.
  const gate = courseGate(instrument, profile)
  const mayStart = gate === 'open'
  const navigate = useNavigate()
  // Null until the learner has moved on by themselves: until then the saved progress says where the lesson opens.
  const [chosen, setStep] = useState<StepId | null>(null)
  const [ready, setReady] = useState(false)
  // The marks of this lesson that are on their way to being stored; the finish waits for them.
  const [marks] = useState(markQueue)
  const progress = useLiveQuery(async () => (lessonId ? ((await db.lessons.get(lessonId)) ?? null) : null), [lessonId], undefined)

  useEffect(() => {
    if (!mayStart) return
    let cancelled = false
    initialiseCourse(course.map((l) => l.id))
      .catch(() => {})
      .finally(() => !cancelled && setReady(true))
    return () => {
      cancelled = true
    }
  }, [course, mayStart])

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
  if (gate === 'set-up') return <Navigate to="/start?instrument=voice" replace />
  if (!ready || progress === undefined) return <div className="flex h-dvh items-center justify-center text-muted">Loading…</div>
  // Lessons open one after the other while the course is running. Someone who has left the course
  // (finished it, or skipped it because they play already) can open any lesson to look something up.
  if (!progress || (progress.status === 'locked' && !courseOver)) {
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

  const offer = chosen === null ? resumeOffer(lesson, progress) : null
  const step: StepId = chosen ?? 'learn'
  const after = (from: StepId) => stepAfter(lesson, from)
  const go = (to: StepId) => () => setStep(to)
  // Every mark is stored on the way and the lesson moves on at once, as it always did. The finish may
  // come straight after (the cards read again in a lesson that only had its finish left, a lesson that
  // ends on its tool), so each write is handed to `marks`, and the finish waits for them.
  const markLearnt = () => {
    marks.add(patchLessonProgress(lesson.id, { learnSeen: true, startedAt: progress.startedAt ?? Date.now() }).catch(() => {}))
    setStep(stepAfterCards(lesson, progress))
  }
  // The tuner and the tools of the singing course stand where a practice round stands, and are marked
  // done the same way.
  const middleDone = (from: StepId) => () => {
    marks.add(patchLessonProgress(lesson.id, { drillDone: true }).catch(() => {}))
    setStep(after(from))
  }
  const tool = lessonTool(lesson)
  // A singer always has notes to sing in: their own, or the lower starting notes until those are found.
  const range = profile?.voice?.range ?? DEFAULT_RANGES.lower

  if (offer) {
    return (
      <Frame lesson={lesson} steps={steps} current={offer.step}>
        <ResumeStep offer={offer} onContinue={go(offer.step)} onCards={go('learn')} />
      </Frame>
    )
  }

  if (step === 'try' && lesson.drill) {
    return <TryStep key={lesson.id} lesson={lesson} drill={lesson.drill} onExit={() => navigate('/lessons')} onContinue={go(after('try'))} onMark={marks.add} />
  }
  if (step === 'play' && lesson.play) {
    return <PlayStep key={lesson.id} lesson={lesson} play={lesson.play} onExit={() => navigate('/lessons')} onContinue={go(after('play'))} onMark={marks.add} />
  }
  return (
    <Frame lesson={lesson} steps={steps} current={step}>
      {step === 'learn' && <LearnStep key={lesson.id} lesson={lesson} onDone={markLearnt} />}
      {step === 'tune' && <TuneStep onDone={middleDone('tune')} />}
      {step === 'tool' && (tool === 'range' || tool === 'match') && <ToolStep tool={tool} hasRange={!!profile?.voice?.range} onDone={middleDone('tool')} />}
      {step === 'done' && <DoneStep lesson={lesson} played={!!progress.playDone} range={range} marksStored={marks.settled} />}
    </Frame>
  )
}
