import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { getSettings, useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { LEVELS } from '../../chart/difficulty'
import { chartBpm, type VoiceChart } from '../../chart/types'
import { ChordBox } from '../../components/diagrams'
import { Badge, Button } from '../../components/ui'
import { recordResult, type SongRecord } from '../../db/db'
import { lessonPlayFor } from '../../lessons/course'
import { forHand } from '../../lessons/fingering'
import { lessonDrillExercise, lessonSongNotes } from '../../lessons/material'
import type { Lesson, LessonDrill, LessonPlay } from '../../lessons/types'
import { DEFAULT_RANGES, type RangeAroundEasy } from '../../music/keys'
import { getTuning } from '../../music/tunings'
import { builtInSong, builtInSongRecord } from '../../songs'
import { songPlayback } from '../../songs/playback'
import { vocalSongRecord } from '../../songs/vocal/install'
import { GETTING_READY, useVocalRunState } from '../../songs/vocal/useVocalRun'
import { useExerciseGuide } from '../play/useExerciseGuide'
import { recordFelt, recordLessonDrill, recordSongPlay, type Felt } from '../../training/coach'
import { renderExerciseBacking } from '../../training/exercises/backing'
import { instrumentOfLessonId, skillById } from '../../training/instruments'
import type { AttemptResult } from '../../training/types'
import { useProfile } from '../../training/useTraining'
import { Player, type PlayerHandle } from '../play/Player'
import { runVerdict, type RunVerdict } from '../play/runVerdict'
import type { ScoreSummary } from '../play/scoring'
import { useHeld } from '../play/useHeld'
import { resultRecord } from '../sing/singPage'
import { COMES_LATER, FELT_COPY, KEY_LOWERED_LINE, asksHowItFelt, feltReply, hitFraction, practiceNote, practiceTrouble, roundCopy, songHint, songNote } from './lessonUtils'
import { getLessonProgress, patchLessonProgress } from '../../lessons/store'

function Overlay({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4" data-testid={testId}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">{children}</div>
    </div>
  )
}

/** Share of a lesson song's notes that must be hit for the song to count as played (or sung). */
const SONG_PLAYED_FRACTION = 0.5

/** A full-screen wait with a way out: nobody should be stuck on it if something takes too long. */
function Waiting({ text, onExit, testId }: { text: string; onExit: () => void; testId?: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 text-muted" data-testid={testId}>
      <p>{text}</p>
      <Button variant="ghost" size="sm" onClick={onExit}>
        Back
      </Button>
    </div>
  )
}

interface Feedback {
  summary: ScoreSummary
  fraction: number
  passed: boolean
  round: number
  /** Whether the run counted; when it did not, nothing was saved and the card says why. */
  verdict: RunVerdict
}

/**
 * The result of a round, over the player. The words are chosen in `roundCopy`, by the lesson's course:
 * a guitarist reads what this card always said, a singer how many notes they were on and one tip, and
 * never a line about timing. `voice` is the sung chart's word about itself; `children` come after the tip.
 */
function FeedbackCard({
  lesson,
  feedback,
  note,
  skillTips,
  voice,
  onAgain,
  onContinue,
  children,
}: {
  lesson: Lesson
  feedback: Feedback
  note: string
  skillTips?: string[]
  voice?: Pick<VoiceChart, 'glide'>
  onAgain: () => void
  onContinue: () => void
  children?: ReactNode
}) {
  const settings = useSettings()
  const copy = roundCopy(lesson, feedback, { skillTips, voice })
  return (
    <Overlay testId="lesson-feedback">
      <h2 className="text-2xl font-bold" data-testid="lesson-score" data-verdict={feedback.verdict}>
        {copy.title}
      </h2>
      {copy.body !== null ? (
        <p className="mt-3 text-sm text-slate-200">{copy.body}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate-200">{note}</p>
          {copy.tip !== null && (
            <p className="mt-3 rounded-lg bg-panel-2 p-3 text-sm text-slate-200" data-testid="lesson-tip">
              {forHand(copy.tip, settings.handedness)}
            </p>
          )}
          {children}
        </>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button variant={feedback.passed ? 'secondary' : 'primary'} onClick={onAgain} data-testid="lesson-again">
          Again
        </Button>
        <Button variant={feedback.passed ? 'primary' : 'secondary'} onClick={onContinue} data-testid="lesson-continue">
          Continue
        </Button>
      </div>
    </Overlay>
  )
}

/** Restarts the player shortly after a reset (the audio element needs a moment to take its new source). */
function useStartAfterReset(player: RefObject<PlayerHandle | null>, round: number) {
  const pending = useRef(false)
  useEffect(() => {
    if (!pending.current) return
    pending.current = false
    const t = setTimeout(() => player.current?.start(), 250)
    return () => clearTimeout(t)
  }, [round, player])
  return () => {
    pending.current = true
  }
}

interface TryStepProps {
  lesson: Lesson
  drill: LessonDrill
  onExit: () => void
  onContinue: () => void
  /** Handed every write to the lesson's row that this step starts, so the finish of the lesson can wait for it. */
  onMark?: (write: Promise<unknown>) => void
}

/** The practice round of a lesson. A sung round is built in the singer's easy notes, so those are read first. */
export function TryStep(props: TryStepProps) {
  return instrumentOfLessonId(props.lesson.id) === 'voice' ? <SungTryStep {...props} /> : <TryRounds {...props} />
}

function SungTryStep(props: TryStepProps) {
  const profile = useProfile('voice')
  if (!profile) return <Waiting testId="lesson-try-loading" text="Getting your practice ready…" onExit={props.onExit} />
  // A singer always has notes to sing in: their own, or the lower starting notes until those are found.
  return <TryRounds {...props} startRange={profile.voice?.range ?? DEFAULT_RANGES.lower} />
}

/** What the singer answered to "How did the slides feel?", and what the answer did. */
interface FeltAnswer {
  /** The round the answer was given after. It is shown on that round's card and on no later one. */
  round: number
  felt: Felt
  /** "Tight" took a note off the top of the easy notes. */
  lowered: boolean
  /** The easy notes after the answer, when they changed: the next round is built in these. */
  next?: RangeAroundEasy
}

/**
 * Asked after a round of slides: easy, OK or tight. The answer is stored at once ("Tight" always wins
 * over what the round scored), and the reply says what it did.
 */
function FeltQuestion({ answer, busy, trouble, onAnswer }: { answer: FeltAnswer | null; busy: boolean; trouble: boolean; onAnswer: (felt: Felt) => void }) {
  return (
    <div className="mt-3 rounded-lg border border-line p-3 text-sm" data-testid="lesson-felt" data-answer={answer?.felt ?? ''}>
      <p className="font-medium text-slate-100">{FELT_COPY.question}</p>
      {answer ? (
        <p className="mt-2 text-slate-200" data-testid="lesson-felt-reply">
          {feltReply(answer.felt, answer.lowered)}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {(['easy', 'ok', 'tight'] as const).map((felt) => (
            <Button key={felt} size="sm" disabled={busy} onClick={() => onAnswer(felt)} data-testid={`lesson-felt-${felt}`}>
              {FELT_COPY[felt]}
            </Button>
          ))}
        </div>
      )}
      {trouble && (
        <p role="alert" className="mt-2 text-red-300">
          We could not save your answer. Please tap it once more.
        </p>
      )}
    </div>
  )
}

function TryRounds({ lesson, drill, startRange, onExit, onContinue, onMark }: TryStepProps & { startRange?: RangeAroundEasy }) {
  const settings = useSettings()
  const skill = skillById(drill.skillId)
  const tuning = getTuning(settings.defaultTuningId).strings
  const tuningKey = tuning.join(',')
  const playerRef = useRef<PlayerHandle>(null)
  const [round, setRound] = useState(1)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // The notes a sung round is built in (a guitar round has none). They stay as they were when the step
  // opened, so a round on screen is never rebuilt under the singer; only the answer "Tight" changes
  // them, and then for the next round.
  const [range, setRange] = useState(startRange)
  const rangeKey = range ? `${range.low},${range.high},${range.easy}` : ''
  const [felt, setFelt] = useState<FeltAnswer | null>(null)
  const [feltBusy, setFeltBusy] = useState(false)
  const [feltTrouble, setFeltTrouble] = useState(false)
  const markStart = useStartAfterReset(playerRef, round)

  const built = useMemo(() => {
    try {
      // Built by the same function as the scoring simulation's lesson cases, so what is proven there is what is shown here.
      return { exercise: renderExerciseBacking(lessonDrillExercise(lesson, tuning, range), { guide: true }), error: null as string | null }
    } catch (err) {
      return { exercise: null, error: err instanceof Error ? err.message : String(err) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, tuningKey, rangeKey])
  const exercise = built.exercise
  const audio = useMemo(() => (exercise?.backing ? encodeWav(exercise.backing, exercise.backingSampleRate) : null), [exercise])
  const { guide: guideAudio, ready: guideReady } = useExerciseGuide(exercise)

  if (!exercise || !audio) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="lesson-try">
        <p>{practiceTrouble(lesson, built.error)}</p>
        <Button variant="primary" onClick={onContinue}>
          Continue
        </Button>
      </div>
    )
  }

  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    const fraction = hitFraction(summary)
    const verdict = runVerdict(summary, result)
    const passed = verdict === 'counted' && (fraction >= drill.passAccuracy || round >= drill.rounds)
    setFeedback({ summary, fraction, passed, round, verdict })
    if (verdict !== 'counted') return
    // The exercise as it was built: a sung round's own params carry the notes it was sung in and its step.
    void recordLessonDrill(drill.skillId, exercise, result, getSettings()).catch(() => {})
    const marked = getLessonProgress(lesson.id)
      .then((prev) =>
        patchLessonProgress(lesson.id, {
          drillBestAccuracy: Math.max(prev?.drillBestAccuracy ?? 0, fraction),
          drillDone: prev?.drillDone || passed,
        }),
      )
      .catch(() => {})
    onMark?.(marked)
  }

  const again = () => {
    // After "Tight" the next round is built under the new top note. Not before: the round whose result
    // is on screen stays the one that was sung.
    if (felt?.next) setRange(felt.next)
    setFelt(null)
    setFeltTrouble(false)
    setFeedback(null)
    markStart()
    setRound((r) => r + 1)
  }

  const answerFelt = (answer: Felt) => {
    // The answer belongs to the round it was given after. Should it be stored only after "Again" was
    // tapped, it must not stand on the next round's card as if that round had been asked about.
    const asked = round
    setFeltBusy(true)
    setFeltTrouble(false)
    recordFelt(answer)
      .then((voice) => {
        const now = voice.range
        const lowered = !!now && !!range && now.high < range.high
        setFelt({ round: asked, felt: answer, lowered, next: now && lowered ? { low: now.low, high: now.high, easy: now.easy } : undefined })
      })
      .catch(() => setFeltTrouble(true))
      .finally(() => setFeltBusy(false))
  }

  const reached = !!feedback && feedback.fraction >= drill.passAccuracy
  const note = practiceNote(!!feedback?.passed, reached)

  if (!guideReady) return <Waiting testId="lesson-try-loading" text="Getting your practice ready…" onExit={onExit} />

  return (
    <div data-testid="lesson-try" className="h-dvh">
      <Player
        ref={playerRef}
        mode="exercise"
        title={`${lesson.number}. ${lesson.title}`}
        subtitle={`Try it · round ${round} of ${drill.rounds}`}
        chart={exercise.chart}
        notes={exercise.chart.notes}
        audio={audio}
        guideAudio={guideAudio}
        backingIsClick
        playedTempo={drill.tempo}
        targetTempo={drill.tempo}
        readyHint={forHand(drill.hint, settings.handedness)}
        resetKey={round}
        headerControls={<Badge tone="accent">{`Try · round ${round} of ${drill.rounds}`}</Badge>}
        onExit={onExit}
        onFinished={onFinished}
        resultsOverlay={
          feedback ? (
            <FeedbackCard lesson={lesson} feedback={feedback} note={note} skillTips={skill?.tips} voice={exercise.chart.voice} onAgain={again} onContinue={onContinue}>
              {asksHowItFelt(exercise.chart) && <FeltQuestion answer={felt?.round === feedback.round ? felt : null} busy={feltBusy} trouble={feltTrouble} onAnswer={answerFelt} />}
            </FeedbackCard>
          ) : null
        }
      />
    </div>
  )
}

interface PlayStepProps {
  lesson: Lesson
  play: LessonPlay
  onExit: () => void
  onContinue: () => void
  /** Handed every write to the lesson's row that this step starts, so the finish of the lesson can wait for it. */
  onMark?: (write: Promise<unknown>) => void
}

/** The song of a lesson: played on the guitar, or sung in a singing lesson. */
export function PlayStep(props: PlayStepProps) {
  return instrumentOfLessonId(props.lesson.id) === 'voice' ? <SungPlayStep {...props} /> : <PlayedSong {...props} />
}

/** Shown in place of a song that cannot be put on the screen: the lesson can go on without it. */
function SongNotReady({ text, onExit, onContinue }: { text: string; onExit: () => void; onContinue: () => void }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="lesson-play">
      <p>{text}</p>
      <Button variant="primary" onClick={onContinue}>
        Continue
      </Button>
      <Button variant="ghost" onClick={onExit}>
        Back to lessons
      </Button>
    </div>
  )
}

const SONG_NOT_READY = 'This song is not ready yet. You can carry on and come back to it later.'

function PlayedSong({ lesson, play, onExit, onContinue, onMark }: PlayStepProps) {
  const settings = useSettings()
  const [record, setRecord] = useState<SongRecord | null>(null)
  const [error, setError] = useState(false)
  const [round, setRound] = useState(1)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const markStart = useStartAfterReset(playerRef, round)
  const info = builtInSong(play.songId)

  useEffect(() => {
    let cancelled = false
    builtInSongRecord(play.songId)
      .then((r) => !cancelled && setRecord(r))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [play.songId])

  const prepared = useMemo(() => {
    if (!record) return null
    // What the lesson shows of the song (the same function builds the scoring simulation's lesson cases).
    const shown = lessonSongNotes(play, record.chart)
    const { audio, guide, clickOnly } = songPlayback(record)
    if (!audio) return null
    return { level: shown.level, notes: shown.notes, audio, guide, clickOnly, chart: { ...record.chart, duration: Math.max(record.chart.duration, record.duration) } }
  }, [record, play])

  if (error || (record && !prepared)) return <SongNotReady text={SONG_NOT_READY} onExit={onExit} onContinue={onContinue} />
  if (!record || !prepared) return <Waiting text="Getting your song ready…" onExit={onExit} />

  const bpm = chartBpm(prepared.chart)
  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    const fraction = hitFraction(summary)
    const verdict = runVerdict(summary, result)
    // The song counts as played once a fair share of it was really hit; the learner can still carry on without.
    setFeedback({ summary, fraction, passed: verdict === 'counted' && fraction >= SONG_PLAYED_FRACTION, round, verdict })
    if (verdict !== 'counted') return
    void recordSongPlay(record, prepared.level, result, getSettings()).catch(() => {})
    void recordResult(record.id, {
      level: LEVELS[prepared.level].level,
      score: summary.score,
      accuracy: summary.accuracy,
      maxStreak: summary.maxStreak,
      perfects: summary.perfects,
      goods: summary.goods,
      misses: summary.misses,
      speed: play.speed,
      date: Date.now(),
    }).catch(() => {})
    const marked = getLessonProgress(lesson.id)
      .then((prev) => patchLessonProgress(lesson.id, { playDone: prev?.playDone || fraction >= SONG_PLAYED_FRACTION, playBestAccuracy: Math.max(prev?.playBestAccuracy ?? 0, fraction) }))
      .catch(() => {})
    onMark?.(marked)
  }
  const again = () => {
    setFeedback(null)
    markStart()
    setRound((r) => r + 1)
  }
  const chords = info?.chords ?? []
  const chordRow =
    chords.length > 0 ? (
      <div className="flex items-center gap-2 overflow-x-auto" data-testid="lesson-chords" aria-label="Chords in this song">
        {chords.map((c) => (
          <div key={c} className="shrink-0 text-center text-xs text-muted">
            <ChordBox name={c} handedness={settings.handedness} size={72} />
            <div>{c}</div>
          </div>
        ))}
      </div>
    ) : null

  return (
    <div data-testid="lesson-play" className="h-dvh">
      <Player
        ref={playerRef}
        mode="song"
        title={record.title}
        subtitle={`${lesson.number}. ${lesson.title}`}
        chart={prepared.chart}
        notes={prepared.notes}
        audio={prepared.audio}
        guideAudio={prepared.guide}
        backingIsClick={prepared.clickOnly}
        speed={play.speed}
        playedTempo={bpm * play.speed}
        targetTempo={bpm}
        resetKey={round}
        readyHint={songHint(lesson, play, info?.description)}
        headerControls={chordRow}
        mobileControls={chordRow}
        onExit={onExit}
        onFinished={onFinished}
        resultsOverlay={feedback ? <FeedbackCard lesson={lesson} feedback={feedback} note={songNote(lesson, feedback.passed)} onAgain={again} onContinue={onContinue} /> : null}
      />
    </div>
  )
}

/**
 * The song of a singing lesson. Its row is asked for by the song's own id and written first when it is
 * missing, so a lesson never depends on the songs having been installed. The last lesson sings the
 * song the singer picked as their goal, which is on the singing profile: that is read before anything
 * is fetched, or the lesson's stand-in song would flash up first.
 */
function SungPlayStep({ lesson, play: own, onExit, onContinue, onMark }: PlayStepProps) {
  const profile = useProfile('voice')
  const known = profile !== undefined
  const play = lessonPlayFor(lesson, profile?.goalSongId) ?? own
  const [found, setFound] = useState<{ songId: string; record: SongRecord } | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!known) return
    let cancelled = false
    // Not inside a live query: asking for the row may write it.
    vocalSongRecord(play.songId)
      .then((record) => !cancelled && setFound({ songId: play.songId, record }))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [known, play.songId])

  if (error) return <SongNotReady text={SONG_NOT_READY} onExit={onExit} onContinue={onContinue} />
  const record = found?.songId === play.songId ? found.record : null
  if (!known || !record) return <Waiting text={`${GETTING_READY}…`} onExit={onExit} />
  return <SungSong lesson={lesson} play={play} record={record} onExit={onExit} onContinue={onContinue} onMark={onMark} />
}

function SungSong({ lesson, play, record, onExit, onContinue, onMark }: PlayStepProps & { record: SongRecord }) {
  const [round, setRound] = useState(1)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [inRun, setInRun] = useState(false)
  const [keyLowered, setKeyLowered] = useState(false)
  const playerRef = useRef<PlayerHandle>(null)
  const markStart = useStartAfterReset(playerRef, round)
  // The song in the singer's own key, at the level this lesson sings it, once both its tracks exist
  // (they are made after this screen is up: that work is not instant on a phone). It follows the singing
  // profile live, so a new key (the Coach lowers a song whose top notes were missed twice) is a new arrangement.
  const making = useVocalRunState(record, play.level)
  const live = making.status === 'ready' ? making.run : null
  // Held while a run is under way and while its result is on screen, so the song is never swapped under
  // the singer. "Again" lets go of it: a run after a key change is then sung in the new key, never in the old one.
  const run = useHeld(live, inRun || feedback !== null)

  if (!run) {
    // The tracks could not be made: say so and let the lesson go on, as for a guitar song that is not ready.
    if (making.status === 'failed' || making.status === 'none') return <SongNotReady text={SONG_NOT_READY} onExit={onExit} onContinue={onContinue} />
    return <Waiting text={`${GETTING_READY}…`} onExit={onExit} />
  }
  // The songs of the course fit every range the app stores; one that does not must not be sung.
  if (!run.fits) return <SongNotReady text={COMES_LATER.thisSong} onExit={onExit} onContinue={onContinue} />

  // Every note of the arrangement, recorded under the lesson's level of the song.
  const shown = lessonSongNotes(play, run.chart)
  const bpm = chartBpm(run.chart)
  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    const fraction = hitFraction(summary)
    const verdict = runVerdict(summary, result)
    // The song counts as sung once a fair share of its notes was really sung; the singer can still carry on without.
    setFeedback({ summary, fraction, passed: verdict === 'counted' && fraction >= SONG_PLAYED_FRACTION, round, verdict })
    if (verdict !== 'counted') return
    void recordSongPlay(record, shown.level, result, getSettings())
      .then((outcome) => setKeyLowered(outcome.keyLowered === true))
      .catch(() => {})
    // Kept by the song's row exactly as the song page keeps a run (level numbers from 1, speed 1), so
    // "your best run on this level" is one list wherever the song was sung.
    void recordResult(record.id, resultRecord(shown.level, summary, Date.now())).catch(() => {})
    const marked = getLessonProgress(lesson.id)
      .then((prev) => patchLessonProgress(lesson.id, { playDone: prev?.playDone || fraction >= SONG_PLAYED_FRACTION, playBestAccuracy: Math.max(prev?.playBestAccuracy ?? 0, fraction) }))
      .catch(() => {})
    onMark?.(marked)
  }
  const again = () => {
    setKeyLowered(false)
    setFeedback(null)
    markStart()
    setRound((r) => r + 1)
  }

  return (
    <div data-testid="lesson-play" className="h-dvh">
      <Player
        ref={playerRef}
        mode="song"
        title={record.title}
        subtitle={`${lesson.number}. ${lesson.title}`}
        chart={run.chart}
        notes={shown.notes}
        audio={run.audio}
        guideAudio={run.guide}
        backingIsClick
        playedTempo={bpm}
        targetTempo={bpm}
        resetKey={round}
        readyHint={songHint(lesson, play)}
        onExit={onExit}
        onFinished={onFinished}
        onPhaseChange={(phase) => setInRun(phase === 'playing' || phase === 'countin' || phase === 'paused')}
        resultsOverlay={
          feedback ? (
            <FeedbackCard lesson={lesson} feedback={feedback} note={songNote(lesson, feedback.passed)} voice={run.chart.voice} onAgain={again} onContinue={onContinue}>
              {keyLowered && (
                <p className="mt-3 text-sm text-slate-200" data-testid="lesson-key-lowered">
                  {KEY_LOWERED_LINE}
                </p>
              )}
            </FeedbackCard>
          ) : null
        }
      />
    </div>
  )
}
