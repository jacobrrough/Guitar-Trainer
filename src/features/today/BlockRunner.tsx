import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getSettings, useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { generateLevels } from '../../chart/difficulty'
import { Badge, Button } from '../../components/ui'
import { db, type SongRecord } from '../../db/db'
import { getTuning } from '../../music/tunings'
import {
  completeExerciseBlock,
  finishExerciseBlock,
  completeSongBlock,
  exerciseForBlock,
  nextPendingBlockId,
  recordExerciseRep,
  recordSongPlay,
  type BlockOutcome,
  type RepOutcome,
} from '../../training/coach'
import { masteryBand } from '../../training/learner'
import { SKILLS_BY_ID } from '../../training/skills'
import { localDateString } from '../../training/store'
import type { AttemptResult, Block, ExerciseBlock, SessionRecord, SongBlock } from '../../training/types'
import { useTodaySession } from '../../training/useTraining'
import { songPlayback } from '../../songs/playback'
import { useExerciseGuide } from '../play/useExerciseGuide'
import { NotCountedCard } from '../play/NotCountedCard'
import { Player, type PlayerHandle } from '../play/Player'
import { runVerdict, type RunVerdict } from '../play/runVerdict'
import { useHeld } from '../play/useHeld'
import { EarTrainer } from './EarTrainer'
import type { ScoreSummary } from '../play/scoring'
import { blockResultLine, hasPace, nextRoundText, scoreHint } from './repCard'
import { bandLabel, notesHitText, pct, reasonText, repSummaryText, simpleBandLabel, timingText, timingWords } from './todayUtils'

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
  const simple = settings.simpleFeedback
  const skill = SKILLS_BY_ID[block.skillId]
  const playerRef = useRef<PlayerHandle>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [tempo, setTempo] = useState(block.tempo)
  const [rep, setRep] = useState(1)
  const [repOutcome, setRepOutcome] = useState<RepOutcome | null>(null)
  const [repResult, setRepResult] = useState<AttemptResult | null>(null)
  const [blockOutcome, setBlockOutcome] = useState<BlockOutcome | null>(null)
  const [notCounted, setNotCounted] = useState<Exclude<RunVerdict, 'counted'> | null>(null)
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
  const { guide: guideAudio, ready: guideReady } = useExerciseGuide(exercise)
  // What the Player shows. While the next round's listening guide is being rendered the Player keeps
  // the round before on screen and stays mounted, so the microphone is not closed and reopened between
  // rounds and the next round starts on the same audio element the learner's tap unlocked.
  const live = useMemo(() => ({ exercise, audio, guideAudio, rep, tempo, ready: guideReady }), [exercise, audio, guideAudio, rep, tempo, guideReady])
  const shown = useHeld(live, !guideReady)

  // After "Next rep": once the new round is in the Player (it resets through resetKey, a child
  // effect, and its audio element takes the new source one render later), start it.
  useEffect(() => {
    if (!startNext.current) return
    startNext.current = false
    const t = setTimeout(() => playerRef.current?.start(), 250)
    return () => clearTimeout(t)
  }, [shown.rep])

  const isLast = rep >= block.reps

  const finalize = useCallback(
    async (result: AttemptResult) => {
      if (!exercise) return
      setError(null)
      setSavingFlag(true)
      try {
        const outcome = await completeExerciseBlock(sessionRef.current, { ...block, tempo }, exercise, result, getSettings())
        // The coach's own safety net: a run it refused to count leaves the block open, so say so instead of "done".
        if (outcome.counted === false) setNotCounted('bleed')
        else setBlockOutcome(outcome)
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
    // Not heard at all, or the app heard its own guitar part: nothing is recorded and the rep is played again.
    const verdict = runVerdict(summary, result)
    if (verdict !== 'counted') {
      setNotCounted(verdict)
      return
    }
    setNotCounted(null)
    if (isLast) {
      void finalize(result)
      return
    }
    setSavingFlag(true)
    recordExerciseRep(sessionRef.current, { ...block, tempo }, exercise, result, getSettings())
      .then((outcome) => (outcome.counted === false ? setNotCounted('bleed') : setRepOutcome(outcome)))
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
    setNotCounted(null)
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
  // Ear rounds are answered in the player's own time: their cards carry no timing or tempo lines.
  const paced = hasPace(exercise)
  let overlay: ReactNode
  if (error) {
    overlay = <ErrorCard message={error} onRetry={isLast && repResult ? () => void finalize(repResult) : undefined} />
  } else if (notCounted) {
    overlay = <NotCountedCard verdict={notCounted} onRetry={retry} />
  } else if (blockOutcome) {
    const after = blockOutcome.state?.rating ?? ratingBefore
    const res = blockOutcome.attempt
    const acc = blockOutcome.performance.acc
    const tip = acc < 0.5 ? 'Buzzing or muted notes? Press each string firmly just behind the metal bar (fret), close to it.' : (skill.tips[0] ?? '')
    const hint = scoreHint({ before: ratingBefore, after, accuracy: acc, tempo, targetTempo: skill.targetTempo, paced })
    const reasons = blockOutcome.performance.reasons
    const details = (
      <>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label={simple ? 'Skill score' : 'Rating'} value={`${Math.round(ratingBefore)} → ${Math.round(after)}`} />
          <Stat
            label={simple ? 'Level' : 'Level band'}
            value={
              simple
                ? `${simpleBandLabel(masteryBand(ratingBefore))} → ${simpleBandLabel(masteryBand(after))}`
                : `${bandLabel(masteryBand(ratingBefore))} → ${bandLabel(masteryBand(after))}`
            }
          />
        </dl>
        {simple && <p className="mt-2 text-xs text-muted">{blockResultLine(pct(acc), tempo, paced)}</p>}
        {hint && <p className="mt-2 text-xs text-muted" data-testid="score-hint">{hint}</p>}
        {!blockOutcome.performance.reliable && (
          <p className="mt-3 text-xs text-amber-200">
            {simple ? 'This result may be off: ' : 'Low-confidence result: '}
            {(simple ? reasons.map(reasonText) : reasons).join(', ') || 'limited evidence'}.
          </p>
        )}
      </>
    )
    overlay = (
      <Overlay testId="block-result">
        <h2 className="text-lg font-semibold">{skill.name} done</h2>
        {simple ? (
          <>
            <div className="mt-1 text-3xl font-bold">You hit {notesHitText(res)}</div>
            {tip && <p className="mt-3 text-sm text-slate-200">Tip: {tip}</p>}
            <details className="mt-4 text-left text-sm">
              <summary className="cursor-pointer text-center text-muted">Details</summary>
              {details}
            </details>
          </>
        ) : (
          <>
            <div className="mt-1 text-5xl font-bold tabular-nums">{pct(acc)}%</div>
            <div className="text-sm text-muted">{paced ? `accuracy · reached ${Math.round(tempo)} bpm` : 'accuracy'}</div>
            {details}
          </>
        )}
        <NavButtons session={blockOutcome.session} blockId={block.id} />
      </Overlay>
    )
  } else if (repOutcome && repResult) {
    overlay = (
      <Overlay testId="rep-card">
        <h2 className="text-lg font-semibold">
          {simple ? 'Round' : 'Rep'} {rep} of {block.reps}
        </h2>
        {simple ? (
          <>
            <div className="mt-1 text-3xl font-bold">You hit {notesHitText(repResult)}</div>
            {paced && <div className="mt-1 text-sm text-muted">Timing: {timingWords(repResult.timingMedianMs)}</div>}
            {paced && <p className="mt-3 text-sm text-slate-200">{nextRoundText(tempo, repOutcome.nextTempo)}</p>}
            <details className="mt-2 text-sm text-muted">
              <summary className="cursor-pointer">Details</summary>
              <div className="mt-1">{pct(repOutcome.performance.acc)}% accuracy · {repSummaryText(repResult)}</div>
              {paced && <div>{timingText(repResult.timingMedianMs)}</div>}
              {paced && <div>Next rep at {Math.round(repOutcome.nextTempo)} bpm</div>}
            </details>
          </>
        ) : (
          <>
            <div className="mt-1 text-5xl font-bold tabular-nums">{pct(repOutcome.performance.acc)}%</div>
            <div className="mt-1 text-sm text-muted">{repSummaryText(repResult)}</div>
            {paced && <div className="text-sm text-muted">{timingText(repResult.timingMedianMs)}</div>}
            {paced && <p className="mt-3 text-sm text-slate-200">Next rep at {Math.round(repOutcome.nextTempo)} bpm</p>}
          </>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={nextRep} data-testid="next-rep">
            {simple ? 'Next round' : 'Next rep'}
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
  // Only before the very first round: later rounds wait behind the Player (see `shown`).
  if (!shown.ready || !shown.exercise || !shown.audio) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 text-muted" data-testid="block-runner">
        <p>Getting your exercise ready…</p>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    )
  }

  return (
    <div data-testid="block-runner">
      <Player
        ref={playerRef}
        mode="exercise"
        title={skill.name}
        subtitle={`${shown.exercise.title} · ${simple ? 'round' : 'rep'} ${shown.rep}/${block.reps}`}
        chart={shown.exercise.chart}
        notes={shown.exercise.chart.notes}
        audio={shown.audio}
        guideAudio={shown.guideAudio}
        backingIsClick
        playedTempo={shown.tempo}
        targetTempo={block.tempo}
        readyHint={shown.exercise.instructions}
        resetKey={`${shown.rep}-${shown.tempo}`}
        headerControls={<Badge tone="accent">{simple ? `Round ${shown.rep} of ${block.reps}` : `Rep ${shown.rep}/${block.reps} · ${Math.round(shown.tempo)} bpm`}</Badge>}
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
function SongPlayer({ block, session, song: liveSong }: { block: SongBlock; session: SessionRecord; song: SongRecord }) {
  const navigate = useNavigate()
  const [inRun, setInRun] = useState(false)
  // The record comes from a live query: a background update must not swap chart and audio under a run in progress.
  const song = useHeld(liveSong, inRun)
  const simple = useSettings().simpleFeedback
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [phase, setPhase] = useState<'loop' | 'full'>(block.loopBars ? 'loop' : 'full')
  const [outcome, setOutcome] = useState<BlockOutcome | null>(null)
  const [notCounted, setNotCounted] = useState<Exclude<RunVerdict, 'counted'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingFlag, setSavingFlag] = useState(false)
  // How many times the plan asks for the song, and which time this is.
  const passes = Math.max(1, Math.min(3, Math.round(block.passes ?? 1)))
  const [pass, setPass] = useState(1)
  const [between, setBetween] = useState<{ pass: number; attempt: AttemptResult } | null>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const levels = useMemo(() => generateLevels(song.chart), [song])
  const level = Math.max(0, Math.min(levels.length - 1, block.level))
  const playback = useMemo(() => songPlayback(song), [song])
  const audio = playback.audio
  const chart = useMemo(() => ({ ...song.chart, duration: Math.max(song.chart.duration, song.duration) }), [song])

  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    setError(null)
    if (phase === 'loop') {
      setPhase('full')
      return
    }
    // Not heard at all, or the app heard its own guitar part: nothing is recorded and the rep is played again.
    const verdict = runVerdict(summary, result)
    if (verdict !== 'counted') {
      setNotCounted(verdict)
      return
    }
    setNotCounted(null)
    setSavingFlag(true)
    // The plan may ask for the song more than once (it fills the block's minutes): every pass before
    // the last is saved as a play of the song, the last one finishes the block.
    if (pass < passes) {
      recordSongPlay(song, block.level, result, getSettings(), Date.now(), sessionRef.current.id)
        .then((played) => (played.counted === false ? setNotCounted('bleed') : setBetween({ pass, attempt: played.attempt })))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSavingFlag(false))
      return
    }
    completeSongBlock(sessionRef.current, block, song, result, getSettings())
      .then((done) => (done.counted === false ? setNotCounted('bleed') : setOutcome(done)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingFlag(false))
  }
  const nextPass = () => {
    setBetween(null)
    setPass((p) => p + 1)
    playerRef.current?.restart()
    playerRef.current?.start()
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
  } else if (notCounted) {
    overlay = (
      <NotCountedCard
        verdict={notCounted}
        onRetry={() => {
          setNotCounted(null)
          playerRef.current?.restart()
          playerRef.current?.start()
        }}
      />
    )
  } else if (between) {
    overlay = (
      <Overlay testId="song-pass">
        <h2 className="text-lg font-semibold">
          Time {between.pass} of {passes}
        </h2>
        <div className="mt-1 text-3xl font-bold">You hit {notesHitText(between.attempt)}</div>
        <p className="mt-2 text-sm text-muted">Take a breath, then play it once more.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="primary" onClick={nextPass} data-testid="song-pass-next">
            Play it again
          </Button>
        </div>
      </Overlay>
    )
  } else if (outcome) {
    const best = outcome.songItem?.bestAccuracy ?? null
    const weak = outcome.songItem?.weakBars ?? []
    overlay = (
      <Overlay testId="block-result">
        <h2 className="text-lg font-semibold">
          {song.title} · Level {level + 1}
        </h2>
        {simple ? (
          <>
            <div className="mt-1 text-3xl font-bold">You hit {notesHitText(outcome.attempt)}</div>
            <div className="text-sm text-muted">{pct(outcome.performance.acc)}% accuracy</div>
          </>
        ) : (
          <>
            <div className="mt-1 text-5xl font-bold tabular-nums">{pct(outcome.performance.acc)}%</div>
            <div className="text-sm text-muted">accuracy</div>
          </>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Best" value={best === null ? '—' : `${pct(best)}%`} />
          <Stat label={simple ? "Bars to practise" : "Weak bars"} value={weak.length ? weak.map((b) => b + 1).join(', ') : 'none'} />
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
        subtitle={phase === 'loop' ? loopLabel : `Level ${level + 1}${block.speed < 1 ? ` · ${Math.round(block.speed * 100)}% speed` : ''}${passes > 1 ? ` · time ${pass} of ${passes}` : ''}`}
        chart={chart}
        notes={levels[level].notes}
        audio={audio}
        guideAudio={playback.guide}
        backingIsClick={playback.clickOnly}
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
        onPhaseChange={(p) => setInRun(p === 'playing' || p === 'countin' || p === 'paused')}
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
