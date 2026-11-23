import { ArrowLeft, Mic, MicOff, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { getSettings, updateSettings, useSettings } from '../../app/settings'
import { useWakeLock } from '../../app/useWakeLock'
import { audioEngine } from '../../audio/AudioEngine'
import { playClick } from '../../audio/metronome/Metronome'
import { chartBpm, type Chart, type ChartNote } from '../../chart/types'
import { Button, cx, formatTime } from '../../components/ui'
import type { AttemptResult } from '../../training/types'
import { PlaybackClock } from './PlaybackClock'
import { detectBleed } from './bleed'
import { createLaneRenderer, type LaneRenderer } from './laneRenderer'
import { PitchSmoother } from './pitchTracker'
import { PLAYER_DETECTOR, detectorFor, deviceChangeMakesPartial, guideStartsOn, guideTrackStep, ownSoundCounts, playerLabels, soundMaySwap } from './playerLabels'
import { createRunTracker, type RunTracker } from './runTracker'
import type { ScoreSummary } from './scoring'
import { barStartTime } from './sectionLoop'
import { lanesVisibleSeconds } from './voice/VoiceLanes'
import { primeMediaElement } from '../../audio/primeMedia'

export type PlayerMode = 'song' | 'exercise' | 'test'
export type PlayerPhase = 'ready' | 'countin' | 'playing' | 'paused' | 'finished'

/** Seconds a section loop keeps listening after its last pass ends, for the notes played right at the end. */
const LOOP_END_GRACE = 0.3
/** With frames arriving about ninety times a second, a silence this long (ms) means the microphone has stopped. */
const MIC_GAP_MS = 1000

export interface PlayerHandle {
  /** Plays the guide track once, without the microphone or scoring. */
  listen: () => void
  start(): void
  pause(): void
  restart(): void
  seek(time: number): void
}

export interface PlayerProps {
  ref?: Ref<PlayerHandle>
  title: string
  subtitle?: string
  /** Provides beats, tuning, capo and duration. */
  chart: Chart
  /** The notes actually displayed and scored (a difficulty level, or the whole chart). */
  notes: ChartNote[]
  audio: Blob
  mode: PlayerMode
  speed?: number
  /** Tempo information recorded with the attempt. */
  playedTempo: number
  targetTempo: number
  /** 0-based inclusive bar range to loop; the player finishes after `loopCount` passes. */
  loopBars?: [number, number]
  loopCount?: number
  /**
   * The same track with the part's notes played (synthesised content only). Off by
   * default while the microphone scores, so a phone speaker cannot score itself.
   * For a sung chart: the track with the guide voice singing the notes. It is on from the start only
   * for a singer who wears headphones (`settings.voiceHeadphones`), and may arrive after the player
   * has mounted (null until it is rendered).
   */
  guideAudio?: Blob | null
  /**
   * `audio` is a click track with no pitched content (the app's own exercises and songs). A phone
   * speaker playing it into the microphone cannot score notes, so such runs count in full.
   * (The scored track of a sung chart also holds the app's cues; the tracker never credits those, so
   * for a sung chart this flag is not read.)
   */
  backingIsClick?: boolean
  /** Changing this value resets the player to the start. */
  resetKey?: number | string
  /** Count-in clicks before the audio starts (default true). */
  countIn?: boolean
  /** Extra controls in the header (desktop) and the second row (phones). */
  headerControls?: ReactNode
  mobileControls?: ReactNode
  /** Rendered over the highway once finished. */
  resultsOverlay?: ReactNode
  readyHint?: string
  onExit: () => void
  onFinished: (summary: ScoreSummary, result: AttemptResult) => void
  onPhaseChange?: (phase: PlayerPhase) => void
}

/**
 * Reusable play-along engine: highway, mic scoring, transport. Song, exercise and test pages wrap it.
 * A chart that is sung (`chart.voice`) gets the pitch lanes and the voice tracker instead; no prop says so.
 */
export function Player({
  ref,
  title,
  subtitle,
  chart,
  notes,
  audio,
  mode,
  speed = 1,
  playedTempo,
  targetTempo,
  loopBars,
  loopCount = 2,
  guideAudio = null,
  backingIsClick = false,
  resetKey,
  countIn = true,
  headerControls,
  mobileControls,
  resultsOverlay,
  readyHint,
  onExit,
  onFinished,
  onPhaseChange,
}: PlayerProps) {
  const settings = useSettings()
  // A sung chart says so itself (`chart.voice`): the tracker, the lanes and the words below all follow from it.
  const sung = Boolean(chart.voice)
  const labels = playerLabels(chart)
  const [phase, setPhaseState] = useState<PlayerPhase>('ready')
  const [micStatus, setMicStatus] = useState<'off' | 'on' | 'error'>(audioEngine.micActive ? 'on' : 'off')
  const [micError, setMicError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeAction, setNoticeAction] = useState<'speaker-mode' | null>(null)
  // The guitar part is muted while the mic scores on a speaker, unless Speaker mode's echo cancellation keeps it out of the mic.
  // On a sung chart the guide voice is on only for a singer who wears headphones (see `guideStartsOn`).
  const [guide, setGuide] = useState(() =>
    guideStartsOn({ voice: sung, hasGuide: Boolean(guideAudio), echoCancellation: settings.echoCancellation, voiceHeadphones: settings.voiceHeadphones }),
  )
  const [countdown, setCountdown] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [portraitPhone, setPortraitPhone] = useState(false)
  const [starting, setStarting] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<LaneRenderer | null>(null)
  const clockRef = useRef<PlaybackClock | null>(null)
  const trackerRef = useRef<RunTracker | null>(null)
  const smootherRef = useRef(new PitchSmoother())
  const detectedRef = useRef<{ midi: number | null; matches: boolean }>({ midi: null, matches: false })
  const judgementRef = useRef<{ text: string; at: number } | null>(null)
  const mediaPrimedRef = useRef(false)
  const playbackStartedRef = useRef(false)
  const skipCountInRef = useRef(false)
  const clickTimesRef = useRef<number[]>([])
  const countInAttacksRef = useRef<number[]>([])
  const bleedRef = useRef(false)
  const listenOnlyRef = useRef(false)
  const listenUrlRef = useRef<string | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const loopsDoneRef = useRef(0)
  const startedAtRef = useRef<number | null>(null)
  /** Bumped by every start, restart, pause and unmount: an older start() that is still awaiting gives up when it changes. */
  const runIdRef = useRef(0)
  const startingRef = useRef(false)
  /** During the count-in: when (audio clock) the song is due to start, and at which song position. */
  const songStartRef = useRef<{ ctx: number; song: number } | null>(null)
  /**
   * The run covers only part of what is on screen: it began in the middle, was moved, changed speed, or
   * the microphone was off or silent for a stretch. Such a run is practice; its result is not saved.
   */
  const partialRef = useRef(false)
  /** When the last microphone frame of this run arrived (performance.now()). */
  const lastFrameAtRef = useRef(0)
  /** Analysis frames scored in this run; none means the microphone never delivered anything. */
  const framesRef = useRef(0)
  /** The user switched the microphone off: runs are for listening, not for scoring. */
  const micOffRef = useRef(false)
  const countInGainRef = useRef<GainNode | null>(null)
  const guideRef = useRef(false)
  /** The detector was narrowed to a voice by this player and has to be set back when it goes. */
  const voiceDetectorRef = useRef(false)
  /** A sung chart's guide track arrived while a run was under way: the switch is put where it starts once the sound may be swapped. */
  const guideSyncDueRef = useRef(false)
  /** When this player last opened the microphone (performance.now()); null = it has not. */
  const micOpenedAtRef = useRef<number | null>(null)
  const phaseRef = useRef<PlayerPhase>('ready')
  const settingsRef = useRef(settings)
  const propsRef = useRef({ chart, notes, speed, loopBars, loopCount, playedTempo, targetTempo, mode, backingIsClick })
  settingsRef.current = settings
  propsRef.current = { chart, notes, speed, loopBars, loopCount, playedTempo, targetTempo, mode, backingIsClick }
  guideRef.current = guide

  /** The latency setting (real time) as song time at the current speed. */
  const lagRef = useRef<() => number>(() => 0)
  lagRef.current = () => (settingsRef.current.latencyMs / 1000) * propsRef.current.speed
  /** Seeks the tracker to `songTime` and, in a section loop, limits scoring to the loop's bars. */
  const armTracker = useCallback((tracker: RunTracker, songTime: number) => {
    const p = propsRef.current
    tracker.seek(songTime - lagRef.current())
    if (p.loopBars) tracker.setRange(barStartTime(p.chart, p.loopBars[0]) ?? 0, barStartTime(p.chart, p.loopBars[1] + 1) ?? p.chart.duration)
  }, [])

  const cancelCountIn = useCallback(() => {
    countInGainRef.current?.disconnect()
    countInGainRef.current = null
    songStartRef.current = null
    setCountdown(null)
  }, [])

  const onPhaseChangeRef = useRef(onPhaseChange)
  onPhaseChangeRef.current = onPhaseChange
  const setPhase = useCallback((p: PlayerPhase) => {
    phaseRef.current = p
    setPhaseState(p)
    onPhaseChangeRef.current?.(p)
  }, [])

  useWakeLock(phase === 'playing' || phase === 'countin')

  // iOS pauses the <audio> element behind our back (phone call, Siri, lock screen, app switch) and cuts the
  // mic. Without this the highway keeps "playing" a frozen clock and the run is scored as misses.
  useEffect(() => {
    const interrupted = () => {
      const el = audioRef.current
      if (!el || phaseRef.current !== 'playing' || el.ended) return
      el.pause()
      playbackStartedRef.current = false
      setPhase('paused')
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      // Put away during the count-in: call it off, or the song would start by itself on return.
      if (phaseRef.current === 'countin') restartRef.current()
      else interrupted()
    }
    const el = audioRef.current
    el?.addEventListener('pause', interrupted)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      el?.removeEventListener('pause', interrupted)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [setPhase])

  // Audio source.
  const source = guide && guideAudio ? guideAudio : audio
  useEffect(() => {
    const url = URL.createObjectURL(source)
    setAudioUrl(url)
    audioUrlRef.current = url
    mediaPrimedRef.current = false
    return () => URL.revokeObjectURL(url)
  }, [source])

  /** Leaves listen mode: drops the temporary guide source and points the element back at the scored track. */
  const endListen = useCallback(() => {
    if (!listenOnlyRef.current) return
    listenOnlyRef.current = false
    setNotice(null)
    const el = audioRef.current
    if (listenUrlRef.current) {
      URL.revokeObjectURL(listenUrlRef.current)
      listenUrlRef.current = null
      if (el && audioUrlRef.current) {
        el.src = audioUrlRef.current
        el.load()
      }
      mediaPrimedRef.current = false
    }
  }, [])

  // Score tracker follows the active notes and speed. Which tracker it is follows from the chart: a
  // sung chart is scored by listening for a voice, every other chart by listening for a guitar.
  useEffect(() => {
    const tracker = createRunTracker(chart, notes, {
      octaveTolerance: settingsRef.current.octaveTolerance,
      a4: settingsRef.current.a4,
      // Asked only for a sung chart, when its first frame arrives: no audio context is made here.
      sampleRate: () => audioEngine.context.sampleRate,
      // The player's own smoother, so a guitar tracker rebuilt in the middle of a run still knows the level of a moment ago.
      smoother: smootherRef.current,
    })
    // The spectrum analysis costs the worklet time on every frame; a voice is scored from its single pitch.
    audioEngine.setSpectrum(tracker.needsSpectrum)
    tracker.setSpeed(speed)
    const el = audioRef.current
    if (el && el.currentTime > 0.05) {
      armTracker(tracker, el.currentTime)
      // A new tracker in the middle of a run (the speed or the level changed): what was judged before is gone.
      if (startedAtRef.current !== null) partialRef.current = true
    }
    trackerRef.current = tracker
  }, [notes, chart, speed, armTracker])

  // Canvas renderer (callback ref: the canvas mounts after data is ready).
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    canvasRef.current = canvas
    if (!canvas) {
      rendererRef.current = null
      return
    }
    // The highway for a guitar chart, the pitch lanes for a sung one.
    const renderer = createLaneRenderer(propsRef.current.chart, canvas)
    rendererRef.current = renderer
    renderer.resize()
    // Whichever renderer holds the canvas at the time (see the effect below).
    const ro = new ResizeObserver(() => rendererRef.current?.resize())
    ro.observe(canvas)
    resizeObserverRef.current = ro
  }, [])

  /** Puts the guide switch where it starts for the chart on screen (see `guideStartsOn`). */
  const hasGuide = Boolean(guideAudio)
  const hasGuideRef = useRef(hasGuide)
  const syncGuide = useCallback(() => {
    // Read from the store, not from the last render: the setting may have been changed a line ago.
    const st = getSettings()
    guideSyncDueRef.current = false
    // The microphone was switched off by hand, to listen: then the guide plays, as the microphone button left it.
    if (micOffRef.current) {
      setGuide(hasGuideRef.current)
      return
    }
    setGuide(
      guideStartsOn({ voice: Boolean(propsRef.current.chart.voice), hasGuide: hasGuideRef.current, echoCancellation: st.echoCancellation, voiceHeadphones: st.voiceHeadphones }),
    )
  }, [])
  /** No run is under way and none is being started: the sound may be swapped (see `soundMaySwap`). */
  const idle = () => soundMaySwap({ phase: phaseRef.current, starting: startingRef.current, listening: listenOnlyRef.current })

  // The chart on screen changed between a guitar chart and a sung one while the player stayed (a
  // screen that swaps charts without leaving): the same canvas is drawn with the other renderer, and
  // the guide switch goes where it starts for that kind of chart.
  const sungRef = useRef(sung)
  useEffect(() => {
    if (sungRef.current === sung) return
    sungRef.current = sung
    const canvas = canvasRef.current
    if (canvas) {
      const renderer = createLaneRenderer(propsRef.current.chart, canvas)
      rendererRef.current = renderer
      renderer.resize()
    }
    if (idle()) syncGuide()
  }, [sung, syncGuide])

  // The guide track of a sung chart is rendered after the page has opened, and again for the next
  // level, so it arrives when the switch has already been set without it. Put the switch where it
  // starts, as long as no run is under way; during a run the sound must not be swapped, so that
  // waits. And when the track goes away the switch goes off with it: left on, the next track would
  // start playing the moment it arrived, in the middle of a run. (See `guideTrackStep`. A guitar
  // chart keeps what it has always done: a guide that arrives late stays off until tapped.)
  useEffect(() => {
    if (hasGuideRef.current === hasGuide) return
    hasGuideRef.current = hasGuide
    const step = guideTrackStep({ voice: Boolean(propsRef.current.chart.voice), hasGuide, idle: idle() })
    if (step === 'set') syncGuide()
    else if (step === 'wait') guideSyncDueRef.current = true
    else if (step === 'off') {
      guideSyncDueRef.current = false
      setGuide(false)
    }
  }, [hasGuide, syncGuide])

  // A switch that had to wait is set as soon as the sound may be swapped: when the run has finished,
  // or was called off and no new start followed at once.
  useEffect(() => {
    if (guideSyncDueRef.current && idle()) syncGuide()
  }, [phase, starting, syncGuide])

  useEffect(() => {
    const update = () => setPortraitPhone(window.innerWidth < 640 && window.innerHeight > window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const finish = useCallback(() => {
    if (phaseRef.current === 'finished') return
    const el = audioRef.current
    el?.pause()
    if (listenOnlyRef.current) {
      // A listen-through ends back at the start, unscored.
      endListen()
      if (el) el.currentTime = 0
      playbackStartedRef.current = false
      loopsDoneRef.current = 0
      startedAtRef.current = null
      clockRef.current?.reset()
      setPhase('ready')
      return
    }
    setPhase('finished')
    const tracker = trackerRef.current
    if (!tracker) return
    // No frames at all means no microphone (denied, switched off or dead): the run was not scored, which is not a 0 %.
    if (framesRef.current === 0) tracker.markUnscored()
    tracker.advance(Number.POSITIVE_INFINITY)
    // A sung run with the guide on: one of the app's own notes came back through the microphone the
    // way only a speaker plays it, so the guide may have been scored. Asked only while the guide is
    // on: with it off the cues are all the app plays, they are never credited, and hearing them is
    // how a bare phone is meant to work.
    if (guideRef.current && !bleedRef.current && tracker.ownSoundHeard?.()) {
      bleedRef.current = true
      setNotice(labels.ownSoundNotice)
      // No headphones after all: the next screen starts with the guide off.
      updateSettings({ voiceHeadphones: false })
    }
    const p = propsRef.current
    const durationSec = startedAtRef.current ? (performance.now() - startedAtRef.current) / 1000 : (el?.currentTime ?? 0)
    const scored = tracker.toAttemptResult({ playedTempo: p.playedTempo, targetTempo: p.targetTempo, speed: p.speed, durationSec })
    const result = partialRef.current ? { ...scored, partial: true } : scored
    onFinished(tracker.summary(), bleedRef.current ? { ...result, bleed: true } : result)
  }, [endListen, labels, onFinished, setPhase])
  const finishRef = useRef(finish)
  finishRef.current = finish

  // Render loop.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const el = audioRef.current
      const renderer = rendererRef.current
      const tracker = trackerRef.current
      if (!el || !renderer || !tracker) return
      const { chart: c, notes: n, speed: sp, loopBars: lb, loopCount: lc } = propsRef.current
      const clock = (clockRef.current ??= new PlaybackClock(el))
      let t = clock.time
      const st = settingsRef.current
      const playing = phaseRef.current === 'playing'
      const duration = c.duration
      if (playing) {
        if (lb) {
          const loopStart = barStartTime(c, lb[0]) ?? 0
          const loopEnd = barStartTime(c, lb[1] + 1) ?? duration
          if (t >= loopEnd - 0.02) {
            if (loopsDoneRef.current + 1 >= lc) {
              // The last pass: its final notes are still on their way through the microphone, so the
              // run closes a moment after the loop's end.
              if (t >= loopEnd + LOOP_END_GRACE * sp || el.ended) {
                loopsDoneRef.current += 1
                void finishRef.current()
                return
              }
            } else {
              loopsDoneRef.current += 1
              el.currentTime = loopStart
              clock.reset()
              tracker.nextPass()
              judgementRef.current = null
              t = loopStart
            }
          }
        }
        if (!listenOnlyRef.current) {
          // The microphone was delivering and has gone quiet for over a second: what passes meanwhile is not the learner's fault.
          if (framesRef.current > 0 && performance.now() - lastFrameAtRef.current > MIC_GAP_MS) partialRef.current = true
          const missed = tracker.advance(t - lagRef.current())
          // A sung note that did not count has no word flashed for it (the labels give none): its bar shows it.
          const missWord = missed.length ? playerLabels(c).judgement('miss') : null
          if (missWord) judgementRef.current = { text: missWord, at: t }
        }
      }
      const widthFactor = Math.min(1, Math.max(0.45, renderer.width / 900))
      renderer.draw({
        songTime: t,
        duration,
        notes: n,
        chart: c,
        statusOf: (noteId) => tracker.stateOfNote(noteId),
        progressOf: (noteId) => tracker.progressOf?.(noteId),
        beats: c.beats,
        tuning: c.tuning,
        capo: c.capo,
        detectedMidi: detectedRef.current.midi,
        detectedMatches: detectedRef.current.matches,
        hud: tracker.summary(),
        lastJudgement: judgementRef.current,
        // Sung notes are long: the lanes show a number of beats, the highway a number of seconds.
        visibleSeconds: c.voice ? lanesVisibleSeconds(chartBpm(c), renderer.width, st.visibleSeconds) : st.visibleSeconds * sp * widthFactor,
        showNoteNames: st.showNoteNames,
        paused: phaseRef.current === 'paused',
      })
      if (playing && !lb && (el.ended || t >= duration + 0.5)) void finishRef.current()
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Microphone frames → scoring.
  useEffect(
    () =>
      audioEngine.subscribe((frame) => {
        const st = settingsRef.current
        const el = audioRef.current
        const listening = listenOnlyRef.current
        let songTime: number | null = null
        let now = 0
        if (el && phaseRef.current === 'playing' && !listening) {
          now = clockRef.current?.time ?? el.currentTime
          // The frame was analysed a moment before it got here: step back by its age on the audio clock,
          // so a busy main thread does not make notes look late.
          const age = Math.min(0.25, Math.max(0, audioEngine.context.currentTime - frame.time))
          songTime = now - age * propsRef.current.speed - lagRef.current()
          framesRef.current++
          lastFrameAtRef.current = performance.now()
        } else if (phaseRef.current === 'countin' && songStartRef.current && !listening) {
          // The tracker already listens during the count-in, on the timeline the song is about to
          // continue: it has to know what the room sounded like before the first note, and a first
          // note played a touch early must not fall into a gap.
          const pre = songStartRef.current
          now = pre.song
          songTime = pre.song + (frame.time - pre.ctx) * propsRef.current.speed - lagRef.current()
        }
        const tracker = trackerRef.current
        if (!tracker) return
        // `songTime` is null whenever nothing is scored (listening only, paused, before the start): the
        // tracker then only works out the pitch for the screen and whether this frame is an attack.
        const out = tracker.frame(frame, songTime, st)
        detectedRef.current.midi = out.midi
        detectedRef.current.matches = out.matches
        // Count-in: microphone attacks right after our own clicks mean the speaker is being heard.
        if (phaseRef.current === 'countin' && out.isAttack && !listening) countInAttacksRef.current.push(frame.time)
        const word = out.judgement ? playerLabels(propsRef.current.chart).judgement(out.judgement) : null
        if (word) judgementRef.current = { text: word, at: now }
      }),
    [],
  )

  useEffect(() => {
    const timer = setInterval(() => {
      const el = audioRef.current
      if (el) setProgress(el.currentTime)
    }, 250)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    // (The spectrum analysis is switched on by the tracker effect above, for the trackers that need it.)
    const el = audioRef.current
    return () => {
      // Leaving the player: stop anything a pending start() would still do, the backing and the microphone.
      runIdRef.current++
      countInGainRef.current?.disconnect()
      el?.pause()
      audioEngine.setSpectrum(false)
      // A sung chart narrowed the detector to a voice. Whoever opens the microphone next (the tuner
      // claims a running one as it is) must find the whole range of a guitar again.
      if (voiceDetectorRef.current) audioEngine.configureDetector(PLAYER_DETECTOR)
      audioEngine.stopMic()
    }
  }, [])

  // Headphones pulled out (or a headset connecting) in the middle of a sung run with the guide on:
  // from here the guide may be coming out of the speaker and scoring itself, so the run is practice.
  useEffect(() => {
    const devices = navigator.mediaDevices
    if (!devices?.addEventListener) return
    const onDeviceChange = () => {
      const chart = propsRef.current.chart
      const sinceMicOpened = micOpenedAtRef.current === null ? Number.POSITIVE_INFINITY : (performance.now() - micOpenedAtRef.current) / 1000
      if (!deviceChangeMakesPartial({ voice: Boolean(chart.voice), guideOn: guideRef.current, listening: listenOnlyRef.current, phase: phaseRef.current, sinceMicOpened })) return
      partialRef.current = true
      setNotice(playerLabels(chart).deviceChangedNotice)
    }
    devices.addEventListener('devicechange', onDeviceChange)
    return () => devices.removeEventListener('devicechange', onDeviceChange)
  }, [])

  const startMic = useCallback(async (overrides: { echoCancellation?: boolean } = {}) => {
    try {
      const st = settingsRef.current
      await audioEngine.startMic({ deviceId: st.inputDeviceId || undefined, threshold: 0.9, echoCancellation: overrides.echoCancellation ?? st.echoCancellation })
      micOpenedAtRef.current = performance.now()
      setMicStatus('on')
      setMicError(null)
    } catch (err) {
      setMicStatus('error')
      setMicError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  /** Speaker mode: echo cancellation removes our own playback from the microphone (iOS pays with phone-call playback quality). */
  const enableSpeakerMode = useCallback(() => {
    updateSettings({ echoCancellation: true })
    setNoticeAction(null)
    setNotice('Speaker mode is on. Restart to let the microphone check again.')
    if (audioEngine.micActive) {
      audioEngine.stopMic()
      void startMic({ echoCancellation: true })
    }
  }, [startMic])

  const restart = useCallback(() => {
    runIdRef.current++
    cancelCountIn()
    endListen()
    const el = audioRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
    playbackStartedRef.current = false
    loopsDoneRef.current = 0
    startedAtRef.current = null
    trackerRef.current?.reset()
    judgementRef.current = null
    bleedRef.current = false
    partialRef.current = false
    framesRef.current = 0
    clockRef.current?.reset()
    setPhase('ready')
  }, [cancelCountIn, endListen, setPhase])

  const start = useCallback(async (opts: { listen?: boolean } = {}) => {
    const el = audioRef.current
    if (!el || startingRef.current || phaseRef.current === 'countin' || phaseRef.current === 'playing') return
    if (phaseRef.current === 'finished') restart()
    if (!opts.listen) endListen()
    const runId = ++runIdRef.current
    const stale = () => runIdRef.current !== runId
    startingRef.current = true
    setStarting(true)
    try {
      audioEngine.unlock()
      primeMediaElement(el, mediaPrimedRef, playbackStartedRef)
      setNotice(null)
      setNoticeAction(null)
      if (!opts.listen && !micOffRef.current && !audioEngine.micActive && micStatus !== 'error') await startMic()
      if (stale()) return
      // The detector is set at every start, not only when the microphone is opened here: it may be
      // running from another screen, or from a chart of the other kind, with a different range. A
      // guitar chart gets what this player has always opened the microphone with; a sung chart gets
      // the singer's range, which is what the voice tracker counts on (at the app's own A = 440: the
      // "Reference pitch" setting is the guitar's and is not handed to anything that is sung).
      audioEngine.configureDetector(detectorFor(propsRef.current.chart))
      voiceDetectorRef.current = Boolean(propsRef.current.chart.voice)
      await audioEngine.resume()
      if (stale()) return
      const p = propsRef.current
      // WebKit can reset the rate when a paused element starts; set the default too and re-assert after play().
      el.defaultPlaybackRate = p.speed
      el.playbackRate = p.speed
      el.preservesPitch = true
      const loopStart = p.loopBars ? (barStartTime(p.chart, p.loopBars[0]) ?? 0) : 0
      if (el.currentTime < loopStart) el.currentTime = loopStart
      const atStart = el.currentTime <= loopStart + 0.05
      if (atStart) {
        bleedRef.current = false
        partialRef.current = false
        framesRef.current = 0
        // Armed here, before the count-in, so that what the tracker hears during it is kept.
        if (trackerRef.current) armTracker(trackerRef.current, loopStart)
      } else if (startedAtRef.current === null && !opts.listen) {
        // Begun from the middle (the position was moved first): practice, not a result for the song.
        partialRef.current = true
      }
      if (!opts.listen && atStart && countIn && !skipCountInRef.current) {
        setPhase('countin')
        const ctx = audioEngine.context
        const bpm = p.chart.tempos[0]?.bpm ?? 120
        const interval = 60 / bpm / p.speed
        const beats = 4
        const t0 = ctx.currentTime + 0.15
        songStartRef.current = { ctx: t0 + beats * interval, song: loopStart }
        // Through its own gain node, so leaving or restarting can silence clicks that are already scheduled.
        const gain = ctx.createGain()
        gain.connect(ctx.destination)
        countInGainRef.current = gain
        clickTimesRef.current = []
        countInAttacksRef.current = []
        for (let i = 0; i < beats; i++) {
          playClick(ctx, gain, t0 + i * interval, i === 0 ? 'high' : 'mid', 0.6)
          clickTimesRef.current.push(t0 + i * interval)
          setTimeout(() => !stale() && setCountdown(beats - i), Math.max(0, (t0 + i * interval - ctx.currentTime) * 1000))
        }
        await new Promise((r) => setTimeout(r, Math.max(0, (t0 + beats * interval - ctx.currentTime) * 1000)))
        if (stale()) return
        // The count-in only happened if the audio clock ran through it. A phone call or the voice assistant
        // can hold the sound while the page stays on screen: then nothing was counted in, so start over.
        if (ctx.state !== 'running' || ctx.currentTime < t0 + beats * interval - 0.1) {
          restart()
          setNotice('The sound was interrupted. Tap play to start again.')
          return
        }
        setCountdown(null)
        // Hearing our own clicks only matters when what plays next has pitches in it: the guitar part,
        // or a real recording. The click track alone cannot score notes. (On a sung chart: the guide
        // voice; the cues of its scored track are never credited. See `ownSoundCounts`.)
        const pitched = ownSoundCounts({ voice: Boolean(p.chart.voice), guideOn: guideRef.current, backingIsClick: p.backingIsClick })
        if (pitched && audioEngine.micActive && detectBleed(clickTimesRef.current, countInAttacksRef.current)) {
          const words = playerLabels(p.chart)
          bleedRef.current = true
          setNotice(words.bleedNotice)
          setNoticeAction(words.bleedAction)
          // A singer whose phone hears its own clicks is not wearing headphones: the guide starts off from now on.
          if (p.chart.voice) updateSettings({ voiceHeadphones: false })
        }
      }
      try {
        el.muted = false
        playbackStartedRef.current = true
        await el.play()
        if (el.playbackRate !== p.speed) el.playbackRate = p.speed
      } catch (err) {
        if (stale()) return
        playbackStartedRef.current = false
        const blocked = err instanceof DOMException && err.name === 'NotAllowedError'
        // Only a start the browser refused for want of a tap skips the count-in next time (it was already heard).
        skipCountInRef.current = blocked
        cancelCountIn()
        setNotice(blocked ? 'Tap the play button once more to start.' : playerLabels(p.chart).playbackError(err instanceof Error ? err.message : String(err)))
        setPhase('ready')
        return
      }
      if (stale()) {
        el.pause()
        return
      }
      skipCountInRef.current = false
      if (atStart || startedAtRef.current === null) startedAtRef.current = performance.now()
      clockRef.current?.reset()
      // The song's sound starts: the level heard so far and the pitch on screen start afresh (for a guitar chart this resets the smoother above).
      trackerRef.current?.onPlaybackStart()
      // The silence check counts from here: a pause is not the microphone going quiet.
      lastFrameAtRef.current = performance.now()
      setPhase('playing')
      songStartRef.current = null
      if (opts.listen) setNotice(playerLabels(p.chart).listenNotice)
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }, [armTracker, cancelCountIn, countIn, endListen, micStatus, restart, setPhase, startMic])

  /** Plays the guide track once without the microphone or scoring, then returns to ready. */
  const listen = useCallback(() => {
    const el = audioRef.current
    if (!el || !guideAudio || phaseRef.current === 'countin' || phaseRef.current === 'playing') return
    if (phaseRef.current === 'finished') restart()
    listenOnlyRef.current = true
    if (!guide) {
      // Swap the source synchronously inside the tap, so iOS still counts the gesture.
      const url = URL.createObjectURL(guideAudio)
      listenUrlRef.current = url
      el.src = url
      el.load()
      mediaPrimedRef.current = false
    }
    void start({ listen: true })
  }, [guide, guideAudio, restart, start])

  const pause = useCallback(() => {
    if (mode === 'test') return
    runIdRef.current++
    cancelCountIn()
    audioRef.current?.pause()
    playbackStartedRef.current = false
    setPhase('paused')
  }, [cancelCountIn, mode, setPhase])

  const seek = useCallback(
    (t: number) => {
      const el = audioRef.current
      // A finished run stays finished: the result on screen offers the ways on (again, next, continue).
      if (!el || mode === 'test' || phaseRef.current === 'finished') return
      el.currentTime = t
      if (trackerRef.current) armTracker(trackerRef.current, t)
      clockRef.current?.reset()
      judgementRef.current = null
      // Moved in the middle of a run: what was judged so far is gone, so the run no longer stands for the whole song.
      if (startedAtRef.current !== null) partialRef.current = true
    },
    [armTracker, mode],
  )

  // Carrying on from a pause keeps the mode the run was in, whoever asks for the start.
  const resume = useCallback(() => void start(phaseRef.current === 'paused' ? { listen: listenOnlyRef.current } : {}), [start])
  useImperativeHandle(ref, () => ({ start: resume, listen, pause, restart, seek }), [resume, listen, pause, restart, seek])

  // The section on repeat was switched or moved in the middle of a run (it can be, while paused): the
  // tracker follows what is on screen, and the run no longer stands for one thing, so it is practice.
  const loopKey = loopBars ? loopBars.join('-') : ''
  const firstLoopRef = useRef(true)
  useEffect(() => {
    if (firstLoopRef.current) {
      firstLoopRef.current = false
      return
    }
    if (startedAtRef.current === null || phaseRef.current === 'finished') return
    partialRef.current = true
    const el = audioRef.current
    if (el && trackerRef.current) armTracker(trackerRef.current, el.currentTime)
  }, [loopKey, armTracker])

  // External reset (new rep, level change). Depends on resetKey only: parent
  // re-renders must never restart a run in progress.
  const restartRef = useRef(restart)
  restartRef.current = restart
  const firstResetRef = useRef(true)
  useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false
      return
    }
    restartRef.current()
  }, [resetKey])

  const overlayRef = useRef(false)
  overlayRef.current = !!resultsOverlay

  const togglePlayPause = useCallback(() => {
    if (phaseRef.current === 'playing') pause()
    // Carrying on after a pause stays in the mode it was in: a listen-through must not turn into a scored run.
    else if (phaseRef.current === 'paused') void start({ listen: listenOnlyRef.current })
    else if (phaseRef.current === 'ready') void start()
  }, [pause, start])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlayPause()
      } else if ((e.key === 'r' || e.key === 'R') && mode !== 'test') {
        // Like the restart button: not while a result is on screen, which offers the ways on.
        if (!(phaseRef.current === 'finished' && overlayRef.current)) restart()
      } else if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlayPause, restart, onExit, mode])

  const duration = chart.duration
  const busy = phase === 'playing' || phase === 'countin'
  const canSeek = mode !== 'test' && !busy && phase !== 'finished'
  const notesCount = notes.length

  return (
    <div
      className="no-select flex h-dvh flex-col bg-bg"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      data-testid={`player-${mode}`}
    >
      <header className="flex items-center gap-2 border-b border-line bg-panel px-2 pb-2 sm:px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <Button variant="ghost" size="sm" onClick={onExit} aria-label="Back" className="px-2">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold sm:text-base">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
        </div>
        {headerControls && (
          <div className="hidden items-center gap-2 sm:flex" data-testid="controls-desktop">
            {headerControls}
          </div>
        )}
        {guideAudio && (
          <Button
            size="sm"
            variant={guide ? 'secondary' : 'ghost'}
            disabled={busy || starting}
            aria-pressed={guide}
            onClick={() => setGuide((g) => !g)}
            title={guide ? labels.guideOn : labels.guideOff}
            aria-label={labels.guideToggle}
            data-testid="guide-toggle"
          >
            {guide ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
        )}
        <Button
          size="sm"
          variant={micStatus === 'on' ? 'secondary' : 'primary'}
          disabled={busy || starting}
          onClick={() => {
            // Switched in the middle of a run: part of it had no microphone, so it cannot count as a whole.
            if (startedAtRef.current !== null) partialRef.current = true
            if (micStatus === 'on') {
              micOffRef.current = true
              audioEngine.stopMic()
              setMicStatus('off')
              // Listening without scoring: play the part.
              if (guideAudio) setGuide(true)
            } else {
              micOffRef.current = false
              audioEngine.unlock()
              // Scoring again: the guide goes back to where it starts for this chart.
              setGuide(
                guideStartsOn({
                  voice: sung,
                  hasGuide: Boolean(guideAudio),
                  echoCancellation: settingsRef.current.echoCancellation,
                  voiceHeadphones: settingsRef.current.voiceHeadphones,
                }),
              )
              void startMic()
            }
          }}
          title={micStatus === 'on' ? 'Microphone on' : 'Microphone off: turn it on to get scored'}
          aria-label={micStatus === 'on' ? 'Microphone on, tap to turn off' : 'Microphone off: turn it on to get scored'}
        >
          {micStatus === 'on' ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </Button>
      </header>
      {(mobileControls ?? headerControls) && (
        <div className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1.5 sm:hidden" data-testid="controls-mobile">
          {mobileControls ?? headerControls}
        </div>
      )}
      {micError && <div className="bg-bad/15 px-4 py-1 text-xs text-red-200">{labels.micError(micError)}</div>}
      {notice && (
        <div className="flex flex-wrap items-center gap-2 bg-accent/15 px-4 py-1 text-xs text-amber-100" data-testid="player-notice">
          <span>{notice}</span>
          {noticeAction === 'speaker-mode' && (
            <button type="button" className="rounded-md border border-amber-200/40 px-2 py-0.5 font-medium hover:bg-amber-200/10" onClick={enableSpeakerMode} data-testid="speaker-mode">
              Turn on Speaker mode
            </button>
          )}
        </div>
      )}
      <div
        className="relative min-h-0 flex-1"
        onPointerUp={(e) => {
          if (e.target === canvasRef.current && (phase === 'playing' || phase === 'paused')) togglePlayPause()
        }}
      >
        <canvas ref={attachCanvas} className="block h-full w-full" data-testid="highway" />
        {phase === 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg/60 px-6 text-center">
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-slate-950 shadow-lg transition-transform hover:scale-105 disabled:opacity-60"
              aria-label="Start"
              data-testid="start"
            >
              <Play className="h-12 w-12" />
            </button>
            <p className="text-sm text-muted">{[readyHint ?? labels.readyLine(notesCount, speed), guideAudio ? (guide ? labels.guideOnShort : labels.guideOffShort) : null].filter(Boolean).join(' · ')}</p>
            {guideAudio && !guide && mode !== 'test' && <p className="max-w-sm text-xs text-muted">{labels.guideOffWhy}</p>}
            {guideAudio && mode !== 'test' && (
              <Button variant="secondary" size="sm" onClick={listen} data-testid="listen">
                <Volume2 className="h-4 w-4" /> Listen first
              </Button>
            )}
            {mode !== 'test' && (
              <p className="text-xs text-muted">
                {portraitPhone ? 'Tip: rotate your phone for a wider lane. Tap the lane to pause.' : 'Tap the lane to pause'}
                <span className="hidden md:inline"> · Space to pause · R to restart</span>
              </p>
            )}
            {mode === 'test' && <p className="text-xs text-amber-200">{labels.testLine}</p>}
          </div>
        )}
        {countdown !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9rem] font-black text-slate-50/90" data-testid="countdown">
            {countdown}
          </div>
        )}
        {phase === 'finished' && resultsOverlay}
      </div>
      <footer className="flex items-center gap-2 border-t border-line bg-panel px-2 pt-2 sm:gap-3 sm:px-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
        <Button
          variant="primary"
          size="sm"
          onClick={togglePlayPause}
          disabled={phase === 'countin' || phase === 'finished' || (mode === 'test' && phase === 'playing')}
          aria-label={phase === 'playing' ? 'Pause' : 'Play'}
          className="h-10 w-10 px-0"
        >
          {phase === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        {mode !== 'test' && (
          <Button variant="ghost" size="sm" onClick={restart} disabled={phase === 'finished' && !!resultsOverlay} aria-label="Restart" className="h-10 w-10 px-0">
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
        <span className="w-10 text-right text-xs tabular-nums text-muted">{formatTime(progress)}</span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(progress, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!canSeek}
          className={cx('min-w-0 flex-1', mode === 'test' && 'opacity-50')}
          aria-label="Position"
        />
        <span className="w-10 text-xs tabular-nums text-muted">{formatTime(duration)}</span>
        {mode === 'song' && (
          <label className="hidden items-center gap-1 text-xs text-muted md:flex">
            Latency
            <input
              type="number"
              min={0}
              max={400}
              step={5}
              value={settings.latencyMs}
              onChange={(e) => updateSettings({ latencyMs: Number(e.target.value) })}
              className="h-7 w-16 rounded border border-line bg-panel-2 px-1 text-xs text-slate-100"
            />
            ms
          </label>
        )}
      </footer>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" playsInline onEnded={() => void finishRef.current()} />
    </div>
  )
}
