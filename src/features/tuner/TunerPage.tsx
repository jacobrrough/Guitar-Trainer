import { Mic, MicOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { updateSettings, useSettings } from '../../app/settings'
import { audioEngine } from '../../audio/AudioEngine'
import { Button, Card, Field, PageHeader, Select, cx } from '../../components/ui'
import { centsOff, midiToFreq, midiToName } from '../../music/pitch'
import { stringColor } from '../../music/strings'
import { TUNINGS, getTuning } from '../../music/tunings'
import { useTuner } from './useTuner'

type Target = 'auto' | 'chromatic' | number

function Gauge({ cents, active, inTune }: { cents: number; active: boolean; inTune: boolean }) {
  const clamped = Math.max(-50, Math.min(50, cents))
  const angle = (clamped / 50) * 70 // degrees from vertical
  const ticks = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50]
  return (
    <svg viewBox="0 0 320 190" className="w-full max-w-md">
      <defs>
        <linearGradient id="arc" x1="0" x2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#22c55e" />
          <stop offset="55%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path d="M 30 170 A 130 130 0 0 1 290 170" fill="none" stroke="#27314a" strokeWidth="14" strokeLinecap="round" />
      <path d="M 30 170 A 130 130 0 0 1 290 170" fill="none" stroke="url(#arc)" strokeWidth="14" strokeLinecap="round" opacity={active ? 0.9 : 0.35} />
      {ticks.map((t) => {
        const a = ((t / 50) * 70 - 90) * (Math.PI / 180)
        const r1 = 108
        const r2 = t % 50 === 0 || t === 0 ? 92 : 98
        return (
          <g key={t}>
            <line x1={160 + r1 * Math.cos(a)} y1={170 + r1 * Math.sin(a)} x2={160 + r2 * Math.cos(a)} y2={170 + r2 * Math.sin(a)} stroke="#64748b" strokeWidth={t === 0 ? 3 : 1.5} />
            {t % 25 === 0 && (
              <text x={160 + 80 * Math.cos(a)} y={170 + 80 * Math.sin(a)} fill="#8b96ad" fontSize="11" textAnchor="middle" dominantBaseline="middle">
                {t > 0 ? `+${t}` : t}
              </text>
            )}
          </g>
        )
      })}
      <g transform={`rotate(${active ? angle : 0} 160 170)`} style={{ transition: 'transform 90ms linear' }}>
        <line x1="160" y1="170" x2="160" y2="52" stroke={inTune && active ? '#22c55e' : '#f8fafc'} strokeWidth="4" strokeLinecap="round" opacity={active ? 1 : 0.3} />
      </g>
      <circle cx="160" cy="170" r="9" fill="#f8fafc" opacity={active ? 1 : 0.3} />
    </svg>
  )
}

export function TunerPage() {
  const settings = useSettings()
  const tuning = getTuning(settings.tunerTuningId)
  const [listening, setListening] = useState(audioEngine.micActive)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<Target>('auto')
  const { reading, level } = useTuner(listening, settings.a4, settings.clarityThreshold)

  useEffect(() => () => audioEngine.stopMic(), [])

  const start = async () => {
    setError(null)
    try {
      await audioEngine.startMic({ deviceId: settings.inputDeviceId || undefined, threshold: 0.93 })
      setListening(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not access the microphone')
      setListening(false)
    }
  }
  const stop = () => {
    audioEngine.stopMic()
    setListening(false)
  }

  // Which string are we tuning, and how far off is it?
  const view = useMemo(() => {
    if (!reading) return null
    let stringIndex: number | null = null
    if (typeof target === 'number') stringIndex = target
    else if (target === 'auto') {
      let best = 0
      for (let i = 1; i < tuning.strings.length; i++) {
        if (Math.abs(tuning.strings[i] - reading.midiFloat) < Math.abs(tuning.strings[best] - reading.midiFloat)) best = i
      }
      stringIndex = best
    }
    if (stringIndex === null) {
      return { label: reading.name, octave: reading.octave, cents: reading.cents, stringIndex: null, targetFreq: midiToFreq(reading.midi, settings.a4) }
    }
    const midi = tuning.strings[stringIndex]
    const cents = centsOff(reading.freq, midi, settings.a4)
    return { label: midiToName(midi, false), octave: Math.floor(midi / 12) - 1, cents, stringIndex, targetFreq: midiToFreq(midi, settings.a4) }
  }, [reading, target, tuning, settings.a4])

  const active = !!reading && !reading.stale
  const inTune = !!view && Math.abs(view.cents) <= 5
  const farOff = !!view && Math.abs(view.cents) > 50

  return (
    <div>
      <PageHeader
        title="Tuner"
        subtitle="Chromatic tuner with per-string targets. Plug in or play into the microphone."
        actions={
          listening ? (
            <Button variant="secondary" onClick={stop}>
              <MicOff className="h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={start}>
              <Mic className="h-4 w-4" /> Start listening
            </Button>
          )
        }
      />
      {error && (
        <Card className="mb-4 border-bad/40 bg-bad/10 text-sm text-red-200">
          {error}. Check the browser permission prompt, or pick another input device in <Link to="/settings" className="underline">Settings</Link>.
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card className="flex flex-col items-center gap-2 py-6">
          <Gauge cents={view?.cents ?? 0} active={active} inTune={inTune} />
          <div className={cx('flex items-baseline gap-1 transition-opacity', active ? 'opacity-100' : 'opacity-40')}>
            <span className={cx('text-7xl font-bold tabular-nums', inTune && active ? 'text-ok' : 'text-slate-50')}>{view?.label ?? '–'}</span>
            <span className="text-2xl text-muted">{view ? view.octave : ''}</span>
          </div>
          <div className={cx('text-sm tabular-nums text-muted transition-opacity', active ? 'opacity-100' : 'opacity-40')}>
            {view ? (
              <>
                <span className={cx('font-semibold', inTune ? 'text-ok' : farOff ? 'text-bad' : 'text-amber-300')}>
                  {view.cents > 0 ? '+' : ''}
                  {view.cents.toFixed(0)} cents
                </span>
                <span className="mx-2">·</span>
                {reading!.freq.toFixed(1)} Hz
                <span className="mx-2">·</span>
                target {view.targetFreq.toFixed(1)} Hz
              </>
            ) : listening ? (
              'Play a string…'
            ) : (
              'Press “Start listening” and play a string'
            )}
          </div>
          {farOff && active && view?.stringIndex !== null && (
            <div className="text-xs text-amber-300">
              Far from {view?.label}: you may be on a different string. Tune {view!.cents > 0 ? 'down' : 'up'} or pick the string manually.
            </div>
          )}
          <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, Math.sqrt(level) * 220)}%` }} />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {tuning.strings.map((midi, i) => {
              const isTarget = view?.stringIndex === i && active
              const selected = target === i
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setTarget(selected ? 'auto' : i)}
                  className={cx(
                    'flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 text-sm font-semibold transition-all',
                    isTarget && inTune ? 'scale-110 border-ok bg-ok/20 text-green-200' : isTarget ? 'scale-110 bg-panel-2' : 'bg-panel-2 text-slate-200',
                    selected ? 'ring-2 ring-accent' : '',
                  )}
                  style={{ borderColor: isTarget && inTune ? undefined : stringColor(i) }}
                  title={`${midiToName(midi)} · ${midiToFreq(midi, settings.a4).toFixed(1)} Hz`}
                >
                  <span>{midiToName(midi, false)}</span>
                  <span className="text-[10px] font-normal text-muted">{Math.floor(midi / 12) - 1}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex gap-2 text-xs">
            <button type="button" onClick={() => setTarget('auto')} className={cx('rounded-md px-2 py-1', target === 'auto' ? 'bg-accent/20 text-amber-200' : 'text-muted hover:text-slate-200')}>
              Auto string
            </button>
            <button type="button" onClick={() => setTarget('chromatic')} className={cx('rounded-md px-2 py-1', target === 'chromatic' ? 'bg-accent/20 text-amber-200' : 'text-muted hover:text-slate-200')}>
              Chromatic
            </button>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <Field label="Tuning">
              <Select value={settings.tunerTuningId} onChange={(e) => updateSettings({ tunerTuningId: e.target.value })}>
                {TUNINGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Reference pitch: A4 = ${settings.a4} Hz`} className="mt-4">
              <input type="range" min={430} max={450} step={1} value={settings.a4} onChange={(e) => updateSettings({ a4: Number(e.target.value) })} />
            </Field>
          </Card>
          <Card className="text-sm text-muted">
            <p className="mb-2 font-medium text-slate-200">Tips</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Pluck one string at a time and let it ring.</li>
              <li>Tune up to the note: loosen below the target, then tighten.</li>
              <li>Green means within ±5 cents.</li>
              <li>Using an audio interface? Choose it in Settings for cleaner readings.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
