import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '../../app/settings'
import { audioEngine } from '../../audio/AudioEngine'
import { normalize, pluck } from '../../audio/synth'
import { Button, Card, cx } from '../../components/ui'
import { midiToFreq, midiToName } from '../../music/pitch'
import { EAR_RESPONSE_SECONDS } from '../../training/constants'
import type { AttemptResult, GeneratedExercise } from '../../training/types'
import { PitchSmoother } from '../play/pitchTracker'
import type { ScoreSummary } from '../play/scoring'
import { earAttemptResult, earSummary, feedbackText, judgeCents, judgePrompt, stablePitch, type EarJudgement } from './earTrainer'

const REFERENCE_SECONDS = 1.2
const SETTLE_MS = 150
const ADVANCE_MS = 1000

type Phase = 'intro' | 'starting' | 'listen' | 'turn' | 'feedback' | 'error'

interface Props {
  exercise: GeneratedExercise
  onFinished: (summary: ScoreSummary, result: AttemptResult) => void
  onExit: () => void
  resetKey?: number
}

/** Plays a reference pitch for each chart note and listens for the player to find it on any string. */
export function EarTrainer({ exercise, onFinished, onExit, resetKey }: Props) {
  const targets = exercise.chart.notes.map((n) => n.midi)
  const total = targets.length
  const [phase, setPhase] = useState<Phase>('intro')
  const [index, setIndex] = useState(0)
  const [judgement, setJudgement] = useState<EarJudgement | null>(null)
  const [feedback, setFeedback] = useState('')
  const [errorText, setErrorText] = useState('')

  const judgements = useRef<EarJudgement[]>([])
  const heard = useRef(0)
  const startedAt = useRef(0)
  const finished = useRef(false)
  const timers = useRef<number[]>([])
  const unsub = useRef<(() => void) | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)
  const ignoreUntil = useRef(0)
  const history = useRef<number[]>([])
  const heardThis = useRef(false)
  const phaseRef = useRef<Phase>('intro')
  const indexRef = useRef(0)
  const exerciseRef = useRef(exercise)
  exerciseRef.current = exercise
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished
  const playPromptRef = useRef<(i: number) => void>(() => {})

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const cleanup = useCallback(() => {
    clearTimers()
    unsub.current?.()
    unsub.current = null
    try {
      source.current?.stop()
    } catch {
      /* already stopped */
    }
    source.current = null
    audioEngine.stopMic()
  }, [])

  const playReference = (midi: number): number => {
    const ctx = audioEngine.context
    const rate = ctx.sampleRate
    const data = new Float32Array(Math.round(REFERENCE_SECONDS * rate))
    pluck(data, 0, midiToFreq(midi), REFERENCE_SECONDS, 0.8, 7 + midi, rate)
    normalize(data, 0.8)
    const buffer = ctx.createBuffer(1, data.length, rate)
    buffer.copyToChannel(data, 0)
    try {
      source.current?.stop()
    } catch {
      /* already stopped */
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start()
    source.current = src
    return REFERENCE_SECONDS * 1000
  }

  const finishPrompt = (i: number, j: EarJudgement, played: number | null) => {
    if (phaseRef.current !== 'turn') return
    clearTimers()
    judgements.current.push(j)
    if (heardThis.current) heard.current += 1
    const target = targets[i]
    const name = midiToName(target)
    if (played === null) {
      setFeedback(`No note heard. It was ${name}.`)
    } else {
      const { cents, octaves } = judgeCents(played, target)
      setFeedback(`${feedbackText(cents, octaves)} (${name})`)
    }
    setJudgement(j)
    setPhaseBoth('feedback')
    later(() => {
      if (i + 1 >= total) {
        if (finished.current) return
        finished.current = true
        const result = earAttemptResult(judgements.current, {
          durationSec: (performance.now() - startedAt.current) / 1000,
          tempo: exerciseRef.current.params.tempo,
          heard: heard.current,
        })
        onFinishedRef.current(earSummary(result, judgements.current), result)
      } else {
        playPromptRef.current(i + 1)
      }
    }, ADVANCE_MS)
  }

  playPromptRef.current = (i: number) => {
    clearTimers()
    indexRef.current = i
    setIndex(i)
    setJudgement(null)
    setFeedback('')
    history.current = []
    heardThis.current = false
    setPhaseBoth('listen')
    const ms = playReference(targets[i])
    later(() => {
      history.current = []
      ignoreUntil.current = performance.now() + SETTLE_MS
      setPhaseBoth('turn')
      later(() => finishPrompt(i, 'miss', null), EAR_RESPONSE_SECONDS * 1000)
    }, ms)
  }

  const start = () => {
    audioEngine.unlock()
    const settings = getSettings()
    setPhaseBoth('starting')
    audioEngine
      .startMic({ deviceId: settings.inputDeviceId || undefined, echoCancellation: settings.echoCancellation })
      .then(() => {
        const smoother = new PitchSmoother()
        unsub.current = audioEngine.subscribe((frame) => {
          if (phaseRef.current !== 'turn' || performance.now() < ignoreUntil.current) return
          const { midi } = smoother.push(frame, getSettings().clarityThreshold)
          if (midi === null) return
          heardThis.current = true
          history.current.push(midi)
          if (history.current.length > 16) history.current.shift()
          const stable = stablePitch(history.current)
          if (stable !== null) {
            const i = indexRef.current
            finishPrompt(i, judgePrompt(stable, targets[i]), stable)
          }
        })
        judgements.current = []
        heard.current = 0
        finished.current = false
        startedAt.current = performance.now()
        playPromptRef.current(0)
      })
      .catch((err) => {
        setErrorText(err instanceof Error ? err.message : 'The microphone could not be started.')
        setPhaseBoth('error')
      })
  }

  useEffect(() => {
    // New rep or retry: back to the intro with clean state.
    cleanup()
    judgements.current = []
    heard.current = 0
    finished.current = false
    phaseRef.current = 'intro'
    setPhase('intro')
    indexRef.current = 0
    setIndex(0)
    setJudgement(null)
    setFeedback('')
    return cleanup
  }, [resetKey, cleanup])

  const replay = () => {
    if (phaseRef.current !== 'turn') return
    history.current = []
    const ms = playReference(targets[index])
    ignoreUntil.current = performance.now() + ms + SETTLE_MS
  }

  const tone = judgement === 'perfect' ? 'text-emerald-300' : judgement === 'good' ? 'text-amber-200' : 'text-red-300'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center" data-testid="ear-trainer">
      <div className="flex w-full max-w-md justify-start">
        <Button variant="ghost" size="sm" onClick={onExit}>
          Back
        </Button>
      </div>
      {phase === 'intro' || phase === 'starting' || phase === 'error' ? (
        <Card className="w-full max-w-md">
          <h2 className="text-xl font-semibold">{exercise.title}</h2>
          <p className="mt-2 text-sm text-muted">{exercise.instructions}</p>
          <p className="mt-2 text-sm text-muted">{total} prompts</p>
          {phase === 'error' && <p className="mt-2 text-sm text-red-300">{errorText}</p>}
          <Button className="mt-4" variant="primary" size="lg" onClick={start} disabled={phase === 'starting'} data-testid="ear-start">
            {phase === 'error' ? 'Try again' : 'Start'}
          </Button>
        </Card>
      ) : (
        <>
          <div className="text-sm text-muted" data-testid="ear-prompt">
            Prompt {index + 1} of {total}
          </div>
          <div className="text-3xl font-bold">
            {phase === 'listen' ? 'Listen…' : phase === 'turn' ? 'Your turn' : judgement === 'miss' ? 'Miss' : judgement === 'good' ? 'Good' : 'Perfect'}
          </div>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-panel-2" aria-hidden>
            <div
              key={`${index}-${phase === 'turn'}`}
              className="h-full bg-accent"
              style={{ width: phase === 'feedback' ? '0%' : '100%' }}
              ref={(el) => {
                if (!el || phase !== 'turn') return
                el.style.transition = 'none'
                el.style.width = '100%'
                void el.offsetWidth
                el.style.transition = `width ${EAR_RESPONSE_SECONDS * 1000}ms linear`
                el.style.width = '0%'
              }}
            />
          </div>
          <div className={cx('min-h-6 text-base', tone)} data-testid="ear-feedback" aria-live="polite">
            {phase === 'feedback' ? feedback : ''}
          </div>
          <Button variant="secondary" onClick={replay} disabled={phase !== 'turn'} data-testid="ear-replay">
            Replay
          </Button>
        </>
      )}
    </div>
  )
}
