import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { getSettings, useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { LEVELS } from '../../chart/difficulty'
import { chartBpm } from '../../chart/types'
import { ChordBox } from '../../components/diagrams'
import { Badge, Button } from '../../components/ui'
import { recordResult, type SongRecord } from '../../db/db'
import { forHand } from '../../lessons/fingering'
import { lessonDrillExercise, lessonSongNotes } from '../../lessons/material'
import type { Lesson, LessonDrill, LessonPlay } from '../../lessons/types'
import { getTuning } from '../../music/tunings'
import { builtInSong, builtInSongRecord } from '../../songs'
import { songPlayback } from '../../songs/playback'
import { useExerciseGuide } from '../play/useExerciseGuide'
import { recordLessonDrill, recordSongPlay } from '../../training/coach'
import { renderExerciseBacking } from '../../training/exercises/backing'
import { SKILLS_BY_ID } from '../../training/skills'
import type { AttemptResult } from '../../training/types'
import { Player, type PlayerHandle } from '../play/Player'
import { NOT_COUNTED, runVerdict, type RunVerdict } from '../play/runVerdict'
import type { ScoreSummary } from '../play/scoring'
import { feedbackLine, hitFraction, lessonSongHint, tipFor } from './lessonUtils'
import { getLessonProgress, patchLessonProgress } from '../../lessons/store'

function Overlay({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4" data-testid={testId}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">{children}</div>
    </div>
  )
}

/** Share of a lesson song's notes that must be hit for the song to count as played. */
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

function FeedbackCard({
  lesson,
  feedback,
  note,
  skillTips,
  onAgain,
  onContinue,
}: {
  lesson: Lesson
  feedback: Feedback
  note: string
  skillTips?: string[]
  onAgain: () => void
  onContinue: () => void
}) {
  const verdict = feedback.verdict
  const settings = useSettings()
  return (
    <Overlay testId="lesson-feedback">
      <h2 className="text-2xl font-bold" data-testid="lesson-score" data-verdict={verdict}>
        {verdict === 'unscored' ? 'We did not hear any notes this time.' : verdict !== 'counted' ? NOT_COUNTED[verdict].title : feedbackLine(feedback.summary)}
      </h2>
      {verdict === 'unscored' ? (
        <p className="mt-3 text-sm text-slate-200">
          Check that the microphone is allowed and that the phone is close to your guitar, then try again. If the guitar may be out of tune, tune it first.
        </p>
      ) : verdict !== 'counted' ? (
        <p className="mt-3 text-sm text-slate-200">{NOT_COUNTED[verdict].body}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate-200">{note}</p>
          <p className="mt-3 rounded-lg bg-panel-2 p-3 text-sm text-slate-200" data-testid="lesson-tip">
            {forHand(tipFor(lesson, feedback.fraction, feedback.round, skillTips), settings.handedness)}
          </p>
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

export function TryStep({ lesson, drill, onExit, onContinue }: { lesson: Lesson; drill: LessonDrill; onExit: () => void; onContinue: () => void }) {
  const settings = useSettings()
  const skill = SKILLS_BY_ID[drill.skillId]
  const tuning = getTuning(settings.defaultTuningId).strings
  const tuningKey = tuning.join(',')
  const playerRef = useRef<PlayerHandle>(null)
  const [round, setRound] = useState(1)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const markStart = useStartAfterReset(playerRef, round)

  const built = useMemo(() => {
    try {
      // Built by the same function as the scoring simulation's lesson cases, so what is proven there is what is shown here.
      return { exercise: renderExerciseBacking(lessonDrillExercise(lesson, tuning), { guide: true }), error: null as string | null }
    } catch (err) {
      return { exercise: null, error: err instanceof Error ? err.message : String(err) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, tuningKey])
  const exercise = built.exercise
  const audio = useMemo(() => (exercise?.backing ? encodeWav(exercise.backing, exercise.backingSampleRate) : null), [exercise])
  const { guide: guideAudio, ready: guideReady } = useExerciseGuide(exercise)

  if (!exercise || !audio) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="lesson-try">
        <p>We could not set up this practice.{built.error ? ` (${built.error})` : ''}</p>
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
    void recordLessonDrill(skill.id, exercise, result, getSettings()).catch(() => {})
    void getLessonProgress(lesson.id)
      .then((prev) =>
        patchLessonProgress(lesson.id, {
          drillBestAccuracy: Math.max(prev?.drillBestAccuracy ?? 0, fraction),
          drillDone: prev?.drillDone || passed,
        }),
      )
      .catch(() => {})
  }

  const again = () => {
    setFeedback(null)
    markStart()
    setRound((r) => r + 1)
  }

  const reached = !!feedback && feedback.fraction >= drill.passAccuracy
  const note = !feedback?.passed
    ? 'Listen first, then go again. It gets easier each time you try.'
    : reached
      ? 'That is enough to move on. You can go again if you want more practice.'
      : 'Not quite there yet, and that is fine. You can move on and come back to this later, or go again now.'

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
        resultsOverlay={feedback ? <FeedbackCard lesson={lesson} feedback={feedback} note={note} skillTips={skill.tips} onAgain={again} onContinue={onContinue} /> : null}
      />
    </div>
  )
}

export function PlayStep({ lesson, play, onExit, onContinue }: { lesson: Lesson; play: LessonPlay; onExit: () => void; onContinue: () => void }) {
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

  if (error || (record && !prepared)) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="lesson-play">
        <p>This song is not ready yet. You can carry on and come back to it later.</p>
        <Button variant="primary" onClick={onContinue}>
          Continue
        </Button>
        <Button variant="ghost" onClick={onExit}>
          Back to lessons
        </Button>
      </div>
    )
  }
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
    void getLessonProgress(lesson.id)
      .then((prev) => patchLessonProgress(lesson.id, { playDone: prev?.playDone || fraction >= SONG_PLAYED_FRACTION, playBestAccuracy: Math.max(prev?.playBestAccuracy ?? 0, fraction) }))
      .catch(() => {})
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
        readyHint={lessonSongHint(play.view, info?.description)}
        headerControls={chordRow}
        mobileControls={chordRow}
        onExit={onExit}
        onFinished={onFinished}
        resultsOverlay={
          feedback ? (
            <FeedbackCard
              lesson={lesson}
              feedback={feedback}
              note={feedback.passed ? 'Well played. You can go again, or carry on to finish the lesson.' : 'Have another go: watch the notes come down and play each one as it reaches the line. You can also carry on and come back to this song later.'}
              onAgain={again}
              onContinue={onContinue}
            />
          ) : null
        }
      />
    </div>
  )
}
