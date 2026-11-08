import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { Button, Card } from '../../components/ui'
import { COURSE, nextAvailableLesson } from '../../lessons/course'
import { courseProgress } from '../../lessons/store'
import { ProgressBar } from './CoursePage'

/** Today-page card pointing at the next First steps lesson. */
export function FirstStepsCard() {
  const progress = useLiveQuery(() => courseProgress(), [])
  if (!progress || progress.length === 0) return null
  const next = nextAvailableLesson(progress)
  if (!next) return null
  return (
    <Card className="mb-4" >
      <div data-testid="first-steps-card">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">First steps</div>
        <h2 className="mt-1 text-lg font-semibold">
          {next.number}. {next.title}
        </h2>
        <p className="text-sm text-muted">{next.subtitle}</p>
        <p className="mt-1 text-xs text-muted">{next.minutes} minutes</p>
        <div className="mt-3">
          <ProgressBar value={next.number - 1} max={COURSE.length} label={`Lesson ${next.number} of ${COURSE.length}`} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link to={`/lessons/${next.id}`} data-testid="first-steps-start">
            <Button variant="primary">Start</Button>
          </Link>
          <Link to="/lessons" className="text-sm text-muted underline hover:text-slate-200">
            All lessons
          </Link>
        </div>
      </div>
    </Card>
  )
}
