import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useSettings } from '../../app/settings'
import { Button, Card, PageHeader, cx } from '../../components/ui'
import { unlockedSongIds } from '../../lessons/course'
import { courseProgress, initialiseCourse } from '../../lessons/store'
import { DEFAULT_RANGES } from '../../music/keys'
import { builtInSong, builtInSongRecord } from '../../songs'
import { vocalSongRecord } from '../../songs/vocal/install'
import { activeInstrument, courseFor } from '../../training/instruments'
import { useProfile } from '../../training/useTraining'
import { singPath } from '../sing/singPage'
import { resumeNote } from '../today/courseEntry'
import { COMES_LATER, courseCopy, courseGate, courseSummary, lessonStatus, ownProfile, songsToSing } from './lessonUtils'

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

/**
 * The First steps course of the instrument the app is switched to: its ten lessons in order, and the
 * songs they have opened. The lesson table holds the rows of both courses; this page reads and counts
 * the rows of its own course only.
 */
export function CoursePage() {
  const navigate = useNavigate()
  const instrument = activeInstrument(useSettings())
  const course = courseFor(instrument)
  const progress = useLiveQuery(() => courseProgress(course.map((l) => l.id)), [course])
  // The instrument can change while this page is up (the switch sits above it), and the profile hook
  // then goes on answering with the other learner's row for a moment. Only the row of the instrument
  // that is shown is ever read here (see `ownProfile`).
  const profile = ownProfile(instrument, useProfile(instrument))
  const [error, setError] = useState<string | null>(null)
  // The guitar course is made the first time this page is seen, as it always was. The singing course
  // gets its rows from the singing set-up and from nothing else.
  const gate = courseGate(instrument, profile)
  const mayStart = gate === 'open'

  useEffect(() => {
    if (!mayStart) return
    void initialiseCourse(course.map((l) => l.id)).catch(() => {})
  }, [course, mayStart])

  if (gate === 'set-up') return <Navigate to="/start?instrument=voice" replace />

  const { done: doneCount, label } = courseSummary(course, progress)
  const copy = courseCopy(instrument, course)
  const opened = progress ? unlockedSongIds(progress, course) : []
  // A singer's songs are songs to sing, and only those that fit their easy notes can be sung now.
  const toSing = instrument === 'voice' ? songsToSing(opened, profile?.voice?.range ?? DEFAULT_RANGES.lower) : null
  const songs: { id: string; title: string; description: string }[] = toSing ? toSing.ready : opened.map((id) => builtInSong(id)).filter((s) => !!s)
  const later = toSing?.later ?? []
  // Someone who skipped the course and came back: say that carrying on is fine. (Asked only while
  // lessons of this course remain: the note itself counts by the guitar course.)
  const resume = doneCount >= course.length ? null : resumeNote(profile, progress)

  const playSong = async (id: string) => {
    setError(null)
    try {
      if (instrument === 'voice') {
        // The row is written first when it is missing, and a sung song has its own page.
        const record = await vocalSongRecord(id)
        navigate(singPath(record.id))
        return
      }
      const record = await builtInSongRecord(id)
      navigate(`/play/${record.id}`)
    } catch {
      setError('That song is not ready yet. Please try again in a moment.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl" data-testid="course-page" data-instrument={instrument}>
      <PageHeader title="First steps" subtitle={copy.subtitle} />
      <Card className="mb-4">
        <ProgressBar value={doneCount} max={course.length} label={label} />
        {resume && (
          <p className="mt-3 text-sm text-muted" data-testid="course-resume">
            {resume}
          </p>
        )}
      </Card>

      <ol className="space-y-2">
        {course.map((lesson) => {
          const status = lessonStatus(lesson.id, progress)
          // After the course (finished or skipped) every lesson can be opened, to look something up.
          const open = status !== 'locked' || !!profile?.firstStepsDoneAt
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
                {!open && <Lock className="h-4 w-4 text-muted" aria-label="Locked" />}
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
        <h2 className="text-lg font-semibold">{copy.songsTitle}</h2>
        {songs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{copy.noSongs}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line" data-testid="unlocked-songs">
            {songs.map((song) => (
              <li key={song.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{song.title}</div>
                  <div className="text-sm text-muted">{song.description}</div>
                </div>
                <Button size="sm" variant="primary" onClick={() => void playSong(song.id)} data-testid={`song-play-${song.id}`}>
                  {copy.songAction}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {later.length > 0 && (
          <div className="mt-4 border-t border-line pt-3" data-testid="songs-later">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{COMES_LATER.title}</div>
            <ul className="mt-2 space-y-1 text-slate-200">
              {later.map((song) => (
                <li key={song.id}>{song.title}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">{COMES_LATER.why(later.length)}</p>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </Card>
    </div>
  )
}
