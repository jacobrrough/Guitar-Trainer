import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, Lock, Pin } from 'lucide-react'
import { useState } from 'react'
import { useSettings } from '../../app/settings'
import { Badge, Card, cx } from '../../components/ui'
import { COURSE } from '../../lessons/course'
import { courseProgress } from '../../lessons/store'
import type { Lesson } from '../../lessons/types'
import { masteryBand } from '../../training/learner'
import { CATEGORY_LABELS, SKILLS } from '../../training/skills'
import type { LearnerModel, MasteryBand, SkillDef } from '../../training/types'
import { missingPrerequisites, openContextOf, skillOpener, taughtSkillIds as lessonSkills } from '../../training/unlock'
import { simpleBandLabel } from '../today/todayUtils'
import { RatingChart } from './RatingChart'
import { categoriesOf, skillPaceText } from './progressStats'

interface SkillMapProps {
  model: LearnerModel
  now: number
  pinnedSkillId?: string
  onPin: (skillId: string | undefined) => void
  seriesFor: (skillId: string) => { at: number; rating: number }[]
  /** Skills the finished First steps lessons drilled; the Coach keeps these open. Read from the lesson rows when absent. */
  taughtSkillIds?: string[]
  /**
   * The skills to draw: one instrument's list. The cards are the categories these skills have, and what
   * is open or locked is worked out among them alone. The guitar's when left out.
   */
  skills?: SkillDef[]
  /** The First steps course of the same instrument, whose finished lessons keep skills open. The guitar's when left out. */
  course?: Pick<Lesson, 'id' | 'drill'>[]
  /**
   * Print the score (0 to 100) beside each bar, as the guitar map always has. A singer in plain mode is
   * shown the bar and its word alone: the number is a rating, and the singing side keeps those off the screen.
   */
  scores?: boolean
  /**
   * For each step skill, the highest step this singer's range has room for (`voiceMaxSteps`). The step
   * named under a bar is held to it. A skill that is not named can reach its last step.
   */
  maxSteps?: Record<string, number>
  /** The skill whose details are open when the map is first drawn. None when left out, as it always was. */
  openSkillId?: string
}

const BAND_BAR: Record<MasteryBand, string> = {
  new: 'bg-muted/60',
  learning: 'bg-muted',
  developing: 'bg-accent',
  solid: 'bg-green-600',
  mastered: 'bg-green-400',
}

/**
 * What opens under a skill: what it is, how to go about it, and how its rating has moved.
 *
 * The chart is a line of ratings with its grid labelled 50, 75 and 90, so it goes with the scores.
 * Where they are left out (`scores` off: a singer in plain mode) that chart is left out too.
 * `plainChart` then draws the same line with no number on it, so a singer still sees a skill grow;
 * the map asks for it. A caller that only says `scores: false` gets the words alone.
 */
export function SkillDetails({
  skill,
  series,
  scores = true,
  plainChart = false,
}: {
  skill: Pick<SkillDef, 'description' | 'tips'>
  series: { at: number; rating: number }[]
  scores?: boolean
  /** With the scores left out: draw the line all the same, without its numbers. Nothing changes where the scores are shown. */
  plainChart?: boolean
}) {
  return (
    <div className="mt-3 space-y-3 pl-6 text-sm">
      <p className="text-slate-300">{skill.description}</p>
      {skill.tips.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          {skill.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
      {scores ? <RatingChart series={series} /> : plainChart && <RatingChart series={series} plain />}
    </div>
  )
}

export function SkillMap({ model, now, pinnedSkillId, onPin, seriesFor, taughtSkillIds, skills = SKILLS, course = COURSE, scores = true, maxSteps, openSkillId }: SkillMapProps) {
  const [open, setOpen] = useState<string | null>(openSkillId ?? null)
  const simple = useSettings().simpleFeedback
  // The same rule and the same facts the Coach plans with (what the finished lessons taught included),
  // so a skill is never drawn locked while it is in today's plan. The lesson table holds the rows of
  // both courses: only this course's are asked for.
  const lessonIds = course.map((l) => l.id)
  const lessonRows = useLiveQuery(() => courseProgress(lessonIds), [lessonIds.join(' ')])
  const context = openContextOf(model, now, taughtSkillIds ?? lessonSkills(lessonRows ?? [], course))
  const ratings = context.ratings
  const isOpen = skillOpener(skills, context)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {categoriesOf(skills).map((category) => (
        <Card key={category}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{CATEGORY_LABELS[category]}</h3>
          <ul className="divide-y divide-line">
            {skills.filter((s) => s.category === category).map((skill) => {
              const state = model.skills[skill.id]
              const eff = ratings[skill.id] ?? 0
              const rating = state?.rating ?? 0
              const band = masteryBand(eff)
              const rust = Math.round(rating - eff)
              const unlocked = isOpen(skill)
              const expanded = open === skill.id
              const pinned = pinnedSkillId === skill.id
              const missing = missingPrerequisites(skill, ratings, skills).map((p) => p.name)
              // A tempo skill's ceiling (technical numbers only), or the step a step skill is practised from.
              const pace = skillPaceText(skill, state, simple, maxSteps?.[skill.id])
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
                          {!simple && <Badge>T{skill.tier}</Badge>}
                          {pinned && <Badge tone="accent">pinned</Badge>}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2">
                          <span
                            className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(eff)}
                            aria-label={`${skill.name} ${simple ? 'skill score' : 'rating'}`}
                          >
                            <span
                              className={cx('block h-full rounded-full', BAND_BAR[band])}
                              style={{
                                width: `${Math.max(0, Math.min(100, eff))}%`,
                              }}
                            />
                          </span>
                          {scores && <span className="w-8 text-right text-xs tabular-nums text-slate-300">{Math.round(eff)}</span>}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                          <span>{simple ? simpleBandLabel(band) : band}</span>
                          {pace && <span>{pace}</span>}
                          {rust > 0 && <span className="text-amber-300">{simple ? 'a bit rusty' : `rusty −${rust}`}</span>}
                          {!unlocked && (
                            <span className="inline-flex items-center gap-1">
                              <Lock size={12} aria-hidden /> first get better at: {missing.join(', ')}
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
                  {/* Where the map prints no score, the line under a skill has no number on it either. */}
                  {expanded && <SkillDetails skill={skill} series={seriesFor(skill.id)} scores={scores} plainChart={!scores} />}
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </div>
  )
}
