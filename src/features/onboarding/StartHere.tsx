import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { audioEngine } from '../../audio/AudioEngine'
import { voiceEnabled } from '../../app/features'
import { getSettings, updateSettings, useSettings } from '../../app/settings'
import { protectStorage } from '../../app/storage'
import { Button, Card, cx } from '../../components/ui'
import { Illustration } from '../../components/diagrams'
import { VOICE_GOAL_SONG_IDS } from '../../lessons/voiceCourse'
import { BUILT_IN_SONGS } from '../../songs'
import { vocalSong } from '../../songs/vocal'
import { startFirstSteps } from '../../training/coach'
import type { FirstStepsSetup } from '../../training/coach'
import type { InstrumentId, VoiceRange } from '../../training/types'
import { loadVoiceProfile, saveVoiceRange } from '../../training/voiceProfile'
import { CalibrationDialog } from '../settings/CalibrationDialog'
import { GuidedTuner } from '../tuner/GuidedTuner'
import { RangeFinder } from '../voice/RangeFinder'
import { rangeText } from '../voice/rangeFinder'
import { WIZARD_FRAME_STYLE } from './wizardLayout'
import {
  BACK_TO_GUITAR,
  VOICE_SETUP_COPY,
  canContinue,
  initialWizardState,
  offersBackToGuitar,
  offersSkipSetup,
  skipSetup,
  stepOrder,
  summarise,
  toSetup,
  toVoiceSetup,
  voiceSettings,
  wizardInstrument,
  wizardReducer,
} from './wizardState'

/** The songs a singer can aim for: the course songs that fit every voice. */
const GOAL_SONGS = VOICE_GOAL_SONG_IDS.map((id) => vocalSong(id)).filter((song) => song !== undefined)

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

/**
 * The microphone check. `prompt` is what to do once it listens (a singer has no string to pluck).
 * `reopen` opens the microphone without a tap, for a check that had it before something else closed it.
 */
function MicCheck({ prompt = 'Pluck any string and watch the bar move.', reopen = false }: { prompt?: string; reopen?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'starting' | 'on' | 'error'>(reopen ? 'starting' : 'idle')
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState(false)
  const unsub = useRef<(() => void) | null>(null)
  const onScreen = useRef(false)

  // A chain and not an `async` function: nothing here changes state before the microphone has
  // answered, so it can also be called while the screen opens.
  const open = (): Promise<void> => {
    audioEngine.unlock()
    const s = getSettings()
    return audioEngine
      .startMic({ deviceId: s.inputDeviceId || undefined, echoCancellation: s.echoCancellation })
      .then(() => {
        // The learner moved on while the microphone was being opened (it can take a second on a phone):
        // a listener added now would never be taken off again, and would be handed every frame of every
        // song from here on.
        if (!onScreen.current) return
        unsub.current?.()
        unsub.current = audioEngine.subscribe((frame) => {
          setLevel(Math.min(1, frame.rms * 8))
          if (frame.rms > 0.005) setHeard(true)
        })
        setStatus('on')
      })
      .catch(() => setStatus('error'))
  }

  const openOnArrival = useEffectEvent(() => {
    if (reopen) void open()
  })
  useEffect(() => {
    onScreen.current = true
    openOnArrival()
    return () => {
      onScreen.current = false
      unsub.current?.()
      // The step that follows (tuning, or finding a singer's easy notes) takes the microphone over; if nothing does, it closes in a moment.
      audioEngine.releaseMic()
    }
  }, [])

  const allow = () => {
    setStatus('starting')
    void open()
  }

  return (
    <div className="flex flex-col gap-3">
      {status !== 'on' && (
        <Button variant="primary" size="lg" data-testid="start-mic-allow" disabled={status === 'starting'} onClick={allow}>
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
          <p className="text-sm text-muted">{prompt}</p>
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

const linkClass = 'self-start text-sm text-muted underline'

/**
 * A singer's phone step: where to put the phone, the headphones question, the microphone check, and
 * the sound sync when this device has never been measured. Every part can be passed by.
 */
function VoicePhone({ headphones, onHeadphones, onContinue }: { headphones: boolean | null; onHeadphones: (wearing: boolean) => void; onContinue: () => void }) {
  const copy = VOICE_SETUP_COPY.phone
  const settings = useSettings()
  // Decided when the screen opens: once measured here, the card stays to say so.
  const [offerSync] = useState(() => getSettings().calibratedAt === undefined)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  // The sound sync takes the microphone and closes it when it is done, whatever the check was doing
  // with it. So the check starts afresh after every sync (each `round` is a new check): it opens the
  // microphone again by itself when it had it open before, or when the sync has just shown that the
  // microphone may be used, and otherwise waits for its tap. A check left as it was could go on saying
  // "watch the bar move" over a bar that no microphone moves any more.
  const [mic, setMic] = useState({ round: 0, reopen: false })
  const micAfterSync = useRef(false)
  const openSync = () => {
    micAfterSync.current = audioEngine.micActive
    setSyncing(true)
  }
  const closeSync = () => {
    setSyncing(false)
    setMic(({ round }) => ({ round: round + 1, reopen: micAfterSync.current }))
  }
  const onSynced = (ms: number) => {
    updateSettings({ latencyMs: ms, calibratedAt: Date.now() })
    micAfterSync.current = true
    setSynced(true)
  }
  return (
    <>
      <h1 className="text-2xl font-bold">{copy.title}</h1>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        <li>{copy.place}</li>
        <li>{copy.lean}</li>
      </ul>
      <div className="mx-auto my-4 w-full max-w-xs text-muted">
        <Illustration id="voice-phone" />
      </div>
      <h2 className="text-lg font-semibold">{copy.headphones.question}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Choice id="start-headphones-yes" title={copy.headphones.yes} selected={headphones === true} onClick={() => onHeadphones(true)} />
        <Choice id="start-headphones-no" title={copy.headphones.no} selected={headphones === false} onClick={() => onHeadphones(false)} />
      </div>
      {headphones !== null && (
        <p className="mt-2 text-sm text-muted" data-testid="start-headphones-line">
          {headphones ? copy.headphones.withThem : copy.headphones.without}
        </p>
      )}
      <div className="mt-5">
        <MicCheck key={mic.round} prompt={copy.micPrompt} reopen={mic.reopen} />
      </div>
      {offerSync && (
        <Card className="mt-4">
          <div data-testid="start-sync" data-synced={synced}>
            <h2 className="font-semibold">{copy.sync.title}</h2>
            {synced ? (
              <p className="mt-1 font-semibold text-accent" data-testid="start-sync-done">
                {copy.sync.done}
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted">{copy.sync.text}</p>
                <Button className="mt-3" onClick={openSync} data-testid="start-sync-open">
                  {copy.sync.start}
                </Button>
                <p className="mt-2 text-xs text-muted">{copy.sync.later}</p>
              </>
            )}
          </div>
        </Card>
      )}
      <button type="button" className={cx(linkClass, 'mt-4')} onClick={onContinue}>
        Continue without the microphone
      </button>
      {/* The singer's words, the same measurement. It writes what the Settings page writes. */}
      {syncing && <CalibrationDialog instrument="voice" deviceId={settings.inputDeviceId || undefined} onClose={closeSync} onResult={onSynced} />}
    </>
  )
}

/**
 * The set-up. `/start` is the guitar's, as it always was. `/start?instrument=voice` is a singer's,
 * once the singing side is switched on: other questions, other steps, and it saves to the singing
 * profile only. Each is its own walk from the first screen, so an address changed under an open
 * set-up cannot leave half of one inside the other.
 */
export function StartHere() {
  const [query] = useSearchParams()
  const instrument = wizardInstrument(query.get('instrument'), voiceEnabled())
  return <Wizard key={instrument} instrument={instrument} />
}

function Wizard({ instrument }: { instrument: InstrumentId }) {
  const navigate = useNavigate()
  const voice = instrument === 'voice'
  const hasSongs = voice ? GOAL_SONGS.length > 0 : BUILT_IN_SONGS.length > 0
  const [state, dispatch] = useReducer(wizardReducer, undefined, () => initialWizardState(hasSongs, instrument))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The easy notes the singer had when they asked to find them again: the way back while the finder is open. */
  const [kept, setKept] = useState<VoiceRange | null>(null)
  const order = stepOrder(hasSongs, state.experience, instrument)
  const index = order.indexOf(state.step)
  const next = () => dispatch({ type: 'next' })

  /**
   * Shows the easy notes that are stored. The range finder saves by itself the moment it has a result,
   * so what is stored is what the set-up has to show; `otherwise` is shown when nothing can be read.
   */
  const showStoredRange = (otherwise: VoiceRange | null = null): Promise<void> =>
    loadVoiceProfile().then(
      (stored) => {
        if (stored.range ?? otherwise) dispatch({ type: 'setRange', value: stored.range ?? otherwise })
      },
      () => {
        if (otherwise) dispatch({ type: 'setRange', value: otherwise })
      },
    )
  // A singer who left the set-up after their easy notes were found does not have to find them again.
  const showRangeOnArrival = useEffectEvent(() => {
    if (voice) void showStoredRange()
  })
  useEffect(() => showRangeOnArrival(), [])

  const finish = async (setup: FirstStepsSetup) => {
    setBusy(true)
    setError(null)
    try {
      await startFirstSteps(setup)
      // There is now something worth keeping: ask the browser not to clear it. Never waits, never shows a prompt.
      void protectStorage()
      navigate('/')
    } catch {
      setError('Something went wrong saving your setup. Please try again.')
      setBusy(false)
    }
  }

  /** Finishes the singing set-up. It writes the singing profile, its lessons and its songs, and nothing of the guitar. */
  const finishVoice = async () => {
    setBusy(true)
    setError(null)
    try {
      // The range finder stored the easy notes when it found them. Should they be gone all the same
      // (the singing data was reset in another window), they go in again first: a singer is never set
      // up without notes to sing in.
      if (!(await loadVoiceProfile()).range) {
        if (!state.range) throw new Error('The set-up has no easy notes to save.')
        await saveVoiceRange(state.range)
      }
      await startFirstSteps(toVoiceSetup(state), Date.now(), 'voice')
      // Only now does the app show the singing side: a set-up that could not be saved leaves the switch alone.
      updateSettings(voiceSettings(state))
      void protectStorage()
      // In place of the set-up, so "back" from Today does not open it again.
      navigate('/', { replace: true })
    } catch {
      setError(VOICE_SETUP_COPY.finish.trouble)
      setBusy(false)
    }
  }

  /**
   * "Back". For a singer who leaves the range finder this way, the notes it may just have stored are
   * picked up first: the finder saves a result the moment it has one, before "Done" is tapped, and
   * coming forward again must not ask for notes that are already there.
   */
  const back = () => {
    if (voice && state.step === 'range' && !state.range) void showStoredRange(kept)
    dispatch({ type: 'back' })
  }

  /** "Not now, back to guitar": the switch goes back, and nothing else is touched. */
  const backToGuitar = () => {
    updateSettings(BACK_TO_GUITAR)
    navigate('/', { replace: true })
  }

  let body: ReactNode
  let showNext = true
  switch (state.step) {
    case 'welcome':
      body = voice ? (
        <>
          <h1 className="text-3xl font-bold">{VOICE_SETUP_COPY.welcome.title}</h1>
          <h2 className="mt-2 text-lg text-muted">{VOICE_SETUP_COPY.welcome.question}</h2>
          <div className="mt-5 flex flex-col gap-3">
            {(['new', 'some', 'played'] as const).map((answer) => (
              <Choice
                key={answer}
                id={`start-experience-${answer}`}
                title={VOICE_SETUP_COPY.welcome[answer].title}
                hint={VOICE_SETUP_COPY.welcome[answer].hint}
                selected={state.experience === answer}
                onClick={() => dispatch({ type: 'setExperience', value: answer })}
              />
            ))}
          </div>
          {offersBackToGuitar(state) && (
            <button type="button" data-testid="start-back-to-guitar" className={cx(linkClass, 'mt-5 py-2')} disabled={busy} onClick={backToGuitar}>
              {VOICE_SETUP_COPY.welcome.backToGuitar}
            </button>
          )}
        </>
      ) : (
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
      body = voice ? (
        <>
          <h1 className="text-2xl font-bold">{VOICE_SETUP_COPY.song.title}</h1>
          <p className="mt-1 text-sm text-muted">{VOICE_SETUP_COPY.song.text}</p>
          <div className="mt-4 flex flex-col gap-3">
            {GOAL_SONGS.map((song) => (
              <Choice
                key={song.id}
                id={`start-song-${song.id}`}
                title={song.title}
                hint={song.description}
                selected={state.goalSongId === song.id}
                onClick={() => dispatch({ type: 'setSong', value: state.goalSongId === song.id ? undefined : song.id })}
              />
            ))}
          </div>
        </>
      ) : (
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
      body = voice ? (
        <VoicePhone headphones={state.headphones} onHeadphones={(value) => dispatch({ type: 'setHeadphones', value })} onContinue={next} />
      ) : (
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
    case 'range':
      if (state.range) {
        const range = state.range
        body = (
          <>
            <h1 className="text-2xl font-bold">{VOICE_SETUP_COPY.range.title}</h1>
            <Card className="mt-4">
              <p className="text-lg font-semibold" data-testid="start-range">
                {rangeText(range)}
              </p>
              <p className="mt-1 text-sm text-muted">{VOICE_SETUP_COPY.range.text}</p>
            </Card>
            <button
              type="button"
              className={cx(linkClass, 'mt-4 py-2')}
              data-testid="start-range-again"
              onClick={() => {
                setKept(range)
                dispatch({ type: 'setRange', value: null })
              }}
            >
              {VOICE_SETUP_COPY.range.again}
            </button>
          </>
        )
      } else {
        // The finder has its own way on, and no way out without easy notes: skipping it leads to the
        // two starting ranges, of which one has to be picked. Only a singer who came here to find
        // their notes again is offered "Not now", and goes back to the notes that are stored.
        showNext = false
        body = (
          <RangeFinder
            autoStart
            onDone={(range) => {
              setKept(null)
              dispatch({ type: 'setRange', value: range })
              next()
            }}
            onSkip={kept ? () => void showStoredRange(kept) : undefined}
          />
        )
      }
      break
    case 'finish':
      showNext = false
      body = (
        <>
          <h1 className="text-2xl font-bold">{voice ? VOICE_SETUP_COPY.finish.title : "You're ready"}</h1>
          <Card className="mt-4">
            <p data-testid="start-summary">{summarise(state)}</p>
          </Card>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {error}
            </p>
          )}
          {voice ? (
            <Button variant="primary" size="lg" className="mt-5 w-full" data-testid="start-finish" disabled={busy} onClick={() => void finishVoice()}>
              {state.experience === 'played' ? VOICE_SETUP_COPY.finish.practice : VOICE_SETUP_COPY.finish.course}
            </Button>
          ) : (
            <Button variant="primary" size="lg" className="mt-5 w-full" data-testid="start-finish" disabled={busy} onClick={() => void finish(toSetup(state))}>
              {state.experience === 'played' ? 'Set up my training' : 'Start lesson 1'}
            </Button>
          )}
        </>
      )
      break
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4" style={WIZARD_FRAME_STYLE} data-testid="start-here" data-instrument={instrument}>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={order.length} aria-valuenow={index + 1} aria-label="Setup progress">
          {order.map((s, i) => (
            <span key={s} className={cx('h-2 w-2 rounded-full', i <= index ? 'bg-accent' : 'bg-line')} />
          ))}
        </div>
        {offersSkipSetup(state) && (
          <button type="button" data-testid="start-skip" className="text-sm text-muted underline" disabled={busy} onClick={() => void finish(skipSetup(state))}>
            Skip setup
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col">{body}</div>
      <div className="flex gap-3">
        {index > 0 && (
          <Button size="lg" data-testid="start-back" onClick={back}>
            Back
          </Button>
        )}
        {showNext && (
          <Button variant="primary" size="lg" className="flex-1" data-testid="start-next" disabled={!canContinue(state)} onClick={next}>
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}
