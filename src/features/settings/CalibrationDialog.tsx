import { useEffect, useRef, useState } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { playClick } from '../../audio/metronome/Metronome'
import { Button, Modal } from '../../components/ui'

const CLICKS = 8
const INTERVAL = 0.6

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Plays clicks; the player strums a muted string on each one. The median gap
 * between click time and detected attack is the round-trip latency to compensate.
 */
export function CalibrationDialog({ deviceId, onClose, onResult }: { deviceId?: string; onClose: () => void; onResult: (ms: number) => void }) {
  const [phase, setPhase] = useState<'intro' | 'running' | 'done' | 'error'>('intro')
  const [count, setCount] = useState(0)
  const [result, setResult] = useState<{ ms: number; samples: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  const run = async () => {
    try {
      setPhase('running')
      await audioEngine.startMic({ deviceId })
      const ctx = audioEngine.context
      const attacks: number[] = []
      let envelope = 0
      let lastAttack = -1
      const unsubscribe = audioEngine.subscribe((f) => {
        if (f.rms > 0.01 && f.rms > envelope * 2.5 && f.time - lastAttack > 0.15) {
          attacks.push(f.time - 0.005)
          lastAttack = f.time
        }
        envelope = Math.max(f.rms, envelope * 0.9)
      })
      const t0 = ctx.currentTime + 0.6
      const clicks: number[] = []
      const timers: ReturnType<typeof setTimeout>[] = []
      for (let i = 0; i < CLICKS; i++) {
        const t = t0 + i * INTERVAL
        clicks.push(t)
        playClick(ctx, ctx.destination, t, i % 4 === 0 ? 'high' : 'mid')
        timers.push(setTimeout(() => setCount(i + 1), (t - ctx.currentTime) * 1000))
      }
      cleanup.current = () => {
        unsubscribe()
        timers.forEach(clearTimeout)
      }
      await new Promise((r) => setTimeout(r, (t0 + CLICKS * INTERVAL + 0.5 - ctx.currentTime) * 1000))
      unsubscribe()
      const offsets: number[] = []
      for (const c of clicks) {
        let best: number | null = null
        for (const a of attacks) {
          const d = a - c
          if (d < -0.05 || d > 0.45) continue
          if (best === null || Math.abs(d) < Math.abs(best)) best = d
        }
        if (best !== null) offsets.push(best)
      }
      if (offsets.length < 3) {
        setError(`Only ${offsets.length} of ${CLICKS} strums were detected. Play louder and closer to the mic, then try again.`)
        setPhase('error')
        return
      }
      setResult({ ms: Math.round(median(offsets) * 1000), samples: offsets.length })
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  return (
    <Modal title="Calibrate latency" onClose={onClose}>
      {phase === 'intro' && (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            You will hear {CLICKS} clicks. Strum a <strong>muted</strong> string exactly on each click. The app measures how long your sound
            takes to arrive and compensates for it when scoring.
          </p>
          <p className="text-muted">Use the speakers or headphones you normally play with.</p>
          <Button variant="primary" onClick={run}>
            Start
          </Button>
        </div>
      )}
      {phase === 'running' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="text-6xl font-bold tabular-nums">{count}</div>
          <p className="text-sm text-muted">Strum on every click…</p>
        </div>
      )}
      {phase === 'done' && result && (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Measured latency: <strong className="text-lg">{result.ms} ms</strong> ({result.samples} of {CLICKS} strums detected).
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={run}>Measure again</Button>
            <Button
              variant="primary"
              onClick={() => {
                onResult(Math.max(0, result.ms))
                onClose()
              }}
            >
              Use {result.ms} ms
            </Button>
          </div>
        </div>
      )}
      {phase === 'error' && (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-red-200">{error}</p>
          <Button onClick={run}>Try again</Button>
        </div>
      )}
    </Modal>
  )
}
