import { useState } from 'react'
import { useSettings } from '../../app/settings'
import { loadScoreFile, scoreToChart, type LoadedScore } from '../../chart/importers/guitarpro'
import { loadMidiFile, midiToChart, type LoadedMidi } from '../../chart/importers/midi'
import { decodeAudio, resampleForModel, runTranscriptionWorker, transcriptionToChart } from '../../chart/importers/transcribe'
import { chartBpm, type Chart } from '../../chart/types'
import { Button, Field, Modal, Select, TextInput, cx } from '../../components/ui'
import { addSong } from '../../db/db'
import { TUNINGS, getTuning } from '../../music/tunings'

type ChartMode = 'auto' | 'score' | 'midi'

const MODES: { id: ChartMode; title: string; description: string }[] = [
  { id: 'score', title: 'Guitar Pro / MusicXML', description: 'Best quality. .gp, .gp3–.gp5, .gpx, .xml, .musicxml, .mxl' },
  { id: 'midi', title: 'MIDI file', description: 'Pick the guitar track; fret positions are worked out automatically.' },
  { id: 'auto', title: 'Listen & transcribe (AI)', description: 'No chart? The app analyses the audio on your device. Works best on clean, exposed guitar parts.' },
]

function parseFilename(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()
  const m = base.match(/^(.+?)\s+-\s+(.+)$/)
  if (m) return { artist: m[1].trim(), title: m[2].trim() }
  return { title: base, artist: '' }
}

function shiftChart(chart: Chart, offsetSec: number): Chart {
  if (!offsetSec) return chart
  return {
    ...chart,
    duration: chart.duration + offsetSec,
    notes: chart.notes.map((n) => ({ ...n, time: Math.max(0, n.time + offsetSec) })),
    beats: chart.beats.map((b) => ({ ...b, time: b.time + offsetSec })).filter((b) => b.time >= 0),
    tempos: chart.tempos.map((t) => ({ ...t, time: Math.max(0, t.time + offsetSec) })),
    timeSignatures: chart.timeSignatures.map((t) => ({ ...t, time: Math.max(0, t.time + offsetSec) })),
  }
}

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (id: number) => void }) {
  const settings = useSettings()
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [mode, setMode] = useState<ChartMode>('score')
  const [chartFile, setChartFile] = useState<File | null>(null)
  const [score, setScore] = useState<LoadedScore | null>(null)
  const [midi, setMidi] = useState<LoadedMidi | null>(null)
  const [trackIndex, setTrackIndex] = useState(0)
  const [tuningId, setTuningId] = useState(settings.defaultTuningId)
  const [offsetSec, setOffsetSec] = useState(0)
  const [status, setStatus] = useState<{ stage: string; progress: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = status !== null

  const onAudio = (file: File | null) => {
    setAudioFile(file)
    if (file && !title && !artist) {
      const parsed = parseFilename(file.name)
      setTitle(parsed.title)
      setArtist(parsed.artist)
    }
  }

  const onChartFile = async (file: File | null) => {
    setChartFile(file)
    setScore(null)
    setMidi(null)
    setError(null)
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      if (mode === 'score') {
        const loaded = await loadScoreFile(new Uint8Array(buf))
        setScore(loaded)
        setTrackIndex(loaded.defaultTrack)
        if (!title && loaded.title) setTitle(loaded.title)
        if (!artist && loaded.artist) setArtist(loaded.artist)
      } else if (mode === 'midi') {
        const loaded = loadMidiFile(buf)
        setMidi(loaded)
        setTrackIndex(loaded.defaultTrack)
        if (!title && loaded.title) setTitle(loaded.title)
      }
    } catch (err) {
      setError(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const canImport = !!audioFile && !busy && (mode === 'auto' || (mode === 'score' && !!score) || (mode === 'midi' && !!midi))

  const runImport = async () => {
    if (!audioFile) return
    setError(null)
    try {
      setStatus({ stage: 'Decoding audio…', progress: null })
      const buffer = await decodeAudio(audioFile)
      const duration = buffer.duration
      const tuning = getTuning(tuningId).strings
      let chart: Chart
      if (mode === 'score' && score) {
        setStatus({ stage: 'Reading the tab…', progress: null })
        chart = await scoreToChart(score, trackIndex)
      } else if (mode === 'midi' && midi) {
        setStatus({ stage: 'Reading MIDI…', progress: null })
        chart = midiToChart(midi, trackIndex, tuning, { title, artist })
      } else {
        setStatus({ stage: 'Preparing audio…', progress: null })
        const mono = await resampleForModel(buffer)
        setStatus({ stage: 'Listening to the song…', progress: 0 })
        const { notes } = await runTranscriptionWorker(mono, { tuning }, (p) => setStatus({ stage: 'Listening to the song…', progress: p }))
        setStatus({ stage: 'Building the chart…', progress: null })
        chart = transcriptionToChart(notes, { title, artist, tuning, duration })
      }
      chart = shiftChart({ ...chart, title: title || chart.title, artist: artist || chart.artist }, offsetSec)
      if (chart.notes.length === 0) {
        throw new Error(mode === 'auto' ? 'No notes were detected. Try a cleaner recording or a different tuning.' : 'The selected track has no notes.')
      }
      const id = await addSong({
        title: chart.title || audioFile.name,
        artist: chart.artist,
        audio: audioFile,
        audioType: audioFile.type || 'audio/mpeg',
        audioName: audioFile.name,
        duration,
        chart: { ...chart, duration: Math.max(chart.duration, duration) },
        source: chart.source,
        bpm: chartBpm(chart),
      })
      onImported(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus(null)
    }
  }

  const tracks = mode === 'score' ? score?.tracks : mode === 'midi' ? midi?.tracks : undefined

  return (
    <Modal title="Add a song" onClose={busy ? undefined : onClose} wide>
      <div className="flex flex-col gap-5">
        <Field label="Audio file" hint="MP3, WAV, FLAC, OGG, M4A… the recording you want to play along with.">
          <input type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" disabled={busy} onChange={(e) => onAudio(e.target.files?.[0] ?? null)} className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-slate-100" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="Song title" />
          </Field>
          <Field label="Artist">
            <TextInput value={artist} onChange={(e) => setArtist(e.target.value)} disabled={busy} placeholder="Artist" />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Where do the notes come from?</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(m.id)
                  setChartFile(null)
                  setScore(null)
                  setMidi(null)
                }}
                className={cx('rounded-lg border p-3 text-left text-sm transition-colors', mode === m.id ? 'border-accent bg-accent/10' : 'border-line bg-panel-2 hover:border-slate-500')}
              >
                <span className="block font-semibold">{m.title}</span>
                <span className="mt-1 block text-xs text-muted">{m.description}</span>
              </button>
            ))}
          </div>
        </div>
        {mode !== 'auto' && (
          <Field label={mode === 'score' ? 'Guitar Pro / MusicXML file' : 'MIDI file'}>
            <input
              type="file"
              key={mode}
              accept={mode === 'score' ? '.gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl,.cap,.capx' : '.mid,.midi,audio/midi'}
              disabled={busy}
              onChange={(e) => void onChartFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-slate-100"
            />
          </Field>
        )}
        {tracks && tracks.length > 0 && (
          <Field label="Track to play">
            <Select value={trackIndex} onChange={(e) => setTrackIndex(Number(e.target.value))} disabled={busy}>
              {tracks.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.name} · {t.noteCount} notes{'strings' in t ? ` · ${t.strings} strings` : ''}{t.isPercussion ? ' · drums' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {mode !== 'score' && (
            <Field label="Your tuning" hint="Used to place notes on the fretboard.">
              <Select value={tuningId} onChange={(e) => setTuningId(e.target.value)} disabled={busy}>
                {TUNINGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {mode !== 'auto' && (
            <Field label="Chart offset (seconds)" hint="Positive if the recording starts with silence or a count-in before the tab's first bar.">
              <TextInput type="number" step={0.05} value={offsetSec} onChange={(e) => setOffsetSec(Number(e.target.value) || 0)} disabled={busy} />
            </Field>
          )}
        </div>
        {chartFile && !score && !midi && !error && mode !== 'auto' && <p className="text-sm text-muted">Reading {chartFile.name}…</p>}
        {mode === 'auto' && (
          <p className="rounded-lg bg-panel-2 p-3 text-xs text-muted">
            Transcription runs Spotify's Basic Pitch model locally. Expect roughly 10–30 seconds per minute of audio depending on your device,
            and expect to correct the result's level and tempo. Isolated guitar recordings transcribe far better than full mixes.
          </p>
        )}
        {status && (
          <div>
            <div className="mb-1 flex justify-between text-sm">
              <span>{status.stage}</span>
              {status.progress !== null && <span className="tabular-nums text-muted">{Math.round(status.progress * 100)}%</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div className={cx('h-full bg-accent transition-[width]', status.progress === null && 'animate-pulse')} style={{ width: `${status.progress === null ? 100 : Math.max(2, status.progress * 100)}%` }} />
            </div>
          </div>
        )}
        {error && <p className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-red-200">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={runImport} disabled={!canImport}>
            {busy ? 'Working…' : 'Add to library'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
