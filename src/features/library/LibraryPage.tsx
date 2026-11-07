import { Play, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { LEVELS } from '../../chart/difficulty'
import type { ChartSource } from '../../chart/types'
import { Badge, Button, Card, PageHeader, cx, formatTime } from '../../components/ui'
import { addSong, deleteSong, type SongRecord } from '../../db/db'
import { useSongs } from '../../db/useSongs'
import { tuningLabel } from '../../music/tunings'
import { ImportDialog } from './ImportDialog'
import { createDemoSong } from './demoSong'

const SOURCE_LABEL: Record<ChartSource, string> = {
  guitarpro: 'Guitar Pro',
  musicxml: 'MusicXML',
  midi: 'MIDI',
  transcription: 'AI transcription',
  demo: 'Demo',
}

function SongCard({ song, onPlay, onDelete }: { song: SongRecord; onPlay: () => void; onDelete: () => void }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{song.title || song.audioName}</h3>
          <p className="truncate text-sm text-muted">{song.artist || 'Unknown artist'}</p>
        </div>
        <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-muted hover:bg-bad/15 hover:text-red-300" aria-label={`Delete ${song.title}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={song.source === 'transcription' ? 'accent' : 'default'}>{SOURCE_LABEL[song.source]}</Badge>
        <Badge>{tuningLabel(song.chart.tuning)}{song.chart.capo ? ` · capo ${song.chart.capo}` : ''}</Badge>
        <Badge>{formatTime(song.duration)}</Badge>
        <Badge>{Math.round(song.bpm)} bpm</Badge>
        <Badge>{song.chart.notes.length} notes</Badge>
      </div>
      <div className="flex items-center gap-1" title="Best accuracy per level">
        {LEVELS.map((l) => {
          const best = song.bestScores[String(l.level)]
          const acc = best ? best.accuracy : null
          return (
            <span
              key={l.level}
              className={cx(
                'flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-semibold',
                acc === null ? 'bg-panel-2 text-muted' : acc >= 0.9 ? 'bg-ok/25 text-green-200' : acc >= 0.7 ? 'bg-accent/25 text-amber-200' : 'bg-bad/20 text-red-200',
              )}
            >
              {l.level === 6 ? 'F' : l.level}
            </span>
          )
        })}
        {song.playCount > 0 && <span className="ml-auto text-xs text-muted">{song.playCount} plays</span>}
      </div>
      <Button variant="primary" onClick={onPlay} className="mt-1">
        <Play className="h-4 w-4" /> Play
      </Button>
    </Card>
  )
}

export function LibraryPage() {
  const songs = useSongs()
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [creatingDemo, setCreatingDemo] = useState(false)

  const addDemo = async () => {
    setCreatingDemo(true)
    try {
      const id = await addSong(createDemoSong())
      navigate(`/play/${id}`)
    } finally {
      setCreatingDemo(false)
    }
  }

  const remove = async (song: SongRecord) => {
    if (window.confirm(`Delete “${song.title}” from your library?`)) await deleteSong(song.id)
  }

  return (
    <div>
      <PageHeader
        title="Songs"
        subtitle="Your library is stored in this browser. Audio never leaves your device."
        actions={
          <>
            <Button onClick={addDemo} disabled={creatingDemo} data-testid="add-demo">
              <Sparkles className="h-4 w-4" /> {creatingDemo ? 'Creating…' : 'Demo song'}
            </Button>
            <Button variant="primary" onClick={() => setImporting(true)} data-testid="add-song">
              <Plus className="h-4 w-4" /> Add song
            </Button>
          </>
        }
      />
      {songs === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : songs.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-12 text-center">
          <h2 className="text-xl font-semibold">Add your first song</h2>
          <p className="max-w-md text-sm text-muted">
            Bring an audio file (MP3, WAV, FLAC, OGG…) and, if you have one, a Guitar Pro, MusicXML or MIDI chart. No chart? The app can
            listen to the song and build one for you, right here in your browser.
          </p>
          <div className="flex gap-2">
            <Button onClick={addDemo} disabled={creatingDemo}>
              <Sparkles className="h-4 w-4" /> Try the demo riff
            </Button>
            <Button variant="primary" onClick={() => setImporting(true)}>
              <Plus className="h-4 w-4" /> Add song
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {songs.map((song) => (
            <SongCard key={song.id} song={song} onPlay={() => navigate(`/play/${song.id}`)} onDelete={() => remove(song)} />
          ))}
        </div>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} onImported={(id) => navigate(`/play/${id}`)} />}
    </div>
  )
}
