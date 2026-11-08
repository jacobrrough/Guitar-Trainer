import { useEffect, useRef, useState } from 'react'
import { getSettings } from '../../app/settings'
import { audioEngine } from '../../audio/AudioEngine'
import { playClick } from '../../audio/metronome/Metronome'
import { Button, Modal, cx } from '../../components/ui'
import {
  CLICK_COUNT,
  CLICK_INTERVAL,
  ClickMatcher,
  MATCH_AFTER,
  PREROLL,
  calibrationAdvice,
  createOnsetDetector,
  noiseFloor,
  summarise,
  type CalibrationSummary,
  type LevelFrame,
} from './calibration'

type Phase = 'intro' | 'running' | 'done' | 'error'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

function friendlyError(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    return 'The microphone is blocked. Allow it for this site in your browser settings, then try again.'
  }
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'No microphone was found.'
  return err instanceof Error ? err.message : String(err)
}

/**
 * Plays clicks; the player strums a muted string on each one. The earliest sound after each click
 * (the strum, or on a phone speaker the click's own echo) marks when sound reaches the app, and the
 * median gap is the latency scoring compensates for. Uses the same microphone options as playing,
 * so any processing the phone adds is included in the measurement.
 */
export function CalibrationDialog({ deviceId, onClose, onResult }: { deviceId?: string; onClose: () => void; onResult: (ms: number) => void }) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [count, setCount] = useState(0)
  const [hits, setHits] = useState<boolean[]>(() => new Array<boolean>(CLICK_COUNT).fill(false))
  const [level, setLevel] = useState(0)
  const [result, setResult] = useState<CalibrationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const alive = useRef(true)

  // Closing the dialog (done, cancelled or unmounted) must release the microphone.
  useEffect(
    () => () => {
      alive.current = false
      cleanup.current?.()
      audioEngine.stopMic()
    },
    [],
  )

  const run = async () => {
    audioEngine.unlock()
    cleanup.current?.()
    cleanup.current = null
    setPhase('running')
    setCount(0)
    setHits(new Array<boolean>(CLICK_COUNT).fill(false))
    setLevel(0)
    setError(null)
    try {
      const s = getSettings()
      await audioEngine.startMic({ deviceId: deviceId ?? (s.inputDeviceId || undefined), echoCancellation: s.echoCancellation })
      const ctx = audioEngine.context
      if (ctx.state !== 'running') await ctx.resume()
      if ((ctx.state as string) !== 'running') throw new Error('Audio is paused. Tap Start again.')

      const t0 = ctx.currentTime + PREROLL
      const clicks = Array.from({ length: CLICK_COUNT }, (_, i) => t0 + i * CLICK_INTERVAL)
      const matcher = new ClickMatcher(clicks)
      const quiet: number[] = []
      let floor = 0
      let detect: ((frame: LevelFrame) => number | null) | null = null
      let lastLevelAt = -1
      let peak = 0
      const unsubscribe = audioEngine.subscribe((f) => {
        // Peak-held, dB-scaled meter so a short muted strum visibly kicks the bar.
        peak = Math.max(f.rms, peak * 0.9)
        if (f.time - lastLevelAt > 0.05) {
          lastLevelAt = f.time
          const db = 20 * Math.log10(Math.max(peak, 1e-5))
          setLevel(Math.min(1, Math.max(0, (db + 60) / 55)))
        }
        if (f.time < t0 - 0.1) {
          quiet.push(f.rms)
          return
        }
        if (!detect) {
          floor = noiseFloor(quiet)
          detect = createOnsetDetector({ floor })
        }
        const onset = detect(f)
        if (onset === null) return
        const i = matcher.onset(onset)
        if (i >= 0) {
          setHits((h) => {
            const next = [...h]
            next[i] = true
            return next
          })
        }
      })
      const timers: ReturnType<typeof setTimeout>[] = []
      clicks.forEach((t, i) => {
        playClick(ctx, ctx.destination, t, i % 4 === 0 ? 'high' : 'mid')
        timers.push(setTimeout(() => setCount(i + 1), (t - ctx.currentTime) * 1000))
      })
      cleanup.current = () => {
        unsubscribe()
        timers.forEach(clearTimeout)
      }
      const end = clicks[clicks.length - 1] + MATCH_AFTER + 0.1
      await wait((end - ctx.currentTime) * 1000)
      // iOS can hold the audio clock for a moment while the mic opens; give the last click its window.
      for (let i = 0; i < 30 && ctx.currentTime < end; i++) await wait(100)
      cleanup.current?.()
      cleanup.current = null
      audioEngine.stopMic()
      if (!alive.current) return
      const summary = summarise(matcher.offsets)
      if (!summary) {
        setError(calibrationAdvice(matcher.heard, CLICK_COUNT, floor))
        setPhase('error')
        return
      }
      setResult(summary)
      setPhase('done')
    } catch (err) {
      cleanup.current?.()
      cleanup.current = null
      audioEngine.stopMic()
      if (!alive.current) return
      setError(friendlyError(err))
      setPhase('error')
    }
  }

  return (
    <Modal title="Sync your sound" onClose={onClose}>
      {phase === 'intro' && (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            You will hear {CLICK_COUNT} clicks. Rest your fingers lightly across the strings so they do not ring, and{' '}
            <strong>strum on each click</strong>. The app measures how long your sound takes to arrive and lines up the scoring to match.
          </p>
          <p className="text-muted">Use the speakers or headphones you normally play with, and keep the phone where you usually keep it.</p>
          <Button variant="primary" onClick={run} data-testid="calibrate-start">
            Start
          </Button>
        </div>
      )}
      {phase === 'running' && (
        <div className="flex flex-col items-center gap-4 py-4" data-testid="calibrate-running">
          <div className="text-6xl font-bold tabular-nums">{count}</div>
          <p className="text-sm text-muted">{count === 0 ? 'Get ready…' : 'Strum on every click…'}</p>
          <div className="flex gap-2" aria-label="Clicks heard">
            {hits.map((hit, i) => (
              <span key={i} className={cx('h-3 w-3 rounded-full', hit ? 'bg-ok' : i < count ? 'bg-panel-2 ring-1 ring-line' : 'bg-panel-2')} />
            ))}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2" data-testid="calibrate-level" aria-hidden>
            <div className="h-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        </div>
      )}
      {phase === 'done' && result && (
        <div className="flex flex-col gap-4 text-sm" data-testid="calibrate-result">
          <p className="text-base">
            Your sound reaches the app about <strong className="text-lg">{result.ms} ms</strong> after the beat.
          </p>
          <p className="text-muted">
            {result.samples} of {CLICK_COUNT} clicks heard
            {result.steady ? '.' : '. The gap varied a lot between clicks, so this is rough: measure again and strum right on each click.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={run}>Measure again</Button>
            <Button
              variant="primary"
              data-testid="calibrate-use"
              onClick={() => {
                onResult(Math.max(0, result.ms))
                onClose()
              }}
            >
              Use {Math.max(0, result.ms)} ms
            </Button>
          </div>
        </div>
      )}
      {phase === 'error' && (
        <div className="flex flex-col gap-4 text-sm">
          <p role="alert" className="text-red-200" data-testid="calibrate-error">
            {error}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={run} data-testid="calibrate-retry">
              Try again
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
