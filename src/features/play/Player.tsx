import { ArrowLeft, Mic, MicOff, Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { updateSettings, useSettings } from '../../app/settings'
import { useWakeLock } from '../../app/useWakeLock'
import { audioEngine } from '../../audio/AudioEngine'
import { playClick } from '../../audio/metronome/Metronome'
import type { Chart, ChartNote } from '../../chart/types'
import { Button, cx, formatTime } from '../../components/ui'
import type { AttemptResult } from '../../training/types'
import { HighwayRenderer } from './Highway'
import { PlaybackClock } from './PlaybackClock'
import { PitchSmoother } from './pitchTracker'
import { ScoreTracker, type ScoreSummary } from './scoring'

export type PlayerMode = 'song' | 'exercise' | 'test'
export type PlayerPhase = 'ready' | 'countin' | 'playing' | 'paused' | 'finished'

export interface PlayerHandle {
  start(): void
  pause(): void
  restart(): void
  seek(time: number): void
}

export interface PlayerProps {
  ref?: Ref<PlayerHandle>
  title: string
  subtitle?: string
  /** Provides beats, tuning, capo and duration. */
  chart: Chart
  /** The notes actually displayed and scored (a difficulty level, or the whole chart). */
  notes: ChartNote[]
  audio: Blob
  mode: PlayerMode
  speed?: number
  /** Tempo information recorded with the attempt. */
  playedTempo: number
  targetTempo: number
  /** 0-based inclusive bar range to loop; the player finishes after `loopCount` passes. */
  loopBars?: [number, number]
  loopCount?: number
  /** Changing this value resets the player to the start. */
  resetKey?: number | string
  /** Count-in clicks before the audio starts (default true). */
  countIn?: boolean
  /** Extra controls in the header (desktop) and the second row (phones). */
  headerControls?: ReactNode
  mobileControls?: ReactNode
  /** Rendered over the highway once finished. */
  resultsOverlay?: ReactNode
  readyHint?: string
  onExit: () => void
  onFinished: (summary: ScoreSummary, result: AttemptResult) => void
  onPhaseChange?: (phase: PlayerPhase) => void
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

function barStartTime(chart: Chart, bar: number): number | null {
  const beat = chart.beats.find((b) => b.bar === bar && b.beatInBar === 0) ?? chart.beats.find((b) => b.bar === bar)
  return beat ? beat.time : null
}

/** Reusable play-along engine: highway, mic scoring, transport. Song, exercise and test pages wrap it. */
export function Player({
  ref,
  title,
  subtitle,
  chart,
  notes,
  audio,
  mode,
  speed = 1,
  playedTempo,
  targetTempo,
  loopBars,
  loopCount = 2,
  resetKey,
  countIn = true,
  headerControls,
  mobileControls,
  resultsOverlay,
  readyHint,
  onExit,
  onFinished,
  onPhaseChange,
}: PlayerProps) {
  const settings = useSettings()
  const [phase, setPhaseState] = useState<PlayerPhase>('ready')
  const [micStatus, setMicStatus] = useState<'off' | 'on' | 'error'>(audioEngine.micActive ? 'on' : 'off')
  const [micError, setMicError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
  const loopsDoneRef = useRef(0)
  const startedAtRef = useRef<number | null>(null)
  const phaseRef = useRef<PlayerPhase>('ready')
  const settingsRef = useRef(settings)
  const propsRef = useRef({ chart, notes, speed, loopBars, loopCount, playedTempo, targetTempo, mode })
  settingsRef.current = settings
  propsRef.current = { chart, notes, speed, loopBars, loopCount, playedTempo, targetTempo, mode }

  const setPhase = useCallback(
    (p: PlayerPhase) => {
      phaseRef.current = p
      setPhaseState(p)
      onPhaseChange?.(p)
    },
    [onPhaseChange],
  )

  useWakeLock(phase === 'playing' || phase === 'countin')

  // Audio source.
  useEffect(() => {
    const url = URL.createObjectURL(audio)
    setAudioUrl(url)
    mediaPrimedRef.current = false
    return () => URL.revokeObjectURL(url)
  }, [audio])

  // Score tracker follows the active notes and speed.
  useEffect(() => {
    const tracker = new ScoreTracker(notes, { octaveTolerance: settingsRef.current.octaveTolerance, beats: chart.beats })
    tracker.setSpeed(speed)
    const el = audioRef.current
    if (el && el.currentTime > 0.05) tracker.seek(el.currentTime - settingsRef.current.latencyMs / 1000)
    trackerRef.current = tracker
  }, [notes, chart, speed])

  // Canvas renderer (callback ref: the canvas mounts after data is ready).
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

  useEffect(() => {
    const update = () => setPortraitPhone(window.innerWidth < 640 && window.innerHeight > window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const finish = useCallback(() => {
    if (phaseRef.current === 'finished') return
    const el = audioRef.current
    el?.pause()
    setPhase('finished')
    const tracker = trackerRef.current
    if (!tracker) return
    tracker.advance(Number.POSITIVE_INFINITY)
    const p = propsRef.current
    const durationSec = startedAtRef.current ? (performance.now() - startedAtRef.current) / 1000 : (el?.currentTime ?? 0)
    onFinished(tracker.summary(), tracker.toAttemptResult({ playedTempo: p.playedTempo, targetTempo: p.targetTempo, speed: p.speed, durationSec }))
  }, [onFinished, setPhase])
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
      if (!el || !renderer || !tracker) return
      const { chart: c, notes: n, speed: sp, loopBars: lb, loopCount: lc } = propsRef.current
      const clock = (clockRef.current ??= new PlaybackClock(el))
      let t = clock.time
      const st = settingsRef.current
      const playing = phaseRef.current === 'playing'
      const duration = c.duration
      if (playing) {
        if (lb) {
          const loopStart = barStartTime(c, lb[0]) ?? 0
          const loopEnd = barStartTime(c, lb[1] + 1) ?? duration
          if (t >= loopEnd - 0.02) {
            loopsDoneRef.current += 1
            if (loopsDoneRef.current >= lc) {
              void finishRef.current()
              return
            }
            el.currentTime = loopStart
            clock.reset()
            tracker.seek(loopStart - st.latencyMs / 1000)
            judgementRef.current = null
            t = loopStart
          }
        }
        const missed = tracker.advance(t - st.latencyMs / 1000)
        if (missed.length) judgementRef.current = { text: 'Miss', at: t }
      }
      const widthFactor = Math.min(1, Math.max(0.45, renderer.width / 900))
      renderer.draw({
        songTime: t,
        duration,
        notes: n,
        statusOf: (noteId) => tracker.stateOfNote(noteId),
        beats: c.beats,
        tuning: c.tuning,
        capo: c.capo,
        detectedMidi: detectedRef.current.midi,
        detectedMatches: detectedRef.current.matches,
        hud: tracker.summary(),
        lastJudgement: judgementRef.current,
        visibleSeconds: st.visibleSeconds * sp * widthFactor,
        showNoteNames: st.showNoteNames,
        paused: phaseRef.current === 'paused',
      })
      if (playing && !lb && (el.ended || t >= duration + 0.5)) void finishRef.current()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Pitch frames → scoring + coverage.
  useEffect(
    () =>
      audioEngine.subscribe((frame) => {
        const st = settingsRef.current
        const { midi, isAttack } = smootherRef.current.push(frame, st.clarityThreshold, st.a4)
        detectedRef.current.midi = midi
        const tracker = trackerRef.current
        const el = audioRef.current
        if (midi === null) tracker?.release()
        if (!tracker || !el || phaseRef.current !== 'playing') {
          detectedRef.current.matches = false
          return
        }
        const now = clockRef.current?.time ?? el.currentTime
        const t = now - st.latencyMs / 1000
        tracker.observe(t, midi !== null)
        if (midi === null) {
          detectedRef.current.matches = false
          return
        }
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

  const restart = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    playbackStartedRef.current = false
    loopsDoneRef.current = 0
    startedAtRef.current = null
    trackerRef.current?.reset()
    judgementRef.current = null
    clockRef.current?.reset()
    setPhase('ready')
  }, [setPhase])

  const start = useCallback(async () => {
    const el = audioRef.current
    if (!el || phaseRef.current === 'countin' || phaseRef.current === 'playing') return
    if (phaseRef.current === 'finished') restart()
    audioEngine.unlock()
    primeMediaElement(el, mediaPrimedRef, playbackStartedRef)
    setNotice(null)
    if (!audioEngine.micActive && micStatus !== 'error') await startMic()
    await audioEngine.resume()
    const p = propsRef.current
    el.playbackRate = p.speed
    el.preservesPitch = true
    const loopStart = p.loopBars ? (barStartTime(p.chart, p.loopBars[0]) ?? 0) : 0
    if (el.currentTime < loopStart) el.currentTime = loopStart
    const atStart = el.currentTime <= loopStart + 0.05
    if (atStart && countIn && !skipCountInRef.current) {
      setPhase('countin')
      const ctx = audioEngine.context
      const bpm = p.chart.tempos[0]?.bpm ?? 120
      const interval = 60 / bpm / p.speed
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
      skipCountInRef.current = true
      setNotice(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Tap play once more to start.' : `Playback failed: ${err instanceof Error ? err.message : String(err)}`)
      setPhase('ready')
      return
    }
    skipCountInRef.current = false
    if (atStart) {
      trackerRef.current?.seek(loopStart - settingsRef.current.latencyMs / 1000)
      startedAtRef.current = performance.now()
    } else if (startedAtRef.current === null) {
      startedAtRef.current = performance.now()
    }
    clockRef.current?.reset()
    smootherRef.current.reset()
    setPhase('playing')
  }, [countIn, micStatus, restart, setPhase, startMic])

  const pause = useCallback(() => {
    if (mode === 'test') return
    audioRef.current?.pause()
    playbackStartedRef.current = false
    setPhase('paused')
  }, [mode, setPhase])

  const seek = useCallback(
    (t: number) => {
      const el = audioRef.current
      if (!el || mode === 'test') return
      el.currentTime = t
      trackerRef.current?.seek(t - settingsRef.current.latencyMs / 1000)
      clockRef.current?.reset()
      judgementRef.current = null
      if (phaseRef.current === 'finished') setPhase('paused')
    },
    [mode, setPhase],
  )

  useImperativeHandle(ref, () => ({ start: () => void start(), pause, restart, seek }), [start, pause, restart, seek])

  // External reset (new rep, level change).
  const firstResetRef = useRef(true)
  useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false
      return
    }
    restart()
  }, [resetKey, restart])

  const togglePlayPause = useCallback(() => {
    if (phaseRef.current === 'playing') pause()
    else if (phaseRef.current === 'paused' || phaseRef.current === 'ready') void start()
  }, [pause, start])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlayPause()
      } else if ((e.key === 'r' || e.key === 'R') && mode !== 'test') restart()
      else if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlayPause, restart, onExit, mode])

  const duration = chart.duration
  const busy = phase === 'playing' || phase === 'countin'
  const canSeek = mode !== 'test' && !busy
  const notesCount = notes.length

  return (
    <div
      className="no-select flex h-dvh flex-col bg-bg"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      data-testid={`player-${mode}`}
    >
      <header className="flex items-center gap-2 border-b border-line bg-panel px-2 pb-2 sm:px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <Button variant="ghost" size="sm" onClick={onExit} aria-label="Back" className="px-2">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold sm:text-base">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
        </div>
        {headerControls && (
          <div className="hidden items-center gap-2 sm:flex" data-testid="controls-desktop">
            {headerControls}
          </div>
        )}
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
      {(mobileControls ?? headerControls) && (
        <div className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1.5 sm:hidden" data-testid="controls-mobile">
          {mobileControls ?? headerControls}
        </div>
      )}
      {micError && <div className="bg-bad/15 px-4 py-1 text-xs text-red-200">Microphone: {micError}. You can still play along without scoring.</div>}
      {notice && <div className="bg-accent/15 px-4 py-1 text-xs text-amber-100">{notice}</div>}
      <div
        className="relative min-h-0 flex-1"
        onPointerUp={(e) => {
          if (e.target === canvasRef.current && (phase === 'playing' || phase === 'paused')) togglePlayPause()
        }}
      >
        <canvas ref={attachCanvas} className="block h-full w-full" data-testid="highway" />
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg/60 px-6 text-center">
            <button
              type="button"
              onClick={() => void start()}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-slate-950 shadow-lg transition-transform hover:scale-105"
              aria-label="Start"
              data-testid="start"
            >
              <Play className="h-12 w-12" />
            </button>
            <p className="text-sm text-muted">{readyHint ?? `${notesCount} notes · ${Math.round(speed * 100)}% speed`}</p>
            {mode !== 'test' && (
              <p className="text-xs text-muted">
                {portraitPhone ? 'Tip: rotate your phone for a wider highway. Tap the highway to pause.' : 'Space or tap the highway to pause · R to restart'}
              </p>
            )}
            {mode === 'test' && <p className="text-xs text-amber-200">Test: one attempt, no pausing.</p>}
          </div>
        )}
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9rem] font-black text-slate-50/90" data-testid="countdown">
            {countdown}
          </div>
        )}
        {phase === 'finished' && resultsOverlay}
      </div>
      <footer className="flex items-center gap-2 border-t border-line bg-panel px-2 pt-2 sm:gap-3 sm:px-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={togglePlayPause}
          disabled={phase === 'countin' || phase === 'finished' || (mode === 'test' && phase === 'playing')}
          aria-label={phase === 'playing' ? 'Pause' : 'Play'}
          className="h-10 w-10 px-0"
        >
          {phase === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        {mode !== 'test' && (
          <Button variant="ghost" size="sm" onClick={restart} aria-label="Restart" className="h-10 w-10 px-0">
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        <span className="w-10 text-right text-xs tabular-nums text-muted">{formatTime(progress)}</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(progress, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!canSeek}
          className={cx('min-w-0 flex-1', mode === 'test' && 'opacity-50')}
          aria-label="Position"
        />
        <span className="w-10 text-xs tabular-nums text-muted">{formatTime(duration)}</span>
        {mode === 'song' && (
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
        )}
      </footer>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" playsInline onEnded={() => void finishRef.current()} />
    </div>
  )
}
