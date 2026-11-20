import { useEffect, useRef, useState } from 'react'
import { useHoldUpdates } from '../../app/appUpdate'
import { getSettings } from '../../app/settings'
import { audioEngine } from '../../audio/AudioEngine'
import { primeMediaElement } from '../../audio/primeMedia'
import { encodeWav } from '../../audio/synth'
import { Button, Modal, cx } from '../../components/ui'
import { PlaybackClock } from '../play/PlaybackClock'
import {
  CLICK_COUNT,
  ClickMatcher,
  MATCH_AFTER,
  RunGuard,
  calibrationAdvice,
  createOnsetDetector,
  noiseFloor,
  summarise,
  type CalibrationSummary,
  type LevelFrame,
} from './calibration'
import { CLICK_TRACK_RATE, clickTimes, renderClickTrack } from './clickTrack'

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
 * median gap is the latency scoring compensates for.
 *
 * The measurement goes down the very path a song takes: the clicks are a piece of audio played by a
 * media element, the microphone frames are placed on that element's clock exactly as the player
 * places them on a song's clock, and the microphone runs with the options used for playing. So
 * whatever the device adds on the way out and on the way in is in the number, and nothing else.
 */
export function CalibrationDialog({ deviceId, onClose, onResult }: { deviceId?: string; onClose: () => void; onResult: (ms: number) => void }) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [count, setCount] = useState(0)
  const [hits, setHits] = useState<boolean[]>(() => new Array<boolean>(CLICK_COUNT).fill(false))
  const [level, setLevel] = useState(0)
  const [result, setResult] = useState<CalibrationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const [guard] = useState(() => new RunGuard())
  // A waiting app update must not reload the page in the middle of a measurement.
  useHoldUpdates()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const primedRef = useRef(false)
  const startedRef = useRef(false)
  const [trackUrl] = useState(() => URL.createObjectURL(encodeWav(renderClickTrack(), CLICK_TRACK_RATE)))
  useEffect(() => () => URL.revokeObjectURL(trackUrl), [trackUrl])

  // Closing the dialog (done, cancelled or unmounted) must silence the clicks and release the
  // microphone, and end a run that is still waiting so it cannot do either again later.
  useEffect(
    () => () => {
      guard.cancel()
      cleanup.current?.()
      audioEngine.stopMic()
    },
    [guard],
  )

  const run = async () => {
    // After every wait the run checks this before touching the audio: once the dialog has closed,
    // the microphone may belong to the tuner or a song.
    const current = guard.start()
    audioEngine.unlock()
    cleanup.current?.()
    cleanup.current = null
    const el = audioRef.current
    if (!el) return
    // Still inside the tap: this lets the clicks start later, once the microphone is open (a phone
    // only lets sound start from a tap).
    startedRef.current = false
    primeMediaElement(el, primedRef, startedRef)
    setPhase('running')
    setCount(0)
    setHits(new Array<boolean>(CLICK_COUNT).fill(false))
    setLevel(0)
    setError(null)
    try {
      const s = getSettings()
      await audioEngine.startMic({ deviceId: deviceId ?? (s.inputDeviceId || undefined), echoCancellation: s.echoCancellation })
      if (!current()) return
      const ctx = audioEngine.context
      if (ctx.state !== 'running') await ctx.resume()
      if (!current()) return
      if ((ctx.state as string) !== 'running') throw new Error('Audio is paused. Tap Start again.')

      const clicks = clickTimes()
      const t0 = clicks[0]
      const matcher = new ClickMatcher(clicks)
      const clock = new PlaybackClock(el)
      let shown = 0
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
        if (el.paused) return
        // Where this frame falls on the click track's own clock: the same sum the player does for a song.
        const now = clock.time
        const time = now - Math.min(0.25, Math.max(0, ctx.currentTime - f.time))
        let sounded = 0
        while (sounded < clicks.length && clicks[sounded] <= now) sounded++
        if (sounded !== shown) {
          shown = sounded
          setCount(sounded)
        }
        if (time < t0 - 0.1) {
          quiet.push(f.rms)
          return
        }
        if (!detect) {
          floor = noiseFloor(quiet)
          detect = createOnsetDetector({ floor })
        }
        const onset = detect({ rms: f.rms, time })
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
      // Stopping the element silences the clicks still to come.
      cleanup.current = () => {
        unsubscribe()
        el.pause()
      }
      startedRef.current = true
      el.muted = false
      el.currentTime = 0
      try {
        await el.play()
      } catch {
        // Not a microphone problem: the browser would not start the sound without a fresh tap.
        throw new Error('The clicks could not start. Tap "Try again".')
      }
      if (!current()) return
      // Until the last click has had its window. The element's clock can stand still for a moment
      // while a phone opens the microphone, so this waits on the clock, not on a fixed time.
      const end = clicks[clicks.length - 1] + MATCH_AFTER + 0.1
      for (let i = 0; i < 200 && current() && !el.ended && el.currentTime < end; i++) await wait(100)
      if (!current()) return
      cleanup.current?.()
      cleanup.current = null
      audioEngine.stopMic()
      const summary = summarise(matcher.offsets)
      if (!summary) {
        setError(calibrationAdvice(matcher.heard, CLICK_COUNT, floor))
        setPhase('error')
        return
      }
      setResult(summary)
      setPhase('done')
    } catch (err) {
      if (!current()) return
      cleanup.current?.()
      cleanup.current = null
      audioEngine.stopMic()
      setError(friendlyError(err))
      setPhase('error')
    }
  }

  return (
    <Modal title="Sync your sound" onClose={onClose}>
      <audio ref={audioRef} src={trackUrl} preload="auto" playsInline />
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
