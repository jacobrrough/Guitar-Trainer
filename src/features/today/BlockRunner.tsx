import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getSettings, useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { generateLevels } from '../../chart/difficulty'
import { Badge, Button } from '../../components/ui'
import { db, songAudioBlob, type SongRecord } from '../../db/db'
import { getTuning } from '../../music/tunings'
import {
  completeExerciseBlock,
  finishExerciseBlock,
  completeSongBlock,
  exerciseForBlock,
  nextPendingBlockId,
  recordExerciseRep,
  type BlockOutcome,
  type RepOutcome,
} from '../../training/coach'
import { masteryBand } from '../../training/learner'
import { SKILLS_BY_ID } from '../../training/skills'
import { localDateString } from '../../training/store'
import type { AttemptResult, Block, ExerciseBlock, SessionRecord, SongBlock } from '../../training/types'
import { useTodaySession } from '../../training/useTraining'
import { renderDemoBacking } from '../library/demoSong'
import { Player, type PlayerHandle } from '../play/Player'
import { EarTrainer } from './EarTrainer'
import type { ScoreSummary } from '../play/scoring'
import { bandLabel, pct, repSummaryText, timingText } from './todayUtils'

function Overlay({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4" data-testid={testId}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel-2 p-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function NavButtons({ session, blockId }: { session: SessionRecord; blockId: string }) {
  const navigate = useNavigate()
  const nextId = nextPendingBlockId(session, blockId)
  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      <Button variant="primary" onClick={() => navigate(nextId ? `/today/block/${nextId}` : '/')} data-testid="next-block">
        {nextId ? 'Next block' : 'Finish session'}
      </Button>
      <Button variant="ghost" onClick={() => navigate('/')}>
        Back to Today
      </Button>
    </div>
  )
}

function NoScoreCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Overlay testId="no-score">
      <h2 className="text-lg font-semibold">Nothing was scored</h2>
      <p className="mt-2 text-sm text-muted">
        No notes were judged. Make sure the microphone is on, then try again. This run was not recorded.
      </p>
      <div className="mt-4 flex justify-center">
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Overlay>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Overlay testId="runner-error">
      <h2 className="text-lg font-semibold text-red-300">Could not save the result</h2>
      <p className="mt-2 text-sm text-muted">{message}</p>
      {onRetry && (
        <div className="mt-4 flex justify-center">
          <Button onClick={onRetry}>Retry</Button>
        </div>
      )}
    </Overlay>
  )
}

function ExerciseRunner({ block, session }: { block: ExerciseBlock; session: SessionRecord }) {
  const navigate = useNavigate()
  const settings = useSettings()
  const skill = SKILLS_BY_ID[block.skillId]
  const playerRef = useRef<PlayerHandle>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [tempo, setTempo] = useState(block.tempo)
  const [rep, setRep] = useState(1)
  const [repOutcome, setRepOutcome] = useState<RepOutcome | null>(null)
  const [repResult, setRepResult] = useState<AttemptResult | null>(null)
  const [blockOutcome, setBlockOutcome] = useState<BlockOutcome | null>(null)
  const [noScore, setNoScore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ratingBefore, setRatingBefore] = useState(0)
  const [savingFlag, setSavingFlag] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const startNext = useRef(false)
  const lastResult = useRef<AttemptResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void db.skillStates.get(block.skillId).then((st) => {
      if (!cancelled) setRatingBefore(st?.rating ?? 0)
    })
    return () => {
      cancelled = true
    }
  }, [block.skillId])

  const tuning = getTuning(settings.defaultTuningId).strings
  const exerciseResult = useMemo(() => {
    try {
      return { exercise: exerciseForBlock({ ...block, tempo }, tuning), error: null as string | null }
    } catch (err) {
      return { exercise: null, error: err instanceof Error ? err.message : String(err) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, tempo, tuning.join(',')])
  const exercise = exerciseResult.exercise
  const audio = useMemo(() => (exercise?.backing ? encodeWav(exercise.backing, exercise.backingSampleRate) : null), [exercise])
  const guideAudio = useMemo(() => (exercise?.guide ? encodeWav(exercise.guide, exercise.backingSampleRate) : null), [exercise])

  // After "Next rep": the Player resets through resetKey (child effect), then we start it.
  // The audio element gets its new source one render later, so wait briefly.
  useEffect(() => {
    if (!startNext.current) return
    startNext.current = false
    const t = setTimeout(() => playerRef.current?.start(), 250)
    return () => clearTimeout(t)
  }, [rep])

  const isLast = rep >= block.reps

  const finalize = useCallback(
    async (result: AttemptResult) => {
      if (!exercise) return
      setError(null)
      setSavingFlag(true)
      try {
        const outcome = await completeExerciseBlock(sessionRef.current, { ...block, tempo }, exercise, result, getSettings())
        setBlockOutcome(outcome)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingFlag(false)
      }
    },
    [block, tempo, exercise],
  )

  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    if (!exercise) return
    lastResult.current = result
    setRepResult(result)
    setRepOutcome(null)
    setBlockOutcome(null)
    setError(null)
    if (summary.total === 0) {
      setNoScore(true)
      return
    }
    setNoScore(false)
    if (isLast) {
      void finalize(result)
      return
    }
    setSavingFlag(true)
    recordExerciseRep(sessionRef.current, { ...block, tempo }, exercise, result, getSettings())
      .then(setRepOutcome)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingFlag(false))
  }

  const nextRep = () => {
    if (!repOutcome) return
    startNext.current = true
    setRepOutcome(null)
    setRepResult(null)
    setTempo(repOutcome.nextTempo)
    setRep((r) => r + 1)
  }

  const retry = () => {
    setNoScore(false)
    setRepResult(null)
    setRetryKey((k) => k + 1)
    playerRef.current?.restart()
    playerRef.current?.start()
  }

  if (!skill || !exercise || (!audio && exercise.interaction !== 'ear')) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="block-runner">
        <p>{exerciseResult.error ?? 'This exercise has no audio.'}</p>
        <Link to="/" className="underline">
          Back to Today
        </Link>
      </div>
    )
  }

  const saving = savingFlag
  let overlay: ReactNode
  if (error) {
    overlay = <ErrorCard message={error} onRetry={isLast && repResult ? () => void finalize(repResult) : undefined} />
  } else if (noScore) {
    overlay = <NoScoreCard onRetry={retry} />
  } else if (blockOutcome) {
    const after = blockOutcome.state?.rating ?? ratingBefore
    overlay = (
      <Overlay testId="block-result">
        <h2 className="text-lg font-semibold">{skill.name} done</h2>
        <div className="mt-1 text-5xl font-bold tabular-nums">{pct(blockOutcome.performance.acc)}%</div>
        <div className="text-sm text-muted">accuracy · reached {Math.round(tempo)} bpm</div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Rating" value={`${Math.round(ratingBefore)} → ${Math.round(after)}`} />
          <Stat label="Level" value={`${bandLabel(masteryBand(ratingBefore))} → ${bandLabel(masteryBand(after))}`} />
        </dl>
        {!blockOutcome.performance.reliable && (
          <p className="mt-3 text-xs text-amber-200">
            Low-confidence result: {blockOutcome.performance.reasons.join(', ') || 'limited evidence'}.
          </p>
        )}
        <NavButtons session={blockOutcome.session} blockId={block.id} />
      </Overlay>
    )
  } else if (repOutcome && repResult) {
    overlay = (
      <Overlay testId="rep-card">
        <h2 className="text-lg font-semibold">
          Rep {rep} of {block.reps}
        </h2>
        <div className="mt-1 text-5xl font-bold tabular-nums">{pct(repOutcome.performance.acc)}%</div>
        <div className="mt-1 text-sm text-muted">{repSummaryText(repResult)}</div>
        <div className="text-sm text-muted">{timingText(repResult.timingMedianMs)}</div>
        <p className="mt-3 text-sm text-slate-200">Next rep at {Math.round(repOutcome.nextTempo)} bpm</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={nextRep} data-testid="next-rep">
            Next rep
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const rep = repOutcome
              setRepOutcome(null)
              if (!rep) return
              setError(null)
              setSavingFlag(true)
              finishExerciseBlock(sessionRef.current, { ...block, tempo }, rep)
                .then(setBlockOutcome)
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setSavingFlag(false))
            }}
          >
            Finish early
          </Button>
        </div>
      </Overlay>
    )
  } else {
    overlay = saving ? (
      <Overlay testId="saving">
        <p className="text-sm text-muted">Saving…</p>
      </Overlay>
    ) : null
  }

  if (exercise.interaction === 'ear') {
    return (
      <div data-testid="block-runner" className="relative h-full">
        <EarTrainer exercise={exercise} resetKey={rep * 1000 + (retryKey % 1000)} onExit={() => navigate('/')} onFinished={onFinished} />
        {overlay}
      </div>
    )
  }

  if (!audio) return null

  return (
    <div data-testid="block-runner">
      <Player
        ref={playerRef}
        mode="exercise"
        title={skill.name}
        subtitle={`${exercise.title} · rep ${rep}/${block.reps}`}
        chart={exercise.chart}
        notes={exercise.chart.notes}
        audio={audio}
        guideAudio={guideAudio}
        playedTempo={tempo}
        targetTempo={block.tempo}
        readyHint={exercise.instructions}
        resetKey={`${rep}-${tempo}`}
        headerControls={<Badge tone="accent">{`Rep ${rep}/${block.reps} · ${Math.round(tempo)} bpm`}</Badge>}
        onExit={() => navigate('/')}
        onFinished={onFinished}
        resultsOverlay={overlay}
      />
    </div>
  )
}

function SongRunner({ block, session }: { block: SongBlock; session: SessionRecord }) {
  const navigate = useNavigate()
  const song = useLiveQuery(async () => (await db.songs.get(block.songId)) ?? null, [block.songId], 'loading' as const)
  if (song === 'loading') return <div className="flex h-full items-center justify-center text-muted">Loading…</div>
  if (!song) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted">
        <p>This song is no longer in your library.</p>
        <Link to="/" className="underline">
          Back to Today
        </Link>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Close
        </Button>
      </div>
    )
  }
  return <SongPlayer block={block} session={session} song={song} />
}

/**
 * Song blocks use Player mode="song" so the latency field stays available while practising a real song.
 * With loopBars: phase 'loop' (2 passes, not recorded) then phase 'full' (recorded via completeSongBlock).
 */
function SongPlayer({ block, session, song }: { block: SongBlock; session: SessionRecord; song: SongRecord }) {
  const navigate = useNavigate()
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [phase, setPhase] = useState<'loop' | 'full'>(block.loopBars ? 'loop' : 'full')
  const [outcome, setOutcome] = useState<BlockOutcome | null>(null)
  const [noScore, setNoScore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingFlag, setSavingFlag] = useState(false)
  const playerRef = useRef<PlayerHandle>(null)
  const levels = useMemo(() => generateLevels(song.chart), [song])
  const level = Math.max(0, Math.min(levels.length - 1, block.level))
  const audio = useMemo(() => songAudioBlob(song), [song])
  const demoBacking = useMemo(() => (song.source === 'demo' ? encodeWav(renderDemoBacking()) : null), [song])
  const chart = useMemo(() => ({ ...song.chart, duration: Math.max(song.chart.duration, song.duration) }), [song])

  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    setError(null)
    if (phase === 'loop') {
      setPhase('full')
      return
    }
    if (summary.total === 0) {
      setNoScore(true)
      return
    }
    setNoScore(false)
    setSavingFlag(true)
    completeSongBlock(sessionRef.current, block, song, result, getSettings())
      .then(setOutcome)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingFlag(false))
  }

  if (!audio) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="block-runner">
        <p>This song has no audio.</p>
        <Link to="/" className="underline">
          Back to Today
        </Link>
      </div>
    )
  }

  const loop = phase === 'loop' ? block.loopBars : undefined
  const saving = savingFlag
  let overlay: ReactNode
  if (error) {
    overlay = <ErrorCard message={error} />
  } else if (noScore) {
    overlay = (
      <NoScoreCard
        onRetry={() => {
          setNoScore(false)
          playerRef.current?.restart()
          playerRef.current?.start()
        }}
      />
    )
  } else if (outcome) {
    const best = outcome.songItem?.bestAccuracy ?? null
    const weak = outcome.songItem?.weakBars ?? []
    overlay = (
      <Overlay testId="block-result">
        <h2 className="text-lg font-semibold">
          {song.title} · Level {level + 1}
        </h2>
        <div className="mt-1 text-5xl font-bold tabular-nums">{pct(outcome.performance.acc)}%</div>
        <div className="text-sm text-muted">accuracy</div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Best" value={best === null ? '—' : `${pct(best)}%`} />
          <Stat label="Weak bars" value={weak.length ? weak.map((b) => b + 1).join(', ') : 'none'} />
        </dl>
        <NavButtons session={outcome.session} blockId={block.id} />
      </Overlay>
    )
  } else {
    overlay = saving ? (
      <Overlay testId="saving">
        <p className="text-sm text-muted">Saving…</p>
      </Overlay>
    ) : null
  }

  const loopLabel = block.loopBars ? `Loop bars ${block.loopBars[0] + 1}–${block.loopBars[1] + 1}` : ''
  return (
    <div data-testid="block-runner">
      <Player
        ref={playerRef}
        mode="song"
        title={song.title}
        subtitle={phase === 'loop' ? loopLabel : `Level ${level + 1}${block.speed < 1 ? ` · ${Math.round(block.speed * 100)}% speed` : ''}`}
        chart={chart}
        notes={levels[level].notes}
        audio={demoBacking ?? audio}
        guideAudio={demoBacking ? audio : null}
        speed={block.speed}
        playedTempo={song.bpm * block.speed}
        targetTempo={song.bpm}
        loopBars={loop}
        loopCount={2}
        resetKey={phase}
        readyHint={
          phase === 'loop'
            ? `${loopLabel} · played twice. Then the whole song.`
            : block.loopBars
              ? 'Loop done. Now play the whole song through.'
              : undefined
        }
        headerControls={<Badge tone="accent">{phase === 'loop' ? 'Loop' : block.loopBars ? 'Full pass' : 'Song'}</Badge>}
        onExit={() => navigate('/')}
        onFinished={onFinished}
        resultsOverlay={phase === 'full' ? overlay : null}
      />
    </div>
  )
}

function TestRedirect({ test }: { test: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(`/test/${test}`, { replace: true })
  }, [navigate, test])
  return <div className="flex h-full items-center justify-center text-muted">Opening skill check…</div>
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="block-runner">
      <p>{message}</p>
      <Link to="/" className="underline">
        Back to Today
      </Link>
    </div>
  )
}

/** Route component for /today/block/:blockId. */
export function BlockRunner() {
  const { blockId } = useParams()
  const session = useTodaySession(useMemo(() => localDateString(new Date()), []))
  // The block is frozen at first sight so live session updates (adapted plans) never regenerate the exercise mid-run.
  const frozen = useRef<{ id: string; block: Block } | null>(null)
  if (session !== 'loading' && session !== null) {
    const found = session.plan.blocks.find((b) => b.id === blockId)
    if (found && frozen.current?.id !== blockId) frozen.current = { id: found.id, block: found }
  }
  if (session === 'loading') return <div className="flex h-full items-center justify-center text-muted">Loading…</div>
  const hold = frozen.current
  const block = hold && hold.id === blockId ? hold.block : undefined
  if (!session || !block) return <NotFound message="This block is not in today's plan" />
  if (block.status === 'done' || block.status === 'skipped') {
    return <NotFound message={`This block is already ${block.status}.`} />
  }
  if (block.kind === 'test') return <TestRedirect test={block.test} />
  if (block.kind === 'song') return <SongRunner key={block.id} block={block} session={session} />
  return <ExerciseRunner key={block.id} block={block} session={session} />
}
