import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { useMicActive } from '../../audio/useMicActive'
import { Illustration } from '../../components/diagrams'
import { Button, Card } from '../../components/ui'
import { DEFAULT_RANGES, type RangeAroundEasy } from '../../music/keys'
import { loadVoiceProfile } from '../../training/voiceProfile'
import { voiceDetector } from '../play/voice/judge'
import type { Heard } from '../play/voice/voiceEar'
import { GuidePlayer, MATCH, MATCH_COPY, NoteMatcher, foldNear, matchLine, matchNotes, noteLabel, type MatchView } from './noteMatch'
import { PitchLadder, VoiceMic, type VoiceMicState } from './PitchLadder'
import { RANGE_COPY, ladderView } from './rangeFinder'

export interface NoteMatchProps {
  onDone?: () => void
  /** Offers "Skip this for now". */
  onSkip?: () => void
  /** Open the microphone without a tap: permission was given on the screen before. */
  autoStart?: boolean
  /** The singer's easy notes. Left out, they are read from the singing profile (the lower starting range when none is stored). */
  range?: RangeAroundEasy
}

/** How often the open note is looked at (ms). */
const LOOK_EVERY = 100
/** How long "That is the note" stays before the next note is sung (ms). */
const FOUND_PAUSE = 1600

const linkClass = 'text-sm text-muted underline hover:text-slate-200'

/**
 * "Meet the note": the app sings a note, then the learner slides until their dot sits on the bar and
 * holds it. Three notes from their easy notes. Nothing is scored and nothing is stored; a note that is
 * not found is "not yet" and the learner goes on. Same contract as the guided tuner, so a lesson can
 * show it where the guitar course shows the tuner. What counts as found is decided in noteMatch.ts.
 */
export function NoteMatch({ onDone, onSkip, autoStart, range: given }: NoteMatchProps) {
  const listening = useMicActive()
  const profile = useLiveQuery(loadVoiceProfile)
  // Undefined only while the profile is being read.
  const known: RangeAroundEasy | undefined = given ?? (profile ? (profile.range ?? DEFAULT_RANGES.lower) : undefined)
  /** The notes of this go and the range they were taken from: fixed at Start, whatever is stored meanwhile. */
  const [go, setGo] = useState<{ notes: number[]; range: RangeAroundEasy } | null>(null)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'intro' | 'tone' | 'sing' | 'end'>('intro')
  /** Counts the notes sung by the app, so that hearing one again starts its timers again. */
  const [turn, setTurn] = useState(0)
  /** Milliseconds from the start of the app's note until listening opens. */
  const [opensIn, setOpensIn] = useState(0)
  const [view, setView] = useState<MatchView | null>(null)
  const matcher = useRef<NoteMatcher | null>(null)
  const [player] = useState(() => new GuidePlayer())

  useEffect(() => {
    player.open()
    return () => player.close()
  }, [player])

  /** The app sings note `i`; the learner's turn opens when it has ended. */
  const sing = (i: number, notes: readonly number[]) => {
    audioEngine.unlock()
    const ctx = audioEngine.context
    // Opens after the note, the time the sound takes to leave the speaker, and the tail of the room.
    const opens = player.play(ctx, notes[i], MATCH.tone) + audioEngine.outputLatency + MATCH.afterTone
    matcher.current = new NoteMatcher(notes[i], opens)
    setIndex(i)
    setView(null)
    setOpensIn((opens - ctx.currentTime) * 1000)
    setTurn((t) => t + 1)
    setPhase('tone')
  }

  const begin = async (mic: VoiceMicState, range: RangeAroundEasy) => {
    // The microphone first, so the learner's turn does not open on a permission question. The notes can
    // be heard with or without it.
    if (!mic.listening) await mic.start()
    const notes = matchNotes(range)
    setGo({ notes, range })
    sing(0, notes)
  }

  const next = () => {
    if (!go) return
    if (index + 1 < go.notes.length) {
      sing(index + 1, go.notes)
      return
    }
    player.stop()
    matcher.current = null
    setPhase('end')
  }

  useEffect(() => {
    if (phase !== 'tone') return
    const id = setTimeout(() => setPhase('sing'), opensIn)
    return () => clearTimeout(id)
  }, [phase, turn, opensIn])

  const look = useEffectEvent(() => {
    if (matcher.current) setView(matcher.current.view())
  })
  useEffect(() => {
    if (phase !== 'sing' || !listening) return
    const id = setInterval(() => look(), LOOK_EVERY)
    return () => clearInterval(id)
  }, [phase, listening, turn])

  // A note that was found is enjoyed for a moment, then the next one comes by itself.
  const found = phase === 'sing' && view?.status === 'found'
  const onward = useEffectEvent(() => next())
  useEffect(() => {
    if (!found) return
    const id = setTimeout(() => onward(), FOUND_PAUSE)
    return () => clearTimeout(id)
  }, [found, turn])

  const onHeard = (heard: readonly Heard[], time: number) => matcher.current?.listen(heard, time)

  const range = go?.range ?? known ?? DEFAULT_RANGES.lower
  const target = go ? go.notes[index] : undefined
  const skip = onSkip && (
    <button type="button" className={linkClass} onClick={onSkip} data-testid="match-skip">
      {MATCH_COPY.skip}
    </button>
  )

  const body = (mic: VoiceMicState): ReactNode => {
    if (phase === 'intro') {
      return (
        <>
          <h2 className="text-2xl font-bold">{MATCH_COPY.title}</h2>
          <p className="max-w-sm text-slate-200">{MATCH_COPY.intro}</p>
          {/* The lesson's own drawing of this screen: the note, your voice, your easy notes. */}
          <Illustration id="pitch-ladder" className="max-h-44 w-full max-w-xs text-slate-200" />
          {mic.failed && (
            <p role="alert" className="max-w-sm text-sm text-red-300">
              {MATCH_COPY.micTrouble}
            </p>
          )}
          <Button variant="primary" size="lg" disabled={!known || mic.starting} onClick={() => known && void begin(mic, known)} data-testid="match-start">
            {MATCH_COPY.start}
          </Button>
          {skip}
        </>
      )
    }
    if (phase === 'end' || !go || target === undefined) {
      return (
        <>
          <h2 className="text-2xl font-bold">{MATCH_COPY.title}</h2>
          <p className="max-w-sm text-slate-200">{MATCH_COPY.end}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {go && (
              <Button onClick={() => sing(0, go.notes)} data-testid="match-again">
                {MATCH_COPY.once}
              </Button>
            )}
            {onDone && (
              <Button variant="primary" size="lg" onClick={onDone} data-testid="match-done">
                {MATCH_COPY.done}
              </Button>
            )}
          </div>
        </>
      )
    }
    const singing = phase === 'sing'
    const line = !singing ? MATCH_COPY.listen : !mic.listening ? (mic.failed ? MATCH_COPY.micTrouble : MATCH_COPY.micOff) : matchLine(view ?? { status: 'listening', where: 'silent', held: 0, octave: 0, quiet: 0 })
    return (
      <>
        <p className="text-xs uppercase tracking-wide text-muted">{noteLabel(index)}</p>
        <PitchLadder view={ladderView(range)} range={range} target={target} dot={mic.dot === null ? null : foldNear(mic.dot, target)} met={singing && (view?.status === 'found' || view?.where === 'on')} />
        <div className="h-2 w-48 overflow-hidden rounded-full bg-panel-2" aria-hidden>
          <div className="h-full bg-ok transition-[width] duration-100" style={{ width: `${Math.round((singing ? (view?.held ?? 0) : 0) * 100)}%` }} />
        </div>
        <p className="max-w-sm text-lg font-semibold" aria-live="polite" data-testid="match-line" data-status={singing ? (view?.status ?? 'listening') : 'tone'}>
          {line}
        </p>
        {singing && !mic.listening && (
          <Button variant="primary" disabled={mic.starting} onClick={() => void mic.start()} data-testid="match-mic">
            {MATCH_COPY.start}
          </Button>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => sing(index, go.notes)} data-testid="match-hear">
            {MATCH_COPY.again}
          </Button>
          <Button variant={view?.status === 'not-yet' ? 'primary' : 'secondary'} onClick={next} data-testid="match-next">
            {index + 1 < go.notes.length ? MATCH_COPY.next : MATCH_COPY.finish}
          </Button>
        </div>
        {skip}
      </>
    )
  }

  return (
    <div data-testid="note-match" data-phase={phase} data-note={index}>
      <Card className="flex flex-col items-center gap-3 py-6 text-center">
        {/* While the app sings nothing is listened to: it would be hearing itself. */}
        <VoiceMic detector={voiceDetector(range)} autoStart={autoStart} ears={phase === 'sing' ? 'voice' : phase === 'tone' ? 'closed' : 'room'} onHeard={onHeard}>
          {body}
        </VoiceMic>
        <p className="max-w-sm text-xs text-muted">{RANGE_COPY.hurt}</p>
      </Card>
    </div>
  )
}
