import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, Card, cx } from '../../components/ui'
import { skipPlacement, updatePrefs } from '../../training/coach'
import type { Goal, Profile } from '../../training/types'
import { GOAL_OPTIONS, MINUTE_OPTIONS } from './todayUtils'

type Minutes = Profile['dailyMinutes']

export function GoalChips({ goals, onChange }: { goals: Goal[]; onChange: (goals: Goal[]) => void }) {
  const toggle = (id: Goal) => {
    const has = goals.includes(id)
    const next = has ? goals.filter((g) => g !== id) : [...goals, id]
    onChange(next.length === 0 ? ['all-round'] : next)
  }
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Goals">
      {GOAL_OPTIONS.map((g) => {
        const on = goals.includes(g.id)
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(g.id)}
            className={cx(
              'h-9 rounded-full border px-3 text-sm font-medium transition-colors',
              on ? 'border-accent bg-accent/20 text-amber-100' : 'border-line bg-panel-2 text-slate-300 hover:bg-line',
            )}
          >
            {g.label}
          </button>
        )
      })}
    </div>
  )
}

export function MinutesPicker({ minutes, onChange }: { minutes: Minutes; onChange: (m: Minutes) => void }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Daily minutes">
      {MINUTE_OPTIONS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={minutes === m}
          onClick={() => onChange(m)}
          className={cx(
            'h-9 min-w-14 rounded-lg border px-3 text-sm font-semibold transition-colors',
            minutes === m ? 'border-accent bg-accent text-slate-950' : 'border-line bg-panel-2 text-slate-200 hover:bg-line',
          )}
        >
          {m} min
        </button>
      ))}
    </div>
  )
}

/** First-run card: goals, daily time, then take the placement test or start as a beginner. */
export function SetupCard({ initialGoals, initialMinutes }: { initialGoals?: Goal[]; initialMinutes?: Minutes }) {
  const navigate = useNavigate()
  const [goals, setGoals] = useState<Goal[]>(initialGoals?.length ? initialGoals : ['all-round'])
  const [minutes, setMinutes] = useState<Minutes>(initialMinutes ?? 20)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await updatePrefs({ goals, dailyMinutes: minutes })
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mx-auto max-w-xl">
      <div data-testid="setup-card" className="flex flex-col gap-5">
        <div>
          <h2 className="text-xl font-bold">Let&apos;s set up your training</h2>
          <p className="mt-1 text-sm text-muted">
            Tell us what you want out of practice. We build a short plan every day and adapt it as you improve.
          </p>
        </div>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-200">What are you working towards?</h3>
          <GoalChips goals={goals} onChange={setGoals} />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-200">Minutes per day</h3>
          <MinutesPicker minutes={minutes} onChange={setMinutes} />
        </section>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" size="lg" disabled={busy} onClick={() => void run(async () => navigate('/test/placement'))}>
            Quick check of what you can already do (6 min)
          </Button>
          <Button size="lg" disabled={busy} onClick={() => void run(async () => void (await skipPlacement()))} data-testid="setup-skip">
            Skip, start from the basics
          </Button>
        </div>
      </div>
    </Card>
  )
}
