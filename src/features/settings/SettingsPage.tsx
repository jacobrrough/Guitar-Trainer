import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, updateSettings, useSettings } from '../../app/settings'
import { audioEngine } from '../../audio/AudioEngine'
import { Button, Card, Field, PageHeader, Select, Toggle } from '../../components/ui'
import { TUNINGS } from '../../music/tunings'
import { CalibrationDialog } from './CalibrationDialog'
import { DataSection } from './DataSection'

const SENSITIVITY = [
  { value: 0.9, label: 'Clean tone (strict)' },
  { value: 0.85, label: 'Normal' },
  { value: 0.78, label: 'Overdrive' },
  { value: 0.7, label: 'High gain / noisy room' },
]

export function SettingsPage() {
  const settings = useSettings()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [calibrating, setCalibrating] = useState(false)

  const refreshDevices = async () => {
    try {
      const list = await audioEngine.listInputs()
      setDevices(list)
      if (list.some((d) => d.label)) setPermission('granted')
    } catch {
      /* enumerateDevices unavailable */
    }
  }

  useEffect(() => {
    void refreshDevices()
  }, [])

  const requestAccess = async () => {
    try {
      await audioEngine.startMic({ deviceId: settings.inputDeviceId || undefined })
      audioEngine.stopMic()
      setPermission('granted')
      await refreshDevices()
    } catch {
      setPermission('denied')
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Stored in this browser." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Input</h2>
          <Field label="Input device" hint="Audio interface or microphone. Grant access once to see device names.">
            <div className="flex gap-2">
              <Select value={settings.inputDeviceId} onChange={(e) => updateSettings({ inputDeviceId: e.target.value })} className="flex-1">
                <option value="">System default</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Input ${i + 1}`}
                  </option>
                ))}
              </Select>
              {permission !== 'granted' && (
                <Button onClick={requestAccess} variant="secondary">
                  Grant access
                </Button>
              )}
            </div>
          </Field>
          {permission === 'denied' && <p className="mt-2 text-xs text-red-300">Microphone access was denied. Allow it in your browser's site settings.</p>}
          <div className="mt-4">
            <Toggle checked={settings.echoCancellation} onChange={(v) => updateSettings({ echoCancellation: v })} label="Speaker mode: cancel the song's echo from the mic" />
            <p className="mt-1 text-xs text-muted">Turn on when playing without headphones (phone speaker). Headphones or an audio interface still score best.</p>
          </div>
          <Field label="Detection sensitivity" hint="Lower strictness tolerates distortion and noise, at the cost of occasional false notes." className="mt-4">
            <Select value={settings.clarityThreshold} onChange={(e) => updateSettings({ clarityThreshold: Number(e.target.value) })}>
              {SENSITIVITY.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Octave tolerance" hint="Pitch detectors often hear chords an octave off. Accepting octaves on chords keeps scoring fair." className="mt-4">
            <Select value={settings.octaveTolerance} onChange={(e) => updateSettings({ octaveTolerance: e.target.value as typeof settings.octaveTolerance })}>
              <option value="chords">Chords only (recommended)</option>
              <option value="all">All notes</option>
              <option value="none">Never</option>
            </Select>
          </Field>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Timing</h2>
          <Field label={`Latency compensation: ${settings.latencyMs} ms`} hint="Bluetooth headphones and USB interfaces add delay. Calibrate for the best scoring accuracy.">
            <input type="range" min={0} max={400} step={5} value={settings.latencyMs} onChange={(e) => updateSettings({ latencyMs: Number(e.target.value) })} />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={() => setCalibrating(true)}>
              Calibrate…
            </Button>
            <Button variant="ghost" onClick={() => updateSettings({ latencyMs: DEFAULT_SETTINGS.latencyMs, calibratedAt: undefined })}>
              Reset
            </Button>
          </div>
          {settings.calibratedAt && <p className="mt-2 text-xs text-muted">Last calibrated {new Date(settings.calibratedAt).toLocaleDateString()}.</p>}
          <Field label={`Highway look-ahead: ${settings.visibleSeconds.toFixed(1)} s`} hint="How far ahead notes are visible. Shorter = faster scrolling." className="mt-6">
            <input type="range" min={1.5} max={6} step={0.5} value={settings.visibleSeconds} onChange={(e) => updateSettings({ visibleSeconds: Number(e.target.value) })} />
          </Field>
          <div className="mt-4">
            <Toggle checked={settings.showNoteNames} onChange={(v) => updateSettings({ showNoteNames: v })} label="Show note names instead of fret numbers" />
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Tuning</h2>
          <Field label={`Reference pitch: A4 = ${settings.a4} Hz`}>
            <input type="range" min={430} max={450} step={1} value={settings.a4} onChange={(e) => updateSettings({ a4: Number(e.target.value) })} />
          </Field>
          <Field label="Default tuning for imports" hint="Used when a MIDI file or transcription needs fret positions." className="mt-4">
            <Select value={settings.defaultTuningId} onChange={(e) => updateSettings({ defaultTuningId: e.target.value })}>
              {TUNINGS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
        <DataSection />
        <Card className="text-sm text-muted">
          <h2 className="mb-3 font-semibold text-slate-100">About</h2>
          <p>
            Guitar Trainer is free and open source. Songs, charts and scores stay in your browser's storage. Tab rendering uses alphaTab (MPL-2.0),
            automatic transcription uses Spotify's Basic Pitch (Apache-2.0).
          </p>
          <p className="mt-2">
            Source code and issues:{' '}
            <a href="https://github.com/jacobrrough/Guitar-Trainer" className="underline" target="_blank" rel="noreferrer">
              github.com/jacobrrough/Guitar-Trainer
            </a>
          </p>
        </Card>
      </div>
      {calibrating && <CalibrationDialog deviceId={settings.inputDeviceId || undefined} onClose={() => setCalibrating(false)} onResult={(ms) => updateSettings({ latencyMs: ms, calibratedAt: Date.now() })} />}
    </div>
  )
}
