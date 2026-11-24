import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Ear,
  Flame,
  Music,
  RotateCcw,
  Repeat,
  Settings2,
  Target,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { getSettings, useSettings } from '../../app/settings'
import { useAppBadge } from '../../app/useAppBadge'
import { Badge, Button, Card, PageHeader, cx } from '../../components/ui'
import { db } from '../../db/db'
import { coachRecommendations, completeFirstSteps, getOrCreateTodaySession, markVoiceTired, skipSessionBlock, updatePrefs } from '../../training/coach'
import { courseProgress, initialiseCourse } from '../../lessons/store'
import { activeInstrument, courseFor, profileIdFor, type InstrumentId } from '../../training/instruments'
import { blockRuns } from '../../training/testBlocks'
import type { Attempt, Block, Recommendation, SessionRecord } from '../../training/types'
import { useMilestonesSince, useProfile, useRecentAttempts, useTodaySession } from '../../training/useTraining'
import { FirstStepsCard } from '../lessons/FirstStepsCard'
import { MilestoneList } from '../progress/MilestoneList'
import { VOICE_DAY, todayCopy } from './copy'
import { courseEntry, skipCourseStep, type SkipCourseStep } from './courseEntry'
import { GoalChips, MinutesPicker, SetupCard } from './SetupCard'
import { sessionForDate, useLocalDate } from './todayDate'
import { setUpPath, todayGate } from './todayGate'
import {
  BLOCK_META,
  adviceAction,
  allFinished,
  attemptForBlock,
  blockPaceText,
  blockPath,
  blockStatusLabel,
  blockTitle,
  formatLongDate,
  milestonesSeenKey,
  minuteOptionsFor,
  minutesThisWeek,
  noneDone,
  notesHitText,
  pct,
  streakText,
  type BlockIconName,
} from './todayUtils'

const ICONS: Record<BlockIconName, LucideIcon> = { Flame, Target, Repeat, Music, RotateCcw, ClipboardCheck, Ear }

function StatusPill({ status }: { status: Block['status'] }) {
  const tone = status === 'done' ? 'ok' : status === 'skipped' ? 'default' : 'accent'
  return <Badge tone={tone}>{blockStatusLabel(status)}</Badge>
}

function PlanRow({
  block,
  songTitle,
  attempt,
  busy,
  onStart,
  onSkip,
}: {
  block: Block
  songTitle?: string
  attempt: Attempt | undefined
  busy: boolean
  onStart: () => void
  onSkip: () => void
}) {
  const [why, setWhy] = useState(false)
  const simple = useSettings().simpleFeedback
  const pace = simple ? blockPaceText(block) : null
  const resultPct = attempt ? pct(attempt.accuracy) : null
  const Icon = ICONS[BLOCK_META[block.kind].icon]
  const finished = block.status === 'done' || block.status === 'skipped'
  return (
    <li data-testid="plan-block">
      <Card className={cx('flex flex-col gap-2', finished && 'opacity-80')}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-accent">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-muted">{BLOCK_META[block.kind].label}</div>
            <div className="font-semibold">{blockTitle(block, songTitle, simple)}</div>
            {pace && <div className="text-xs text-muted">{pace}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>about {block.minutes} min</span>
              <StatusPill status={block.status} />
              {block.status === 'done' && resultPct !== null && (
                <Badge tone={resultPct >= 80 ? 'ok' : resultPct >= 50 ? 'warn' : 'default'}>
                  {simple && attempt && attempt.total > 0 ? notesHitText(attempt) : `${resultPct}% accuracy`}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWhy((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted hover:text-slate-200"
            aria-expanded={why}
          >
            {why ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Why this?
          </button>
          {!finished && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
                Skip
              </Button>
              <Button size="sm" variant="primary" onClick={onStart} data-testid="block-start">
                Start
              </Button>
            </div>
          )}
        </div>
        {why && <p className="rounded-lg bg-panel-2 p-2 text-sm text-slate-300">{block.reason || 'No reason recorded.'}</p>}
      </Card>
    </li>
  )
}

function readSeenAt(key: string): number {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/** The milestones of one instrument that are new since they were last dismissed; each instrument remembers that for itself. */
function MilestoneStrip({ instrument }: { instrument: InstrumentId }) {
  const seenKey = milestonesSeenKey(instrument)
  const [seenAt, setSeenAt] = useState(() => readSeenAt(seenKey))
  const fresh = useMilestonesSince(seenAt, instrument)
  if (!fresh || fresh.length === 0) return null
  const dismiss = () => {
    const ts = Math.max(Date.now(), ...fresh.map((m) => m.at))
    try {
      localStorage.setItem(seenKey, String(ts))
    } catch {
      /* storage unavailable: dismiss for this view only */
    }
    setSeenAt(ts)
  }
  return (
    <Card className="border-accent/40">
      <div data-testid="milestone-strip" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">New milestones</h2>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
        <MilestoneList milestones={fresh.slice(0, 5)} emptyText="" />
      </div>
    </Card>
  )
}

function RecommendationCard({ rec, action }: { rec: Recommendation; action: { label: string; run: () => void } | null }) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="font-semibold">{rec.title}</div>
      <p className="text-sm text-muted">{rec.reason}</p>
      {action && (
        <div className="mt-1">
          <Button size="sm" onClick={action.run}>
            {action.label}
          </Button>
        </div>
      )}
    </Card>
  )
}

/**
 * The way to the First steps lessons. It is on Today for good, also after the course was finished
 * or skipped: nothing else in the app leads to the lessons. It speaks of the course of the instrument
 * on screen and reads the rows of that course alone.
 */
function CourseEntryCard({ instrument }: { instrument: InstrumentId }) {
  const course = courseFor(instrument)
  const progress = useLiveQuery(() => courseProgress(course.map((l) => l.id)), [course])
  const entry = courseEntry(progress, course)
  return (
    <Card>
      <div data-testid="course-entry" className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-accent">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="font-semibold">{entry.title}</h2>
          {/* Nothing is said about progress until it is known. */}
          {progress !== undefined && <p className="text-sm text-muted">{entry.line}</p>}
        </div>
        <Link to={entry.to} data-testid="course-entry-open">
          <Button size="sm">{entry.action}</Button>
        </Link>
      </div>
    </Card>
  )
}

/**
 * Today for the instrument the app is switched to (the guitar until the singing side is switched on).
 * What it shows is decided by `todayGate`, from that instrument's own profile.
 */
export function TodayPage() {
  const instrument = activeInstrument(useSettings())
  const profile = useProfile(instrument)
  const date = useLocalDate()
  const gate = todayGate(instrument, profile)
  if (gate === 'loading' || !profile) return <div className="py-16 text-center text-muted">Loading…</div>
  // A brand-new profile goes through the Start Here wizard first. (For a singer the shell sends them
  // to the same place from every page; this is that same step, so Today is never a blank page.)
  if (gate === 'start') return <Navigate to={setUpPath(instrument)} replace />
  // Keyed by the instrument: nothing a guitarist's Today holds (a session, a half-given answer) may be shown to the singer after the switch.
  if (gate === 'course') return <FirstStepsHome key={instrument} date={date} instrument={instrument} />
  if (gate === 'setup') {
    return (
      <div data-testid="today-page" data-instrument={instrument} className="flex flex-col gap-4">
        <div>
          <PageHeader title="Today" subtitle={formatLongDate(date)} />
          <SetupCard initialGoals={profile.goals} initialMinutes={profile.dailyMinutes} />
        </div>
        <CourseEntryCard instrument={instrument} />
      </div>
    )
  }
  return <TodayPlan key={instrument} placementDoneAt={profile.placementDoneAt ?? 0} date={date} instrument={instrument} />
}

/** Today while the First steps course is running: the next lesson, the tools, and a way out. */
function FirstStepsHome({ date, instrument }: { date: string; instrument: InstrumentId }) {
  const course = courseFor(instrument)
  const copy = todayCopy(instrument)
  // Leaving the course is asked about first: one stray tap must not end it.
  const [skip, setSkip] = useState<SkipCourseStep>('idle')
  const [skipFailed, setSkipFailed] = useState(false)
  // A phone left in a state an older version could cause (the course running with no lesson to
  // start) is put right the moment this screen opens; a healthy course is not written to.
  useEffect(() => {
    void initialiseCourse(course.map((l) => l.id)).catch(() => {
      /* the lesson card then shows what it can */
    })
  }, [course])
  const confirmSkip = async () => {
    if (skipCourseStep(skip, 'confirm') !== 'skipping') return
    setSkip('skipping')
    setSkipFailed(false)
    try {
      await completeFirstSteps(Date.now(), instrument)
    } catch {
      setSkipFailed(true)
    } finally {
      setSkip((s) => skipCourseStep(s, 'settled'))
    }
  }
  return (
    <div data-testid="today-page" data-instrument={instrument} className="flex flex-col gap-4">
      <PageHeader title="Today" subtitle={formatLongDate(date)} />
      <FirstStepsCard course={course} />
      <Card className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Any time:</span>
        {copy.tools.map((tool) => (
          <Link key={tool.to} to={tool.to} className="underline hover:text-slate-200">
            {tool.label}
          </Link>
        ))}
      </Card>
      {instrument === 'voice' && (
        <p className="text-sm text-muted" data-testid="voice-care">
          {VOICE_DAY.care}
        </p>
      )}
      {skip === 'idle' ? (
        <p className="text-xs text-muted">
          {copy.skip.lead}{' '}
          <button type="button" className="underline hover:text-slate-200" onClick={() => setSkip((s) => skipCourseStep(s, 'ask'))} data-testid="skip-course">
            {copy.skip.link}
          </button>
        </p>
      ) : (
        <Card className="border-accent/40">
          <div data-testid="skip-course-ask" role="group" aria-labelledby="skip-course-title" className="flex flex-col gap-2">
            <h2 id="skip-course-title" className="text-lg font-semibold">
              {copy.skip.title}
            </h2>
            {copy.skip.body.map((paragraph) => (
              <p key={paragraph} className="text-sm text-slate-200">
                {paragraph}
              </p>
            ))}
            {skipFailed && <p className="text-sm text-red-300">That did not work. Please try again.</p>}
            <div className="mt-1 flex flex-wrap gap-2">
              <Button variant="primary" disabled={skip === 'skipping'} onClick={() => setSkip((s) => skipCourseStep(s, 'keep'))} data-testid="skip-course-keep">
                {copy.skip.keep}
              </Button>
              <Button disabled={skip === 'skipping'} onClick={() => void confirmSkip()} data-testid="skip-course-confirm">
                {copy.skip.confirm}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

/** Ending a singing day early takes two taps, like leaving the course: the button only asks. */
type TiredStep = 'idle' | 'asking' | 'saving'

function TodayPlan({ placementDoneAt, date, instrument }: { placementDoneAt: number; date: string; instrument: InstrumentId }) {
  const sung = instrument === 'voice'
  const copy = todayCopy(instrument)
  // Only ever this instrument's own row: for a moment after the switch the hook still holds the other one.
  const held = useProfile(instrument)
  const profile = held?.id === profileIdFor(instrument) ? held : undefined
  const navigate = useNavigate()
  const settings = useSettings()
  const live = useTodaySession(date, instrument)
  const [created, setCreated] = useState<SessionRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [tired, setTired] = useState<TiredStep>('idle')
  const [tiredFailed, setTiredFailed] = useState(false)
  const week = useRecentAttempts(7, instrument)
  const recent = useRecentAttempts(1, instrument)
  // A block's result is one of its own runs: the tasks of a skill check belong to the session too, but to no exercise or song.
  const runs = useMemo(() => blockRuns(recent ?? []), [recent])

  // Only ever the session of the date on screen: after midnight the old one is still in memory for a moment.
  const session = sessionForDate(date, live, created)
  // Home-screen badge while today's session still has pending blocks (installed web app only).
  useAppBadge(session ? session.plan.blocks.some((b) => b.status === 'pending') : false)

  // Plans the day on arrival, and again when the date moves on while the app stays open.
  useEffect(() => {
    let cancelled = false
    getOrCreateTodaySession({ settings: getSettings(), instrument })
      .then((s) => {
        if (!cancelled) setCreated(s)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [placementDoneAt, date, instrument])

  const sessionKey = session ? session.plan.blocks.map((b) => b.status).join(',') : ''
  useEffect(() => {
    let cancelled = false
    coachRecommendations(getSettings(), Date.now(), instrument)
      .then((r) => {
        if (!cancelled) setRecs(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionKey, settings.calibratedAt, instrument])

  const songIds = useMemo(
    () => (session ? [...new Set(session.plan.blocks.flatMap((b) => (b.kind === 'song' ? [b.songId] : [])))] : []),
    [session],
  )
  const songIdsKey = songIds.join(',')
  const songTitles = useLiveQuery(async () => {
    const rows = await db.songs.bulkGet(songIds)
    return Object.fromEntries(rows.flatMap((s) => (s ? [[s.id, s.title || s.audioName] as const] : [])))
  }, [songIdsKey])

  const replan = useCallback(
    async (quick: boolean) => {
      setBusy(true)
      setError(null)
      try {
        setCreated(await getOrCreateTodaySession({ settings: getSettings(), quick, forceNew: true, instrument }))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [instrument],
  )

  const patchPrefs = async (patch: Parameters<typeof updatePrefs>[0]) => {
    setError(null)
    try {
      await updatePrefs(patch, instrument)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const skip = async (blockId: string) => {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      setCreated(await skipSessionBlock(session, blockId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // "My voice is tired": every block still open is set aside, and the Coach plans tomorrow gently.
  const restToday = async () => {
    if (!session || tired === 'saving') return
    setTired('saving')
    setTiredFailed(false)
    // "Skip" on a row waits as well: it saves the plan from the copy on screen, which would put back blocks that are being set aside.
    setBusy(true)
    try {
      // The Coach ends the plan that is stored for the day and hands that one back: show what it returns.
      setCreated(await markVoiceTired(session))
      setTired('idle')
    } catch {
      setTiredFailed(true)
      setTired('asking')
    } finally {
      setBusy(false)
    }
  }

  const startBlock = (block: Block) => navigate(blockPath(block))

  const recAction = (rec: Recommendation): { label: string; run: () => void } | null => {
    const target = adviceAction(rec, instrument, session?.plan.blocks)
    return target ? { label: target.label, run: () => navigate(target.to) } : null
  }

  const canReplan = !!session && noneDone(session) && !busy
  const replanTip = canReplan ? undefined : 'Only available before you finish a block'
  const minutesWeek = minutesThisWeek(week ?? [])
  const streak = profile?.streak ?? 0
  const complete = !!session && allFinished(session)
  // The day was ended with "My voice is tired": the card under the plan says rest, not "nice work".
  const rested = sung && profile?.voice?.tiredOn === date

  return (
    <div data-testid="today-page" data-instrument={instrument} className="flex flex-col gap-4">
      <PageHeader
        title="Today"
        subtitle={formatLongDate(date)}
        actions={
          <>
            <Badge tone={streak > 0 ? 'accent' : 'default'}>{streakText(streak)}</Badge>
            <Badge>{minutesWeek} min this week</Badge>
          </>
        }
      />
      <MilestoneStrip instrument={instrument} />
      <CourseEntryCard instrument={instrument} />
      {error && <div className="rounded-lg bg-bad/15 px-3 py-2 text-sm text-red-200">{error}</div>}
      {!session && !error && <div className="py-10 text-center text-muted">Planning your session…</div>}
      {session && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">
              {session.plan.minutes} min plan · {session.minutesDone} min done
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {/* A voice is always warmed up first, so a singing day has no five-minute form. */}
              {!sung && (
                <Button size="sm" disabled={!canReplan} title={replanTip} onClick={() => void replan(true)} data-testid="quick-5">
                  <Zap className="h-4 w-4" /> Quick 5 minutes
                </Button>
              )}
              <Button size="sm" disabled={!canReplan} title={replanTip} onClick={() => void replan(false)}>
                <RotateCcw className="h-4 w-4" /> New plan
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowPrefs((v) => !v)} aria-expanded={showPrefs}>
                <Settings2 className="h-4 w-4" /> Preferences
              </Button>
            </div>
          </div>
          {showPrefs && profile && (
            <Card className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Minutes per day</h3>
                <MinutesPicker minutes={profile.dailyMinutes} options={minuteOptionsFor(instrument)} onChange={(m) => void patchPrefs({ dailyMinutes: m })} />
              </div>
              {/* The goals sort guitar skills (rhythm, lead, technique): they would change nothing in a singing plan. */}
              {!sung && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">Goals</h3>
                  <GoalChips goals={profile.goals} onChange={(g) => void patchPrefs({ goals: g })} />
                </div>
              )}
              <p className="text-xs text-muted">Changes apply to the next plan.</p>
              <div>
                <Button size="sm" variant="primary" disabled={!canReplan} title={replanTip} onClick={() => void replan(false)}>
                  New plan now
                </Button>
              </div>
            </Card>
          )}
          <ol className="flex flex-col gap-3">
            {session.plan.blocks.map((block, index) => {
              const attempt = attemptForBlock(runs, session.id, block)
              return (
                <Fragment key={block.id}>
                  <PlanRow
                    block={block}
                    songTitle={block.kind === 'song' ? songTitles?.[block.songId] : undefined}
                    attempt={attempt}
                    busy={busy}
                    onStart={() => startBlock(block)}
                    onSkip={() => void skip(block.id)}
                  />
                  {sung && index === 0 && !complete && (
                    <li className="px-1 text-xs text-muted" data-testid="voice-water">
                      {VOICE_DAY.water}
                    </li>
                  )}
                </Fragment>
              )
            })}
          </ol>
          {sung && !complete && (
            <Card>
              <div data-testid="voice-care" className="flex flex-col gap-3">
                <p className="text-sm text-slate-200">{VOICE_DAY.care}</p>
                {tired === 'idle' ? (
                  <div>
                    <Button size="sm" disabled={busy} onClick={() => setTired('asking')} data-testid="voice-tired">
                      {VOICE_DAY.tired.button}
                    </Button>
                  </div>
                ) : (
                  <div data-testid="voice-tired-ask" role="group" aria-labelledby="voice-tired-title" className="flex flex-col gap-2">
                    <h2 id="voice-tired-title" className="text-lg font-semibold">
                      {VOICE_DAY.tired.ask.title}
                    </h2>
                    {VOICE_DAY.tired.ask.body.map((paragraph) => (
                      <p key={paragraph} className="text-sm text-slate-200">
                        {paragraph}
                      </p>
                    ))}
                    {tiredFailed && <p className="text-sm text-red-300">{VOICE_DAY.tired.trouble}</p>}
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Button variant="primary" disabled={tired === 'saving'} onClick={() => void restToday()} data-testid="voice-tired-confirm">
                        {VOICE_DAY.tired.ask.confirm}
                      </Button>
                      <Button disabled={tired === 'saving'} onClick={() => setTired('idle')} data-testid="voice-tired-keep">
                        {VOICE_DAY.tired.ask.keep}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
          {complete && rested && (
            <Card className="border-ok/40">
              <div data-testid="voice-rested" className="flex flex-col items-start gap-2">
                <h2 className="text-lg font-bold">{VOICE_DAY.tired.done.title}</h2>
                <p className="text-sm text-muted">{VOICE_DAY.tired.done.body}</p>
              </div>
            </Card>
          )}
          {complete && !rested && (
            <Card className="border-ok/40">
              <div data-testid="session-complete" className="flex flex-col items-start gap-2">
                <h2 className="text-lg font-bold">Session complete</h2>
                <p className="text-sm text-muted">{copy.complete.body(session.minutesDone)}</p>
                <Link to="/songs">
                  <Button variant="primary">
                    <Music className="h-4 w-4" /> {copy.complete.action}
                  </Button>
                </Link>
              </div>
            </Card>
          )}
          {session.plan.explanation.length > 0 && (
            <Card>
              <button
                type="button"
                onClick={() => setShowPlan((v) => !v)}
                className="flex w-full items-center justify-between text-left text-sm font-semibold"
                aria-expanded={showPlan}
              >
                How today was planned
                {showPlan ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showPlan && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                  {session.plan.explanation.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
      {recs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recommendations</h2>
          {recs.slice(0, 4).map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} action={recAction(rec)} />
          ))}
        </section>
      )}
    </div>
  )
}
