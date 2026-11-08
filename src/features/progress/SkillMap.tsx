import { ChevronDown, ChevronRight, Lock, Pin } from 'lucide-react'
import { useState } from 'react'
import { Badge, Card, cx } from '../../components/ui'
import { effectiveRating, masteryBand } from '../../training/learner'
import { CATEGORY_LABELS, SKILLS_BY_ID, isUnlocked, skillsForCategory } from '../../training/skills'
import type { LearnerModel, MasteryBand, SkillCategory } from '../../training/types'
import { RatingChart } from './RatingChart'

interface SkillMapProps {
  model: LearnerModel
  now: number
  pinnedSkillId?: string
  onPin: (skillId: string | undefined) => void
  seriesFor: (skillId: string) => { at: number; rating: number }[]
}

const CATEGORIES: SkillCategory[] = ['fretting', 'picking', 'chords', 'lead', 'timing', 'ear']

const BAND_BAR: Record<MasteryBand, string> = {
  new: 'bg-muted/60',
  learning: 'bg-muted',
  developing: 'bg-accent',
  solid: 'bg-green-600',
  mastered: 'bg-green-400',
}

export function SkillMap({ model, now, pinnedSkillId, onPin, seriesFor }: SkillMapProps) {
  const [open, setOpen] = useState<string | null>(null)
  const ratings: Record<string, number> = {}
  for (const [id, st] of Object.entries(model.skills)) ratings[id] = effectiveRating(st, now)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {CATEGORIES.map((category) => (
        <Card key={category}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{CATEGORY_LABELS[category]}</h3>
          <ul className="divide-y divide-line">
            {skillsForCategory(category).map((skill) => {
              const state = model.skills[skill.id]
              const eff = ratings[skill.id] ?? 0
              const rating = state?.rating ?? 0
              const band = masteryBand(eff)
              const rust = Math.round(rating - eff)
              const unlocked = isUnlocked(skill.id, ratings)
              const expanded = open === skill.id
              const pinned = pinnedSkillId === skill.id
              const missing = skill.prerequisites.filter((p) => (ratings[p] ?? 0) < 60).map((p) => SKILLS_BY_ID[p]?.name ?? p)
              return (
                <li key={skill.id} className="py-2">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : skill.id)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${skill.name}`}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {expanded ? (
                        <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted" />
                      ) : (
                        <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className={cx('text-sm font-medium', !unlocked && 'text-muted')}>{skill.name}</span>
                          <Badge>T{skill.tier}</Badge>
                          {skill.provisional && <Badge tone="warn">provisional</Badge>}
                          {pinned && <Badge tone="accent">pinned</Badge>}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2">
                          <span
                            className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(eff)}
                            aria-label={`${skill.name} rating`}
                          >
                            <span
                              className={cx('block h-full rounded-full', BAND_BAR[band])}
                              style={{
                                width: `${Math.max(0, Math.min(100, eff))}%`,
                              }}
                            />
                          </span>
                          <span className="w-8 text-right text-xs tabular-nums text-slate-300">{Math.round(eff)}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                          <span>{band}</span>
                          {state && state.tempoCeiling > 0 && <span>ceiling {Math.round(state.tempoCeiling)} bpm</span>}
                          {rust > 0 && <span className="text-amber-300">rusty −{rust}</span>}
                          {!unlocked && (
                            <span className="inline-flex items-center gap-1">
                              <Lock size={12} aria-hidden /> needs {missing.join(', ')}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onPin(pinned ? undefined : skill.id)}
                      aria-pressed={pinned}
                      aria-label={pinned ? `Unpin ${skill.name}` : `Pin ${skill.name}`}
                      className={cx(
                        'rounded-md p-1.5 hover:bg-panel-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        pinned ? 'text-accent' : 'text-muted',
                      )}
                    >
                      <Pin size={16} />
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 space-y-3 pl-6 text-sm">
                      <p className="text-slate-300">{skill.description}</p>
                      {skill.tips.length > 0 && (
                        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                          {skill.tips.map((tip) => (
                            <li key={tip}>{tip}</li>
                          ))}
                        </ul>
                      )}
                      <RatingChart series={seriesFor(skill.id)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </div>
  )
}
