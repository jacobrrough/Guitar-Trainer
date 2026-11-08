import { Award, Download, Trash2, TrendingUp, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { isIOS } from '../../app/platform'
import { Badge, Button, Card, PageHeader } from '../../components/ui'
import { masteryBand, effectiveRating } from '../../training/learner'
import { SKILLS } from '../../training/skills'
import { exportTrainingData, importTrainingData, resetTrainingData, saveProfile } from '../../training/store'
import { useLearnerModel, useMilestones, useRecentAttempts, useTests } from '../../training/useTraining'
import { practiceStreakDays, ratingSeries, weeklyMinutes } from './progressStats'
import { MilestoneList } from './MilestoneList'
import { SkillMap } from './SkillMap'

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-1 truncate text-xs text-muted">{sub}</div>}
    </Card>
  )
}

function WeeklyChart({ data }: { data: { weekStart: string; minutes: number }[] }) {
  const W = 320
  const H = 130
  const max = Math.max(30, ...data.map((d) => d.minutes))
  const slot = (W - 8) / data.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Minutes practised per week, last 8 weeks">
      {data.map((d, i) => {
        const h = (d.minutes / max) * (H - 36)
        const x = 4 + i * slot + slot * 0.15
        const w = slot * 0.7
        const [, m, day] = d.weekStart.split('-')
        return (
          <g key={d.weekStart}>
            <rect
              x={x}
              y={H - 18 - h}
              width={w}
              height={Math.max(h, 1)}
              rx="3"
              fill="var(--color-accent)"
              opacity={d.minutes > 0 ? 1 : 0.25}
            />
            {d.minutes > 0 && (
              <text x={x + w / 2} y={H - 22 - h} textAnchor="middle" fontSize="9" fill="var(--color-muted)">
                {Math.round(d.minutes)}
              </text>
            )}
            <text x={x + w / 2} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--color-muted)">
              {`${Number(m)}/${Number(day)}`}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function ProgressPage() {
  const model = useLearnerModel()
  const attempts = useRecentAttempts(120)
  const tests = useTests(10)
  const milestones = useMilestones(12)
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const now = useMemo(() => Date.now(), [])

  const stats = useMemo(() => {
    if (!model || !attempts) return null
    let mastered = 0
    let solid = 0
    for (const skill of SKILLS) {
      const st = model.skills[skill.id]
      const band = masteryBand(st ? effectiveRating(st, now) : 0)
      if (band === 'mastered') mastered++
      else if (band === 'solid') solid++
    }
    const weeks = weeklyMinutes(attempts, now, 8)
    return {
      mastered,
      solid,
      weeks,
      streak: practiceStreakDays(attempts, now),
      thisWeek: weeks[weeks.length - 1]?.minutes ?? 0,
    }
  }, [model, attempts, now])

  const onPin = (skillId: string | undefined) => {
    if (!model) return
    void saveProfile({ ...model.profile, pinnedSkillId: skillId })
  }

  const onExport = async () => {
    const json = await exportTrainingData()
    const name = `guitar-trainer-progress-${new Date().toISOString().slice(0, 10)}.json`
    const blob = new Blob([json], { type: 'application/json' })
    // iOS (esp. installed web apps): the share sheet is the only reliable way to reach Files.
    const file = new File([blob], name, { type: 'application/json' })
    if (isIOS() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name })
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
      }
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Safari cancels the download if the URL is revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    if (!window.confirm('Importing replaces all current training data. Continue?')) {
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    try {
      const res = await importTrainingData(await file.text())
      setMessage(`Imported ${res.attempts} attempts and ${res.skills} skills.`)
    } catch (e) {
      setMessage(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const onReset = async () => {
    if (!window.confirm('Reset all training progress? This cannot be undone.')) return
    await resetTrainingData()
    setMessage('Training data reset.')
  }

  const lastTest = tests?.[0]

  return (
    <div>
      <PageHeader title="Progress" subtitle="Skills, practice time and test history." />
      {!model || !attempts || !stats ? (
        <p className="text-sm text-muted" role="status">
          Loading progress…
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Streak" value={`${stats.streak} day${stats.streak === 1 ? '' : 's'}`} />
            <Tile label="This week" value={`${Math.round(stats.thisWeek)} min`} />
            <Tile label="Skills" value={`${stats.mastered} / ${stats.solid} / ${SKILLS.length}`} sub="mastered / solid / total" />
            <Tile
              label="Last test"
              value={lastTest ? new Date(lastTest.at).toLocaleDateString() : 'None yet'}
              sub={lastTest?.report.headline}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <TrendingUp size={16} aria-hidden /> Minutes per week
              </h2>
              <WeeklyChart data={stats.weeks} />
            </Card>
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <Award size={16} aria-hidden /> Tests
              </h2>
              {!tests ? (
                <p className="text-sm text-muted">Loading…</p>
              ) : tests.length === 0 ? (
                <p className="text-sm text-muted">No tests taken yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {tests.map((t) => {
                    const passed = t.results.filter((r) => r.passed).length
                    return (
                      <li key={t.id ?? t.at} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <Badge tone="accent">{t.type}</Badge>
                        <span className="text-xs text-muted">{new Date(t.at).toLocaleDateString()}</span>
                        <span className="min-w-0 flex-1 truncate">{t.report.headline}</span>
                        <Badge tone={passed === t.results.length ? 'ok' : 'default'}>
                          {passed}/{t.results.length} passed
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
              <Award size={16} aria-hidden /> Milestones
            </h2>
            {milestones ? (
              <MilestoneList milestones={milestones} emptyText="Milestones appear as you improve." />
            ) : (
              <p className="text-sm text-muted">Loading…</p>
            )}
          </Card>

          <section aria-label="Skill map">
            <h2 className="mb-3 text-lg font-semibold">Skill map</h2>
            <SkillMap
              model={model}
              now={now}
              pinnedSkillId={model.profile.pinnedSkillId}
              onPin={onPin}
              seriesFor={(id) => ratingSeries(attempts, id)}
            />
          </section>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Data</h2>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void onExport()} aria-label="Export training data as JSON">
                <Download size={16} /> Export
              </Button>
              <Button onClick={() => fileRef.current?.click()} aria-label="Import training data from JSON file">
                <Upload size={16} /> Import
              </Button>
              <Button variant="danger" onClick={() => void onReset()} aria-label="Reset all training data">
                <Trash2 size={16} /> Reset
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Training data file"
                onChange={(e) => void onImport(e.target.files?.[0])}
              />
            </div>
            {message && (
              <p className="mt-3 text-sm text-muted" role="status">
                {message}
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
