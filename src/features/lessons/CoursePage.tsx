import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Card, PageHeader, cx } from '../../components/ui'
import { COURSE, nextAvailableLesson, unlockedSongIds } from '../../lessons/course'
import { courseProgress, initialiseCourse } from '../../lessons/store'
import { builtInSong, builtInSongRecord } from '../../songs'
import { lessonStatus } from './lessonUtils'

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{label}</div>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round((value / max) * 100)}%` }} />
      </div>
    </div>
  )
}

/** The First steps course: ten lessons in order, and the songs they unlock. */
export function CoursePage() {
  const navigate = useNavigate()
  const progress = useLiveQuery(() => courseProgress(), [])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void initialiseCourse(COURSE.map((l) => l.id)).catch(() => {})
  }, [])

  const doneCount = progress ? progress.filter((p) => p.status === 'done').length : 0
  const next = progress ? nextAvailableLesson(progress) : undefined
  const label = doneCount >= COURSE.length ? `All ${COURSE.length} lessons done` : `Lesson ${next?.number ?? doneCount + 1} of ${COURSE.length}`
  const songs = (progress ? unlockedSongIds(progress) : []).map((id) => builtInSong(id)).filter((s) => !!s)

  const playSong = async (id: string) => {
    setError(null)
    try {
      const record = await builtInSongRecord(id)
      navigate(`/play/${record.id}`)
    } catch {
      setError('That song is not ready yet. Please try again in a moment.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl" data-testid="course-page">
      <PageHeader title="First steps" subtitle="Ten short lessons, from holding the guitar to playing your first songs." />
      <Card className="mb-4">
        <ProgressBar value={doneCount} max={COURSE.length} label={label} />
      </Card>

      <ol className="space-y-2">
        {COURSE.map((lesson) => {
          const status = lessonStatus(lesson.id, progress)
          const open = status !== 'locked'
          const body = (
            <>
              <div
                className={cx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  status === 'done' ? 'bg-ok/20 text-green-300' : open ? 'bg-accent text-slate-950' : 'bg-panel-2 text-muted',
                )}
              >
                {status === 'done' ? <Check className="h-4 w-4" aria-label="Done" /> : lesson.number}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{lesson.title}</div>
                <div className="text-sm text-muted">{lesson.subtitle}</div>
                <div className="mt-0.5 text-xs text-muted">{lesson.minutes} minutes</div>
              </div>
              <div className="shrink-0 text-sm">
                {status === 'done' && <span className="text-green-300">Done</span>}
                {status === 'available' && <span className="rounded-lg bg-accent px-3 py-1.5 font-medium text-slate-950">Start</span>}
                {status === 'locked' && <Lock className="h-4 w-4 text-muted" aria-label="Locked" />}
              </div>
            </>
          )
          const cls = cx('flex items-center gap-3 rounded-xl border border-line bg-panel p-3', open ? 'hover:bg-panel-2' : 'opacity-60')
          return (
            <li key={lesson.id}>
              {open ? (
                <Link to={`/lessons/${lesson.id}`} className={cls} data-testid="lesson-row" data-status={status} data-lesson={lesson.id}>
                  {body}
                </Link>
              ) : (
                <div className={cls} data-testid="lesson-row" data-status={status} data-lesson={lesson.id} aria-disabled="true">
                  {body}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <Card className="mt-6" >
        <h2 className="text-lg font-semibold">Songs you can play now</h2>
        {songs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Finish a lesson and your first songs will appear here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line" data-testid="unlocked-songs">
            {songs.map((song) => (
              <li key={song.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{song.title}</div>
                  <div className="text-sm text-muted">{song.description}</div>
                </div>
                <Button size="sm" variant="primary" onClick={() => void playSong(song.id)} data-testid={`song-play-${song.id}`}>
                  Play
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </Card>
    </div>
  )
}
