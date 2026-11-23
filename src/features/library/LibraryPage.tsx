import { useLiveQuery } from 'dexie-react-hooks'
import { Mic, Play, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { InstallBanner } from '../../app/InstallBanner'
import { useSettings } from '../../app/settings'
import { LEVELS } from '../../chart/difficulty'
import type { ChartSource } from '../../chart/types'
import { Badge, Button, Card, PageHeader, cx, formatTime } from '../../components/ui'
import { addSong, deleteSong, type SongRecord } from '../../db/db'
import { useSongs } from '../../db/useSongs'
import { tuningLabel } from '../../music/tunings'
import { ImportDialog } from './ImportDialog'
import { installBuiltInSongs } from '../../songs'
import { VOCAL_SONGS } from '../../songs/vocal'
import { vocalSongRecord } from '../../songs/vocal/install'
import { activeInstrument } from '../../training/instruments'
import { useProfile } from '../../training/useTraining'
import { voiceIsSetUp } from '../../training/voicePlan'
import { loadVoiceProfile } from '../../training/voiceProfile'
import { SING_COPY, singPath, singingRange, songCards, type LevelRow, type SongCard as VoiceCard } from '../sing/singPage'
import { createDemoSong } from './demoSong'

const SOURCE_LABEL: Record<ChartSource, string> = {
  guitarpro: 'Guitar Pro',
  musicxml: 'MusicXML',
  midi: 'MIDI',
  transcription: 'AI transcription',
  demo: 'Demo',
  builtin: 'Built-in',
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

/** The guitar library: the stored guitar songs, with import, the demo riff and the starter songs. */
function GuitarLibrary() {
  const songs = useSongs()
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [creatingDemo, setCreatingDemo] = useState(false)
  const [installing, setInstalling] = useState(false)

  const addStarterSongs = async () => {
    setInstalling(true)
    try {
      await installBuiltInSongs()
    } finally {
      setInstalling(false)
    }
  }

  const addDemo = async () => {
    setCreatingDemo(true)
    try {
      const id = await addSong(await createDemoSong())
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
            <Button onClick={addStarterSongs} disabled={installing} data-testid="add-builtin">
              <Sparkles className="h-4 w-4" /> {installing ? 'Adding…' : 'Starter songs'}
            </Button>
            <Button onClick={addDemo} disabled={creatingDemo} data-testid="add-demo">
              {creatingDemo ? 'Creating…' : 'Demo song'}
            </Button>
            <Button variant="primary" onClick={() => setImporting(true)} data-testid="add-song">
              <Plus className="h-4 w-4" /> Add song
            </Button>
          </>
        }
      />
      <InstallBanner />
      {songs === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : songs.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-12 text-center">
          <h2 className="text-xl font-semibold">Add your first song</h2>
          <p className="max-w-md text-sm text-muted">
            New to guitar? <strong>Starter songs</strong> adds a set of easy, well-known tunes made for the first lessons. You can also bring
            your own recording (MP3, WAV, FLAC…) with a Guitar Pro, MusicXML or MIDI chart, or let the app listen and build a chart for you.
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

const LEVEL_TONE: Record<LevelRow['tone'], string> = {
  default: 'bg-panel-2 text-muted',
  accent: 'bg-accent/25 text-amber-200',
  ok: 'bg-ok/25 text-green-200',
}

/** One song to sing: its key for this singer, the six levels with the best run on each, and the way in. No delete: its results hang on the row. */
function VoiceSongCard({ card, opening = false, onOpen }: { card: VoiceCard; opening?: boolean; onOpen?: () => void }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold">{card.title}</h3>
        <p className="truncate text-sm text-muted">{card.credit}</p>
      </div>
      <p className="text-sm text-slate-200">{card.description}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={card.key.fits ? 'accent' : 'default'}>{card.key.title}</Badge>
        <span className="text-xs text-muted">{card.key.notes}</span>
      </div>
      {card.key.fits ? (
        <>
          <div className="flex items-center gap-1" title={SING_COPY.bestOnEach}>
            {card.levels.map((level) => (
              <span
                key={level.index}
                title={`${level.name}: ${level.best}`}
                className={cx('flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-semibold', LEVEL_TONE[level.tone])}
              >
                {level.number}
              </span>
            ))}
            {card.sung && <span className="ml-auto text-xs text-muted">{card.sung}</span>}
          </div>
          <Button variant="primary" onClick={onOpen} disabled={opening} className="mt-1" data-testid="voice-song-open">
            <Mic className="h-4 w-4" /> {SING_COPY.sing}
          </Button>
        </>
      ) : (
        <p className="text-sm text-slate-200">{card.key.reason}</p>
      )}
    </Card>
  )
}

/**
 * The singer's library: every song to sing, in their own key. Nothing is imported and nothing is
 * deleted here: the songs are the app's own, a row is written the first time a song is opened, and the
 * results of a song hang on that row.
 */
function VoiceLibrary() {
  const rows = useSongs('voice')
  const voice = useLiveQuery(loadVoiceProfile)
  const profile = useProfile('voice')
  const navigate = useNavigate()
  const [opening, setOpening] = useState<string | null>(null)
  const [trouble, setTrouble] = useState(false)

  const open = async (builtinId: string) => {
    setOpening(builtinId)
    setTrouble(false)
    try {
      // The row of a song that was never opened is written here, on the tap: a live query must not write.
      const row = await vocalSongRecord(builtinId)
      navigate(singPath(row.id))
    } catch {
      setTrouble(true)
    } finally {
      setOpening(null)
    }
  }

  // A singer who has not been through the set-up is sent there, as on every page of the singing side.
  if (profile && !voiceIsSetUp(profile)) return <Navigate to="/start?instrument=voice" replace />
  // The profile too: until it is read nobody knows whether this singer belongs here or in the set-up.
  const cards = rows === undefined || voice === undefined || profile === undefined ? null : songCards(VOCAL_SONGS, voice, rows)
  return (
    <div data-testid="voice-library">
      <PageHeader title="Songs" subtitle={SING_COPY.librarySubtitle} />
      <InstallBanner />
      {cards === null ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          {singingRange(voice).kind === 'none' && (
            <p className="mb-4 text-sm text-slate-200">
              {SING_COPY.libraryStarting}{' '}
              <Link to="/range" className="text-accent underline">
                {SING_COPY.myVoice}
              </Link>
            </p>
          )}
          {trouble && (
            <p className="mb-4 text-sm text-amber-200" role="alert">
              {SING_COPY.openTrouble}
            </p>
          )}
          {cards.now.length === 0 ? (
            <Card className="py-8 text-center text-sm text-slate-200">{SING_COPY.noneFit}</Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="voice-songs">
              {cards.now.map((card) => (
                <VoiceSongCard key={card.id} card={card} opening={opening !== null} onOpen={() => void open(card.id)} />
              ))}
            </div>
          )}
          {cards.later.length > 0 && (
            <section className="mt-8" data-testid="comes-later">
              <h2 className="mb-3 text-lg font-semibold">{SING_COPY.comesLater}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.later.map((card) => (
                  <VoiceSongCard key={card.id} card={card} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** The songs of the instrument the app is showing. With the singing side switched off that is always the guitar. */
export function LibraryPage() {
  const instrument = activeInstrument(useSettings())
  return instrument === 'voice' ? <VoiceLibrary /> : <GuitarLibrary />
}
