import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from '../../app/settings'
import { audioEngine } from '../../audio/AudioEngine'
import { renderNoteAudio } from '../../audio/guitar'
import { renderGuitarNote } from '../../audio/synth'
import { Button, Card, cx } from '../../components/ui'
import { midiToName } from '../../music/pitch'
import { EAR_RESPONSE_SECONDS } from '../../training/constants'
import type { AttemptResult, GeneratedExercise } from '../../training/types'
import type { ScoreSummary } from '../play/scoring'
import { EarListener, RunGuard, answerText, prepareRun, type EarAnswer } from './earListening'
import { earAttemptResult, earSummary, type EarJudgement } from './earTrainer'

const REFERENCE_SECONDS = 1.2
const ADVANCE_MS = 1000
const RESPONSE_MS = EAR_RESPONSE_SECONDS * 1000

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
  // The answer-time bar: `run` restarts it, `delayMs` holds it full while a replayed reference sounds.
  const [bar, setBar] = useState({ run: 0, delayMs: 0 })

  const judgements = useRef<EarJudgement[]>([])
  const heard = useRef(0)
  const startedAt = useRef(0)
  const finished = useRef(false)
  const timers = useRef<number[]>([])
  const unsub = useRef<(() => void) | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)
  const references = useRef(new Map<number, Float32Array<ArrayBuffer>>())
  const listener = useRef<EarListener | null>(null)
  // Ends with the run (Back, a new round): work that finishes later checks it and does nothing.
  const guard = useRef(new RunGuard())
  const alive = useRef<() => boolean>(() => false)
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
    const stillThisRun = alive.current
    timers.current.push(
      window.setTimeout(() => {
        if (stillThisRun()) fn()
      }, ms),
    )
  }

  const cleanup = useCallback(() => {
    guard.current.end()
    listener.current?.close()
    listener.current = null
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
    // Rendered ahead in start(); the string model stands in if that has not finished.
    const data = references.current.get(midi) ?? new Float32Array(renderGuitarNote(null, midi, REFERENCE_SECONDS, rate))
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

  const finishPrompt = (i: number, answer: EarAnswer) => {
    if (phaseRef.current !== 'turn') return
    clearTimers()
    listener.current?.close()
    const j = answer.judgement
    judgements.current.push(j)
    if (answer.heard) heard.current += 1
    setFeedback(answerText(answer, midiToName(targets[i]), targets[i]))
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

  /** (Re)starts the timer and the bar for the open turn, from the listener's deadline. */
  const armDeadline = (i: number) => {
    const l = listener.current
    if (!l) return
    clearTimers()
    const left = l.deadline - performance.now()
    setBar((b) => ({ run: b.run + 1, delayMs: Math.max(0, left - RESPONSE_MS) }))
    // Normally a microphone frame ends the turn at the deadline; this covers a microphone that has gone quiet.
    later(() => finishPrompt(i, l.expire()), left)
  }

  playPromptRef.current = (i: number) => {
    clearTimers()
    listener.current?.close()
    indexRef.current = i
    setIndex(i)
    setJudgement(null)
    setFeedback('')
    setPhaseBoth('listen')
    const ms = playReference(targets[i])
    later(() => {
      listener.current?.open(targets[i], performance.now())
      setPhaseBoth('turn')
      armDeadline(i)
    }, ms)
  }

  const start = () => {
    audioEngine.unlock()
    const settings = getSettings()
    setPhaseBoth('starting')
    const thisRun = guard.current.begin()
    alive.current = thisRun
    // The reference notes, played by the recorded guitar.
    const renderReferences = async () => {
      const rate = audioEngine.context.sampleRate
      await Promise.all(
        [...new Set(targets)].map(async (midi) => {
          if (references.current.has(midi)) return
          const pcm = await renderNoteAudio(midi, REFERENCE_SECONDS, rate).catch(() => null)
          if (pcm) references.current.set(midi, new Float32Array(pcm))
        }),
      )
    }
    prepareRun(thisRun, () => audioEngine.startMic({ deviceId: settings.inputDeviceId || undefined, echoCancellation: settings.echoCancellation }), renderReferences)
      .then((ready) => {
        // Left or started over while the microphone was coming up: leaving has already closed the microphone
        // (or cancelled its start). Stopping it again here could cut it from under the screen that came next.
        if (!ready || phaseRef.current !== 'starting') return
        const l = new EarListener({ responseMs: RESPONSE_MS })
        listener.current = l
        unsub.current = audioEngine.subscribe((frame) => {
          // Every frame goes in, also between turns: the listener needs the level before a turn opens.
          const answer = l.frame(frame, performance.now(), getSettings().clarityThreshold)
          if (answer) finishPrompt(indexRef.current, answer)
        })
        judgements.current = []
        heard.current = 0
        finished.current = false
        startedAt.current = performance.now()
        playPromptRef.current(0)
      })
      .catch((err) => {
        if (!thisRun()) return
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
    const l = listener.current
    if (phaseRef.current !== 'turn' || !l) return
    const i = indexRef.current
    const ms = playReference(targets[i])
    // Hearing it again does not cost answer time: the listener waits for the note to end, then the full time starts again.
    l.replay(performance.now(), ms)
    armDeadline(i)
  }

  // Runs the bar down over the answer time. Stable between renders, so only a new turn or a Replay restarts it.
  const runBar = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || phase !== 'turn') return
      el.style.transition = 'none'
      el.style.width = '100%'
      void el.offsetWidth
      el.style.transition = `width ${RESPONSE_MS}ms linear ${bar.delayMs}ms`
      el.style.width = '0%'
    },
    [phase, bar],
  )

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
          <p className="mt-2 text-sm text-muted">{total} notes to find</p>
          {phase === 'error' && <p className="mt-2 text-sm text-red-300">{errorText}</p>}
          <Button className="mt-4" variant="primary" size="lg" onClick={start} disabled={phase === 'starting'} data-testid="ear-start">
            {phase === 'error' ? 'Try again' : 'Start'}
          </Button>
        </Card>
      ) : (
        <>
          <div className="text-sm text-muted" data-testid="ear-prompt">
            Note {index + 1} of {total}
          </div>
          <div className="text-3xl font-bold">
            {phase === 'listen' ? 'Listen…' : phase === 'turn' ? 'Your turn' : judgement === 'miss' ? 'Not quite' : judgement === 'good' ? 'Good' : 'Perfect'}
          </div>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-panel-2" aria-hidden>
            <div
              key={`${index}-${phase === 'turn'}-${bar.run}`}
              className="h-full bg-accent"
              style={{ width: phase === 'feedback' ? '0%' : '100%' }}
              ref={runBar}
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
