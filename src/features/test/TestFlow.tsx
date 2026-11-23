import { ClipboardCheck } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { voiceEnabled } from '../../app/features'
import { useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { generateLevels } from '../../chart/difficulty'
import type { Chart, ChartNote } from '../../chart/types'
import { Button, Card, PageHeader } from '../../components/ui'
import { db, type SongRecord } from '../../db/db'
import { songPlayback } from '../../songs/playback'
import { levelIndex } from '../../songs/vocal/levels'
import { useVocalRunState, type VocalRunView } from '../../songs/vocal/useVocalRun'
import { getTuning } from '../../music/tunings'
import { checkpointTasks, evaluateTask, monthlyTasks, placementLadder } from '../../training/assessment'
import { CALIBRATION_MAX_AGE_DAYS } from '../../training/constants'
import { attemptForTask, calibrationAgeDays, exerciseForTask, songSummaries } from '../../training/coach'
import { activeInstrument, instrumentOf, skillsFor } from '../../training/instruments'
import { saveFinishedTest } from '../../training/testBlocks'
import type { AttemptResult, InstrumentId, LearnerModel, Profile, TestTask, TestType } from '../../training/types'
import { useLearnerModel, useProfile } from '../../training/useTraining'
import { voiceCheckOptions, voiceIsSetUp } from '../../training/voicePlan'
import { loadVoiceProfile } from '../../training/voiceProfile'
import { NotCountedCard } from '../play/NotCountedCard'
import { Player, type PlayerHandle } from '../play/Player'
import { runVerdict, type RunVerdict } from '../play/runVerdict'
import type { ScoreSummary } from '../play/scoring'
import { voiceResultCopy } from '../play/voice/voiceCopy'
import { TaskCard, TaskIntro, TaskResultCard } from './TaskIntro'
import { checkInstrument, checkOffered, checkWords, focusSkillFor, singingRange, sungSongStep, type CheckWords } from './taskResult'
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
  /** The audio is a click track only (see Player.backingIsClick). */
  clickOnly: boolean
  tempo: number
  hint: string
}

/**
 * A song task of a sung check, before its sound exists. A song to sing is stored without audio: it is
 * arranged for the singer's range and rendered when the task opens (`SungSongTask`).
 */
interface SungSong {
  sungSong: SongRecord
  /** Level index 0 to 5. */
  level: number
  hint: string
}

/**
 * The tasks of a check for one instrument. A voice has the weekly check and no other (the caller sends
 * the other kinds away): its tasks are built from the singing skills, each at its own step and as far
 * up its ladder as the singer's range goes, with the sung pass mark.
 */
async function buildTasks(type: TestType, instrument: InstrumentId, model: LearnerModel, profile: Profile): Promise<TestTask[]> {
  const skills = skillsFor(instrument)
  if (instrument === 'voice') {
    const range = singingRange(await loadVoiceProfile())
    return checkpointTasks(model, skills, await songSummaries('voice'), Date.now(), focusSkillFor(model, profile, skills), voiceCheckOptions(range))
  }
  if (type === 'placement') return placementLadder(skills)
  if (type === 'monthly') return monthlyTasks(model, skills)
  return checkpointTasks(model, skills, await songSummaries(), Date.now(), focusSkillFor(model, profile, skills))
}

/** Loads chart, notes and audio for a task; null when a song task's song is gone. */
async function prepareMedia(task: TestTask, tuning: number[], instrument: InstrumentId, words: CheckWords): Promise<PlayMedia | SungSong | null> {
  if (task.generatorId === 'song') {
    const song = await db.songs.get(task.params.songId as number)
    if (instrument === 'voice') {
      return song && instrumentOf(song) === 'voice' ? { sungSong: song, level: levelIndex(Number(task.params.level)), hint: task.instructions } : null
    }
    // Bundled songs store the guitar part itself: a test plays their click track only.
    const playback = song ? songPlayback(song) : null
    const audio = playback?.audio ?? null
    if (!song || !playback || !audio) return null
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
      clickOnly: playback.clickOnly,
      tempo: song.bpm,
      hint: task.instructions,
    }
  }
  // A sung exercise is placed in the singer's range as it is now, not as it was when the check was built,
  // and is written for a voice: the guitar's tuning has no say in it.
  const exercise = instrument === 'voice' ? exerciseForTask(task, undefined, singingRange(await loadVoiceProfile())) : exerciseForTask(task, tuning)
  if (!exercise || !exercise.backing) throw new Error(words.trouble.task)
  return {
    title: task.title,
    chart: exercise.chart,
    notes: exercise.chart.notes,
    audio: encodeWav(exercise.backing, exercise.backingSampleRate),
    clickOnly: true,
    tempo: task.params.tempo,
    hint: task.instructions,
  }
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-xl">{children}</div>
}

/**
 * A song task of a sung check: makes the song ready in the singer's key, then hands it to the Player
 * (`children`). The sound is the scored track alone, click and starting notes, as for every task of a
 * check: no guide voice sings along with what is being measured.
 *
 * The arrangement the task opens with is the one that is sung. The singing profile is read live, and
 * a range or key changed elsewhere must not swap the chart under a task that has begun.
 * A song that cannot be made ready, or that no longer fits the singer's range, is left out of the
 * check (`onLeftOut`); it is not counted as a miss.
 */
function SungSongTask({
  task,
  waiting,
  onLeftOut,
  children,
}: {
  task: SungSong
  /** Said while the song is being made ready. */
  waiting: string
  onLeftOut: () => void
  children: (media: PlayMedia) => ReactNode
}) {
  const live = useVocalRunState(task.sungSong, task.level)
  const [held, setHeld] = useState<VocalRunView | null>(null)
  // Adopting the first run during render is React's pattern for state derived from what a hook returns.
  if (!held && live.status === 'ready') setHeld(live.run)
  const run = held ?? (live.status === 'ready' ? live.run : null)
  const step = sungSongStep(live, held)
  const leftOut = step === 'left-out'
  const leaveOut = useEffectEvent(onLeftOut)
  useEffect(() => {
    if (leftOut) leaveOut()
  }, [leftOut])
  const { title, bpm } = task.sungSong
  const media = useMemo(
    (): PlayMedia | null => (run ? { title, chart: run.chart, notes: run.notes, audio: run.audio, clickOnly: true, tempo: bpm, hint: task.hint } : null),
    [run, title, bpm, task.hint],
  )
  if (!media || step !== 'sing') {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted" role="status" data-testid="task-song-waiting">
        {waiting}
      </div>
    )
  }
  return <>{children(media)}</>
}

/**
 * A skill check for one instrument. Whose check it is comes from the page address (`?instrument=voice`),
 * else from the instrument on screen. Singing has the weekly check alone: any other kind asked for a
 * voice goes back to Today.
 */
export function TestFlow() {
  const { type: typeParam } = useParams()
  const [query] = useSearchParams()
  const settings = useSettings()
  const instrument = checkInstrument(query.get('instrument'), activeInstrument(settings), voiceEnabled())
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
  if (!checkOffered(typeParam, instrument)) return <Navigate to="/" replace />
  return <TestFlowInner key={`${instrument}:${typeParam}`} type={typeParam} instrument={instrument} />
}

function TestFlowInner({ type, instrument }: { type: TestType; instrument: InstrumentId }) {
  const navigate = useNavigate()
  const settings = useSettings()
  const sung = instrument === 'voice'
  const words = checkWords(instrument)
  const model = useLearnerModel(instrument)
  const profile = useProfile(instrument)
  const [state, dispatch] = useReducer(testFlowReducer, type, initialTestFlowState)
  const [override, setOverride] = useState(false)
  const [media, setMedia] = useState<PlayMedia | SungSong | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [lastResult, setLastResult] = useState<AttemptResult | null>(null)
  // The one tip for a sung task, from what the tracker heard; the guitar card has its numbers instead.
  const [lastTip, setLastTip] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const builtRef = useRef(false)
  const finishingRef = useRef(false)

  const age = calibrationAgeDays(settings)
  const calibrated = age !== null && age <= CALIBRATION_MAX_AGE_DAYS
  // A sung check never waits for the sound sync: when a sung note begins is no part of its result.
  const gateOpen = sung || calibrated || (type === 'placement' && override)
  const ready = model !== undefined && profile !== undefined
  // A singer who has not been through the set-up has no check to take: the set-up comes first.
  const notSetUp = sung && profile !== undefined && !voiceIsSetUp(profile)

  // Build the task list exactly once, when the gate is open and data is loaded.
  useEffect(() => {
    if (!gateOpen || !ready || notSetUp || builtRef.current) return
    builtRef.current = true
    buildTasks(type, instrument, model, profile)
      .then((tasks) => {
        if (tasks.length === 0) setEmpty(true)
        else dispatch({ type: 'loaded', tasks })
      })
      .catch((e: unknown) =>
        dispatch({
          type: 'fail',
          message: e instanceof Error ? e.message : words.trouble.build,
        }),
      )
  }, [gateOpen, ready, notSetUp, model, profile, type, instrument, words])

  // Save the results when the last task is done. Saving also closes the check's block in today's plan.
  useEffect(() => {
    if (state.phase !== 'finishing' || finishingRef.current) return
    finishingRef.current = true
    if (state.results.length === 0) {
      dispatch({
        type: 'fail',
        message: words.noTasks,
      })
      return
    }
    saveFinishedTest(type, state.tasks, state.results, Date.now(), instrument)
      .then((record) => dispatch({ type: 'done', record }))
      .catch((e: unknown) =>
        dispatch({
          type: 'fail',
          message: e instanceof Error ? e.message : words.trouble.save,
        }),
      )
  }, [state.phase, state.tasks, state.results, type, instrument, words])

  const active = state.phase === 'intro' || state.phase === 'task-intro' || state.phase === 'playing' || state.phase === 'task-result'

  // Browser back and tab close while a test is in progress.
  useEffect(() => {
    if (!active) return
    window.history.pushState({ testGuard: true }, '')
    let leaving = false
    const onPop = () => {
      if (leaving) return
      if (window.confirm(words.leave)) {
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
  }, [active, words])

  const confirmLeave = useCallback(() => {
    if (window.confirm(words.leave)) navigate('/')
  }, [navigate, words])

  const task = state.current
  const playerRef = useRef<PlayerHandle>(null)
  const [notCounted, setNotCounted] = useState<Exclude<RunVerdict, 'counted'> | null>(null)
  const tuning = useMemo(() => getTuning(settings.defaultTuningId).strings, [settings.defaultTuningId])

  const playTask = async () => {
    if (!task) return
    setPreparing(true)
    try {
      const m = await prepareMedia(task, tuning, instrument, words)
      if (!m) {
        dispatch({ type: 'skipTask', taskId: task.id })
        return
      }
      setMedia(m)
      dispatch({ type: 'play' })
    } catch (e) {
      dispatch({
        type: 'fail',
        message: e instanceof Error ? e.message : words.trouble.prepare,
      })
    } finally {
      setPreparing(false)
    }
  }

  const onFinished = (summary: ScoreSummary, result: AttemptResult, chart: Chart) => {
    if (!task || state.phase !== 'playing') return
    // A task the app could not hear (or where it heard its own playback) is played again, not marked as failed.
    const verdict = runVerdict(summary, result)
    if (verdict !== 'counted') {
      setNotCounted(verdict)
      return
    }
    setNotCounted(null)
    const passed = evaluateTask(task, result)
    // Whose run it is has to be said here: a song task names no skill to read it from.
    const attempt = attemptForTask(task, result, settings, Date.now(), instrument)
    setLastResult(result)
    setLastTip(sung ? voiceResultCopy(summary, chart.voice).tip : null)
    dispatch({
      type: 'finishedTask',
      result: { taskId: task.id, attempt, passed },
    })
  }

  let body: ReactNode
  if (notSetUp) {
    return <Navigate to="/start?instrument=voice" replace />
  } else if (state.phase === 'error') {
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
        <PageHeader title={words.nothing.title} subtitle={words.nothing.subtitle} />
        <Link to="/" className="text-accent underline">
          Back to Today
        </Link>
      </Centered>
    )
  } else if (state.phase === 'gate') {
    body = <div className="py-10 text-center text-muted">{words.preparing}</div>
  } else if (state.phase === 'intro') {
    body = (
      <TaskIntro
        type={type}
        taskCount={state.tasks.length}
        onStart={() => dispatch({ type: 'start' })}
        onCancel={() => navigate('/')}
        instrument={instrument}
      />
    )
  } else if (state.phase === 'task-intro' && task) {
    const { position, total } = progressOf(state)
    body = <TaskCard task={task} position={position} total={total} onPlay={() => void playTask()} busy={preparing} instrument={instrument} />
  } else if (state.phase === 'playing' && task && media) {
    const play = (m: PlayMedia) => (
      <Player
        ref={playerRef}
        title={m.title}
        subtitle={task.title}
        chart={m.chart}
        notes={m.notes}
        audio={m.audio}
        backingIsClick={m.clickOnly}
        mode="test"
        speed={1}
        playedTempo={m.tempo}
        targetTempo={m.tempo}
        resetKey={task.id}
        readyHint={m.hint}
        onExit={confirmLeave}
        onFinished={(summary, result) => onFinished(summary, result, m.chart)}
        onPhaseChange={(p) => p !== 'finished' && setNotCounted(null)}
        resultsOverlay={
          notCounted ? (
            <NotCountedCard
              verdict={notCounted}
              instrument={instrument}
              onRetry={() => {
                setNotCounted(null)
                playerRef.current?.restart()
                playerRef.current?.start()
              }}
            />
          ) : null
        }
      />
    )
    return (
      <div className="fixed inset-0 z-40 bg-bg" data-testid="test-flow">
        {'sungSong' in media ? (
          <SungSongTask key={task.id} task={media} waiting={words.gettingSongReady} onLeftOut={() => dispatch({ type: 'skipTask', taskId: task.id })}>
            {play}
          </SungSongTask>
        ) : (
          play(media)
        )}
      </div>
    )
  } else if (state.phase === 'task-result' && task) {
    const last = state.results[state.results.length - 1]
    body = (
      <TaskResultCard
        task={task}
        passed={last?.passed ?? false}
        result={lastResult}
        last={isComplete(state)}
        onNext={() => dispatch({ type: 'next' })}
        instrument={instrument}
        tip={lastTip}
      />
    )
  } else if (state.phase === 'finishing') {
    body = <div className="py-10 text-center text-muted">Saving your results…</div>
  } else if (state.phase === 'report' && state.record) {
    const notes = state.skipped.map((t) => words.skipped(t))
    body = <TestReportView record={state.record} notes={notes} onHome={() => navigate('/')} onProgress={() => navigate('/progress')} instrument={instrument} />
  } else {
    body = <div className="py-10 text-center text-muted">Loading…</div>
  }

  return <div data-testid="test-flow">{body}</div>
}
