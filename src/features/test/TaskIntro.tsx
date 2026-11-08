import { ClipboardCheck, Mic, Play, Timer } from 'lucide-react'
import { Badge, Button, Card, PageHeader } from '../../components/ui'
import { SKILLS_BY_ID } from '../../training/skills'
import type { TestTask, TestType } from '../../training/types'

export const TEST_TITLES: Record<TestType, string> = {
  placement: 'Placement test',
  checkpoint: 'Weekly checkpoint',
  monthly: 'Monthly assessment',
}

const TEST_BLURBS: Record<TestType, string> = {
  placement: 'A ladder of short tasks that gets easier to harder. It stops after two misses in a row and sets your starting levels.',
  checkpoint: 'A focus task, a retention task and a song stretch to see what has moved since last time.',
  monthly: 'The ladder again, starting one tier below your level, to re-measure your skills.',
}

const SECONDS_PER_TASK = 35

export function estimateMinutes(taskCount: number): number {
  return Math.max(1, Math.round((taskCount * SECONDS_PER_TASK) / 60))
}

export interface TaskIntroProps {
  type: TestType
  taskCount: number
  onStart: () => void
  onCancel: () => void
}

/** Overview screen shown before the first task. */
export function TaskIntro({ type, taskCount, onStart, onCancel }: TaskIntroProps) {
  const minutes = estimateMinutes(taskCount)
  const rules = [
    'One attempt per task. There is no retry.',
    'No pausing or seeking once a task starts.',
    'Everything plays at full speed after a count-in.',
    'Nothing is saved unless you finish the test.',
  ]
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={TEST_TITLES[type]} subtitle={TEST_BLURBS[type]} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="accent">
            <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
            {type === 'placement' ? `Up to ${taskCount} tasks` : `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`}
          </Badge>
          <Badge>
            <Timer className="mr-1 h-3.5 w-3.5" />~{minutes} min
          </Badge>
          <Badge>
            <Mic className="mr-1 h-3.5 w-3.5" />
            Mic required
          </Badge>
        </div>
        <h2 className="mb-2 font-semibold">Rules</h2>
        <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-slate-300">
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={onStart} data-testid="test-start">
            <Play className="h-4 w-4" /> Start
          </Button>
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Not now
          </Button>
        </div>
      </Card>
    </div>
  )
}

export interface TaskCardProps {
  task: TestTask
  position: number
  total: number
  onPlay: () => void
  busy?: boolean
}

/** Per-task card shown before the Player takes over the screen. */
export function TaskCard({ task, position, total, onPlay, busy }: TaskCardProps) {
  const tempo = task.params.tempo
  const skills = task.skillIds.map((id) => SKILLS_BY_ID[id]?.name ?? id)
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`Task ${position} of ${total}`} subtitle={task.generatorId === 'song' ? 'Song stretch' : 'Skill task'} />
      <Card>
        <h2 className="text-lg font-semibold">{task.title}</h2>
        <p className="mt-2 text-sm text-slate-300">{task.instructions}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-panel-2 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted">Target tempo</dt>
            <dd className="text-xl font-semibold tabular-nums">{Math.round(tempo)} bpm</dd>
          </div>
          <div className="rounded-lg bg-panel-2 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted">Measures</dt>
            <dd className="flex flex-wrap gap-1 pt-1">
              {skills.length > 0 ? skills.map((s) => <Badge key={s}>{s}</Badge>) : <Badge>Song playing</Badge>}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">A count-in plays first. Pass: 85% accuracy with steady timing.</p>
        <Button variant="primary" size="lg" className="mt-4" onClick={onPlay} disabled={busy} data-testid="task-play">
          <Play className="h-4 w-4" /> Play task
        </Button>
      </Card>
    </div>
  )
}
