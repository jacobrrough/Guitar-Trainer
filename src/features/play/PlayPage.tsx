import { Repeat, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { LEVELS, distinctLevels, generateLevels, suggestedLevel } from '../../chart/difficulty'
import { chartBpm } from '../../chart/types'
import { Button, Select, cx } from '../../components/ui'
import { recordResult, type SongRecord } from '../../db/db'
import { useSong } from '../../db/useSongs'
import { tuningLabel } from '../../music/tunings'
import { getSettings, useSettings } from '../../app/settings'
import { songPlayback } from '../../songs/playback'
import { NotCountedCard } from './NotCountedCard'
import { runVerdict, type RunVerdict } from './runVerdict'
import { useHeld } from './useHeld'
import { recordSongPlay } from '../../training/coach'
import { instrumentOf } from '../../training/instruments'
import type { AttemptResult } from '../../training/types'
import { Player, type PlayerHandle } from './Player'
import type { ScoreSummary } from './scoring'
import { LOOP_PASS_OPTIONS, barCount, clampRange, loopHint, loopOutcome, weakestRange } from './sectionLoop'

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

function stars(accuracy: number): number {
  return accuracy >= 0.95 ? 3 : accuracy >= 0.8 ? 2 : accuracy >= 0.6 ? 1 : 0
}

function LevelPicker({
  levelIdx,
  counts,
  offered,
  disabled,
  onPick,
  compact,
}: {
  levelIdx: number | null
  counts: number[] | null
  /** Indexes of the levels to offer: a short tune has fewer different levels than six. */
  offered: number[]
  disabled: boolean
  onPick: (idx: number) => void
  compact?: boolean
}) {
  return (
    <div className={cx('flex items-center gap-1', compact && 'flex-1 justify-between')} role="group" aria-label="Difficulty level">
      {LEVELS.map((l, i) => (offered.includes(i) || levelIdx === i) && (
        <button
          key={l.level}
          type="button"
          disabled={disabled}
          onClick={() => onPick(i)}
          title={counts ? `${counts[i]} notes` : ''}
          className={cx(
            'h-9 rounded-md text-sm font-semibold transition-colors disabled:opacity-50',
            compact ? 'min-w-8 px-1.5' : 'min-w-9 px-2',
            levelIdx === i ? 'bg-accent text-slate-950' : 'bg-panel-2 text-slate-200 hover:bg-line',
          )}
          data-testid={`level-${l.level}`}
        >
          {l.level === 6 ? 'Full' : l.level}
        </button>
      ))}
    </div>
  )
}

export function ResultsOverlay({
  summary,
  levelIndex,
  up,
  down,
  onRetry,
  onLevel,
  loop,
}: {
  summary: ScoreSummary
  levelIndex: number
  /** The next level up and down that really differ from this one (null: there is none). */
  up: number | null
  down: number | null
  onRetry: () => void
  onLevel: (idx: number) => void
  /** Section-loop run: shows the auto-step message and a "Go again" primary button. */
  loop?: { message: string; onAgain: () => void }
}) {
  const s = stars(summary.accuracy)
  const canUp = up !== null
  const canDown = down !== null
  const simple = useSettings().simpleFeedback
  const hit = summary.perfects + summary.goods
  const suggestion = summary.accuracy >= 0.9 && canUp ? 'up' : summary.accuracy < 0.6 && canDown ? 'down' : null
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4" data-testid="results">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">
        <div className="mb-2 text-4xl tracking-widest text-accent" aria-label={`${s} of 3 stars`}>
          {'★'.repeat(s)}
          <span className="text-line">{'★'.repeat(3 - s)}</span>
        </div>
        <div className="text-5xl font-bold tabular-nums">{summary.score.toLocaleString()}</div>
        <div className="mt-1 text-sm text-muted">
          {simple && summary.judged > 0
            ? `${LEVELS[levelIndex].label} · ${hit} of ${summary.judged} notes`
            : `${LEVELS[levelIndex].label} · ${Math.round(summary.accuracy * 100)}% accuracy`}
        </div>
        {simple && (
          <details className="mt-1 text-xs text-muted">
            <summary className="cursor-pointer">Details</summary>
            <span>{Math.round(summary.accuracy * 100)}% accuracy</span>
          </details>
        )}
        <dl className="mt-5 grid grid-cols-4 gap-2 text-sm">
          {[
            ['Perfect', summary.perfects, 'text-green-300'],
            ['Good', summary.goods, 'text-amber-200'],
            ['Missed', summary.misses, 'text-red-300'],
            ['Best streak', summary.maxStreak, 'text-slate-100'],
          ].map(([label, value, color]) => (
            <div key={label as string} className="rounded-lg bg-panel-2 p-2">
              <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
              <dd className={cx('text-xl font-semibold tabular-nums', color as string)}>{value as number}</dd>
            </div>
          ))}
        </dl>
        {loop && <p className="mt-4 text-sm font-medium text-accent">{loop.message}</p>}
        {!loop && suggestion === 'up' && up !== null && <p className="mt-4 text-sm text-green-200">Great run! You are ready for {LEVELS[up].label}.</p>}
        {!loop && suggestion === 'down' && down !== null && <p className="mt-4 text-sm text-amber-200">Tough one. Try {LEVELS[down].label} or slow the song down.</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {loop ? (
            <Button variant="primary" onClick={loop.onAgain} data-testid="loop-again">
              <RotateCcw className="h-4 w-4" /> Go again
            </Button>
          ) : (
            <Button variant="primary" onClick={onRetry}>
              <RotateCcw className="h-4 w-4" /> Play again
            </Button>
          )}
          {up !== null && (
            <Button onClick={() => onLevel(up)} variant={!loop && suggestion === 'up' ? 'primary' : 'secondary'}>
              Level up
            </Button>
          )}
          {down !== null && <Button onClick={() => onLevel(down)}>Easier</Button>}
          <Link to="/songs">
            <Button variant="ghost">Songs</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

/**
 * The page of a stored song (`/play/:songId`). A song to sing is stored in the same table, but it has
 * no guitar part and no audio of its own, so it goes to its own page before anything here reads its chart.
 */
export function PlayPage() {
  const { songId } = useParams()
  const id = Number(songId)
  const songQuery = useSong(Number.isFinite(id) ? id : null)
  if (songQuery !== 'loading' && songQuery && instrumentOf(songQuery) === 'voice') return <Navigate to={`/sing/${songQuery.id}`} replace />
  return <GuitarPlayPage songQuery={songQuery} />
}

/** Song play-along: level and speed controls around the shared Player engine. */
function GuitarPlayPage({ songQuery }: { songQuery: SongRecord | null | 'loading' }) {
  const navigate = useNavigate()
  const [inRun, setInRun] = useState(false)
  // The record is a live query: while a run is in progress keep the one it started with, so a
  // background update (a re-rendered sound, a corrected chart) cannot restart the score mid-song.
  const song: SongRecord | null = useHeld(songQuery === 'loading' ? null : songQuery, inRun)
  const levels = useMemo(() => (song ? generateLevels(song.chart) : null), [song])
  const offered = useMemo(() => (levels ? distinctLevels(levels) : LEVELS.map((_, i) => i)), [levels])
  // The app's own songs store the guitar part itself; while the microphone scores only their click track plays (see songPlayback).
  const playback = useMemo(() => (song ? songPlayback(song) : null), [song])
  const audio = playback?.audio ?? null
  const chart = useMemo(() => (song ? { ...song.chart, duration: Math.max(song.chart.duration, song.duration) } : null), [song])
  const [levelIdx, setLevelIdx] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ScoreSummary | null>(null)
  const [verdict, setVerdict] = useState<RunVerdict>('counted')
  const [resetKey, setResetKey] = useState(0)
  const [loopOn, setLoopOn] = useState(false)
  const [loopRange, setLoopRange] = useState<[number, number]>([0, 3])
  const [passes, setPasses] = useState(2)
  const [autoStep, setAutoStep] = useState(false)
  const [lastPerBar, setLastPerBar] = useState<number[] | null>(null)
  const [loopNext, setLoopNext] = useState<{ message: string; nextSpeed: number } | null>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const startAfterReset = useRef(false)
  const songRef = useRef(song)
  songRef.current = song

  useEffect(() => {
    if (song && levelIdx === null) {
      setLevelIdx((song.lastLevel ?? suggestedLevel(song.chart)) - 1)
      setSpeed(song.lastSpeed || 1)
    }
  }, [song, levelIdx])

  // After a "Go again" reset the Player has re-initialised (child effects run first), so start now.
  useEffect(() => {
    if (startAfterReset.current) {
      startAfterReset.current = false
      playerRef.current?.start()
    }
  }, [resetKey])

  const onFinished = useCallback(
    (summary: ScoreSummary, result: AttemptResult) => {
      const counts = runVerdict(summary, result)
      setVerdict(counts)
      setResults(summary)
      // A run the app could not hear, or one where it heard its own guitar part, is neither shown as a score nor saved.
      if (counts !== 'counted') return
      if (result.perBar) setLastPerBar(result.perBar)
      if (loopOn) {
        // A partial-song pass: show the loop message but never record it.
        setLoopNext(loopOutcome(summary.accuracy, speed, autoStep))
        return
      }
      const s = songRef.current
      if (s && levelIdx !== null) {
        void recordSongPlay(s, levelIdx, result, getSettings()).catch(() => {})
        void recordResult(s.id, {
          level: LEVELS[levelIdx].level,
          score: summary.score,
          accuracy: summary.accuracy,
          maxStreak: summary.maxStreak,
          perfects: summary.perfects,
          goods: summary.goods,
          misses: summary.misses,
          speed,
          date: Date.now(),
        })
      }
    },
    [levelIdx, speed, loopOn, autoStep],
  )

  const pickLevel = (idx: number) => {
    setLevelIdx(idx)
    setResults(null)
    setResetKey((k) => k + 1)
  }

  if (songQuery === 'loading') return <div className="flex h-full items-center justify-center text-muted">Loading…</div>
  if (!song || !levels || !audio || !chart) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <p>This song is not in your library.</p>
        <Link to="/songs" className="underline">
          Back to songs
        </Link>
      </div>
    )
  }
  const bars = barCount(chart)
  const range = clampRange(loopRange, bars)
  const weak = lastPerBar ? weakestRange(lastPerBar) : null
  const goAgain = () => {
    if (loopNext) setSpeed(loopNext.nextSpeed)
    setResults(null)
    startAfterReset.current = true
    setResetKey((k) => k + 1)
  }
  const playAgain = () => {
    setResults(null)
    playerRef.current?.restart()
    playerRef.current?.start()
  }
  const li = levelIdx ?? suggestedLevel(song.chart) - 1
  const counts = levels.map((l) => l.notes.length)
  const speedSelect = (
    <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={busy} aria-label="Playback speed" className="h-9 py-0">
      {SPEEDS.map((s) => (
        <option key={s} value={s}>
          {Math.round(s * 100)}%
        </option>
      ))}
    </Select>
  )

  const barOptions = Array.from({ length: bars }, (_, i) => (
    <option key={i} value={i}>
      {i + 1}
    </option>
  ))
  // Phones get an icon-only toggle so the level row never grows wider than the screen.
  const loopToggle = (compact = false) => (
    <Button
      size="sm"
      variant={loopOn ? 'primary' : 'secondary'}
      aria-pressed={loopOn}
      aria-label="Loop"
      disabled={busy}
      onClick={() => setLoopOn((v) => !v)}
      data-testid="loop-toggle"
      title="Practice a section on repeat"
      className="shrink-0"
    >
      <Repeat className="h-4 w-4" />
      {!compact && <span>Loop</span>}
    </Button>
  )
  const loopOptions = loopOn && (
    <>
      <label className="flex items-center gap-1 text-xs text-muted">
        From
        <Select
          value={range[0]}
          onChange={(e) => setLoopRange(clampRange([Number(e.target.value), Math.max(range[1], Number(e.target.value))], bars))}
          disabled={busy}
          aria-label="Loop from bar"
          className="h-8 px-2 py-0"
          data-testid="loop-from"
        >
          {barOptions}
        </Select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">
        To
        <Select
          value={range[1]}
          onChange={(e) => setLoopRange(clampRange([Math.min(range[0], Number(e.target.value)), Number(e.target.value)], bars))}
          disabled={busy}
          aria-label="Loop to bar"
          className="h-8 px-2 py-0"
          data-testid="loop-to"
        >
          {barOptions}
        </Select>
      </label>
      <Select
        value={passes}
        onChange={(e) => setPasses(Number(e.target.value))}
        disabled={busy}
        aria-label="Passes"
        title="Passes"
        className="h-8 px-2 py-0"
        data-testid="loop-passes"
      >
        {LOOP_PASS_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}×
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant={autoStep ? 'primary' : 'secondary'}
        aria-pressed={autoStep}
        disabled={busy}
        onClick={() => setAutoStep((v) => !v)}
        data-testid="loop-auto"
        title="Speed up after a clean pass, slow down after a rough one"
      >
        Auto-step
      </Button>
      <Button
        size="sm"
        disabled={busy || !weak}
        onClick={() => weak && setLoopRange(weak)}
        data-testid="loop-weakest"
        title={weak ? 'Loop the bars you missed most' : 'Play the song once to find your weakest bars'}
      >
        Weakest bars
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLoopOn(false)}>
        Whole song
      </Button>
    </>
  )

  return (
    <Player
      ref={playerRef}
      title={song.title}
      subtitle={`${song.artist || 'Unknown artist'} · ${tuningLabel(chart.tuning)}${chart.capo ? ` · capo ${chart.capo}` : ''} · ${Math.round(chartBpm(chart))} bpm`}
      chart={chart}
      notes={levels[li].notes}
      audio={audio}
      guideAudio={playback?.guide ?? null}
      backingIsClick={playback?.clickOnly ?? false}
      mode="song"
      speed={speed}
      playedTempo={chartBpm(chart) * speed}
      targetTempo={chartBpm(chart)}
      resetKey={resetKey}
      loopBars={loopOn ? range : undefined}
      loopCount={passes}
      readyHint={loopOn ? loopHint(range, passes, speed) : `${LEVELS[li].label} · ${counts[li]} notes · ${Math.round(speed * 100)}% speed`}
      headerControls={
        <>
          <LevelPicker levelIdx={li} counts={counts} offered={offered} disabled={busy} onPick={pickLevel} />
          {speedSelect}
          {loopToggle()}
          {loopOptions}
        </>
      }
      mobileControls={
        <div className="flex w-full min-w-0 flex-col gap-1.5 short-landscape:gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <LevelPicker levelIdx={li} counts={counts} offered={offered} disabled={busy} onPick={pickLevel} compact />
            {speedSelect}
            {loopToggle(true)}
          </div>
          {loopOn && <div className="flex flex-wrap items-center gap-1.5">{loopOptions}</div>}
        </div>
      }
      resultsOverlay={
        results && verdict !== 'counted' ? (
          <NotCountedCard verdict={verdict} onRetry={playAgain}>
            <Link to="/songs">
              <Button variant="ghost">Songs</Button>
            </Link>
          </NotCountedCard>
        ) : results ? (
          <ResultsOverlay
            summary={results}
            levelIndex={li}
            up={offered.find((i) => i > li) ?? null}
            down={[...offered].reverse().find((i) => i < li) ?? null}
            onRetry={playAgain}
            onLevel={pickLevel}
            loop={loopOn && loopNext ? { message: loopNext.message, onAgain: goAgain } : undefined}
          />
        ) : null
      }
      onExit={() => navigate('/songs')}
      onFinished={onFinished}
      onPhaseChange={(p) => {
        setBusy(p === 'playing' || p === 'countin')
        setInRun(p === 'playing' || p === 'countin' || p === 'paused')
        if (p !== 'finished') setResults(null)
      }}
    />
  )
}
