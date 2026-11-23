import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { encodeWav } from '../../audio/synth'
import type { Chart } from '../../chart/types'
import { Button } from '../../components/ui'
import { DEFAULT_RANGES } from '../../music/keys'
import { renderExerciseBacking } from '../../training/exercises/backing'
import { DEFAULT_TUNING } from '../../training/exercises/builder'
import { exerciseParams, generateExercise } from '../../training/exercises/index'
import { skillById } from '../../training/instruments'
import { attemptPerformance } from '../../training/performance'
import type { AttemptResult, GeneratedExercise } from '../../training/types'
import { NotCountedCard } from '../play/NotCountedCard'
import { Player } from '../play/Player'
import { runVerdict, type RunVerdict } from '../play/runVerdict'
import type { ScoreSummary } from '../play/scoring'
import { useExerciseGuide } from '../play/useExerciseGuide'
import { voiceResultCopy } from '../play/voice/voiceCopy'

/** The skill whose first step is sung here: one note at a time, listened to and sung back. */
const CHECK_SKILL = 'voice.pitch.match'

/**
 * One round of the skill's first step in the "Lower voice" starting range, with its scored track
 * (click and starting notes). Built by the same calls as a block of the daily plan, with nothing
 * that changes from day to day, so that the takes of the browser check
 * (src/features/play/voice/e2eVoiceFixtures.test.ts, which builds it by these calls too) fit it.
 */
function buildCheck(): { exercise: GeneratedExercise; audio: Blob } {
  const skill = skillById(CHECK_SKILL)
  if (!skill) throw new Error(`No skill ${CHECK_SKILL}`)
  const generatorId = skill.generators[0]
  const params = exerciseParams(skill, generatorId, skill.startTempo, { step: 0, bars: 8, ...DEFAULT_RANGES.lower })
  const exercise = renderExerciseBacking(generateExercise(skill, generatorId, params, DEFAULT_TUNING), { guide: true })
  if (!exercise.backing) throw new Error('The check exercise has no sound')
  return { exercise, audio: encodeWav(exercise.backing, exercise.backingSampleRate) }
}

/**
 * What a take of the browser check has to fit: every note to sing, then every note the app sings
 * first, each as pitch (MIDI number), start and length in seconds. The fixture writer puts the same
 * line in its index (`chartOf` there, to the letter) and the check compares the two: the exercise's id
 * names how it was asked for, not which notes came out, so a build with other notes than the takes
 * would pass for the same exercise by its id.
 */
function chartOf(chart: Chart): string {
  const mark = (n: { midi: number; time: number; duration: number }) => `${n.midi}@${n.time.toFixed(2)}+${n.duration.toFixed(2)}`
  return [...chart.notes.map(mark), 'after', ...(chart.voice?.cues ?? []).map(mark)].join(' ')
}

interface Finished {
  summary: ScoreSummary
  result: AttemptResult
  verdict: RunVerdict
}

/** The verdict in a checker's words; the test id beside it carries the verdict itself. */
const VERDICT_WORDS: Record<RunVerdict, string> = {
  counted: 'this run counts',
  unscored: 'nothing was scored',
  bleed: 'the app heard its own sound',
  partial: 'practice only',
}

/**
 * What the run came to, in one line that is there for every run, counted or not. `data-accuracy` is
 * what the Coach would make of the round (a note that is on the note but not spot on counts for less
 * than one): a number for whoever checks, which is why it is not among the words.
 */
function Readout({ run }: { run: Finished }) {
  return (
    <p className="w-full text-xs text-muted" data-testid="voice-check-result" data-verdict={run.verdict} data-accuracy={attemptPerformance(run.result).acc.toFixed(3)}>
      <span data-testid="voice-check-hits">{run.summary.perfects + run.summary.goods}</span> of <span data-testid="voice-check-total">{run.summary.total}</span> notes on pitch ·{' '}
      <span data-testid="voice-check-verdict">{VERDICT_WORDS[run.verdict]}</span>
    </p>
  )
}

/**
 * A hidden page for checking the singing side before its screens exist: one sung exercise in the real
 * player, with the real tracker, lanes, guide switch and "not counted" cards, and the result on the
 * page. The route is only there while the voice side is switched on (see main.tsx).
 *
 * It is what the browser check sings into (e2e/singer.mjs), and it serves for the first checks on a
 * real phone (docs/SINGING.md §11: staying silent on a bare speaker, the guide without headphones).
 * No attempt, session or profile is read or written. Only the player's own setting can change, as on
 * every screen: it turns "I use headphones" off when it hears the guide through the microphone.
 */
export function VoiceCheckPage() {
  const navigate = useNavigate()
  const { exercise, audio } = useMemo(() => buildCheck(), [])
  // Rendered after the page has opened, as on every screen that plays an exercise: the player gets
  // the guide track a moment late and has to put its switch where it starts.
  const { guide } = useExerciseGuide(exercise)
  const [round, setRound] = useState(0)
  const [done, setDone] = useState<Finished | null>(null)
  const again = () => {
    setDone(null)
    setRound((r) => r + 1)
  }

  let overlay = null
  if (done && done.verdict !== 'counted') {
    overlay = (
      <NotCountedCard verdict={done.verdict} instrument="voice" onRetry={again}>
        <Readout run={done} />
      </NotCountedCard>
    )
  } else if (done) {
    const copy = voiceResultCopy(done.summary, exercise.chart.voice)
    overlay = (
      <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">
          <h2 className="text-lg font-semibold" data-testid="voice-check-line">
            {copy.line}
          </h2>
          {copy.tip && (
            <p className="mt-2 text-sm text-muted" data-testid="voice-check-tip">
              {copy.tip}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={again} data-testid="voice-check-again">
              Sing it again
            </Button>
            <Readout run={done} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="voice-check" data-exercise={exercise.id} data-chart={chartOf(exercise.chart)}>
      <Player
        mode="exercise"
        title="Voice check"
        subtitle={exercise.title}
        chart={exercise.chart}
        notes={exercise.chart.notes}
        audio={audio}
        guideAudio={guide}
        backingIsClick
        playedTempo={exercise.params.tempo}
        targetTempo={exercise.params.tempo}
        readyHint={exercise.instructions}
        resetKey={round}
        resultsOverlay={overlay}
        onExit={() => navigate('/')}
        onFinished={(summary: ScoreSummary, result: AttemptResult) => setDone({ summary, result, verdict: runVerdict(summary, result) })}
      />
    </div>
  )
}
