import { RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LEVELS, generateLevels, suggestedLevel } from '../../chart/difficulty'
import { chartBpm } from '../../chart/types'
import { Button, Select, cx } from '../../components/ui'
import { recordResult, songAudioBlob, type SongRecord } from '../../db/db'
import { useSong } from '../../db/useSongs'
import { tuningLabel } from '../../music/tunings'
import { getSettings } from '../../app/settings'
import { recordSongPlay } from '../../training/coach'
import type { AttemptResult } from '../../training/types'
import { Player, type PlayerHandle } from './Player'
import type { ScoreSummary } from './scoring'

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

function stars(accuracy: number): number {
  return accuracy >= 0.95 ? 3 : accuracy >= 0.8 ? 2 : accuracy >= 0.6 ? 1 : 0
}

function LevelPicker({
  levelIdx,
  counts,
  disabled,
  onPick,
  compact,
}: {
  levelIdx: number | null
  counts: number[] | null
  disabled: boolean
  onPick: (idx: number) => void
  compact?: boolean
}) {
  return (
    <div className={cx('flex items-center gap-1', compact && 'flex-1 justify-between')} role="group" aria-label="Difficulty level">
      {LEVELS.map((l, i) => (
        <button
          key={l.level}
          type="button"
          disabled={disabled}
          onClick={() => onPick(i)}
          title={counts ? `${counts[i]} notes` : ''}
          className={cx(
            'h-9 min-w-9 rounded-md px-2 text-sm font-semibold transition-colors disabled:opacity-50',
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
  onRetry,
  onLevel,
}: {
  summary: ScoreSummary
  levelIndex: number
  onRetry: () => void
  onLevel: (idx: number) => void
}) {
  const s = stars(summary.accuracy)
  const canUp = levelIndex < LEVELS.length - 1
  const canDown = levelIndex > 0
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
          {LEVELS[levelIndex].label} · {Math.round(summary.accuracy * 100)}% accuracy
        </div>
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
        {suggestion === 'up' && <p className="mt-4 text-sm text-green-200">Great run! You are ready for {LEVELS[levelIndex + 1].label}.</p>}
        {suggestion === 'down' && <p className="mt-4 text-sm text-amber-200">Tough one. Try {LEVELS[levelIndex - 1].label} or slow the song down.</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" /> Play again
          </Button>
          {canUp && (
            <Button onClick={() => onLevel(levelIndex + 1)} variant={suggestion === 'up' ? 'primary' : 'secondary'}>
              Level up
            </Button>
          )}
          {canDown && <Button onClick={() => onLevel(levelIndex - 1)}>Easier</Button>}
          <Link to="/songs">
            <Button variant="ghost">Songs</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

/** Song play-along: level and speed controls around the shared Player engine. */
export function PlayPage() {
  const { songId } = useParams()
  const id = Number(songId)
  const navigate = useNavigate()
  const songQuery = useSong(Number.isFinite(id) ? id : null)
  const song: SongRecord | null = songQuery === 'loading' ? null : songQuery
  const levels = useMemo(() => (song ? generateLevels(song.chart) : null), [song])
  const audio = useMemo(() => (song ? songAudioBlob(song) : null), [song])
  const [levelIdx, setLevelIdx] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ScoreSummary | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const playerRef = useRef<PlayerHandle>(null)
  const songRef = useRef(song)
  songRef.current = song

  useEffect(() => {
    if (song && levelIdx === null) {
      setLevelIdx((song.lastLevel ?? suggestedLevel(song.chart)) - 1)
      setSpeed(song.lastSpeed || 1)
    }
  }, [song, levelIdx])

  const onFinished = useCallback(
    (summary: ScoreSummary, result: AttemptResult) => {
      setResults(summary)
      const s = songRef.current
      if (s && levelIdx !== null && summary.total > 0) {
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
    [levelIdx, speed],
  )

  const pickLevel = (idx: number) => {
    setLevelIdx(idx)
    setResults(null)
    setResetKey((k) => k + 1)
  }

  if (songQuery === 'loading') return <div className="flex h-full items-center justify-center text-muted">Loading…</div>
  if (!song || !levels || !audio) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <p>This song is not in your library.</p>
        <Link to="/songs" className="underline">
          Back to songs
        </Link>
      </div>
    )
  }
  const li = levelIdx ?? suggestedLevel(song.chart) - 1
  const counts = levels.map((l) => l.notes.length)
  const chart = { ...song.chart, duration: Math.max(song.chart.duration, song.duration) }
  const speedSelect = (
    <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={busy} aria-label="Playback speed" className="h-9 py-0">
      {SPEEDS.map((s) => (
        <option key={s} value={s}>
          {Math.round(s * 100)}%
        </option>
      ))}
    </Select>
  )

  return (
    <Player
      ref={playerRef}
      title={song.title}
      subtitle={`${song.artist || 'Unknown artist'} · ${tuningLabel(chart.tuning)}${chart.capo ? ` · capo ${chart.capo}` : ''} · ${Math.round(chartBpm(chart))} bpm`}
      chart={chart}
      notes={levels[li].notes}
      audio={audio}
      mode="song"
      speed={speed}
      playedTempo={chartBpm(chart) * speed}
      targetTempo={chartBpm(chart)}
      resetKey={resetKey}
      readyHint={`${LEVELS[li].label} · ${counts[li]} notes · ${Math.round(speed * 100)}% speed`}
      headerControls={
        <>
          <LevelPicker levelIdx={li} counts={counts} disabled={busy} onPick={pickLevel} />
          {speedSelect}
        </>
      }
      mobileControls={
        <>
          <LevelPicker levelIdx={li} counts={counts} disabled={busy} onPick={pickLevel} compact />
          {speedSelect}
        </>
      }
      resultsOverlay={
        results ? (
          <ResultsOverlay
            summary={results}
            levelIndex={li}
            onRetry={() => {
              setResults(null)
              playerRef.current?.restart()
              playerRef.current?.start()
            }}
            onLevel={pickLevel}
          />
        ) : null
      }
      onExit={() => navigate('/songs')}
      onFinished={onFinished}
      onPhaseChange={(p) => {
        setBusy(p === 'playing' || p === 'countin')
        if (p !== 'finished') setResults(null)
      }}
    />
  )
}
