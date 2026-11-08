import { CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { generateLevels } from '../../chart/difficulty'
import type { Chart, ChartNote } from '../../chart/types'
import { Badge, Button, Card, PageHeader } from '../../components/ui'
import { db, songAudioBlob } from '../../db/db'
import { getTuning } from '../../music/tunings'
import { checkpointTasks, evaluateTask, monthlyTasks, placementLadder } from '../../training/assessment'
import { CALIBRATION_MAX_AGE_DAYS } from '../../training/constants'
import { attemptForTask, calibrationAgeDays, exerciseForTask, finishTest, songSummaries } from '../../training/coach'
import { SKILLS } from '../../training/skills'
import type { AttemptResult, LearnerModel, Profile, TestTask, TestType } from '../../training/types'
import { useLearnerModel, useProfile } from '../../training/useTraining'
import { Player } from '../play/Player'
import type { ScoreSummary } from '../play/scoring'
import { TaskCard, TaskIntro } from './TaskIntro'
import { TestReportView } from './TestReportView'
import { initialTestFlowState, isComplete, progressOf, testFlowReducer } from './testFlowState'

const TYPES: TestType[] = ['placement', 'checkpoint', 'monthly']

function isTestType(v: string | undefined): v is TestType {
  return TYPES.includes(v as TestType)
}

interface PlayMedia {
  title: string
  chart: Chart
  notes: ChartNote[]
  audio: Blob
  tempo: number
  hint: string
}

function focusSkillFor(model: LearnerModel, profile: Profile): string {
  if (profile.pinnedSkillId) return profile.pinnedSkillId
  let best: { id: string; rating: number } | null = null
  for (const [id, st] of Object.entries(model.skills)) {
    if (!best || st.rating < best.rating) best = { id, rating: st.rating }
  }
  return best?.id ?? SKILLS[0].id
}

async function buildTasks(type: TestType, model: LearnerModel, profile: Profile): Promise<TestTask[]> {
  if (type === 'placement') return placementLadder(SKILLS)
  if (type === 'monthly') return monthlyTasks(model, SKILLS)
  return checkpointTasks(model, SKILLS, await songSummaries(), Date.now(), focusSkillFor(model, profile))
}

/** Loads chart, notes and audio for a task; null when a song task's song is gone. */
async function prepareMedia(task: TestTask, tuning: number[]): Promise<PlayMedia | null> {
  if (task.generatorId === 'song') {
    const song = await db.songs.get(task.params.songId as number)
    const audio = song ? songAudioBlob(song) : null
    if (!song || !audio) return null
    const levels = generateLevels(song.chart)
    const level = levels[task.params.level as number] ?? levels[levels.length - 1]
    const chart = {
      ...song.chart,
      duration: Math.max(song.chart.duration, song.duration),
    }
    return {
      title: song.title,
      chart,
      notes: level.notes,
      audio,
      tempo: song.bpm,
      hint: task.instructions,
    }
  }
  const exercise = exerciseForTask(task, tuning)
  if (!exercise || !exercise.backing) throw new Error('This task could not be generated.')
  return {
    title: task.title,
    chart: exercise.chart,
    notes: exercise.chart.notes,
    audio: encodeWav(exercise.backing, exercise.backingSampleRate),
    tempo: task.params.tempo,
    hint: task.instructions,
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl">{children}</div>
}

function TaskResultCard({
  task,
  passed,
  summary,
  result,
  last,
  onNext,
}: {
  task: TestTask
  passed: boolean
  summary: ScoreSummary | null
  result: AttemptResult | null
  last: boolean
  onNext: () => void
}) {
  const accuracy = summary ? Math.round(summary.accuracy * 100) : null
  const median = result?.timingMedianMs
  const stdev = result?.timingStdevMs
  return (
    <Centered>
      <PageHeader title="Task result" subtitle={task.title} />
      <Card>
        <div className="mb-4 flex items-center gap-2">
          {passed ? <CheckCircle2 className="h-6 w-6 text-green-300" /> : <XCircle className="h-6 w-6 text-red-300" />}
          <span className="text-lg font-semibold">{passed ? 'Passed' : 'Not yet'}</span>
          <Badge tone={passed ? 'ok' : 'warn'}>{passed ? 'on target' : 'below target'}</Badge>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-panel-2 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted">Accuracy</dt>
            <dd className="text-xl font-semibold tabular-nums">{accuracy === null ? '-' : `${accuracy}%`}</dd>
          </div>
          <div className="rounded-lg bg-panel-2 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted">Timing</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {median === null || median === undefined ? '-' : `${median > 0 ? '+' : ''}${Math.round(median)} ms`}
            </dd>
          </div>
          <div className="rounded-lg bg-panel-2 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted">Spread</dt>
            <dd className="text-xl font-semibold tabular-nums">
              {stdev === null || stdev === undefined ? '-' : `${Math.round(stdev)} ms`}
            </dd>
          </div>
        </dl>
        <Button variant="primary" size="lg" className="mt-4" onClick={onNext} data-testid="task-next">
          {last ? 'See results' : 'Next'}
        </Button>
      </Card>
    </Centered>
  )
}

export function TestFlow() {
  const { type: typeParam } = useParams()
  if (!isTestType(typeParam)) {
    return (
      <Centered>
        <Card>
          <p className="mb-3">Unknown test type.</p>
          <Link to="/" className="text-accent underline">
            Back to Today
          </Link>
        </Card>
      </Centered>
    )
  }
  return <TestFlowInner key={typeParam} type={typeParam} />
}

function TestFlowInner({ type }: { type: TestType }) {
  const navigate = useNavigate()
  const settings = useSettings()
  const model = useLearnerModel()
  const profile = useProfile()
  const [state, dispatch] = useReducer(testFlowReducer, type, initialTestFlowState)
  const [override, setOverride] = useState(false)
  const [media, setMedia] = useState<PlayMedia | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [lastSummary, setLastSummary] = useState<ScoreSummary | null>(null)
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null)
  const [empty, setEmpty] = useState(false)
  const builtRef = useRef(false)
  const finishingRef = useRef(false)

  const age = calibrationAgeDays(settings)
  const calibrated = age !== null && age <= CALIBRATION_MAX_AGE_DAYS
  const gateOpen = calibrated || (type === 'placement' && override)
  const ready = model !== undefined && profile !== undefined

  // Build the task list exactly once, when the gate is open and data is loaded.
  useEffect(() => {
    if (!gateOpen || !ready || builtRef.current) return
    builtRef.current = true
    buildTasks(type, model, profile)
      .then((tasks) => {
        if (tasks.length === 0) setEmpty(true)
        else dispatch({ type: 'loaded', tasks })
      })
      .catch((e: unknown) =>
        dispatch({
          type: 'fail',
          message: e instanceof Error ? e.message : 'Could not build the test.',
        }),
      )
  }, [gateOpen, ready, model, profile, type])

  // Save the results when the last task is done.
  useEffect(() => {
    if (state.phase !== 'finishing' || finishingRef.current) return
    finishingRef.current = true
    if (state.results.length === 0) {
      dispatch({
        type: 'fail',
        message: 'No tasks could be played, so nothing was saved.',
      })
      return
    }
    finishTest(type, state.tasks, state.results)
      .then((record) => dispatch({ type: 'done', record }))
      .catch((e: unknown) =>
        dispatch({
          type: 'fail',
          message: e instanceof Error ? e.message : 'Could not save the test.',
        }),
      )
  }, [state.phase, state.tasks, state.results, type])

  const active = state.phase === 'intro' || state.phase === 'task-intro' || state.phase === 'playing' || state.phase === 'task-result'
  const activeRef = useRef(active)
  activeRef.current = active

  // Browser back and tab close while a test is in progress.
  useEffect(() => {
    if (!active) return
    window.history.pushState({ testGuard: true }, '')
    let leaving = false
    const onPop = () => {
      if (leaving) return
      if (window.confirm('Leave the test? Your progress will not be saved.')) {
        leaving = true
        window.history.back()
      } else {
        window.history.pushState({ testGuard: true }, '')
      }
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [active])

  const confirmLeave = useCallback(() => {
    if (window.confirm('Leave the test? Your progress will not be saved.')) navigate('/')
  }, [navigate])

  const task = state.current
  const tuning = useMemo(() => getTuning(settings.defaultTuningId).strings, [settings.defaultTuningId])

  const playTask = async () => {
    if (!task) return
    setPreparing(true)
    try {
      const m = await prepareMedia(task, tuning)
      if (!m) {
        dispatch({ type: 'skipTask', taskId: task.id })
        return
      }
      setMedia(m)
      dispatch({ type: 'play' })
    } catch (e) {
      dispatch({
        type: 'fail',
        message: e instanceof Error ? e.message : 'Could not prepare the task.',
      })
    } finally {
      setPreparing(false)
    }
  }

  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    if (!task || state.phase !== 'playing') return
    const passed = evaluateTask(task, result)
    const attempt = attemptForTask(task, result, settings)
    setLastSummary(summary)
    setLastResult(result)
    dispatch({
      type: 'finishedTask',
      result: { taskId: task.id, attempt, passed },
    })
  }

  let body: React.ReactNode
  if (state.phase === 'error') {
    body = (
      <Centered>
        <Card>
          <p className="mb-3 text-red-300" role="alert">
            {state.message ?? 'Something went wrong.'}
          </p>
          <Button onClick={() => navigate('/')}>Back to Today</Button>
        </Card>
      </Centered>
    )
  } else if (!gateOpen) {
    body = (
      <Centered>
        <PageHeader title="Calibrate first" subtitle="Tests need a recent latency calibration." />
        <Card>
          <ClipboardCheck className="mb-2 h-6 w-6 text-accent" />
          <p className="mb-4 text-sm text-slate-300">
            Test scores are judged to within a few milliseconds. Without a calibration from the last {CALIBRATION_MAX_AGE_DAYS} days your
            timing could be marked early or late by mistake.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => navigate('/settings?calibrate=1')}>
              Calibrate
            </Button>
            {type === 'placement' && <Button onClick={() => setOverride(true)}>Continue anyway</Button>}
            <Button variant="ghost" onClick={() => navigate('/')}>
              Not now
            </Button>
          </div>
        </Card>
      </Centered>
    )
  } else if (empty) {
    body = (
      <Centered>
        <PageHeader title="Nothing to test yet" subtitle="Practise a few skills first, then come back." />
        <Link to="/" className="text-accent underline">
          Back to Today
        </Link>
      </Centered>
    )
  } else if (state.phase === 'gate') {
    body = <div className="py-10 text-center text-muted">Preparing your test…</div>
  } else if (state.phase === 'intro') {
    body = (
      <TaskIntro type={type} taskCount={state.tasks.length} onStart={() => dispatch({ type: 'start' })} onCancel={() => navigate('/')} />
    )
  } else if (state.phase === 'task-intro' && task) {
    const { position, total } = progressOf(state)
    body = <TaskCard task={task} position={position} total={total} onPlay={() => void playTask()} busy={preparing} />
  } else if (state.phase === 'playing' && task && media) {
    return (
      <div className="fixed inset-0 z-40 bg-bg" data-testid="test-flow">
        <Player
          title={media.title}
          subtitle={task.title}
          chart={media.chart}
          notes={media.notes}
          audio={media.audio}
          mode="test"
          speed={1}
          playedTempo={media.tempo}
          targetTempo={media.tempo}
          resetKey={task.id}
          readyHint={media.hint}
          onExit={confirmLeave}
          onFinished={onFinished}
        />
      </div>
    )
  } else if (state.phase === 'task-result' && task) {
    const last = state.results[state.results.length - 1]
    body = (
      <TaskResultCard
        task={task}
        passed={last?.passed ?? false}
        summary={lastSummary}
        result={lastResult}
        last={isComplete(state)}
        onNext={() => dispatch({ type: 'next' })}
      />
    )
  } else if (state.phase === 'finishing') {
    body = <div className="py-10 text-center text-muted">Saving your results…</div>
  } else if (state.phase === 'report' && state.record) {
    const notes = state.skipped.map((t) => `${t}: skipped (song not in your library)`)
    body = <TestReportView record={state.record} notes={notes} onHome={() => navigate('/')} onProgress={() => navigate('/progress')} />
  } else {
    body = <div className="py-10 text-center text-muted">Loading…</div>
  }

  return <div data-testid="test-flow">{body}</div>
}
