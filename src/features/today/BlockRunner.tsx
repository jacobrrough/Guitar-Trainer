import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { voiceEnabled } from '../../app/features'
import { getSettings, useSettings } from '../../app/settings'
import { encodeWav } from '../../audio/synth'
import { generateLevels } from '../../chart/difficulty'
import { chartBpm } from '../../chart/types'
import { Badge, Button } from '../../components/ui'
import { db, recordResult, type SongRecord } from '../../db/db'
import { DEFAULT_RANGES } from '../../music/keys'
import { getTuning } from '../../music/tunings'
import {
  completeExerciseBlock,
  finishExerciseBlock,
  completeSongBlock,
  exerciseForBlock,
  nextPendingBlockId,
  recordExerciseRep,
  recordFelt,
  recordSongPlay,
  type BlockOutcome,
  type ExerciseRange,
  type Felt,
  type RepOutcome,
} from '../../training/coach'
import { instrumentOf, instrumentOfBlockId, instrumentOfSkillId, skillById } from '../../training/instruments'
import { masteryBand, stepWithin } from '../../training/learner'
import { localDateString } from '../../training/store'
import type { AttemptResult, Block, ExerciseBlock, SessionRecord, SongBlock } from '../../training/types'
import { useProfile, useTodaySession } from '../../training/useTraining'
import { MOVED_DOWN } from '../../training/voicePlan'
import { songPlayback } from '../../songs/playback'
import { levelIndex, VOICE_LEVELS } from '../../songs/vocal'
import { GETTING_READY, useVocalRunState } from '../../songs/vocal/useVocalRun'
import { FELT_COPY, asksHowItFelt, feltReply } from '../lessons/lessonUtils'
import { useExerciseGuide } from '../play/useExerciseGuide'
import { NotCountedCard } from '../play/NotCountedCard'
import { Player, type PlayerHandle } from '../play/Player'
import { runVerdict, type RunVerdict } from '../play/runVerdict'
import { useHeld } from '../play/useHeld'
import { closerLine, resultRecord, singsAgainAtOnce } from '../sing/singPage'
import { EarTrainer } from './EarTrainer'
import type { ScoreSummary } from '../play/scoring'
import { SUNG_BLOCK } from './copy'
import {
  blockResultLine,
  blockTip,
  hasPace,
  nextRoundText,
  nextSungRoundText,
  resultCaption,
  roundBadge,
  roundWord,
  scoreHint,
  stepThatFits,
  sungCardCopy,
  sungSongView,
  sungStepLine,
} from './repCard'
import { bandLabel, blockPath, notesHitText, pct, reasonText, repSummaryText, simpleBandLabel, stepLabel, timingText, timingWords } from './todayUtils'

/**
 * A card over the player, in the middle of it. The card is centred by its own margins, not by the
 * box around it: a card taller than a phone held sideways then starts at the top and can be scrolled,
 * where one centred by the box loses its top line above the edge with no way to reach it.
 */
function Overlay({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex overflow-y-auto bg-bg/85 p-4" data-testid={testId}>
      <div className="m-auto w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel-2 p-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function NavButtons({ session, blockId }: { session: SessionRecord; blockId: string }) {
  const navigate = useNavigate()
  const nextId = nextPendingBlockId(session, blockId)
  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      <Button variant="primary" onClick={() => navigate(nextId ? `/today/block/${nextId}` : '/')} data-testid="next-block">
        {nextId ? 'Next block' : 'Finish session'}
      </Button>
      <Button variant="ghost" onClick={() => navigate('/')}>
        Back to Today
      </Button>
    </div>
  )
}

function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Overlay testId="runner-error">
      <h2 className="text-lg font-semibold text-red-300">Could not save the result</h2>
      <p className="mt-2 text-sm text-muted">{message}</p>
      {onRetry && (
        <div className="mt-4 flex justify-center">
          <Button onClick={onRetry}>Retry</Button>
        </div>
      )}
    </Overlay>
  )
}

/** What the singer answered to "How did the slides feel?", and what the answer did. */
interface FeltAnswer {
  /** The round the answer was given after. It is shown on that round's card and on no later one. */
  round: number
  felt: Felt
  /** "Tight" took a note off the top of the easy notes. */
  lowered: boolean
  /** The easy notes after the answer, when they changed: the next round is built in these. */
  next?: ExerciseRange
}

/**
 * Asked after a round of slides: easy, OK or tight. The answer is stored at once ("Tight" always wins
 * over what the round scored), and the reply says what it did. The words are the lesson's own, so the
 * daily plan and the lesson ask the same question.
 */
function FeltQuestion({ answer, busy, trouble, onAnswer }: { answer: FeltAnswer | null; busy: boolean; trouble: boolean; onAnswer: (felt: Felt) => void }) {
  return (
    <div className="mt-3 rounded-lg border border-line p-3 text-sm" data-testid="felt" data-answer={answer?.felt ?? ''}>
      <p className="font-medium text-slate-100">{FELT_COPY.question}</p>
      {answer ? (
        <p className="mt-2 text-slate-200" data-testid="felt-reply">
          {feltReply(answer.felt, answer.lowered)}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {(['easy', 'ok', 'tight'] as const).map((felt) => (
            <Button key={felt} size="sm" disabled={busy} onClick={() => onAnswer(felt)} data-testid={`felt-${felt}`}>
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

/**
 * A sung exercise is built in the singer's easy notes, so those are read before the first round is.
 * A singer always has notes to sing in: their own, or the lower starting notes until those are found
 * (the same ones a song is then placed in, so an exercise and a song are never an octave apart).
 */
function SungExerciseRunner({ block, session }: { block: ExerciseBlock; session: SessionRecord }) {
  const navigate = useNavigate()
  const profile = useProfile('voice')
  if (!profile) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 text-muted" data-testid="block-runner">
        <p>Getting your exercise ready…</p>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    )
  }
  return <ExerciseRunner block={block} session={session} startRange={profile.voice?.range ?? DEFAULT_RANGES.lower} />
}

/**
 * The rounds of one exercise block. `startRange` is given for a sung exercise and for no other: the
 * notes it is built in. They stay as they were when the block opened, so a round on screen is never
 * rebuilt under the singer; only the answer "Tight" changes them, and then for the next round.
 */
function ExerciseRunner({ block, session, startRange }: { block: ExerciseBlock; session: SessionRecord; startRange?: ExerciseRange }) {
  const navigate = useNavigate()
  const settings = useSettings()
  const simple = settings.simpleFeedback
  const skill = skillById(block.skillId)
  // By the skill, as the Coach stamps the run: a sung round gets a singer's cards.
  const sung = instrumentOfSkillId(block.skillId) === 'voice'
  const playerRef = useRef<PlayerHandle>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [tempo, setTempo] = useState(block.tempo)
  // A step exercise never changes tempo; the Coach moves its step from round to round instead.
  // Null until it has: the first round is built from the block as it was planned.
  const [roundStep, setRoundStep] = useState<number | null>(null)
  const [range, setRange] = useState(startRange)
  const rangeKey = range ? `${range.low},${range.high},${range.easy}` : ''
  const [felt, setFelt] = useState<FeltAnswer | null>(null)
  const [feltBusy, setFeltBusy] = useState(false)
  const [feltTrouble, setFeltTrouble] = useState(false)
  // What the player said about the round that was just sung: the reasons behind a singer's tip are in it.
  const [lastSummary, setLastSummary] = useState<ScoreSummary | null>(null)
  const [rep, setRep] = useState(1)
  const [repOutcome, setRepOutcome] = useState<RepOutcome | null>(null)
  const [repResult, setRepResult] = useState<AttemptResult | null>(null)
  const [blockOutcome, setBlockOutcome] = useState<BlockOutcome | null>(null)
  const [notCounted, setNotCounted] = useState<Exclude<RunVerdict, 'counted'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ratingBefore, setRatingBefore] = useState(0)
  const [savingFlag, setSavingFlag] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const startNext = useRef(false)
  const lastResult = useRef<AttemptResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void db.skillStates.get(block.skillId).then((st) => {
      if (!cancelled) setRatingBefore(st?.rating ?? 0)
    })
    return () => {
      cancelled = true
    }
  }, [block.skillId])

  const tuning = getTuning(settings.defaultTuningId).strings
  const exerciseResult = useMemo(() => {
    try {
      // The round as the Coach asked for it: the block, at this round's tempo and (a step exercise) on
      // this round's step. A sung round is placed in the easy notes as they are for this round.
      const round = roundStep === null ? { ...block, tempo } : { ...block, tempo, params: { ...block.params, step: roundStep } }
      return { exercise: exerciseForBlock(round, tuning, range), error: null as string | null }
    } catch (err) {
      return { exercise: null, error: err instanceof Error ? err.message : String(err) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, tempo, tuning.join(','), roundStep, rangeKey])
  const exercise = exerciseResult.exercise
  const audio = useMemo(() => (exercise?.backing ? encodeWav(exercise.backing, exercise.backingSampleRate) : null), [exercise])
  const { guide: guideAudio, ready: guideReady } = useExerciseGuide(exercise)
  // What the Player shows. While the next round's listening guide is being rendered the Player keeps
  // the round before on screen and stays mounted, so the microphone is not closed and reopened between
  // rounds and the next round starts on the same audio element the learner's tap unlocked.
  const live = useMemo(() => ({ exercise, audio, guideAudio, rep, tempo, ready: guideReady }), [exercise, audio, guideAudio, rep, tempo, guideReady])
  const shown = useHeld(live, !guideReady)

  // After "Next rep": once the new round is in the Player (it resets through resetKey, a child
  // effect, and its audio element takes the new source one render later), start it.
  useEffect(() => {
    if (!startNext.current) return
    startNext.current = false
    const t = setTimeout(() => playerRef.current?.start(), 250)
    return () => clearTimeout(t)
  }, [shown.rep])

  const isLast = rep >= block.reps

  const finalize = useCallback(
    async (result: AttemptResult) => {
      if (!exercise) return
      setError(null)
      setSavingFlag(true)
      try {
        const outcome = await completeExerciseBlock(sessionRef.current, { ...block, tempo }, exercise, result, getSettings())
        // The coach's own safety net: a run it refused to count leaves the block open, so say so instead of "done".
        if (outcome.counted === false) setNotCounted('bleed')
        else setBlockOutcome(outcome)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSavingFlag(false)
      }
    },
    [block, tempo, exercise],
  )

  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    if (!exercise) return
    lastResult.current = result
    setLastSummary(summary)
    setRepResult(result)
    setRepOutcome(null)
    setBlockOutcome(null)
    setError(null)
    // Not heard at all, or the app heard its own guitar part: nothing is recorded and the rep is played again.
    const verdict = runVerdict(summary, result)
    if (verdict !== 'counted') {
      setNotCounted(verdict)
      return
    }
    setNotCounted(null)
    if (isLast) {
      void finalize(result)
      return
    }
    setSavingFlag(true)
    recordExerciseRep(sessionRef.current, { ...block, tempo }, exercise, result, getSettings())
      .then((outcome) => (outcome.counted === false ? setNotCounted('bleed') : setRepOutcome(outcome)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingFlag(false))
  }

  const nextRep = () => {
    if (!repOutcome) return
    startNext.current = true
    // After "Tight" the next round is built under the new top note. Not before: the round whose result
    // is on screen stays the one that was sung.
    if (felt?.next) setRange(felt.next)
    setFelt(null)
    setFeltTrouble(false)
    setRepOutcome(null)
    setRepResult(null)
    setTempo(repOutcome.nextTempo)
    // The step the Coach picked for the next round (a step exercise only), taken over as the tempo is.
    if (repOutcome.nextParams) setRoundStep(repOutcome.nextParams.step)
    setRep((r) => r + 1)
  }

  const answerFelt = (answer: Felt) => {
    // The answer belongs to the round it was given after: stored late, it must not stand on the next round's card.
    const asked = rep
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

  const retry = () => {
    setNotCounted(null)
    setRepResult(null)
    setRetryKey((k) => k + 1)
    playerRef.current?.restart()
    playerRef.current?.start()
  }

  if (!skill || !exercise || (!audio && exercise.interaction !== 'ear')) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="block-runner">
        {/* The reason a sung round could not be built is written in note numbers: a singer reads what they can do instead. */}
        <p>{sung ? SUNG_BLOCK.buildTrouble : (exerciseResult.error ?? 'This exercise has no audio.')}</p>
        {sung && (
          <Link to="/range" className="underline">
            My voice
          </Link>
        )}
        <Link to="/" className="underline">
          Back to Today
        </Link>
      </div>
    )
  }

  const saving = savingFlag
  // Ear rounds are answered in the player's own time: their cards carry no timing or tempo lines.
  const paced = hasPace(exercise)
  // A step exercise: the step this round was built on, in the words of its skill. Null for an exercise that moves by tempo.
  const stepNow = stepLabel(skill, exercise.params.step)
  // A singer's result: how many notes they were on, and what the run itself showed (under the note, not heard).
  // (The summary is there whenever a card is: the player hands it over together with the result.)
  // On the card that ends the block the tip does not ask for another go: there is none.
  const sungCopy = sung ? sungCardCopy(lastSummary, exercise.chart.voice, blockOutcome !== null) : null
  // After slides the singer is asked how they felt, on the card of that round and on no later one.
  const feltQuestion =
    sung && asksHowItFelt(exercise.chart) ? <FeltQuestion answer={felt?.round === rep ? felt : null} busy={feltBusy} trouble={feltTrouble} onAnswer={answerFelt} /> : null
  let overlay: ReactNode
  if (error) {
    overlay = <ErrorCard message={error} onRetry={isLast && repResult ? () => void finalize(repResult) : undefined} />
  } else if (notCounted) {
    overlay = <NotCountedCard verdict={notCounted} onRetry={retry} instrument={sung ? 'voice' : 'guitar'} />
  } else if (blockOutcome) {
    const after = blockOutcome.state?.rating ?? ratingBefore
    const res = blockOutcome.attempt
    const acc = blockOutcome.performance.acc
    const tip = blockTip({ accuracy: acc, skillTips: skill.tips, sung: sungCopy ? { runTip: sungCopy.tip } : undefined })
    const lastStep = (skill.steps?.length ?? 0) - 1
    const hint = scoreHint({
      before: ratingBefore,
      after,
      accuracy: acc,
      tempo,
      targetTempo: skill.targetTempo,
      paced,
      ...(sung ? { sung: true } : {}),
      ...(lastStep >= 0 ? { step: { now: stepWithin(exercise.params.step, lastStep, 0), top: stepWithin(exercise.params.maxStep, lastStep, lastStep) } } : {}),
    })
    const reasons = blockOutcome.performance.reasons
    // A singer with plain feedback reads words, not a score: a rating is a number a beginner cannot use.
    const showScore = !sung || !simple
    const details = (
      <>
        <dl className={showScore ? 'mt-4 grid grid-cols-2 gap-2 text-sm' : 'mt-4 grid grid-cols-1 gap-2 text-sm'}>
          {showScore && <Stat label={simple ? 'Skill score' : 'Rating'} value={`${Math.round(ratingBefore)} → ${Math.round(after)}`} />}
          <Stat
            label={simple ? 'Level' : 'Level band'}
            value={
              simple
                ? `${simpleBandLabel(masteryBand(ratingBefore))} → ${simpleBandLabel(masteryBand(after))}`
                : `${bandLabel(masteryBand(ratingBefore))} → ${bandLabel(masteryBand(after))}`
            }
          />
        </dl>
        {simple && !sung && <p className="mt-2 text-xs text-muted">{blockResultLine(pct(acc), tempo, paced)}</p>}
        {simple && sung && stepNow && <p className="mt-2 text-xs text-muted">{sungStepLine(stepNow)}</p>}
        {hint && showScore && <p className="mt-2 text-xs text-muted" data-testid="score-hint">{hint}</p>}
        {!blockOutcome.performance.reliable && (
          <p className="mt-3 text-xs text-amber-200">
            {simple ? 'This result may be off: ' : 'Low-confidence result: '}
            {(simple ? reasons.map(reasonText) : reasons).join(', ') || 'limited evidence'}.
          </p>
        )}
      </>
    )
    overlay = (
      <Overlay testId="block-result">
        <h2 className="text-lg font-semibold">{skill.name} done</h2>
        {simple ? (
          <>
            {sungCopy ? (
              <div className="mt-1 text-2xl font-bold" data-testid="sung-line">
                {sungCopy.line}
              </div>
            ) : (
              <div className="mt-1 text-3xl font-bold">You hit {notesHitText(res)}</div>
            )}
            {tip && (
              <p className="mt-3 text-sm text-slate-200" data-testid={sung ? 'sung-tip' : undefined}>
                Tip: {tip}
              </p>
            )}
            {feltQuestion}
            <details className="mt-4 text-left text-sm">
              <summary className="cursor-pointer text-center text-muted">Details</summary>
              {details}
            </details>
          </>
        ) : (
          <>
            <div className="mt-1 text-5xl font-bold tabular-nums">{pct(acc)}%</div>
            <div className="text-sm text-muted">{resultCaption({ paced, tempo, stepLabel: stepNow })}</div>
            {sung && tip && <p className="mt-3 text-sm text-slate-200">Tip: {tip}</p>}
            {feltQuestion}
            {details}
          </>
        )}
        <NavButtons session={blockOutcome.session} blockId={block.id} />
      </Overlay>
    )
  } else if (repOutcome && repResult && sungCopy) {
    // A sung round: how many notes, one tip, and what comes next. No line about timing: being a
    // little behind the click is not what a singer needs to hear about.
    const picked = repOutcome.nextParams?.step
    // After "Tight" on this card the next round is built in one note fewer, and a step that needed
    // that note is not the one that comes: the card names the step that does.
    const next = picked === undefined ? undefined : stepThatFits(skill, picked, felt?.round === rep ? felt.next : undefined)
    const lastStep = (skill.steps?.length ?? 0) - 1
    const nextText = nextSungRoundText({
      step: next !== undefined && lastStep >= 0 ? { now: stepWithin(exercise.params.step, lastStep, 0), next, nextLabel: stepLabel(skill, next) ?? '' } : undefined,
      tempo,
      nextTempo: repOutcome.nextTempo,
      accuracy: repOutcome.performance.acc,
    })
    overlay = (
      <Overlay testId="rep-card">
        <h2 className="text-lg font-semibold">
          Round {rep} of {block.reps}
        </h2>
        {simple ? (
          <div className="mt-1 text-2xl font-bold" data-testid="sung-line">
            {sungCopy.line}
          </div>
        ) : (
          <>
            <div className="mt-1 text-5xl font-bold tabular-nums">{pct(repOutcome.performance.acc)}%</div>
            <div className="mt-1 text-sm text-muted">{repSummaryText(repResult)}</div>
          </>
        )}
        {sungCopy.tip && (
          <p className="mt-2 text-sm text-muted" data-testid="sung-tip">
            {sungCopy.tip}
          </p>
        )}
        <p className="mt-3 text-sm text-slate-200" data-testid="next-round">
          {nextText}
        </p>
        {feltQuestion}
        {/* While an answer to "How did the slides feel?" is on its way to the store the card waits: the next round is built from what comes back. */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" disabled={feltBusy} onClick={nextRep} data-testid="next-rep">
            Next round
          </Button>
          <Button
            variant="secondary"
            disabled={feltBusy}
            onClick={() => {
              const rep = repOutcome
              setRepOutcome(null)
              if (!rep) return
              setError(null)
              setSavingFlag(true)
              finishExerciseBlock(sessionRef.current, { ...block, tempo }, rep)
                .then(setBlockOutcome)
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setSavingFlag(false))
            }}
          >
            Finish early
          </Button>
        </div>
      </Overlay>
    )
  } else if (repOutcome && repResult) {
    overlay = (
      <Overlay testId="rep-card">
        <h2 className="text-lg font-semibold">
          {simple ? 'Round' : 'Rep'} {rep} of {block.reps}
        </h2>
        {simple ? (
          <>
            <div className="mt-1 text-3xl font-bold">You hit {notesHitText(repResult)}</div>
            {paced && <div className="mt-1 text-sm text-muted">Timing: {timingWords(repResult.timingMedianMs)}</div>}
            {paced && <p className="mt-3 text-sm text-slate-200">{nextRoundText(tempo, repOutcome.nextTempo)}</p>}
            <details className="mt-2 text-sm text-muted">
              <summary className="cursor-pointer">Details</summary>
              <div className="mt-1">{pct(repOutcome.performance.acc)}% accuracy · {repSummaryText(repResult)}</div>
              {paced && <div>{timingText(repResult.timingMedianMs)}</div>}
              {paced && <div>Next rep at {Math.round(repOutcome.nextTempo)} bpm</div>}
            </details>
          </>
        ) : (
          <>
            <div className="mt-1 text-5xl font-bold tabular-nums">{pct(repOutcome.performance.acc)}%</div>
            <div className="mt-1 text-sm text-muted">{repSummaryText(repResult)}</div>
            {paced && <div className="text-sm text-muted">{timingText(repResult.timingMedianMs)}</div>}
            {paced && <p className="mt-3 text-sm text-slate-200">Next rep at {Math.round(repOutcome.nextTempo)} bpm</p>}
          </>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={nextRep} data-testid="next-rep">
            {simple ? 'Next round' : 'Next rep'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const rep = repOutcome
              setRepOutcome(null)
              if (!rep) return
              setError(null)
              setSavingFlag(true)
              finishExerciseBlock(sessionRef.current, { ...block, tempo }, rep)
                .then(setBlockOutcome)
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setSavingFlag(false))
            }}
          >
            Finish early
          </Button>
        </div>
      </Overlay>
    )
  } else {
    overlay = saving ? (
      <Overlay testId="saving">
        <p className="text-sm text-muted">Saving…</p>
      </Overlay>
    ) : null
  }

  if (exercise.interaction === 'ear') {
    return (
      <div data-testid="block-runner" className="relative h-full">
        <EarTrainer exercise={exercise} resetKey={rep * 1000 + (retryKey % 1000)} onExit={() => navigate('/')} onFinished={onFinished} />
        {overlay}
      </div>
    )
  }

  if (!audio) return null
  // Only before the very first round: later rounds wait behind the Player (see `shown`).
  if (!shown.ready || !shown.exercise || !shown.audio) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 text-muted" data-testid="block-runner">
        <p>Getting your exercise ready…</p>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    )
  }

  return (
    <div data-testid="block-runner">
      <Player
        ref={playerRef}
        mode="exercise"
        title={skill.name}
        subtitle={`${shown.exercise.title} · ${roundWord(simple, sung).toLowerCase()} ${shown.rep}/${block.reps}`}
        chart={shown.exercise.chart}
        notes={shown.exercise.chart.notes}
        audio={shown.audio}
        guideAudio={shown.guideAudio}
        backingIsClick
        playedTempo={shown.tempo}
        targetTempo={block.tempo}
        readyHint={shown.exercise.instructions}
        resetKey={`${shown.rep}-${shown.tempo}`}
        headerControls={
          <Badge tone="accent">{roundBadge({ simple, rep: shown.rep, reps: block.reps, tempo: shown.tempo, sung, stepLabel: stepLabel(skill, shown.exercise.params.step) })}</Badge>
        }
        onExit={() => navigate('/')}
        onFinished={onFinished}
        resultsOverlay={overlay}
      />
    </div>
  )
}

function SongRunner({ block, session }: { block: SongBlock; session: SessionRecord }) {
  const navigate = useNavigate()
  const song = useLiveQuery(async () => (await db.songs.get(block.songId)) ?? null, [block.songId], 'loading' as const)
  if (song === 'loading') return <div className="flex h-full items-center justify-center text-muted">Loading…</div>
  if (!song) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted">
        <p>{instrumentOfBlockId(block.id) === 'voice' ? SUNG_BLOCK.songGone : 'This song is no longer in your library.'}</p>
        <Link to="/" className="underline">
          Back to Today
        </Link>
        <Button variant="ghost" onClick={() => navigate('/')}>
          Close
        </Button>
      </div>
    )
  }
  // The row says whose song it is: a song to sing has no stored sound and no guitar levels, and is run by its own player.
  if (instrumentOf(song) === 'voice') return <SungSongPlayer block={block} session={session} record={song} />
  return <SongPlayer block={block} session={session} song={song} />
}

/** What is shown over a sung song once a pass has ended. */
type SungCard =
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'notCounted'; verdict: Exclude<RunVerdict, 'counted'> }
  | { kind: 'between'; pass: number; summary: ScoreSummary; keyLowered: boolean }
  | { kind: 'done'; outcome: BlockOutcome; summary: ScoreSummary }

/** A message in place of a sung song that cannot be put on the screen, with the way back. */
function SungSongNotice({ text, testId, waiting = false }: { text: string; testId: string; waiting?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-muted" data-testid="block-runner">
      <p data-testid={testId} role={waiting ? 'status' : undefined}>
        {text}
      </p>
      <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
        Back to Today
      </Button>
    </div>
  )
}

/**
 * A song block of a singing plan. The song is arranged for the singer's easy notes and key at the
 * level the plan asks for, and its two tracks are made after this screen is up: until both exist the
 * screen says so and no player is shown. Every pass is saved as a run of the song; the last one
 * finishes the block. There is no loop of single bars for a singer, and a sung song has one speed.
 *
 * The singing profile is read live, and the Coach may move the song to a lower key right after a pass
 * (its top notes were missed twice in a row). Neither may swap the chart under a run in progress or
 * under its result, so what is on screen is held until the singer moves on. The next pass is then sung
 * in the song as it is now: a pass sung in the old key after a move would count as a run in the new one.
 */
function SungSongPlayer({ block, session, record }: { block: SongBlock; session: SessionRecord; record: SongRecord }) {
  const navigate = useNavigate()
  const simple = useSettings().simpleFeedback
  const sessionRef = useRef(session)
  sessionRef.current = session
  const level = levelIndex(block.level)
  const latest = useVocalRunState(record, level)
  const [inRun, setInRun] = useState(false)
  const [card, setCard] = useState<SungCard | null>(null)
  const state = useHeld(latest, inRun || card !== null)
  // The arrangement that was on screen when the Coach moved the key: it is never offered again (see `sungSongView`).
  const [movedFrom, setMovedFrom] = useState<string | null>(null)
  // How many times the plan asks for the song, and which time this is.
  const passes = Math.max(1, Math.min(3, Math.round(block.passes ?? 1)))
  const [pass, setPass] = useState(1)
  const playerRef = useRef<PlayerHandle>(null)

  const view = sungSongView(state, movedFrom)
  if (view === 'getting-ready') return <SungSongNotice text={GETTING_READY} testId="song-getting-ready" waiting />
  // The easy notes changed since the day was planned and the song no longer fits them: it must not be sung.
  if (view === 'later') return <SungSongNotice text={SUNG_BLOCK.songLater} testId="song-later" />
  // 'none' cannot happen for a row that says it is a song to sing; it is shown like a song that could not be made.
  if (view === 'not-ready' || state.status !== 'ready') return <SungSongNotice text={SUNG_BLOCK.songNotReady} testId="song-not-ready" />
  const run = state.run

  const failed = (err: unknown) => setCard({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  // The Player always calls the handler of the latest render, so this one sees the run that is on screen.
  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    // Not heard at all, or the app heard its own guide: nothing is recorded and the pass is sung again.
    const verdict = runVerdict(summary, result)
    if (verdict !== 'counted') {
      setCard({ kind: 'notCounted', verdict })
      return
    }
    setCard({ kind: 'saving' })
    // Kept by the song's row exactly as the song page keeps a run, so "your best run on this level"
    // is one list wherever the song was sung.
    const keep = () => void recordResult(record.id, resultRecord(level, summary, Date.now())).catch(() => {})
    if (pass < passes) {
      recordSongPlay(record, block.level, result, getSettings(), Date.now(), sessionRef.current.id)
        .then((played) => {
          if (played.counted === false) return setCard({ kind: 'notCounted', verdict: 'bleed' })
          keep()
          setCard({ kind: 'between', pass, summary, keyLowered: played.keyLowered === true })
        })
        .catch(failed)
      return
    }
    completeSongBlock(sessionRef.current, block, record, result, getSettings())
      .then((done) => {
        if (done.counted === false) return setCard({ kind: 'notCounted', verdict: 'bleed' })
        keep()
        setCard({ kind: 'done', outcome: done, summary })
      })
      .catch(failed)
  }
  /**
   * Lets go of the card and sings again. At once only when the song on screen is still the song as it
   * is now: after a key move the player is made afresh in the new key, with its start button, and the
   * arrangement that was just sung is taken off the screen until the new one is there.
   */
  const again = (keyLowered: boolean) => {
    const atOnce = singsAgainAtOnce({ sameRun: latest.status === 'ready' && latest.run === run, saving: false, keyLowered })
    if (keyLowered) setMovedFrom(run.key)
    setCard(null)
    playerRef.current?.restart()
    if (atOnce) playerRef.current?.start()
  }

  const levelName = VOICE_LEVELS[level].name
  let overlay: ReactNode = null
  if (card?.kind === 'error') {
    overlay = <ErrorCard message={card.message} />
  } else if (card?.kind === 'notCounted') {
    overlay = <NotCountedCard verdict={card.verdict} onRetry={() => again(false)} instrument="voice" />
  } else if (card?.kind === 'between') {
    const said = sungCardCopy(card.summary, run.chart.voice, false)
    overlay = (
      <Overlay testId="song-pass">
        <h2 className="text-lg font-semibold">
          Time {card.pass} of {passes}
        </h2>
        <div className="mt-1 text-2xl font-bold" data-testid="sung-line">
          {said.line}
        </div>
        {said.tip && (
          <p className="mt-2 text-sm text-muted" data-testid="sung-tip">
            {said.tip}
          </p>
        )}
        {card.keyLowered && (
          <p className="mt-3 text-sm text-amber-200" data-testid="song-key-lowered">
            {MOVED_DOWN}
          </p>
        )}
        <p className="mt-2 text-sm text-muted">{SUNG_BLOCK.between.body}</p>
        <div className="mt-4 flex justify-center">
          <Button
            variant="primary"
            onClick={() => {
              setPass((p) => p + 1)
              again(card.keyLowered)
            }}
            data-testid="song-pass-next"
          >
            {SUNG_BLOCK.between.action}
          </Button>
        </div>
      </Overlay>
    )
  } else if (card?.kind === 'done') {
    // The last time through: the tip does not ask for another go.
    const said = sungCardCopy(card.summary, run.chart.voice, true)
    // One piece of advice at most: the tip for the notes that did not count, or what is left to do when all of them did.
    const tip = said.tip ?? closerLine(card.summary)
    overlay = (
      <Overlay testId="block-result">
        <h2 className="text-lg font-semibold">
          {record.title} · {levelName}
        </h2>
        <div className="mt-1 text-2xl font-bold" data-testid="sung-line">
          {said.line}
        </div>
        {!simple && <div className="text-sm text-muted">{pct(card.outcome.performance.acc)}% accuracy</div>}
        {tip && (
          <p className="mt-3 text-sm text-slate-200" data-testid="sung-tip">
            {tip}
          </p>
        )}
        {card.outcome.keyLowered && (
          <p className="mt-3 text-sm text-amber-200" data-testid="song-key-lowered">
            {MOVED_DOWN}
          </p>
        )}
        <NavButtons session={card.outcome.session} blockId={block.id} />
      </Overlay>
    )
  } else if (card?.kind === 'saving') {
    overlay = (
      <Overlay testId="saving">
        <p className="text-sm text-muted">Saving…</p>
      </Overlay>
    )
  }

  const bpm = chartBpm(run.chart)
  return (
    <div data-testid="block-runner">
      <Player
        // A new arrangement (another key) is a new chart with new sound: the player starts afresh.
        key={run.key}
        ref={playerRef}
        mode="song"
        title={record.title}
        subtitle={`${levelName}${passes > 1 ? ` · time ${pass} of ${passes}` : ''}`}
        chart={run.chart}
        notes={run.notes}
        audio={run.audio}
        guideAudio={run.guide}
        backingIsClick
        playedTempo={bpm}
        targetTempo={bpm}
        readyHint={VOICE_LEVELS[level].about}
        headerControls={<Badge tone="accent">Song</Badge>}
        onExit={() => navigate('/')}
        onFinished={onFinished}
        onPhaseChange={(p) => setInRun(p === 'playing' || p === 'countin' || p === 'paused')}
        resultsOverlay={overlay}
      />
    </div>
  )
}

/**
 * Song blocks use Player mode="song" so the latency field stays available while practising a real song.
 * With loopBars: phase 'loop' (2 passes, not recorded) then phase 'full' (recorded via completeSongBlock).
 */
function SongPlayer({ block, session, song: liveSong }: { block: SongBlock; session: SessionRecord; song: SongRecord }) {
  const navigate = useNavigate()
  const [inRun, setInRun] = useState(false)
  // The record comes from a live query: a background update must not swap chart and audio under a run in progress.
  const song = useHeld(liveSong, inRun)
  const simple = useSettings().simpleFeedback
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [phase, setPhase] = useState<'loop' | 'full'>(block.loopBars ? 'loop' : 'full')
  const [outcome, setOutcome] = useState<BlockOutcome | null>(null)
  const [notCounted, setNotCounted] = useState<Exclude<RunVerdict, 'counted'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingFlag, setSavingFlag] = useState(false)
  // How many times the plan asks for the song, and which time this is.
  const passes = Math.max(1, Math.min(3, Math.round(block.passes ?? 1)))
  const [pass, setPass] = useState(1)
  const [between, setBetween] = useState<{ pass: number; attempt: AttemptResult } | null>(null)
  const playerRef = useRef<PlayerHandle>(null)
  const levels = useMemo(() => generateLevels(song.chart), [song])
  const level = Math.max(0, Math.min(levels.length - 1, block.level))
  const playback = useMemo(() => songPlayback(song), [song])
  const audio = playback.audio
  const chart = useMemo(() => ({ ...song.chart, duration: Math.max(song.chart.duration, song.duration) }), [song])

  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    setError(null)
    if (phase === 'loop') {
      setPhase('full')
      return
    }
    // Not heard at all, or the app heard its own guitar part: nothing is recorded and the rep is played again.
    const verdict = runVerdict(summary, result)
    if (verdict !== 'counted') {
      setNotCounted(verdict)
      return
    }
    setNotCounted(null)
    setSavingFlag(true)
    // The plan may ask for the song more than once (it fills the block's minutes): every pass before
    // the last is saved as a play of the song, the last one finishes the block.
    if (pass < passes) {
      recordSongPlay(song, block.level, result, getSettings(), Date.now(), sessionRef.current.id)
        .then((played) => (played.counted === false ? setNotCounted('bleed') : setBetween({ pass, attempt: played.attempt })))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSavingFlag(false))
      return
    }
    completeSongBlock(sessionRef.current, block, song, result, getSettings())
      .then((done) => (done.counted === false ? setNotCounted('bleed') : setOutcome(done)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingFlag(false))
  }
  const nextPass = () => {
    setBetween(null)
    setPass((p) => p + 1)
    playerRef.current?.restart()
    playerRef.current?.start()
  }

  if (!audio) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="block-runner">
        <p>This song has no audio.</p>
        <Link to="/" className="underline">
          Back to Today
        </Link>
      </div>
    )
  }

  const loop = phase === 'loop' ? block.loopBars : undefined
  const saving = savingFlag
  let overlay: ReactNode
  if (error) {
    overlay = <ErrorCard message={error} />
  } else if (notCounted) {
    overlay = (
      <NotCountedCard
        verdict={notCounted}
        onRetry={() => {
          setNotCounted(null)
          playerRef.current?.restart()
          playerRef.current?.start()
        }}
      />
    )
  } else if (between) {
    overlay = (
      <Overlay testId="song-pass">
        <h2 className="text-lg font-semibold">
          Time {between.pass} of {passes}
        </h2>
        <div className="mt-1 text-3xl font-bold">You hit {notesHitText(between.attempt)}</div>
        <p className="mt-2 text-sm text-muted">Take a breath, then play it once more.</p>
        <div className="mt-4 flex justify-center">
          <Button variant="primary" onClick={nextPass} data-testid="song-pass-next">
            Play it again
          </Button>
        </div>
      </Overlay>
    )
  } else if (outcome) {
    const best = outcome.songItem?.bestAccuracy ?? null
    const weak = outcome.songItem?.weakBars ?? []
    overlay = (
      <Overlay testId="block-result">
        <h2 className="text-lg font-semibold">
          {song.title} · Level {level + 1}
        </h2>
        {simple ? (
          <>
            <div className="mt-1 text-3xl font-bold">You hit {notesHitText(outcome.attempt)}</div>
            <div className="text-sm text-muted">{pct(outcome.performance.acc)}% accuracy</div>
          </>
        ) : (
          <>
            <div className="mt-1 text-5xl font-bold tabular-nums">{pct(outcome.performance.acc)}%</div>
            <div className="text-sm text-muted">accuracy</div>
          </>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Best" value={best === null ? '—' : `${pct(best)}%`} />
          <Stat label={simple ? "Bars to practise" : "Weak bars"} value={weak.length ? weak.map((b) => b + 1).join(', ') : 'none'} />
        </dl>
        <NavButtons session={outcome.session} blockId={block.id} />
      </Overlay>
    )
  } else {
    overlay = saving ? (
      <Overlay testId="saving">
        <p className="text-sm text-muted">Saving…</p>
      </Overlay>
    ) : null
  }

  const loopLabel = block.loopBars ? `Loop bars ${block.loopBars[0] + 1}–${block.loopBars[1] + 1}` : ''
  return (
    <div data-testid="block-runner">
      <Player
        ref={playerRef}
        mode="song"
        title={song.title}
        subtitle={phase === 'loop' ? loopLabel : `Level ${level + 1}${block.speed < 1 ? ` · ${Math.round(block.speed * 100)}% speed` : ''}${passes > 1 ? ` · time ${pass} of ${passes}` : ''}`}
        chart={chart}
        notes={levels[level].notes}
        audio={audio}
        guideAudio={playback.guide}
        backingIsClick={playback.clickOnly}
        speed={block.speed}
        playedTempo={song.bpm * block.speed}
        targetTempo={song.bpm}
        loopBars={loop}
        loopCount={2}
        resetKey={phase}
        readyHint={
          phase === 'loop'
            ? `${loopLabel} · played twice. Then the whole song.`
            : block.loopBars
              ? 'Loop done. Now play the whole song through.'
              : undefined
        }
        headerControls={<Badge tone="accent">{phase === 'loop' ? 'Loop' : block.loopBars ? 'Full pass' : 'Song'}</Badge>}
        onExit={() => navigate('/')}
        onFinished={onFinished}
        onPhaseChange={(p) => setInRun(p === 'playing' || p === 'countin' || p === 'paused')}
        resultsOverlay={phase === 'full' ? overlay : null}
      />
    </div>
  )
}

function TestRedirect({ to }: { to: string }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(to, { replace: true })
  }, [navigate, to])
  return <div className="flex h-full items-center justify-center text-muted">Opening skill check…</div>
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted" data-testid="block-runner">
      <p>{message}</p>
      <Link to="/" className="underline">
        Back to Today
      </Link>
    </div>
  )
}

/**
 * Route component for /today/block/:blockId. Whose block it is is in its id (`voice-…` is a block of a
 * singing plan), so the session it is looked up in is that instrument's, whatever the switch shows.
 */
export function BlockRunner() {
  const { blockId } = useParams()
  const instrument = instrumentOfBlockId(blockId ?? '')
  const session = useTodaySession(useMemo(() => localDateString(new Date()), []), instrument)
  // The block is frozen at first sight so live session updates (adapted plans) never regenerate the exercise mid-run.
  const frozen = useRef<{ id: string; block: Block } | null>(null)
  if (session !== 'loading' && session !== null) {
    const found = session.plan.blocks.find((b) => b.id === blockId)
    if (found && frozen.current?.id !== blockId) frozen.current = { id: found.id, block: found }
  }
  // The singing side stays out of sight until it is switched on: a typed address of a singing block finds nothing.
  if (instrument === 'voice' && !voiceEnabled()) return <NotFound message="This block is not in today's plan" />
  if (session === 'loading') return <div className="flex h-full items-center justify-center text-muted">Loading…</div>
  const hold = frozen.current
  const block = hold && hold.id === blockId ? hold.block : undefined
  if (!session || !block) return <NotFound message="This block is not in today's plan" />
  if (block.status === 'done' || block.status === 'skipped') {
    return <NotFound message={`This block is already ${block.status}.`} />
  }
  if (block.kind === 'test') return <TestRedirect to={blockPath(block)} />
  if (block.kind === 'song') return <SongRunner key={block.id} block={block} session={session} />
  if (instrumentOfSkillId(block.skillId) === 'voice') return <SungExerciseRunner key={block.id} block={block} session={session} />
  return <ExerciseRunner key={block.id} block={block} session={session} />
}
