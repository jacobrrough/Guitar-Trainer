import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useWakeLock } from '../../app/useWakeLock'
import { audioEngine, type PitchFrame } from '../../audio/AudioEngine'
import { useMicActive } from '../../audio/useMicActive'
import { Button, cx } from '../../components/ui'
import type { RangeEdges } from '../../music/keys'
import { clamp, midiToName } from '../../music/pitch'
import type { VoiceRange } from '../../training/types'
import { saveVoiceRange } from '../../training/voiceProfile'
import type { Heard } from '../play/voice/voiceEar'
import { GUITAR_DETECTOR, LiveDot, RANGE_COPY, VoiceListener, edgeLine, ladderLabel, ladderSpot, ladderView, rangeText, shiftRange, type LadderView } from './rangeFinder'

/*
 * What the voice tools share on screen: the ladder a voice is drawn on, the microphone they listen
 * through, and the card that shows the easy notes. The rules behind them are in rangeFinder.ts.
 */

const W = 200
const H = 240
/** The two rails of the ladder. */
const LEFT = 62
const RIGHT = 138
/** The dark the dot is outlined with, as in the lesson drawings. */
const INK = '#0b0f14'

export interface PitchLadderProps {
  /** The notes drawn, lowest and highest. */
  view: LadderView
  /** The easy notes: a shaded band, named at both ends. */
  range?: RangeEdges
  /** The note to sing: a bar. */
  target?: number
  /** The voice, as a fractional MIDI number; null when none is heard. */
  dot?: number | null
  /** The dot is on the bar: the bar turns green. */
  met?: boolean
  /** The height of the picture (a Tailwind height class); the width follows. As tall as fits a phone screen with the words around it when left out. */
  className?: string
}

/**
 * A ladder of notes, one rung a note, higher notes higher up: the same picture as the lesson drawing
 * "pitch-ladder", alive. Words inside it are note names only.
 */
export function PitchLadder({ view, range, target, dot = null, met = false, className }: PitchLadderProps) {
  const rows = view.top - view.bottom + 1
  const row = H / rows
  const y = (midi: number) => ladderSpot(midi, view).y * H
  const notes = Array.from({ length: rows }, (_, i) => view.bottom + i)
  const spot = dot === null ? null : ladderSpot(dot, view)
  const radius = clamp(row * 0.42, 4, 7)
  const bar = clamp(row * 0.6, 5, 10)
  return (
    <svg role="img" aria-label={ladderLabel({ range, target, dot })} viewBox={`0 0 ${W} ${H}`} className={cx('w-auto max-w-full text-slate-200', className ?? 'h-60')} data-testid="pitch-ladder" data-voice={dot === null ? 'none' : 'heard'}>
      {range && (
        <>
          <rect x={LEFT - 6} y={y(range.high) - row / 2} width={RIGHT - LEFT + 12} height={y(range.low) - y(range.high) + row} rx={6} fill="var(--color-accent)" fillOpacity={0.18} />
          <text x={LEFT - 12} y={y(range.high) + 4} textAnchor="end" fontSize={12} fill="currentColor">
            {midiToName(range.high)}
          </text>
          <text x={LEFT - 12} y={y(range.low) + 4} textAnchor="end" fontSize={12} fill="currentColor">
            {midiToName(range.low)}
          </text>
        </>
      )}
      <line x1={LEFT} y1={2} x2={LEFT} y2={H - 2} stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.6} />
      <line x1={RIGHT} y1={2} x2={RIGHT} y2={H - 2} stroke="currentColor" strokeWidth={2} strokeLinecap="round" opacity={0.6} />
      {notes.map((note) => (
        <line key={note} x1={LEFT} y1={y(note)} x2={RIGHT} y2={y(note)} stroke="currentColor" strokeWidth={1} opacity={0.3} />
      ))}
      {target !== undefined && (
        <>
          <rect x={LEFT - 4} y={y(target) - bar / 2} width={RIGHT - LEFT + 8} height={bar} rx={bar / 2} fill={met ? 'var(--color-ok)' : 'currentColor'} />
          <text x={RIGHT + 12} y={y(target) + 4} fontSize={12} fontWeight={600} fill="currentColor">
            {midiToName(target)}
          </text>
        </>
      )}
      {spot && spot.beyond === null && <circle cx={W / 2} cy={clamp(spot.y * H, radius, H - radius)} r={radius} fill="var(--color-accent)" stroke={INK} strokeWidth={1.5} />}
      {/* A voice outside the picture: an arrow at the edge it left by. */}
      {spot?.beyond === 'above' && <polygon points={`${W / 2},2 ${W / 2 - 8},14 ${W / 2 + 8},14`} fill="var(--color-accent)" stroke={INK} strokeWidth={1} />}
      {spot?.beyond === 'below' && <polygon points={`${W / 2},${H - 2} ${W / 2 - 8},${H - 14} ${W / 2 + 8},${H - 14}`} fill="var(--color-accent)" stroke={INK} strokeWidth={1} />}
    </svg>
  )
}

/** The dot is redrawn this often at most (seconds of microphone time): thirty times a second is smooth, every frame is not needed. */
const DOT_EVERY = 0.033

export interface VoiceMicState {
  /** The microphone is open. */
  listening: boolean
  /** It is being opened (the browser may be asking for permission). */
  starting: boolean
  /** It could not be opened. */
  failed: boolean
  /** The voice right now as a fractional MIDI number, or null when none is heard. */
  dot: number | null
  /** Opens the microphone; resolves to whether it is open. Call it from a tap. */
  start: () => Promise<boolean>
  stop: () => void
}

export interface VoiceMicProps {
  /** What the pitch detector is set to while this screen has the microphone. */
  detector: { minFreq: number; maxFreq: number; threshold: number }
  /** Open the microphone without a tap: permission was given on the screen before. */
  autoStart?: boolean
  /**
   * What the frames are right now: the learner's 'voice', the 'room' while they read what to do (its
   * level is what a voice then has to rise above), or neither ('closed': the app itself is sounding).
   */
  ears: 'voice' | 'room' | 'closed'
  /** Every frame while the ears are on 'voice': what it settled of the voice (often nothing) and the frame's time. */
  onHeard?: (heard: readonly Heard[], time: number) => void
  children: (mic: VoiceMicState) => ReactNode
}

/**
 * The microphone for a voice screen, the way the tuner screens hold it: a running microphone is taken
 * over from the screen before, and handed on when this one goes away. Two things differ. The detector
 * is set to a voice's range while the screen is up, and set back to the guitar's before the microphone
 * is handed on, because the tuner only moves the lower edge when it takes over. And frames go through
 * the voice ear, so what a tool hears is what a sung run would hear.
 */
export function VoiceMic({ detector, autoStart = false, ears, onHeard, children }: VoiceMicProps) {
  const settings = useSettings()
  // Follows the audio engine, so a microphone that another screen closed never shows as listening.
  const listening = useMicActive()
  // Opened without a tap, it is being opened from the first moment on.
  const [starting, setStarting] = useState(() => autoStart && !audioEngine.micActive)
  const [failed, setFailed] = useState(false)
  const [dot, setDot] = useState<number | null>(null)
  const kit = useRef<{ listener: VoiceListener; live: LiveDot; shownAt: number } | null>(null)
  const { minFreq, maxFreq, threshold } = detector

  useWakeLock(listening)

  // A chain and not an `async` function: nothing here changes state before the microphone has answered,
  // so it can be called while the screen mounts.
  const open = (): Promise<boolean> => {
    audioEngine.unlock()
    return audioEngine
      .startMic({ deviceId: settings.inputDeviceId || undefined, minFreq, maxFreq, threshold, echoCancellation: settings.echoCancellation })
      .then(
        () => audioEngine.micActive,
        () => {
          setFailed(true)
          return false
        },
      )
      .finally(() => setStarting(false))
  }
  const start = (): Promise<boolean> => {
    setFailed(false)
    setStarting(true)
    return open()
  }

  const takeOver = useEffectEvent(() => {
    if (!audioEngine.claimMic() && autoStart) void open()
  })
  useEffect(() => {
    takeOver()
    return () => {
      audioEngine.configureDetector(GUITAR_DETECTOR)
      audioEngine.releaseMic()
    }
  }, [])

  // A microphone taken over from another screen was opened with that screen's range.
  useEffect(() => {
    if (listening) audioEngine.configureDetector({ minFreq, maxFreq, threshold })
  }, [listening, minFreq, maxFreq, threshold])

  const onFrame = useEffectEvent((frame: PitchFrame) => {
    const k = kit.current
    if (!k) return
    if (ears === 'closed') {
      k.listener.pause()
      return
    }
    if (ears === 'room') {
      k.listener.rest(frame)
      return
    }
    const heard = k.listener.hear(frame)
    k.live.add(heard)
    onHeard?.(heard, frame.time)
    // `abs`: the clock of a microphone that was reopened starts where it likes.
    if (Math.abs(frame.time - k.shownAt) < DOT_EVERY) return
    k.shownAt = frame.time
    setDot(k.live.at(frame.time))
  })
  useEffect(() => {
    if (!listening) return
    kit.current = { listener: new VoiceListener(audioEngine.context.sampleRate), live: new LiveDot(), shownAt: 0 }
    const unsubscribe = audioEngine.subscribe((frame) => onFrame(frame))
    return () => {
      unsubscribe()
      kit.current = null
    }
  }, [listening])

  // The last dot is not shown once nobody is listening for a voice: frames stop, and it would stay for good.
  return <>{children({ listening, starting, failed, dot: listening && ears === 'voice' ? dot : null, start, stop: () => audioEngine.stopMic() })}</>
}

export interface EasyNotesProps {
  range: VoiceRange
  /** The voice on the ladder, when a microphone is listening. */
  dot?: number | null
  /** The range as it was stored after "A bit lower" or "A bit higher". */
  onMoved?: (range: VoiceRange) => void
  children?: ReactNode
}

/**
 * "Your easy notes": their names, the ladder with them shaded, and the two buttons that move them a
 * semitone. A move is stored at once, and what is shown afterwards is what the store gave back.
 */
export function EasyNotes({ range, dot, onMoved, children }: EasyNotesProps) {
  const [trouble, setTrouble] = useState(false)
  const lower = shiftRange(range, -1, 0)
  const higher = shiftRange(range, 1, 0)
  // A button that only goes grey leaves the learner guessing: the line says why it stopped.
  const edge = edgeLine(range)
  const move = async (by: 1 | -1) => {
    const moved = shiftRange(range, by, Date.now())
    if (!moved) return
    setTrouble(false)
    try {
      const voice = await saveVoiceRange(moved)
      onMoved?.(voice.range ?? moved)
    } catch {
      setTrouble(true)
    }
  }
  return (
    <div className="flex flex-col items-center gap-3 text-center" data-testid="easy-notes" data-low={range.low} data-high={range.high} data-source={range.source}>
      <h2 className="text-xl font-semibold">{RANGE_COPY.result.title}</h2>
      <p className="text-3xl font-bold text-slate-50" data-testid="easy-notes-names">
        {rangeText(range)}
      </p>
      <PitchLadder view={ladderView(range)} range={range} dot={dot} />
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => void move(-1)} disabled={!lower} data-testid="range-lower">
          {RANGE_COPY.lower}
        </Button>
        <Button onClick={() => void move(1)} disabled={!higher} data-testid="range-higher">
          {RANGE_COPY.higher}
        </Button>
      </div>
      {edge && (
        <p className="max-w-sm text-sm text-muted" aria-live="polite" data-testid="range-edge">
          {edge}
        </p>
      )}
      {trouble && (
        <p role="alert" className="text-sm text-red-300">
          {RANGE_COPY.result.notSaved}
        </p>
      )}
      {children}
    </div>
  )
}
