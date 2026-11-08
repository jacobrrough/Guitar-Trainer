import { useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { audioEngine } from '../../audio/AudioEngine'
import { getSettings } from '../../app/settings'
import { Button, Card, cx } from '../../components/ui'
import { Illustration } from '../../components/diagrams'
import { BUILT_IN_SONGS } from '../../songs'
import { startFirstSteps } from '../../training/coach'
import type { FirstStepsSetup } from '../../training/coach'
import { GuidedTuner } from '../tuner/GuidedTuner'
import { initialWizardState, stepOrder, summarise, toSetup, wizardReducer } from './wizardState'

const DEFAULT_SETUP: FirstStepsSetup = { experience: 'new', handedness: 'right', guitarType: 'acoustic', dailyMinutes: 10 }

function Choice({ id, selected, title, hint, onClick }: { id: string; selected: boolean; title: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={id}
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'flex min-h-16 w-full flex-col items-start justify-center rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected ? 'border-accent bg-accent/15' : 'border-line bg-panel hover:bg-panel-2',
      )}
    >
      <span className="text-base font-semibold">{title}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </button>
  )
}

function MicCheck() {
  const [status, setStatus] = useState<'idle' | 'starting' | 'on' | 'error'>('idle')
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState(false)
  const unsub = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      unsub.current?.()
      audioEngine.stopMic()
    },
    [],
  )

  const allow = async () => {
    audioEngine.unlock()
    setStatus('starting')
    try {
      const s = getSettings()
      await audioEngine.startMic({ deviceId: s.inputDeviceId || undefined, echoCancellation: s.echoCancellation })
      unsub.current?.()
      unsub.current = audioEngine.subscribe((frame) => {
        setLevel(Math.min(1, frame.rms * 8))
        if (frame.rms > 0.01) setHeard(true)
      })
      setStatus('on')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {status !== 'on' && (
        <Button variant="primary" size="lg" data-testid="start-mic-allow" disabled={status === 'starting'} onClick={() => void allow()}>
          {status === 'starting' ? 'Starting…' : 'Allow the microphone'}
        </Button>
      )}
      {status === 'error' && (
        <p role="alert" className="text-sm text-red-300">
          We could not use the microphone. Check that you allowed it in your browser, then try again, or continue without it.
        </p>
      )}
      {status === 'on' && (
        <>
          <p className="text-sm text-muted">Pluck any string and watch the bar move.</p>
          <div className="h-3 w-full overflow-hidden rounded-full bg-panel-2" aria-hidden>
            <div className="h-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          {heard && (
            <p data-testid="start-mic-ok" className="font-semibold text-accent">
              We can hear you
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function StartHere() {
  const navigate = useNavigate()
  const hasSongs = BUILT_IN_SONGS.length > 0
  const [state, dispatch] = useReducer(wizardReducer, hasSongs, initialWizardState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const order = stepOrder(hasSongs, state.experience)
  const index = order.indexOf(state.step)
  const next = () => dispatch({ type: 'next' })

  const finish = async (setup: FirstStepsSetup) => {
    setBusy(true)
    setError(null)
    try {
      await startFirstSteps(setup)
      navigate('/')
    } catch {
      setError('Something went wrong saving your setup. Please try again.')
      setBusy(false)
    }
  }

  let body: ReactNode
  let showNext = true
  switch (state.step) {
    case 'welcome':
      body = (
        <>
          <h1 className="text-3xl font-bold">Let's get you playing.</h1>
          <h2 className="mt-2 text-lg text-muted">Have you played guitar before?</h2>
          <div className="mt-5 flex flex-col gap-3">
            <Choice id="start-experience-new" title="Never" hint="Start from the very beginning" selected={state.experience === 'new'} onClick={() => dispatch({ type: 'setExperience', value: 'new' })} />
            <Choice id="start-experience-some" title="A little" hint="I know a few things" selected={state.experience === 'some'} onClick={() => dispatch({ type: 'setExperience', value: 'some' })} />
            <Choice id="start-experience-played" title="Yes, I can play" hint="Check my level instead" selected={state.experience === 'played'} onClick={() => dispatch({ type: 'setExperience', value: 'played' })} />
          </div>
        </>
      )
      break
    case 'guitar':
      body = (
        <>
          <h1 className="text-2xl font-bold">Your guitar</h1>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Choice id="start-guitar-acoustic" title="Acoustic" selected={state.guitarType === 'acoustic'} onClick={() => dispatch({ type: 'setGuitar', value: 'acoustic' })} />
            <Choice id="start-guitar-electric" title="Electric" selected={state.guitarType === 'electric'} onClick={() => dispatch({ type: 'setGuitar', value: 'electric' })} />
          </div>
          <h2 className="mt-6 text-lg font-semibold">Which hand strums?</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Choice id="start-hand-right" title="Right" selected={state.handedness === 'right'} onClick={() => dispatch({ type: 'setHand', value: 'right' })} />
            <Choice id="start-hand-left" title="Left" selected={state.handedness === 'left'} onClick={() => dispatch({ type: 'setHand', value: 'left' })} />
          </div>
          <div className="mx-auto mt-5 w-full max-w-xs text-muted">
            <Illustration id="sitting" handedness={state.handedness} />
          </div>
        </>
      )
      break
    case 'time':
      body = (
        <>
          <h1 className="text-2xl font-bold">How long each day?</h1>
          <div className="mt-4 flex flex-col gap-3">
            {([10, 20, 30] as const).map((m) => (
              <Choice key={m} id={`start-minutes-${m}`} title={`${m} minutes`} hint={m === 10 ? 'A good start' : undefined} selected={state.dailyMinutes === m} onClick={() => dispatch({ type: 'setMinutes', value: m })} />
            ))}
          </div>
        </>
      )
      break
    case 'song':
      body = (
        <>
          <h1 className="text-2xl font-bold">Pick a song to aim for</h1>
          <p className="mt-1 text-sm text-muted">Optional. It gives your first weeks a target.</p>
          <div className="mt-4 flex flex-col gap-3">
            {BUILT_IN_SONGS.map((song) => (
              <Choice
                key={song.id}
                id={`start-song-${song.id}`}
                title={`${song.title} · ${song.artist}`}
                hint={song.description}
                selected={state.goalSongId === song.id}
                onClick={() => dispatch({ type: 'setSong', value: state.goalSongId === song.id ? undefined : song.id })}
              />
            ))}
          </div>
        </>
      )
      break
    case 'phone':
      body = (
        <>
          <h1 className="text-2xl font-bold">Phone and sound</h1>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            <li>Prop the phone at arm's length, facing the guitar.</li>
            <li>Headphones give honest scores.</li>
            <li>Keep the speaker away from the microphone.</li>
          </ul>
          <div className="mx-auto my-4 w-full max-w-xs text-muted">
            <Illustration id="phone-placement" />
          </div>
          <MicCheck />
          <button type="button" className="mt-4 self-start text-sm text-muted underline" onClick={next}>
            Continue without the microphone
          </button>
        </>
      )
      break
    case 'tune': {
      showNext = false
      const tunerProps = { autoStart: true, onDone: next, onSkip: next }
      body = <GuidedTuner {...tunerProps} />
      break
    }
    case 'finish':
      showNext = false
      body = (
        <>
          <h1 className="text-2xl font-bold">You're ready</h1>
          <Card className="mt-4">
            <p data-testid="start-summary">{summarise(state)}</p>
          </Card>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {error}
            </p>
          )}
          <Button variant="primary" size="lg" className="mt-5 w-full" data-testid="start-finish" disabled={busy} onClick={() => void finish(toSetup(state))}>
            {state.experience === 'played' ? 'Set up my training' : 'Start lesson 1'}
          </Button>
        </>
      )
      break
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 p-4 pb-8" data-testid="start-here">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={order.length} aria-valuenow={index + 1} aria-label="Setup progress">
          {order.map((s, i) => (
            <span key={s} className={cx('h-2 w-2 rounded-full', i <= index ? 'bg-accent' : 'bg-line')} />
          ))}
        </div>
        <button type="button" data-testid="start-skip" className="text-sm text-muted underline" disabled={busy} onClick={() => void finish(DEFAULT_SETUP)}>
          Skip setup
        </button>
      </div>
      <div className="flex flex-1 flex-col">{body}</div>
      <div className="flex gap-3">
        {index > 0 && (
          <Button size="lg" data-testid="start-back" onClick={() => dispatch({ type: 'back' })}>
            Back
          </Button>
        )}
        {showNext && (
          <Button variant="primary" size="lg" className="flex-1" data-testid="start-next" disabled={state.step === 'welcome' && !state.experience} onClick={next}>
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}
