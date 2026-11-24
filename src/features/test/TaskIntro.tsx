import { CheckCircle2, ClipboardCheck, Mic, Play, Timer, XCircle } from 'lucide-react'
import { Badge, Button, Card, PageHeader } from '../../components/ui'
import { skillById } from '../../training/instruments'
import type { AttemptResult, InstrumentId, TestTask, TestType } from '../../training/types'
import { voiceResultLine } from '../play/voice/voiceCopy'
import {
  checkWords,
  estimateMinutes,
  failedCriteria,
  failureReasons,
  passRuleText,
  ruleAccuracy,
  shownAccuracyPct,
  taskPace,
  verdictBadge,
  type FailedCriterion,
} from './taskResult'

/*
 * The cards of a check: the page before the first task, the card before each task, and the card after
 * it. Each takes the instrument the check is for and says everything in that instrument's words
 * (`checkWords`); left out, it is the guitar, and the cards read as they always did.
 */

export interface TaskIntroProps {
  type: TestType
  taskCount: number
  onStart: () => void
  onCancel: () => void
  instrument?: InstrumentId
}

/** Overview screen shown before the first task. */
export function TaskIntro({ type, taskCount, onStart, onCancel, instrument = 'guitar' }: TaskIntroProps) {
  const words = checkWords(instrument)
  const minutes = estimateMinutes(taskCount)
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={words.title(type)} subtitle={words.blurb(type)} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="accent">
            <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
            {words.count(type, taskCount)}
          </Badge>
          <Badge>
            <Timer className="mr-1 h-3.5 w-3.5" />~{minutes} min
          </Badge>
          <Badge>
            <Mic className="mr-1 h-3.5 w-3.5" />
            {words.mic}
          </Badge>
        </div>
        <h2 className="mb-2 font-semibold">{words.rulesHeading}</h2>
        <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-slate-300">
          {words.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={onStart} data-testid="test-start">
            <Play className="h-4 w-4" /> Start
          </Button>
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Not now
          </Button>
        </div>
      </Card>
    </div>
  )
}

export interface TaskCardProps {
  task: TestTask
  position: number
  total: number
  onPlay: () => void
  busy?: boolean
  instrument?: InstrumentId
}

/** Per-task card shown before the Player takes over the screen. */
export function TaskCard({ task, position, total, onPlay, busy, instrument = 'guitar' }: TaskCardProps) {
  const words = checkWords(instrument)
  // How the task is paced: a tempo, or for a singer the step of a step exercise or the level of a song.
  const pace = taskPace(task, instrument)
  const skills = task.skillIds.map((id) => skillById(id)?.name ?? id)
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`Task ${position} of ${total}`} subtitle={words.kind(task.generatorId === 'song')} />
      <Card>
        <h2 className="text-lg font-semibold">{task.title}</h2>
        <p className="mt-2 text-sm text-slate-300">{task.instructions}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-panel-2 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted">{pace.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{pace.value}</dd>
          </div>
          <div className="rounded-lg bg-panel-2 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted">{words.measures}</dt>
            <dd className="flex flex-wrap gap-1 pt-1">
              {skills.length > 0 ? skills.map((s) => <Badge key={s}>{s}</Badge>) : <Badge>{words.songMeasure}</Badge>}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">
          {words.beforeRule} {passRuleText(task.passCriteria, instrument)}
        </p>
        <Button variant="primary" size="lg" className="mt-4" onClick={onPlay} disabled={busy} data-testid="task-play">
          <Play className="h-4 w-4" /> {words.start}
        </Button>
      </Card>
    </div>
  )
}

export interface TaskResultCardProps {
  task: TestTask
  passed: boolean
  result: AttemptResult | null
  /** This was the last task: the button leads to the report. */
  last: boolean
  onNext: () => void
  instrument?: InstrumentId
  /** One tip for a sung task, from what the tracker heard (`sungTaskTip`); none for the guitar. */
  tip?: string | null
}

/**
 * The result of one task. The guitar card shows the three numbers the pass rule uses. A sung task has
 * no number to show for when its notes began, and a percentage is no use to a beginner either: its card
 * counts the notes that were on the note, gives one tip, and says what a pass would have taken.
 */
export function TaskResultCard({ task, passed, result, last, onNext, instrument = 'guitar', tip = null }: TaskResultCardProps) {
  const sung = instrument === 'voice'
  // The number shown is the one the pass rule uses (a note a little off counts for less), and a miss says which part was missed.
  const accuracy = result ? shownAccuracyPct(ruleAccuracy(result), task.passCriteria.minAccuracy) : null
  const failed: FailedCriterion[] = result && !passed ? failedCriteria(task.passCriteria, result) : []
  const reasons = result && !passed ? failureReasons(task.passCriteria, result, instrument) : []
  const median = result?.timingMedianMs
  const stdev = result?.timingStdevMs
  const tile = (part: FailedCriterion) => `rounded-lg bg-panel-2 p-3 ${failed.includes(part) ? 'ring-1 ring-amber-300/60' : ''}`
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Task result" subtitle={task.title} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {passed ? <CheckCircle2 className="h-6 w-6 text-green-300" /> : <XCircle className="h-6 w-6 text-red-300" />}
          <span className="text-lg font-semibold">{passed ? 'Passed' : 'Not yet'}</span>
          <Badge tone={passed ? 'ok' : 'warn'}>{passed ? 'on target' : failed.length > 0 ? verdictBadge(failed, instrument) : 'below target'}</Badge>
        </div>
        {sung ? (
          result && (
            <div className="space-y-2 text-sm" data-testid="task-sung">
              <p className="text-base text-slate-100">{voiceResultLine({ hits: result.perfects + result.goods, notes: result.total })}</p>
              {tip && <p className="text-slate-300">{tip}</p>}
            </div>
          )
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div className={tile('accuracy')}>
              <dt className="text-[11px] uppercase tracking-wide text-muted">Accuracy</dt>
              <dd className="text-xl font-semibold tabular-nums">{accuracy === null ? '-' : `${accuracy}%`}</dd>
            </div>
            <div className={tile('timing')}>
              <dt className="text-[11px] uppercase tracking-wide text-muted">Timing</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {median === null || median === undefined ? '-' : `${median > 0 ? '+' : ''}${Math.round(median)} ms`}
              </dd>
            </div>
            <div className={tile('spread')}>
              <dt className="text-[11px] uppercase tracking-wide text-muted">Spread</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {stdev === null || stdev === undefined ? '-' : `${Math.round(stdev)} ms`}
              </dd>
            </div>
          </dl>
        )}
        {reasons.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-slate-200" data-testid="task-reasons">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <Button variant="primary" size="lg" className="mt-4" onClick={onNext} data-testid="task-next">
          {last ? 'See results' : 'Next'}
        </Button>
      </Card>
    </div>
  )
}
