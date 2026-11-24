import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { voiceEnabled } from '../../app/features'
import { getSettings } from '../../app/settings'
import { chartBpm } from '../../chart/types'
import { Button, Card, Select, cx } from '../../components/ui'
import { recordResult, type SongRecord } from '../../db/db'
import { useSong } from '../../db/useSongs'
import { VOICE_LEVELS, vocalSong, type VocalSong } from '../../songs/vocal'
import { GETTING_READY, useVocalRunState } from '../../songs/vocal/useVocalRun'
import { recordSongPlay } from '../../training/coach'
import { instrumentOf } from '../../training/instruments'
import type { AttemptResult } from '../../training/types'
import { useProfile } from '../../training/useTraining'
import { MOVED_DOWN, voiceIsSetUp } from '../../training/voicePlan'
import { loadVoiceProfile, setKeyNudge } from '../../training/voiceProfile'
import { NotCountedCard } from '../play/NotCountedCard'
import { Player, type PlayerHandle } from '../play/Player'
import { runVerdict, type RunVerdict } from '../play/runVerdict'
import type { ScoreSummary } from '../play/scoring'
import { useHeld } from '../play/useHeld'
import { voiceResultCopy } from '../play/voice/voiceCopy'
import {
  SING_COPY,
  askedLevel,
  closerLine,
  isNewBest,
  keyCard,
  levelRows,
  lineChoices,
  nextLevelAfter,
  resultRecord,
  runWords,
  savesAsResult,
  singsAgainAtOnce,
  startLevel,
  type LevelRow,
  type SingerSoFar,
} from './singPage'

const TONE_CLASS: Record<LevelRow['tone'], string> = {
  default: 'bg-panel text-slate-300',
  accent: 'bg-accent/25 text-amber-200',
  ok: 'bg-ok/25 text-green-200',
}

/** A message in the middle of an otherwise empty screen. */
function Centered({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center" data-testid={testId}>
      {children}
    </div>
  )
}

interface RunResults {
  /** Which run these belong to: what the Coach reports a moment later must not land on the next run's card. */
  run: number
  summary: ScoreSummary
  verdict: RunVerdict
  /** One line on its own: nothing was saved. */
  practice: boolean
  newBest: boolean
  /** The run is on its way to the Coach, who may answer by moving the key: until then "Sing again" waits. */
  saving: boolean
  /** The Coach moved the song down after this run. */
  keyLowered: boolean
}

function SingResults({
  heading,
  line,
  tip,
  results,
  next,
  onAgain,
  onNext,
  onBack,
}: {
  heading: string
  line: string
  tip: string | null
  results: RunResults
  /** The level to offer next, or null. */
  next: number | null
  onAgain: () => void
  onNext: (level: number) => void
  onBack: () => void
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4" data-testid="results">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">
        <div className="text-xs uppercase tracking-wide text-muted">{heading}</div>
        <p className="mt-2 text-xl font-semibold" data-testid="sing-result-line">
          {line}
        </p>
        {tip && (
          <p className="mt-3 text-sm text-slate-200" data-testid="sing-result-tip">
            {tip}
          </p>
        )}
        {results.practice && <p className="mt-3 text-sm text-muted">{SING_COPY.practiceRun}</p>}
        {results.newBest && <p className="mt-3 text-sm text-green-200">{SING_COPY.newBest}</p>}
        {results.keyLowered && (
          <p className="mt-3 text-sm text-amber-200" data-testid="sing-key-lowered">
            {MOVED_DOWN}
          </p>
        )}
        {next !== null && <p className="mt-3 text-sm text-green-200">{SING_COPY.readyForNext(VOICE_LEVELS[next].name)}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {/* Off for the moment the run takes to be saved (see `singsAgainAtOnce`); a script that taps at once waits for it. */}
          <Button variant={next === null ? 'primary' : 'secondary'} onClick={onAgain} disabled={results.saving} data-testid="sing-again">
            <RotateCcw className="h-4 w-4" /> {SING_COPY.again}
          </Button>
          {next !== null && (
            <Button variant="primary" onClick={() => onNext(next)} data-testid="sing-next-level">
              {SING_COPY.nextLevel(VOICE_LEVELS[next].name)}
            </Button>
          )}
          <Button variant="ghost" onClick={onBack} data-testid="sing-back">
            {SING_COPY.backToSong}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * One level of the song (or one line of it) in the shared Player. The tracks are made after this
 * screen has painted, so it says "Getting your song ready" first and the Player only mounts when both
 * tracks exist.
 */
function SingRun({
  record,
  song,
  level,
  line,
  onClose,
  onLevel,
}: {
  record: SongRecord
  song: VocalSong
  level: number
  /** Line index for "Practise one line"; null = the whole song. */
  line: number | null
  onClose: () => void
  onLevel: (level: number) => void
}) {
  const latest = useVocalRunState(record, level, { onlyLine: line ?? undefined })
  const [inRun, setInRun] = useState(false)
  const [results, setResults] = useState<RunResults | null>(null)
  // The singing profile is read live, and the Coach may move the key right after a run. Neither may
  // swap the chart under a run in progress, nor take the Player (and the result on it) off the screen:
  // what is sung and shown stays until the singer moves on.
  const state = useHeld(latest, inRun || results !== null)
  const playerRef = useRef<PlayerHandle>(null)
  const runCount = useRef(0)
  const run = state.status === 'ready' ? state.run : null

  if (!run) {
    // 'none' cannot happen here (the page has checked the record), and is shown like a song that could not be made.
    const waiting = state.status === 'preparing'
    return (
      <Centered testId={waiting ? 'sing-getting-ready' : 'sing-not-ready'}>
        {waiting ? (
          <>
            {/* A fade is drawn by the browser's compositor, so the dot keeps moving while this thread is busy making the tracks. */}
            <span className="h-3 w-3 animate-pulse rounded-full bg-accent" aria-hidden="true" />
            <p className="text-lg font-semibold" role="status">
              {GETTING_READY}
            </p>
          </>
        ) : (
          <p className="max-w-sm text-slate-200" role="alert">
            {SING_COPY.notReady}
          </p>
        )}
        <Button variant="ghost" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" /> {SING_COPY.back}
        </Button>
      </Centered>
    )
  }
  if (!run.fits) {
    // The easy notes changed while this screen was open and the song no longer fits them. The song page says why.
    return (
      <Centered testId="sing-later">
        <p className="text-lg font-semibold">{SING_COPY.comesLater}</p>
        <Button variant="primary" onClick={onClose}>
          {SING_COPY.backToSong}
        </Button>
      </Centered>
    )
  }

  // The Player always calls the handler of the latest render, so this one sees the run that is on screen.
  const onFinished = (summary: ScoreSummary, result: AttemptResult) => {
    const verdict = runVerdict(summary, result)
    // One line on its own is practice. Handed to the Coach it would count as a run of the whole song.
    const practice = !savesAsResult(run.chart)
    const saved = verdict === 'counted' && !practice
    const stored = resultRecord(level, summary, Date.now())
    const id = ++runCount.current
    setResults({ run: id, summary, verdict, practice, newBest: saved && isNewBest(record.bestScores[String(stored.level)], summary), saving: saved, keyLowered: false })
    // A run the app could not hear, or one where it heard its own guide, is neither shown as a result nor saved.
    if (!saved) return
    // What the Coach answers belongs to the card of this run and to no later one.
    const answered = (keyLowered: boolean) => setResults((shown) => (shown?.run === id ? { ...shown, saving: false, keyLowered } : shown))
    void recordSongPlay(record, level, result, getSettings()).then(
      (outcome) => answered(outcome.keyLowered === true),
      () => answered(false),
    )
    void recordResult(record.id, stored).catch(() => {})
  }
  const again = () => {
    const atOnce = singsAgainAtOnce({ sameRun: latest.status === 'ready' && latest.run === run, saving: results?.saving ?? false, keyLowered: results?.keyLowered ?? false })
    // Letting go of the result lets the song be made ready as it is now. After a key move that is
    // the new key: a pass sung in the old one would count for the new one.
    setResults(null)
    // Back to the start in every case, so a Player that stays on screen has its start button again.
    playerRef.current?.restart()
    if (atOnce) playerRef.current?.start()
  }
  const words = runWords(level, run.notes.length, line === null ? null : (lineChoices(song)[line]?.label ?? null))
  const copy = results ? voiceResultCopy(results.summary, run.chart.voice) : null

  return (
    <Player
      // A new arrangement (key, level or line) is a new chart with new sound: the Player starts afresh.
      key={run.key}
      ref={playerRef}
      title={song.title}
      subtitle={words.heading}
      chart={run.chart}
      notes={run.notes}
      audio={run.audio}
      guideAudio={run.guide}
      backingIsClick
      mode="song"
      playedTempo={chartBpm(run.chart)}
      targetTempo={chartBpm(run.chart)}
      readyHint={words.ready}
      resultsOverlay={
        results && copy ? (
          results.verdict !== 'counted' ? (
            <NotCountedCard verdict={results.verdict} onRetry={again} instrument="voice">
              <Button variant="ghost" onClick={onClose}>
                {SING_COPY.backToSong}
              </Button>
            </NotCountedCard>
          ) : (
            <SingResults
              heading={words.heading}
              line={copy.line}
              // One piece of advice at most: the tip for the notes that did not count, or what is left to do when all of them did.
              tip={copy.tip ?? closerLine(results.summary)}
              results={results}
              next={results.practice ? null : nextLevelAfter(level, results.summary)}
              onAgain={again}
              onNext={(up) => {
                setResults(null)
                onLevel(up)
              }}
              onBack={onClose}
            />
          )
        ) : null
      }
      onExit={onClose}
      onFinished={onFinished}
      onPhaseChange={(p) => {
        setInRun(p === 'playing' || p === 'countin' || p === 'paused')
        if (p !== 'finished') setResults(null)
      }}
    />
  )
}

/** The song page itself: the key, the six levels with the best run on each, one line for practice, and the way in. */
function SingSong({ record, song, asked, singer }: { record: SongRecord; song: VocalSong; asked: number | undefined; singer: SingerSoFar }) {
  const voice = useLiveQuery(loadVoiceProfile)
  // Read once, when the page opens: a song never sung starts on "Whole tune" for a singer who is past the echo levels.
  const [level, setLevel] = useState(() => startLevel(record.lastLevel, asked, singer))
  const [line, setLine] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [trouble, setTrouble] = useState(false)

  if (open) return <SingRun record={record} song={song} level={level} line={line} onClose={() => setOpen(false)} onLevel={setLevel} />
  if (voice === undefined) return <Centered>Loading…</Centered>

  const key = keyCard(song, voice)
  const rows = levelRows(record.bestScores)
  const move = async (by: 1 | -1) => {
    if (moving) return
    setMoving(true)
    setTrouble(false)
    try {
      // Worked out from the profile as it is stored now, not as it was last drawn: a second tap that
      // comes before the card has caught up is then a second step, never the first one stored twice.
      const now = keyCard(song, await loadVoiceProfile())
      const to = by < 0 ? now.lower : now.higher
      // The card reads the profile live, so it shows the new key as soon as this is stored.
      if (to !== null) await setKeyNudge(song.id, to)
    } catch {
      setTrouble(true)
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-bg" data-testid="sing-page">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-3 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
        <Link to="/songs" aria-label={SING_COPY.backToSongs} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-slate-200 hover:bg-panel-2">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{SING_COPY.songs}</span>
        </Link>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{song.title}</div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{song.title}</h1>
            <p className="mt-1 text-sm text-muted">{song.credit}</p>
            <p className="mt-2 text-sm text-slate-200">{song.description}</p>
          </div>

          <Card>
            <h2 className="text-base font-semibold" data-testid="sing-key-title">
              {key.title}
            </h2>
            <p className="mt-1 text-sm text-slate-200" data-testid="sing-key-notes">
              {key.notes}
            </p>
            <p className="text-sm text-muted">{key.yours}</p>
            {key.moved && <p className="mt-1 text-sm text-muted">{key.moved}</p>}
            {key.reason && <p className="mt-2 text-sm text-slate-200">{key.reason}</p>}
            {key.hint && <p className="mt-2 text-sm text-slate-200">{key.hint}</p>}
            {key.fits && (
              <>
                <p className="mt-3 text-xs text-muted">{SING_COPY.keyHelp}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={key.lower === null || moving} onClick={() => void move(-1)} data-testid="sing-lower">
                    {SING_COPY.lower}
                  </Button>
                  <Button size="sm" disabled={key.higher === null || moving} onClick={() => void move(1)} data-testid="sing-higher">
                    {SING_COPY.higher}
                  </Button>
                </div>
                {key.end && <p className="mt-2 text-xs text-muted">{key.end}</p>}
                {trouble && (
                  <p className="mt-2 text-xs text-amber-200" role="alert">
                    {SING_COPY.keyTrouble}
                  </p>
                )}
              </>
            )}
            {(key.hint || !key.fits) && (
              <Link to="/range" className="mt-3 inline-block text-sm text-accent underline" data-testid="sing-my-voice">
                {SING_COPY.myVoice}
              </Link>
            )}
          </Card>

          {key.fits && (
            <>
              <Card>
                <h2 className="text-base font-semibold">{SING_COPY.levels}</h2>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={SING_COPY.levels}>
                  {rows.map((row) => (
                    <button
                      key={row.index}
                      type="button"
                      aria-pressed={row.index === level}
                      onClick={() => setLevel(row.index)}
                      className={cx(
                        'flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        row.index === level ? 'border-accent bg-accent/15' : 'border-line bg-panel-2 hover:bg-line',
                      )}
                      data-testid={`sing-level-${row.number}`}
                    >
                      <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold', TONE_CLASS[row.tone])}>{row.number}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{row.name}</span>
                        <span className="block text-xs text-muted">{row.best}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-sm text-slate-200" data-testid="sing-level-about">
                  {rows[level].about}
                </p>
              </Card>

              <Card>
                <h2 className="text-base font-semibold">{SING_COPY.oneLine}</h2>
                <Select
                  value={line === null ? '' : String(line)}
                  onChange={(e) => setLine(e.target.value === '' ? null : Number(e.target.value))}
                  aria-label={SING_COPY.oneLine}
                  className="mt-3 w-full"
                  data-testid="sing-line"
                >
                  <option value="">{SING_COPY.wholeSong}</option>
                  {lineChoices(song).map((choice) => (
                    <option key={choice.index} value={choice.index}>
                      {choice.label}
                    </option>
                  ))}
                </Select>
                {line !== null && <p className="mt-2 text-xs text-muted">{SING_COPY.oneLineNote}</p>}
              </Card>

              <Button variant="primary" size="lg" onClick={() => setOpen(true)} data-testid="sing-open">
                {line === null ? SING_COPY.sing : SING_COPY.practise}
              </Button>
              <p className="text-center text-xs text-muted">{SING_COPY.listenHint}</p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

/**
 * The page of a song to sing (`/sing/:songId`, by the id of its stored row; `?level=` opens it on a
 * level). A guitar song opened here goes to its own page, as a song to sing opened there comes here.
 */
export function SingPage() {
  const { songId } = useParams()
  const [params] = useSearchParams()
  const id = Number(songId)
  const songQuery = useSong(Number.isFinite(id) ? id : null)
  const profile = useProfile('voice')
  // The singing side stays out of sight until it is switched on.
  if (!voiceEnabled()) return <Navigate to="/" replace />
  // Nothing of the song is shown before it is known who is asking: the row can be read before the profile is.
  if (songQuery === 'loading' || profile === undefined) return <Centered>Loading…</Centered>
  // The row says whose song it is: a guitar song goes to its own page, whoever asks.
  if (songQuery && instrumentOf(songQuery) === 'guitar') return <Navigate to={`/play/${songQuery.id}`} replace />
  // A singer who has not been through the set-up is sent there, as on every page of the singing side.
  if (!voiceIsSetUp(profile)) return <Navigate to="/start?instrument=voice" replace />
  const song = songQuery?.builtinId ? vocalSong(songQuery.builtinId) : undefined
  if (!songQuery || !song) {
    return (
      <Centered testId="sing-not-here">
        <p className="text-muted">{SING_COPY.notHere}</p>
        <Link to="/songs" className="underline">
          {SING_COPY.backToSongs}
        </Link>
      </Centered>
    )
  }
  const asked = askedLevel(params.get('level'))
  // Keyed by the row and the level asked for: another song, or an address that names another level, is the page opened afresh.
  return <SingSong key={`${songQuery.id}:${asked ?? ''}`} record={songQuery} song={song} asked={asked} singer={profile} />
}
