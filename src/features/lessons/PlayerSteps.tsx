import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { getSettings, useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { LEVELS, generateLevels } from '../../chart/difficulty'
import { chartBpm } from '../../chart/types'
import { ChordBox } from '../../components/diagrams'
import { Badge, Button } from '../../components/ui'
import { recordResult, songAudioBlob, type SongRecord } from '../../db/db'
import type { Lesson, LessonDrill, LessonPlay } from '../../lessons/types'
import { getTuning } from '../../music/tunings'
import { builtInBacking, builtInSong, builtInSongRecord } from '../../songs'
import { recordLessonDrill, recordSongPlay } from '../../training/coach'
import { exerciseParams, generateExercise } from '../../training/exercises'
import { renderExerciseBacking } from '../../training/exercises/backing'
import { SKILLS_BY_ID } from '../../training/skills'
import type { AttemptResult } from '../../training/types'
import { Player, type PlayerHandle } from '../play/Player'
import type { ScoreSummary } from '../play/scoring'
import { feedbackLine, hitFraction, tipFor } from './lessonUtils'
import { getLessonProgress, patchLessonProgress } from '../../lessons/store'

function Overlay({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4" data-testid={testId}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">{children}</div>
    </div>
  )
}

interface Feedback {
  summary: ScoreSummary
  fraction: number
  passed: boolean
  round: number
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
  const none = feedback.summary.total === 0
  return (
    <Overlay testId="lesson-feedback">
      <h2 className="text-2xl font-bold" data-testid="lesson-score">
        {feedbackLine(feedback.summary)}
      </h2>
      {none ? (
        <p className="mt-3 text-sm text-slate-200">Check that your guitar is close to the phone and the microphone is allowed, then try again.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate-200">{note}</p>
          <p className="mt-3 rounded-lg bg-panel-2 p-3 text-sm text-slate-200" data-testid="lesson-tip">
            {tipFor(lesson, feedback.fraction, feedback.round, skillTips)}
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
      const params = exerciseParams(skill, drill.generatorId, drill.tempo, drill.params)
      return { exercise: renderExerciseBacking(generateExercise(skill, drill.generatorId, params, tuning), { guide: true }), error: null as string | null }
    } catch (err) {
      return { exercise: null, error: err instanceof Error ? err.message : String(err) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, tuningKey])
  const exercise = built.exercise
  const audio = useMemo(() => (exercise?.backing ? encodeWav(exercise.backing, exercise.backingSampleRate) : null), [exercise])
  const guideAudio = useMemo(() => (exercise?.guide ? encodeWav(exercise.guide, exercise.backingSampleRate) : null), [exercise])

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
    const passed = summary.total > 0 && (fraction >= drill.passAccuracy || round >= drill.rounds)
    setFeedback({ summary, fraction, passed, round })
    if (summary.total === 0) return
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

  const note = feedback?.passed
    ? 'That is enough to move on. You can go again if you want more practice.'
    : 'Listen first, then go again. Each try gets a little easier.'

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
        playedTempo={drill.tempo}
        targetTempo={drill.tempo}
        readyHint={exercise.instructions}
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
    const levels = generateLevels(record.chart)
    const level = Math.max(0, Math.min(levels.length - 1, play.level))
    const guide = songAudioBlob(record)
    const drums = builtInBacking(play.songId)
    const audio = drums ? encodeWav(drums) : guide
    if (!audio) return null
    return { level, notes: levels[level].notes, audio, guide: drums ? guide : null, chart: { ...record.chart, duration: Math.max(record.chart.duration, record.duration) } }
  }, [record, play.songId, play.level])

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
  if (!record || !prepared) return <div className="flex h-dvh items-center justify-center text-muted">Getting your song ready…</div>

  const bpm = chartBpm(prepared.chart)
  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    const fraction = hitFraction(summary)
    setFeedback({ summary, fraction, passed: summary.total > 0, round })
    if (summary.total === 0) return
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
      .then((prev) => patchLessonProgress(lesson.id, { playDone: true, playBestAccuracy: Math.max(prev?.playBestAccuracy ?? 0, fraction) }))
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
        speed={play.speed}
        playedTempo={bpm * play.speed}
        targetTempo={bpm}
        resetKey={round}
        readyHint={info?.description}
        headerControls={chordRow}
        mobileControls={chordRow}
        onExit={onExit}
        onFinished={onFinished}
        resultsOverlay={
          feedback ? (
            <FeedbackCard
              lesson={lesson}
              feedback={feedback}
              note={feedback.passed ? 'Well played. You can go again, or carry on to finish the lesson.' : ''}
              onAgain={again}
              onContinue={onContinue}
            />
          ) : null
        }
      />
    </div>
  )
}
