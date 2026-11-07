import { Minus, Pause, Play, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { updateSettings, useSettings } from '../../app/settings'
import { metronome } from '../../audio/metronome/Metronome'
import { tapTempo } from '../../audio/metronome/scheduler-core'
import { Button, Card, Field, PageHeader, Toggle, cx } from '../../components/ui'

const TIME_SIGNATURES = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '5/4', beats: 5 },
  { label: '6/8', beats: 6 },
  { label: '7/8', beats: 7 },
]

const SUBDIVISIONS = [
  { label: '♩', value: 1, title: 'Quarter notes' },
  { label: '♫', value: 2, title: 'Eighth notes' },
  { label: '♪³', value: 3, title: 'Triplets' },
  { label: '♬', value: 4, title: 'Sixteenth notes' },
]

export function MetronomePage() {
  const { metronome: prefs } = useSettings()
  const [running, setRunning] = useState(metronome.running)
  const [beat, setBeat] = useState<{ beat: number; sub: number } | null>(null)
  const taps = useRef<number[]>([])

  // Keep the engine in sync with persisted preferences.
  useEffect(() => {
    metronome.update({ bpm: prefs.bpm, beatsPerBar: prefs.beatsPerBar, subdivision: prefs.subdivision, accentFirst: prefs.accentFirst })
    metronome.setVolume(prefs.volume)
  }, [prefs.bpm, prefs.beatsPerBar, prefs.subdivision, prefs.accentFirst, prefs.volume])

  useEffect(() => {
    const off = metronome.onBeat((ev) => setBeat({ beat: ev.beat, sub: ev.sub }))
    return () => {
      off()
      metronome.stop()
    }
  }, [])

  const setBpm = useCallback((bpm: number) => updateSettings({ metronome: { ...prefs, bpm: Math.max(30, Math.min(300, Math.round(bpm))) } }), [prefs])

  const toggle = useCallback(async () => {
    if (metronome.running) {
      metronome.stop()
      setRunning(false)
      setBeat(null)
    } else {
      await metronome.start()
      setRunning(true)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        void toggle()
      } else if (e.key === 'ArrowUp') setBpm(prefs.bpm + (e.shiftKey ? 10 : 1))
      else if (e.key === 'ArrowDown') setBpm(prefs.bpm - (e.shiftKey ? 10 : 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, setBpm, prefs.bpm])

  const onTap = () => {
    const now = performance.now()
    taps.current.push(now)
    if (taps.current.length > 8) taps.current.shift()
    const bpm = tapTempo(taps.current)
    if (bpm) setBpm(bpm)
  }

  return (
    <div>
      <PageHeader title="Metronome" subtitle="Space to start/stop · ↑/↓ to change tempo (Shift for ±10)" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="flex flex-col items-center py-8">
          <div className="mb-6 flex items-center gap-3">
            {Array.from({ length: prefs.beatsPerBar }, (_, i) => {
              const lit = running && beat?.beat === i
              return (
                <span
                  key={i}
                  className={cx(
                    'h-4 w-4 rounded-full transition-all',
                    lit ? (i === 0 && prefs.accentFirst ? 'bg-accent beat-pulse' : 'bg-slate-100 beat-pulse') : 'bg-line',
                  )}
                />
              )
            })}
          </div>
          <div className="flex items-center gap-4">
            <Button variant="secondary" size="lg" onClick={() => setBpm(prefs.bpm - 1)} aria-label="Slower">
              <Minus className="h-5 w-5" />
            </Button>
            <div className="w-44 text-center">
              <div className="text-7xl font-bold tabular-nums leading-none">{prefs.bpm}</div>
              <div className="mt-1 text-sm uppercase tracking-widest text-muted">bpm</div>
            </div>
            <Button variant="secondary" size="lg" onClick={() => setBpm(prefs.bpm + 1)} aria-label="Faster">
              <Plus className="h-5 w-5" />
            </Button>
          </div>
          <input type="range" min={30} max={300} value={prefs.bpm} onChange={(e) => setBpm(Number(e.target.value))} className="mt-6 w-full max-w-md" aria-label="Tempo" />
          <div className="mt-6 flex items-center gap-3">
            <Button variant="primary" size="lg" onClick={toggle} className="w-36" data-testid="metronome-toggle">
              {running ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              {running ? 'Stop' : 'Start'}
            </Button>
            <Button variant="secondary" size="lg" onClick={onTap}>
              Tap tempo
            </Button>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <Field label="Time signature">
              <div className="flex flex-wrap gap-2">
                {TIME_SIGNATURES.map((ts) => (
                  <button
                    key={ts.label}
                    type="button"
                    onClick={() => updateSettings({ metronome: { ...prefs, beatsPerBar: ts.beats } })}
                    className={cx('rounded-lg border px-3 py-1.5 text-sm', prefs.beatsPerBar === ts.beats ? 'border-accent bg-accent/15 text-amber-200' : 'border-line bg-panel-2 text-slate-200')}
                  >
                    {ts.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Subdivision" className="mt-4">
              <div className="flex gap-2">
                {SUBDIVISIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    title={s.title}
                    onClick={() => updateSettings({ metronome: { ...prefs, subdivision: s.value } })}
                    className={cx('h-10 w-12 rounded-lg border text-lg', prefs.subdivision === s.value ? 'border-accent bg-accent/15 text-amber-200' : 'border-line bg-panel-2 text-slate-200')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="mt-4">
              <Toggle checked={prefs.accentFirst} onChange={(v) => updateSettings({ metronome: { ...prefs, accentFirst: v } })} label="Accent first beat" />
            </div>
            <Field label={`Volume ${Math.round(prefs.volume * 100)}%`} className="mt-4">
              <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => updateSettings({ metronome: { ...prefs, volume: Number(e.target.value) } })} />
            </Field>
          </Card>
          <Card className="text-sm text-muted">
            <p className="mb-2 font-medium text-slate-200">Practice idea</p>
            <p>Pick a riff, set the tempo where you can play it cleanly, then raise it 3–5 bpm each time you nail it four bars in a row.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
