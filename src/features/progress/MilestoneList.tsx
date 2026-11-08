import { useState } from 'react'
import { Award, ClipboardCheck, Flame, Gauge, Music, Unlock, type LucideIcon } from 'lucide-react'
import type { Milestone, MilestoneType } from '../../training/types'

const ICONS: Record<MilestoneType, LucideIcon> = {
  band: Award,
  tempo: Gauge,
  unlock: Unlock,
  streak: Flame,
  song: Music,
  test: ClipboardCheck,
}

/** "today", "yesterday" or "N days ago" relative to `now`, by local calendar day. */
function relativeDate(at: number, now: number = Date.now()): string {
  const startOf = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((startOf(now) - startOf(at)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Icon + title + detail + relative date rows for milestones. */
export function MilestoneList({ milestones, emptyText }: { milestones: Milestone[]; emptyText: string }) {
  const [now] = useState(() => Date.now())
  if (milestones.length === 0) return <p className="text-sm text-muted">{emptyText}</p>
  return (
    <ul className="divide-y divide-line" data-testid="milestone-list">
      {milestones.map((m) => {
        const Icon = ICONS[m.type]
        return (
          <li key={m.key} className="flex items-start gap-3 py-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{m.title}</div>
              <div className="text-xs text-muted">{m.detail}</div>
            </div>
            <span className="shrink-0 text-xs text-muted">{relativeDate(m.at, now)}</span>
          </li>
        )
      })}
    </ul>
  )
}
