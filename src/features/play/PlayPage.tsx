import { ArrowLeft, Mic, MicOff, Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { updateSettings, useSettings } from '../../app/settings'
import { useWakeLock } from '../../app/useWakeLock'
import { audioEngine } from '../../audio/AudioEngine'
import { playClick } from '../../audio/metronome/Metronome'
import { LEVELS, generateLevels, suggestedLevel } from '../../chart/difficulty'
import { chartBpm } from '../../chart/types'
import { Button, Select, cx, formatTime } from '../../components/ui'
import { recordResult, songAudioBlob, type SongRecord } from '../../db/db'
import { useSong } from '../../db/useSongs'
import { tuningLabel } from '../../music/tunings'
import { HighwayRenderer } from './Highway'
import { PlaybackClock } from './PlaybackClock'
import { PitchSmoother } from './pitchTracker'
import { ScoreTracker, type ScoreSummary } from './scoring'

type Phase = 'ready' | 'countin' | 'playing' | 'paused' | 'finished'
const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1]

function stars(accuracy: number): number {
  return accuracy >= 0.95 ? 3 : accuracy >= 0.8 ? 2 : accuracy >= 0.6 ? 1 : 0
}

/**
 * iOS Safari only lets a media element start from a user gesture, and our
 * count-in defers the real play() by a few seconds. Playing muted for an
 * instant inside the tap marks the element as user-activated so the later
 * programmatic play() is allowed.
 */
function primeMediaElement(el: HTMLMediaElement, primed: RefObject<boolean>, playbackStarted: RefObject<boolean>): void {
  if (primed.current) return
  const wasMuted = el.muted
  el.muted = true
  const finish = () => {
    primed.current = true
    if (playbackStarted.current) return
    el.pause()
    try {
      if (el.currentTime > 0 && el.currentTime < 0.5) el.currentTime = 0
    } catch {
      /* not seekable yet */
    }
    el.muted = wasMuted
  }
  let promise: Promise<void> | undefined
  try {
    promise = el.play()
  } catch {
    el.muted = wasMuted
    return
  }
  if (promise && typeof promise.then === 'function') {
    promise.then(finish).catch(() => {
      if (!playbackStarted.current) el.muted = wasMuted
    })
  } else {
    finish()
  }
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

function ResultsOverlay({
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
          <Link to="/">
            <Button variant="ghost">Songs</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

export function PlayPage() {
  const { songId } = useParams()
  const id = Number(songId)
  const navigate = useNavigate()
  const settings = useSettings()
  const songQuery = useSong(Number.isFinite(id) ? id : null)
  const song: SongRecord | null = songQuery === 'loading' ? null : songQuery
  const songRef = useRef<SongRecord | null>(null)
  songRef.current = song

  const levels = useMemo(() => (song ? generateLevels(song.chart) : null), [song])
  const [levelIdx, setLevelIdx] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)
  const [phase, setPhase] = useState<Phase>('ready')
  const [micStatus, setMicStatus] = useState<'off' | 'on' | 'error'>(audioEngine.micActive ? 'on' : 'off')
  const [micError, setMicError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [results, setResults] = useState<ScoreSummary | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [portraitPhone, setPortraitPhone] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<HighwayRenderer | null>(null)
  const clockRef = useRef<PlaybackClock | null>(null)
  const trackerRef = useRef<ScoreTracker | null>(null)
  const smootherRef = useRef(new PitchSmoother())
  const detectedRef = useRef<{ midi: number | null; matches: boolean }>({ midi: null, matches: false })
  const judgementRef = useRef<{ text: string; at: number } | null>(null)
  const mediaPrimedRef = useRef(false)
  const playbackStartedRef = useRef(false)
  const skipCountInRef = useRef(false)
  const phaseRef = useRef<Phase>('ready')
  const settingsRef = useRef(settings)
  const speedRef = useRef(speed)
  const levelsRef = useRef(levels)
  const levelIdxRef = useRef(levelIdx)
  phaseRef.current = phase
  settingsRef.current = settings
  speedRef.current = speed
  levelsRef.current = levels
  levelIdxRef.current = levelIdx

  useWakeLock(phase === 'playing' || phase === 'countin')

  // Initial level & speed from the song's history.
  useEffect(() => {
    if (song && levelIdx === null) {
      setLevelIdx((song.lastLevel ?? suggestedLevel(song.chart)) - 1)
      setSpeed(song.lastSpeed || 1)
    }
  }, [song, levelIdx])

  // Audio source.
  const songKey = song?.id ?? null
  useEffect(() => {
    const s = songRef.current
    if (!s) return
    const blob = songAudioBlob(s)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setAudioUrl(url)
    mediaPrimedRef.current = false
    return () => URL.revokeObjectURL(url)
  }, [songKey])

  // Score tracker follows the level and speed.
  useEffect(() => {
    if (!levels || levelIdx === null) return
    const tracker = new ScoreTracker(levels[levelIdx].notes, { octaveTolerance: settingsRef.current.octaveTolerance })
    tracker.setSpeed(speed)
    const el = audioRef.current
    if (el && el.currentTime > 0.05) tracker.seek(el.currentTime - settingsRef.current.latencyMs / 1000)
    trackerRef.current = tracker
  }, [levels, levelIdx, speed])

  // Canvas renderer. The canvas mounts only once the song has loaded, so a
  // callback ref (not a mount effect) attaches the renderer to it.
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    canvasRef.current = canvas
    if (!canvas) {
      rendererRef.current = null
      return
    }
    const renderer = new HighwayRenderer(canvas)
    rendererRef.current = renderer
    renderer.resize()
    const ro = new ResizeObserver(() => renderer.resize())
    ro.observe(canvas)
    resizeObserverRef.current = ro
  }, [])

  // Orientation hint for phones.
  useEffect(() => {
    const update = () => setPortraitPhone(window.innerWidth < 640 && window.innerHeight > window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const finish = useCallback(async () => {
    if (phaseRef.current === 'finished') return
    audioRef.current?.pause()
    setPhase('finished')
    const tracker = trackerRef.current
    const s = songRef.current
    const li = levelIdxRef.current
    if (!tracker || !s || li === null) return
    tracker.advance(Number.POSITIVE_INFINITY)
    const summary = tracker.summary()
    setResults(summary)
    if (summary.total > 0) {
      await recordResult(s.id, {
        level: LEVELS[li].level,
        score: summary.score,
        accuracy: summary.accuracy,
        maxStreak: summary.maxStreak,
        perfects: summary.perfects,
        goods: summary.goods,
        misses: summary.misses,
        speed: speedRef.current,
        date: Date.now(),
      })
    }
  }, [])
  const finishRef = useRef(finish)
  finishRef.current = finish

  // Render loop.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const el = audioRef.current
      const renderer = rendererRef.current
      const tracker = trackerRef.current
      const s = songRef.current
      const lv = levelsRef.current
      const li = levelIdxRef.current
      if (!el || !renderer || !tracker || !s || !lv || li === null) return
      const clock = (clockRef.current ??= new PlaybackClock(el))
      const t = clock.time
      const st = settingsRef.current
      const playing = phaseRef.current === 'playing'
      if (playing) {
        const missed = tracker.advance(t - st.latencyMs / 1000)
        if (missed.length) judgementRef.current = { text: 'Miss', at: t }
      }
      // Narrow screens show less look-ahead so notes stay readable.
      const widthFactor = Math.min(1, Math.max(0.45, renderer.width / 900))
      renderer.draw({
        songTime: t,
        duration: Math.max(s.chart.duration, s.duration),
        notes: lv[li].notes,
        statusOf: (noteId) => tracker.stateOfNote(noteId),
        beats: s.chart.beats,
        tuning: s.chart.tuning,
        capo: s.chart.capo,
        detectedMidi: detectedRef.current.midi,
        detectedMatches: detectedRef.current.matches,
        hud: tracker.summary(),
        lastJudgement: judgementRef.current,
        visibleSeconds: st.visibleSeconds * speedRef.current * widthFactor,
        showNoteNames: st.showNoteNames,
        paused: phaseRef.current === 'paused',
      })
      if (playing && (el.ended || t >= Math.max(s.chart.duration, s.duration) + 0.5)) void finishRef.current()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Pitch frames → scoring.
  useEffect(
    () =>
      audioEngine.subscribe((frame) => {
        const st = settingsRef.current
        const { midi, isAttack } = smootherRef.current.push(frame, st.clarityThreshold, st.a4)
        detectedRef.current.midi = midi
        const tracker = trackerRef.current
        const el = audioRef.current
        if (midi === null) tracker?.release()
        if (midi === null || !tracker || !el || phaseRef.current !== 'playing') {
          detectedRef.current.matches = false
          return
        }
        const now = clockRef.current?.time ?? el.currentTime
        const t = now - st.latencyMs / 1000
        const hit = tracker.onPitch(midi, t, isAttack)
        if (hit) {
          judgementRef.current = { text: hit.judgement === 'perfect' ? 'Perfect!' : 'Good', at: now }
          detectedRef.current.matches = true
        } else {
          detectedRef.current.matches = tracker.isUpcomingPitch(midi, t)
        }
      }),
    [],
  )

  // Progress readout for the scrubber.
  useEffect(() => {
    const timer = setInterval(() => {
      const el = audioRef.current
      if (el) setProgress(el.currentTime)
    }, 250)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => () => audioEngine.stopMic(), [])

  const startMic = useCallback(async () => {
    try {
      const st = settingsRef.current
      await audioEngine.startMic({ deviceId: st.inputDeviceId || undefined, threshold: 0.9, echoCancellation: st.echoCancellation })
      setMicStatus('on')
      setMicError(null)
    } catch (err) {
      setMicStatus('error')
      setMicError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const start = useCallback(async () => {
    const el = audioRef.current
    const s = songRef.current
    if (!el || !s || phaseRef.current === 'countin' || phaseRef.current === 'playing') return
    // Spend the user gesture synchronously on unlocking audio (required on iOS).
    audioEngine.unlock()
    primeMediaElement(el, mediaPrimedRef, playbackStartedRef)
    setNotice(null)
    if (!audioEngine.micActive && micStatus !== 'error') await startMic()
    await audioEngine.resume()
    el.playbackRate = speedRef.current
    el.preservesPitch = true
    if (el.currentTime < 0.05 && !skipCountInRef.current) {
      setPhase('countin')
      const ctx = audioEngine.context
      const interval = 60 / chartBpm(s.chart) / speedRef.current
      const beats = 4
      const t0 = ctx.currentTime + 0.15
      for (let i = 0; i < beats; i++) {
        playClick(ctx, ctx.destination, t0 + i * interval, i === 0 ? 'high' : 'mid', 0.6)
        setTimeout(() => setCountdown(beats - i), Math.max(0, (t0 + i * interval - ctx.currentTime) * 1000))
      }
      await new Promise((r) => setTimeout(r, Math.max(0, (t0 + beats * interval - ctx.currentTime) * 1000)))
      setCountdown(null)
    }
    try {
      el.muted = false
      playbackStartedRef.current = true
      await el.play()
    } catch (err) {
      playbackStartedRef.current = false
      // Safari refuses play() once the gesture has expired: the next tap plays immediately.
      skipCountInRef.current = true
      setNotice(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Tap play once more to start.' : `Playback failed: ${err instanceof Error ? err.message : String(err)}`)
      setPhase('ready')
      return
    }
    skipCountInRef.current = false
    clockRef.current?.reset()
    smootherRef.current.reset()
    setPhase('playing')
  }, [micStatus, startMic])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    playbackStartedRef.current = false
    setPhase('paused')
  }, [])

  const restart = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    playbackStartedRef.current = false
    trackerRef.current?.reset()
    judgementRef.current = null
    clockRef.current?.reset()
    setResults(null)
    setPhase('ready')
  }, [])

  const seek = (t: number) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = t
    trackerRef.current?.seek(t - settingsRef.current.latencyMs / 1000)
    clockRef.current?.reset()
    judgementRef.current = null
    if (phaseRef.current === 'finished') {
      setResults(null)
      setPhase('paused')
    }
  }

  const togglePlayPause = useCallback(() => {
    if (phaseRef.current === 'playing') pause()
    else if (phaseRef.current === 'paused' || phaseRef.current === 'ready') void start()
  }, [pause, start])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlayPause()
      } else if (e.key === 'r' || e.key === 'R') restart()
      else if (e.key === 'Escape') navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlayPause, restart, navigate])

  if (songQuery === 'loading') return <div className="flex h-full items-center justify-center text-muted">Loading…</div>
  if (!song) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <p>This song is not in your library.</p>
        <Link to="/" className="underline">
          Back to songs
        </Link>
      </div>
    )
  }

  const chart = song.chart
  const duration = Math.max(chart.duration, song.duration)
  const busy = phase === 'playing' || phase === 'countin'
  const counts = levels ? levels.map((l) => l.notes.length) : null
  const currentLevelNotes = levels && levelIdx !== null ? levels[levelIdx].notes.length : 0
  const pickLevel = (idx: number) => {
    setLevelIdx(idx)
    if (phase === 'finished') restart()
  }

  return (
    <div
      className="no-select flex h-dvh flex-col bg-bg"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      <header className="flex items-center gap-2 border-b border-line bg-panel px-2 pb-2 sm:px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} aria-label="Back to songs" className="px-2">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Songs</span>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold sm:text-base">{song.title}</div>
          <div className="truncate text-xs text-muted">
            {song.artist || 'Unknown artist'} · {tuningLabel(chart.tuning)}
            {chart.capo ? ` · capo ${chart.capo}` : ''} · {Math.round(chartBpm(chart))} bpm
          </div>
        </div>
        <div className="hidden items-center gap-2 sm:flex" data-testid="controls-desktop">
          <LevelPicker levelIdx={levelIdx} counts={counts} disabled={busy} onPick={pickLevel} />
          <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={busy} aria-label="Playback speed" className="h-9 py-0">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </Select>
        </div>
        <Button
          size="sm"
          variant={micStatus === 'on' ? 'secondary' : 'primary'}
          onClick={() => {
            if (micStatus === 'on') {
              audioEngine.stopMic()
              setMicStatus('off')
            } else {
              audioEngine.unlock()
              void startMic()
            }
          }}
          title={micStatus === 'on' ? 'Microphone on' : 'Turn on microphone to get scored'}
          aria-label="Toggle microphone"
        >
          {micStatus === 'on' ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </Button>
      </header>
      <div className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1.5 sm:hidden" data-testid="controls-mobile">
        <LevelPicker levelIdx={levelIdx} counts={counts} disabled={busy} onPick={pickLevel} compact />
        <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={busy} aria-label="Playback speed" className="h-9 py-0 pr-7 text-xs">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {Math.round(s * 100)}%
            </option>
          ))}
        </Select>
      </div>
      {micError && <div className="bg-bad/15 px-4 py-1 text-xs text-red-200">Microphone: {micError}. You can still play along without scoring.</div>}
      {notice && <div className="bg-accent/15 px-4 py-1 text-xs text-amber-100">{notice}</div>}
      <div
        className="relative min-h-0 flex-1"
        onPointerUp={(e) => {
          // Tap the highway to pause / resume (phones have no space bar).
          if (e.target === canvasRef.current && (phase === 'playing' || phase === 'paused')) togglePlayPause()
        }}
      >
        <canvas ref={attachCanvas} className="block h-full w-full" data-testid="highway" />
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg/60 px-6 text-center">
            <button
              type="button"
              onClick={start}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-slate-950 shadow-lg transition-transform hover:scale-105"
              aria-label="Start"
              data-testid="start"
            >
              <Play className="h-12 w-12" />
            </button>
            <p className="text-sm text-muted">
              {levelIdx !== null ? LEVELS[levelIdx].label : ''} · {currentLevelNotes} notes · {Math.round(speed * 100)}% speed
            </p>
            {portraitPhone ? (
              <p className="text-xs text-muted">Tip: rotate your phone for a wider highway. Tap the highway to pause.</p>
            ) : (
              <p className="text-xs text-muted">Space or tap the highway to pause · R to restart</p>
            )}
          </div>
        )}
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9rem] font-black text-slate-50/90" data-testid="countdown">
            {countdown}
          </div>
        )}
        {phase === 'finished' && results && levelIdx !== null && (
          <ResultsOverlay
            summary={results}
            levelIndex={levelIdx}
            onRetry={() => {
              restart()
              void start()
            }}
            onLevel={(idx) => {
              setLevelIdx(idx)
              restart()
            }}
          />
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-line bg-panel px-2 pt-2 sm:gap-3 sm:px-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
        <Button variant="primary" size="sm" onClick={togglePlayPause} disabled={phase === 'countin' || phase === 'finished'} aria-label={phase === 'playing' ? 'Pause' : 'Play'} className="h-10 w-10 px-0">
          {phase === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={restart} aria-label="Restart" className="h-10 w-10 px-0">
          <RotateCcw className="h-4 w-4" />
        </Button>
        <span className="w-10 text-right text-xs tabular-nums text-muted">{formatTime(progress)}</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(progress, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={busy}
          className="min-w-0 flex-1"
          aria-label="Position"
        />
        <span className="w-10 text-xs tabular-nums text-muted">{formatTime(duration)}</span>
        <label className="hidden items-center gap-1 text-xs text-muted md:flex">
          Latency
          <input
            type="number"
            min={0}
            max={400}
            step={5}
            value={settings.latencyMs}
            onChange={(e) => updateSettings({ latencyMs: Number(e.target.value) })}
            className="h-7 w-16 rounded border border-line bg-panel-2 px-1 text-xs text-slate-100"
          />
          ms
        </label>
      </footer>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" playsInline onEnded={() => void finishRef.current()} />
    </div>
  )
}
