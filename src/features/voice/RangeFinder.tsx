import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { useMicActive } from '../../audio/useMicActive'
import { Button, Card, cx } from '../../components/ui'
import { DEFAULT_RANGES } from '../../music/keys'
import type { VoiceRange } from '../../training/types'
import { loadVoiceProfile, saveVoiceRange } from '../../training/voiceProfile'
import type { Heard } from '../play/voice/voiceEar'
import { GuidePlayer } from './noteMatch'
import { EasyNotes, PitchLadder, VoiceMic, type VoiceMicState } from './PitchLadder'
import { RANGE_COPY, RANGE_DETECTOR, STEPS, Take, finderReducer, finderView, newFinder, rangeText, resultLine, sameNotes, stepLabel, unheardLine, type FinderAction, type FinderState } from './rangeFinder'

export interface RangeFinderProps {
  /** The learner has their easy notes: called with the range as it was stored. */
  onDone?: (range: VoiceRange) => void
  /** Offers "Not now": leave without any easy notes. */
  onSkip?: () => void
  /** Open the microphone without a tap: permission was given on the screen before. */
  autoStart?: boolean
}

type Voice = keyof typeof DEFAULT_RANGES

/** How long a starting range's note sounds when its button is tapped (seconds). */
const CHOICE_NOTE = 1.2
/** How often the open step is looked at (ms): it ends by itself when the singer has finished. */
const LOOK_EVERY = 100
const IDLE: { status: Take['status']; progress: number } = { status: 'waiting', progress: 0 }

const linkClass = 'text-sm text-muted underline hover:text-slate-200'

function Choice({ id, selected, title, hint, onClick }: { id: string; selected: boolean; title: string; hint: string; onClick: () => void }) {
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
      <span className="text-sm text-muted">{hint}</span>
    </button>
  )
}

/**
 * Finds the singer's easy notes and stores them: a hum, two slides down, two slides up, under a minute,
 * every step skippable. Without a microphone, or when the hum is skipped, two starting ranges are
 * offered instead, each with its note to listen to. Same contract as the guided tuner, so the set-up,
 * a lesson and the "My voice" page can all show it. What it decides is decided in rangeFinder.ts.
 */
export function RangeFinder({ onDone, onSkip, autoStart }: RangeFinderProps) {
  const listening = useMicActive()
  const [state, setState] = useState<FinderState>(newFinder)
  /** The range as the store gave it back: an easy note outside the range comes back moved. */
  const [stored, setStored] = useState<VoiceRange | null>(null)
  const [saveTrouble, setSaveTrouble] = useState(false)
  const [meter, setMeter] = useState(IDLE)
  const [picked, setPicked] = useState<Voice | null>(null)
  /**
   * The easy notes the singer had when this screen opened, if any. A result is stored the moment it is
   * there, so the result screen offers the way back to these: a walk in a noisy room must not cost
   * anyone the notes that were found on a good day.
   */
  const [previous, setPrevious] = useState<VoiceRange | undefined>(undefined)
  const take = useRef<Take | null>(null)
  const [player] = useState(() => new GuidePlayer())

  // Read once, when the screen opens: what this screen stores later is not "from before".
  useEffect(() => {
    let open = true
    void loadVoiceProfile().then(
      (voice) => {
        if (open) setPrevious(voice.range)
      },
      () => {
        // Nothing could be read: there is then nothing to offer, and the walk goes on as for a first time.
      },
    )
    return () => {
      open = false
    }
  }, [])

  useEffect(() => {
    player.open()
    return () => player.close()
  }, [player])

  const store = async (range: VoiceRange): Promise<VoiceRange | null> => {
    setSaveTrouble(false)
    try {
      const voice = await saveVoiceRange(range)
      const kept = voice.range ?? range
      setStored(kept)
      return kept
    } catch {
      setSaveTrouble(true)
      return null
    }
  }

  /** Back to the notes from before this walk, and out. */
  const keepPrevious = async () => {
    if (!previous) return
    const kept = await store(previous)
    if (kept) onDone?.(kept)
  }

  /** "A bit lower" or "A bit higher" was stored: that is the range now, whatever happened to the save before it. */
  const onMoved = (range: VoiceRange) => {
    setSaveTrouble(false)
    setStored(range)
  }

  const act = (action: FinderAction) => {
    const next = finderReducer(state, action)
    setState(next)
    setMeter(IDLE)
    // A step that follows a sung one opens without a tap, perhaps before the singer has quite stopped.
    take.current = next.stage === 'listen' ? new Take(STEPS[next.step], action.type === 'heard') : null
    if (next.range === state.range) return
    // A new result is stored as soon as it is there, so closing the screen now does not lose it.
    setStored(null)
    if (next.range) void store(next.range)
  }

  const look = useEffectEvent(() => {
    const open = take.current
    if (!open) return
    setMeter({ status: open.status, progress: open.progress })
    if (open.status === 'done') act({ type: 'heard', heard: open.heard, at: Date.now() })
  })
  useEffect(() => {
    if (state.stage !== 'listen' || !listening) return
    const id = setInterval(() => look(), LOOK_EVERY)
    return () => clearInterval(id)
  }, [state.stage, listening])

  const onHeard = (heard: readonly Heard[], time: number) => take.current?.add(heard, time)

  const begin = async (mic: VoiceMicState) => {
    if (!mic.listening && !(await mic.start())) return
    act({ type: 'start' })
  }

  const hearChoice = (voice: Voice) => {
    setPicked(voice)
    audioEngine.unlock()
    player.play(audioEngine.context, DEFAULT_RANGES[voice].easy, CHOICE_NOTE)
  }

  const kind = STEPS[state.step]
  const shown = stored ?? state.range
  const skipAll = (
    <button type="button" className={linkClass} onClick={() => act({ type: 'skip', at: Date.now() })} data-testid="range-skip">
      {RANGE_COPY.skipAll}
    </button>
  )
  const notNow = onSkip && (
    <button type="button" className={linkClass} onClick={onSkip} data-testid="range-not-now">
      {RANGE_COPY.notNow}
    </button>
  )
  const care = <p className="max-w-sm text-sm text-muted">{RANGE_COPY.care}</p>

  const body = (mic: VoiceMicState): ReactNode => {
    switch (state.stage) {
      case 'intro':
        return (
          <>
            <h2 className="text-2xl font-bold">{RANGE_COPY.title}</h2>
            <p className="max-w-sm text-slate-200">{RANGE_COPY.intro}</p>
            {care}
            {mic.failed && (
              <p role="alert" className="max-w-sm text-sm text-red-300">
                {RANGE_COPY.micTrouble}
              </p>
            )}
            <Button variant="primary" size="lg" disabled={mic.starting} onClick={() => void begin(mic)} data-testid="range-start">
              {RANGE_COPY.start}
            </Button>
            {skipAll}
            {notNow}
          </>
        )
      case 'listen':
        return (
          <>
            <p className="text-xs uppercase tracking-wide text-muted">{stepLabel(state.step)}</p>
            <h2 className="max-w-sm text-xl font-bold">{RANGE_COPY.steps[kind].title}</h2>
            <p className="max-w-sm text-sm text-muted">{state.step > 0 && STEPS[state.step - 1] === kind ? RANGE_COPY.again : RANGE_COPY.steps[kind].hint}</p>
            <PitchLadder view={finderView(state.measured.hum)} dot={mic.dot} className="h-48" />
            {kind === 'hum' && (
              <div className="h-2 w-48 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${Math.round(meter.progress * 100)}%` }} />
              </div>
            )}
            {mic.listening ? (
              <p className="font-semibold text-accent" aria-live="polite" data-testid="range-status" data-status={meter.status}>
                {meter.status === 'hearing' ? RANGE_COPY.hearing : RANGE_COPY.waiting}
              </p>
            ) : (
              <>
                <p role="alert" className="max-w-sm text-sm text-red-300">
                  {mic.failed ? RANGE_COPY.micTrouble : RANGE_COPY.micOff}
                </p>
                <Button variant="primary" disabled={mic.starting} onClick={() => void mic.start()} data-testid="range-mic">
                  {RANGE_COPY.start}
                </Button>
              </>
            )}
            {care}
            <Button onClick={() => act({ type: 'skip', at: Date.now() })} data-testid="range-skip-step">
              {RANGE_COPY.skipStep}
            </Button>
          </>
        )
      case 'unheard':
        return (
          <>
            <p className="text-xs uppercase tracking-wide text-muted">{stepLabel(state.step)}</p>
            <h2 className="max-w-sm text-xl font-bold">{RANGE_COPY.steps[kind].title}</h2>
            <p className="max-w-sm text-slate-200" aria-live="polite" data-testid="range-unheard" data-strong={state.strong}>
              {unheardLine(state)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => act({ type: 'again' })} data-testid="range-again">
                {RANGE_COPY.tryAgain}
              </Button>
              <Button onClick={() => act({ type: 'skip', at: Date.now() })} data-testid="range-skip-step">
                {RANGE_COPY.skipStep}
              </Button>
            </div>
            {care}
          </>
        )
      case 'choose':
        return (
          <>
            <h2 className="text-2xl font-bold">{RANGE_COPY.choose.title}</h2>
            <p className="max-w-sm text-slate-200">{RANGE_COPY.choose.text}</p>
            <div className="flex w-full max-w-sm flex-col gap-3">
              <Choice id="range-choose-lower" title={RANGE_COPY.choose.lower} hint={rangeText(DEFAULT_RANGES.lower)} selected={picked === 'lower'} onClick={() => hearChoice('lower')} />
              <Choice id="range-choose-higher" title={RANGE_COPY.choose.higher} hint={rangeText(DEFAULT_RANGES.higher)} selected={picked === 'higher'} onClick={() => hearChoice('higher')} />
            </div>
            <Button variant="primary" size="lg" disabled={!picked} onClick={() => picked && act({ type: 'choose', voice: picked, at: Date.now() })} data-testid="range-use">
              {RANGE_COPY.choose.use}
            </Button>
            <button type="button" className={linkClass} onClick={() => act({ type: 'restart' })} data-testid="range-listen">
              {RANGE_COPY.choose.listen}
            </button>
            {notNow}
          </>
        )
      case 'result':
        return (
          shown && (
            <EasyNotes range={shown} onMoved={onMoved}>
              <p className="max-w-sm text-sm text-muted" data-testid="range-result-line">
                {resultLine(state)}
              </p>
              {saveTrouble && state.range && (
                <>
                  <p role="alert" className="max-w-sm text-sm text-red-300">
                    {RANGE_COPY.result.notSaved}
                  </p>
                  <Button onClick={() => state.range && void store(state.range)} data-testid="range-save-again">
                    {RANGE_COPY.tryAgain}
                  </Button>
                </>
              )}
              {onDone && (
                <Button variant="primary" size="lg" disabled={!stored} onClick={() => stored && onDone(stored)} data-testid="range-done">
                  {RANGE_COPY.result.done}
                </Button>
              )}
              <button type="button" className={linkClass} onClick={() => act({ type: 'restart' })} data-testid="range-restart">
                {RANGE_COPY.result.again}
              </button>
              {previous && !sameNotes(previous, shown) && (
                <button type="button" className={linkClass} onClick={() => void keepPrevious()} data-testid="range-keep">
                  {RANGE_COPY.result.keep}
                </button>
              )}
            </EasyNotes>
          )
        )
    }
  }

  return (
    <div data-testid="range-finder" data-stage={state.stage} data-step={state.step}>
      <Card className="flex flex-col items-center gap-3 py-6 text-center">
        {/* While the starting ranges play their notes nothing is listened to: the app would be hearing itself. */}
        <VoiceMic detector={RANGE_DETECTOR} autoStart={autoStart} ears={state.stage === 'listen' ? 'voice' : state.stage === 'choose' ? 'closed' : 'room'} onHeard={onHeard}>
          {body}
        </VoiceMic>
      </Card>
    </div>
  )
}
