import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { BUILD_ID, applyUpdate, checkForUpdate, useUpdateReady, type UpdateCheck } from '../../app/appUpdate'
import { voiceEnabled } from '../../app/features'
import { isStandalone } from '../../app/platform'
import { DEFAULT_SETTINGS, updateSettings, useSettings } from '../../app/settings'
import { installProtects, protectStorage, storageProtection, storageStatusText } from '../../app/storage'
import { audioEngine } from '../../audio/AudioEngine'
import { Button, Card, Field, PageHeader, Select, Toggle } from '../../components/ui'
import { TUNINGS } from '../../music/tunings'
import { activeInstrument } from '../../training/instruments'
import { loadVoiceProfile } from '../../training/voiceProfile'
import { EasyNotes } from '../voice/PitchLadder'
import { CalibrationDialog } from './CalibrationDialog'
import { DataSection } from './DataSection'
import { SINGING_CARD } from './dataSection'

const SENSITIVITY = [
  { value: 0.9, label: 'Clean tone (strict)' },
  { value: 0.85, label: 'Normal' },
  { value: 0.78, label: 'Overdrive' },
  { value: 0.7, label: 'High gain / noisy room' },
]

const CHECK_TEXT: Record<UpdateCheck, string> = {
  ready: 'A new version is ready.',
  downloading: 'A new version is downloading. It will be offered when it is ready.',
  current: 'You have the latest version.',
  unavailable: 'Could not check right now. Try again when you are online.',
}

/** Which build this is, and a way to ask for a newer one (an installed app on a phone can stay open for days). */
function VersionRow() {
  const ready = useUpdateReady()
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<UpdateCheck | null>(null)
  const check = async () => {
    setChecking(true)
    setStatus(await checkForUpdate())
    setChecking(false)
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="version-row">
      <span>
        Version: <span data-testid="build-id">{BUILD_ID}</span>
      </span>
      {ready ? (
        <Button size="sm" variant="primary" onClick={applyUpdate}>
          Update now
        </Button>
      ) : (
        <Button size="sm" onClick={() => void check()} disabled={checking}>
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
      )}
      {status && !ready && (
        <span role="status" data-testid="update-status">
          {CHECK_TEXT[status]}
        </span>
      )}
    </div>
  )
}

/**
 * Says whether the browser has promised to keep the songs and progress when the device runs low on space.
 * It first asks for that promise (only where no prompt can appear), so someone who set the app up
 * before it started asking is covered the first time they look here.
 */
function StorageRow() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      await protectStorage()
      const status = await storageProtection()
      if (live) setText(storageStatusText(status, installProtects(isStandalone(), navigator.userAgent)))
    })()
    return () => {
      live = false
    }
  }, [])
  if (!text) return null
  return (
    <p className="mt-2" data-testid="storage-status">
      {text}
    </p>
  )
}

/**
 * The "Singing" card: the singer's easy notes with the two small moves ("A bit lower", "A bit higher",
 * which stop at the lowest and highest notes the app can follow and say so), the way to find them
 * again, and whether the singer wears headphones. Drawn only while the singing side is on.
 *
 * The headphones switch can be off again without anyone having touched it: a sung run that hears the
 * guide from a speaker turns it off (the Player does), and the line under the switch says so.
 */
function SingingCard() {
  const settings = useSettings()
  const navigate = useNavigate()
  // Read live: a move of the easy notes is stored by the buttons themselves, and shown as it was stored.
  const voice = useLiveQuery(loadVoiceProfile)
  const range = voice?.range
  return (
    <Card>
      <div data-testid="singing-settings">
        <h2 className="mb-3 font-semibold">{SINGING_CARD.title}</h2>
        {range ? (
          <EasyNotes range={range}>
            <Button onClick={() => navigate('/range')} data-testid="singing-find-again">
              {SINGING_CARD.findAgain}
            </Button>
          </EasyNotes>
        ) : (
          // Nothing is said while the profile is still being read: "we do not know" would flash up for a singer who has notes.
          voice && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted">{SINGING_CARD.none}</p>
              <Button variant="primary" onClick={() => navigate('/range')} data-testid="singing-find">
                {SINGING_CARD.find}
              </Button>
            </div>
          )
        )}
        <div className="mt-4">
          <Toggle checked={settings.voiceHeadphones} onChange={(v) => updateSettings({ voiceHeadphones: v })} label={SINGING_CARD.headphones} />
          <p className="mt-1 text-xs text-muted" data-testid="singing-headphones-hint">
            {settings.voiceHeadphones ? SINGING_CARD.headphonesOn : SINGING_CARD.headphonesOff}
          </p>
        </div>
      </div>
    </Card>
  )
}

export function SettingsPage() {
  const settings = useSettings()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [params, setParams] = useSearchParams()
  // Today and the tests send people here with ?calibrate=1: the dialog opens straight away.
  const wantCalibrate = params.get('calibrate') === '1'
  const [calibrating, setCalibrating] = useState(wantCalibrate)
  const advancedRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (wantCalibrate && advancedRef.current) advancedRef.current.open = true
  }, [wantCalibrate])

  const closeCalibration = () => {
    setCalibrating(false)
    if (wantCalibrate) setParams({}, { replace: true })
  }

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
          <h2 className="mb-3 font-semibold">Sound</h2>
          <Toggle
            checked={settings.echoCancellation}
            onChange={(v) => updateSettings({ echoCancellation: v })}
            label="Playing through the phone speaker (no headphones)"
          />
          <p className="mt-1 text-xs text-muted">
            Turn this on if the sound comes out of your phone or computer speaker. It stops the microphone from mistaking the song for your playing.
            Headphones still score best.
          </p>
        </Card>
        {voiceEnabled() && <SingingCard />}
        <Card>
          <h2 className="mb-3 font-semibold">Microphone</h2>
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
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Display</h2>
          <div className="flex flex-col gap-3">
            <Toggle
              checked={settings.handedness === 'left'}
              onChange={(v) => updateSettings({ handedness: v ? 'left' : 'right' })}
              label="Left-handed"
            />
            <Toggle checked={settings.showFingerNumbers} onChange={(v) => updateSettings({ showFingerNumbers: v })} label="Show finger numbers" />
            <Toggle checked={settings.showNoteNames} onChange={(v) => updateSettings({ showNoteNames: v })} label="Show note names instead of fret numbers" />
            <Toggle
              checked={settings.simpleFeedback}
              onChange={(v) => updateSettings({ simpleFeedback: v })}
              label="Simple feedback (hide scores and technical numbers)"
            />
          </div>
          <Field label={`Note lane look-ahead: ${settings.visibleSeconds.toFixed(1)} s`} hint="How far ahead notes are visible. Shorter = faster scrolling." className="mt-4">
            <input type="range" min={1.5} max={6} step={0.5} value={settings.visibleSeconds} onChange={(e) => updateSettings({ visibleSeconds: Number(e.target.value) })} />
          </Field>
        </Card>
        <Card>
          <details data-testid="advanced-settings" ref={advancedRef}>
            <summary className="cursor-pointer font-semibold">Advanced</summary>
            <div className="mt-3">
              <Field label={`Sync your sound (latency): ${settings.latencyMs} ms`} hint="Your sound takes a moment to reach the app, longer with Bluetooth headphones or a USB interface. Measure it once and scoring lines up with what you play.">
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
              <Field label="Mic strictness" hint="Lower strictness tolerates distortion and noise, at the cost of occasional false notes." className="mt-4">
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
              <Field label={`Reference pitch: A4 = ${settings.a4} Hz`} hint="The pitch the tuner and scoring treat as the A above middle C. Leave at 440 unless you know you need otherwise." className="mt-4">
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
            </div>
          </details>
        </Card>
        <DataSection />
        <Card className="text-sm text-muted">
          <h2 className="mb-3 font-semibold text-slate-100">About</h2>
          <p>
            Guitar Trainer is free and open source. Songs, charts and scores stay in your browser's storage. Tab rendering uses alphaTab (MPL-2.0),
            automatic transcription uses Spotify's Basic Pitch (Apache-2.0).
          </p>
          <p className="mt-2">
            The guitar you hear is a recorded steel-string guitar from the University of Iowa Musical Instrument Samples, as edited in
            tonejs-instruments (CC BY 3.0); the notes were trimmed and packed into one file for this app.
          </p>
          <p className="mt-2">
            Source code and issues:{' '}
            <a href="https://github.com/jacobrrough/Guitar-Trainer" className="underline" target="_blank" rel="noreferrer">
              github.com/jacobrrough/Guitar-Trainer
            </a>
          </p>
          <VersionRow />
          <StorageRow />
        </Card>
      </div>
      {calibrating && (
        <CalibrationDialog
          deviceId={settings.inputDeviceId || undefined}
          // The words only: a singer is not asked to strum. The guitar's until the singing side is the one on screen.
          instrument={activeInstrument(settings)}
          onClose={closeCalibration}
          onResult={(ms) => updateSettings({ latencyMs: ms, calibratedAt: Date.now() })}
        />
      )}
    </div>
  )
}
