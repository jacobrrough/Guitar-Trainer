import { useLiveQuery } from 'dexie-react-hooks'
import {
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { getSettings, useSettings } from '../../app/settings'
import { useAppBadge } from '../../app/useAppBadge'
import { Badge, Button, Card, PageHeader, cx } from '../../components/ui'
import { db } from '../../db/db'
import { coachRecommendations, getOrCreateTodaySession, skipSessionBlock, updatePrefs } from '../../training/coach'
import { localDateString } from '../../training/store'
import type { Block, Recommendation, SessionRecord } from '../../training/types'
import { useMilestonesSince, useProfile, useRecentAttempts, useTodaySession } from '../../training/useTraining'
import { MilestoneList } from '../progress/MilestoneList'
import { GoalChips, MinutesPicker, SetupCard } from './SetupCard'
import {
  BLOCK_META,
  allFinished,
  attemptForBlock,
  blockStatusLabel,
  blockTitle,
  formatLongDate,
  minutesThisWeek,
  noneDone,
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
  resultPct,
  busy,
  onStart,
  onSkip,
}: {
  block: Block
  songTitle?: string
  resultPct: number | null
  busy: boolean
  onStart: () => void
  onSkip: () => void
}) {
  const [why, setWhy] = useState(false)
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
            <div className="font-semibold">{blockTitle(block, songTitle)}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{block.minutes} min</span>
              <StatusPill status={block.status} />
              {block.status === 'done' && resultPct !== null && (
                <Badge tone={resultPct >= 80 ? 'ok' : resultPct >= 50 ? 'warn' : 'default'}>{resultPct}% accuracy</Badge>
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

const SEEN_KEY = 'gt.milestonesSeenAt'

function readSeenAt(): number {
  try {
    const n = Number(localStorage.getItem(SEEN_KEY))
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function MilestoneStrip() {
  const [seenAt, setSeenAt] = useState(readSeenAt)
  const fresh = useMilestonesSince(seenAt)
  if (!fresh || fresh.length === 0) return null
  const dismiss = () => {
    const ts = Math.max(Date.now(), ...fresh.map((m) => m.at))
    try {
      localStorage.setItem(SEEN_KEY, String(ts))
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

export function TodayPage() {
  const profile = useProfile()
  if (!profile) return <div className="py-16 text-center text-muted">Loading…</div>
  if (!profile.placementDoneAt) {
    return (
      <div data-testid="today-page">
        <PageHeader title="Today" subtitle={formatLongDate(localDateString(new Date()))} />
        <SetupCard initialGoals={profile.goals} initialMinutes={profile.dailyMinutes} />
      </div>
    )
  }
  return <TodayPlan placementDoneAt={profile.placementDoneAt} />
}

function TodayPlan({ placementDoneAt }: { placementDoneAt: number }) {
  const profile = useProfile()
  const navigate = useNavigate()
  const settings = useSettings()
  const date = useMemo(() => localDateString(new Date()), [])
  const live = useTodaySession(date)
  const [created, setCreated] = useState<SessionRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [recs, setRecs] = useState<Recommendation[]>([])
  const week = useRecentAttempts(7)
  const recent = useRecentAttempts(1)

  const session: SessionRecord | null = live !== 'loading' && live !== null ? live : created
  // Home-screen badge while today's session still has pending blocks (installed web app only).
  useAppBadge(session ? session.plan.blocks.some((b) => b.status === 'pending') : false)

  useEffect(() => {
    let cancelled = false
    getOrCreateTodaySession({ settings: getSettings() })
      .then((s) => {
        if (!cancelled) setCreated(s)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [placementDoneAt])

  const sessionKey = session ? session.plan.blocks.map((b) => b.status).join(',') : ''
  useEffect(() => {
    let cancelled = false
    coachRecommendations(getSettings())
      .then((r) => {
        if (!cancelled) setRecs(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionKey, settings.calibratedAt])

  const songIds = useMemo(
    () => (session ? [...new Set(session.plan.blocks.flatMap((b) => (b.kind === 'song' ? [b.songId] : [])))] : []),
    [session],
  )
  const songIdsKey = songIds.join(',')
  const songTitles = useLiveQuery(async () => {
    const rows = await db.songs.bulkGet(songIds)
    return Object.fromEntries(rows.flatMap((s) => (s ? [[s.id, s.title || s.audioName] as const] : [])))
  }, [songIdsKey])

  const replan = useCallback(async (quick: boolean) => {
    setBusy(true)
    setError(null)
    try {
      setCreated(await getOrCreateTodaySession({ settings: getSettings(), quick, forceNew: true }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const patchPrefs = async (patch: Parameters<typeof updatePrefs>[0]) => {
    setError(null)
    try {
      await updatePrefs(patch)
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

  const startBlock = (block: Block) => navigate(block.kind === 'test' ? `/test/${block.test}` : `/today/block/${block.id}`)

  const recAction = (rec: Recommendation): { label: string; run: () => void } | null => {
    const a = rec.action
    if (!a) return null
    switch (a.type) {
      case 'calibrate':
        return { label: 'Calibrate', run: () => navigate('/settings') }
      case 'song':
        return { label: 'Play song', run: () => navigate(`/play/${a.songId}`) }
      case 'test':
        return { label: 'Start test', run: () => navigate(`/test/${a.test}`) }
      case 'practice': {
        const block = session?.plan.blocks.find(
          (b) => b.kind !== 'song' && b.kind !== 'test' && b.skillId === a.skillId && b.status === 'pending',
        )
        return block ? { label: 'Go to block', run: () => startBlock(block) } : null
      }
      default:
        return null
    }
  }

  const canReplan = !!session && noneDone(session) && !busy
  const replanTip = canReplan ? undefined : 'Only available before you finish a block'
  const minutesWeek = minutesThisWeek(week ?? [])
  const streak = profile?.streak ?? 0
  const complete = !!session && allFinished(session)

  return (
    <div data-testid="today-page" className="flex flex-col gap-4">
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
      <MilestoneStrip />
      {error && <div className="rounded-lg bg-bad/15 px-3 py-2 text-sm text-red-200">{error}</div>}
      {!session && !error && <div className="py-10 text-center text-muted">Planning your session…</div>}
      {session && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">
              {session.plan.minutes} min plan · {session.minutesDone} min done
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" disabled={!canReplan} title={replanTip} onClick={() => void replan(true)} data-testid="quick-5">
                <Zap className="h-4 w-4" /> Quick 5
              </Button>
              <Button size="sm" disabled={!canReplan} title={replanTip} onClick={() => void replan(false)}>
                <RotateCcw className="h-4 w-4" /> Re-plan
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
                <MinutesPicker minutes={profile.dailyMinutes} onChange={(m) => void patchPrefs({ dailyMinutes: m })} />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Goals</h3>
                <GoalChips goals={profile.goals} onChange={(g) => void patchPrefs({ goals: g })} />
              </div>
              <p className="text-xs text-muted">Changes apply to the next plan.</p>
              <div>
                <Button size="sm" variant="primary" disabled={!canReplan} title={replanTip} onClick={() => void replan(false)}>
                  Re-plan now
                </Button>
              </div>
            </Card>
          )}
          <ol className="flex flex-col gap-3">
            {session.plan.blocks.map((block) => {
              const attempt = attemptForBlock(recent ?? [], session.id, block)
              return (
                <PlanRow
                  key={block.id}
                  block={block}
                  songTitle={block.kind === 'song' ? songTitles?.[block.songId] : undefined}
                  resultPct={attempt ? pct(attempt.accuracy) : null}
                  busy={busy}
                  onStart={() => startBlock(block)}
                  onSkip={() => void skip(block.id)}
                />
              )
            })}
          </ol>
          {complete && (
            <Card className="border-ok/40">
              <div data-testid="session-complete" className="flex flex-col items-start gap-2">
                <h2 className="text-lg font-bold">Session complete</h2>
                <p className="text-sm text-muted">You practised {session.minutesDone} minutes today. Nice work.</p>
                <Link to="/songs">
                  <Button variant="primary">
                    <Music className="h-4 w-4" /> Play a song
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
