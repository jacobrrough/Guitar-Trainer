import { useRef, useState } from 'react'
import { isIOS } from '../../app/platform'
import { Button, Card } from '../../components/ui'
import { exportTrainingData, importTrainingData, resetTrainingData } from '../../training/store'
import { exportFileName, formatError, importStatusText } from './dataSection'
import { ImportConfirm } from './ImportConfirm'
import { IMPORT_NOTE, RESET_WARNING, backupSaved, importFlow, type ExportOutcome, type ImportEvent, type ImportFlow } from './importConfirm'

/** Settings card to export training data, import it (replacing what is there, after a yes) and reset it. */
export function DataSection() {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('')
  const [importing, setImporting] = useState<ImportFlow<File>>({ step: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)

  /** Runs `fn` and shows its message, or the error when it failed. */
  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await fn())
    } catch (err) {
      setStatus(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  /** Exports the training data. Resolves to how it ended; null when it failed. */
  const doExport = async (): Promise<ExportOutcome | null> => {
    const ended: { how: ExportOutcome | null } = { how: null }
    await run(async () => {
      const json = await exportTrainingData()
      const name = exportFileName(new Date())
      const blob = new Blob([json], { type: 'application/json' })
      const file = new File([blob], name, { type: 'application/json' })
      if (isIOS() && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name })
          ended.how = 'shared'
          return 'Export ready.'
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) throw err
          ended.how = 'cancelled'
          return ''
        }
      }
      const url = URL.createObjectURL(blob)
      try {
        if (isIOS()) {
          window.open(url, '_blank')
          ended.how = 'opened'
          return 'Export opened in a new tab.'
        }
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        ended.how = 'downloaded'
        return `Exported ${name}.`
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
    })
    return ended.how
  }

  // A picked file only waits here; the data is replaced when the learner confirms.
  const onImport = (event: ImportEvent<File>) => {
    const next = importFlow(importing, event)
    setImporting(next.state)
    const file = next.importFile
    if (file) void run(async () => importStatusText(await importTrainingData(await file.text())))
  }

  const backUpFirst = async () => {
    // Only say "Backup saved" when a file was really handed over.
    if (backupSaved(await doExport())) setImporting((flow) => importFlow(flow, { type: 'backedUp' }).state)
  }

  const doReset = () => {
    setConfirming(false)
    void run(async () => {
      await resetTrainingData()
      return 'Training data reset.'
    })
  }

  return (
    <Card>
      <h2 className="mb-3 font-semibold">Your data</h2>
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <div className="font-medium text-slate-200">Export</div>
          <p className="mb-2 text-xs text-muted">Save your lessons, practice history, skill checks and skill ratings as a backup file.</p>
          <Button data-testid="data-export" disabled={busy} onClick={() => void doExport()}>
            Export training data
          </Button>
        </div>
        <div>
          <div className="font-medium text-slate-200">Import</div>
          <p className="mb-2 text-xs text-muted">{IMPORT_NOTE}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              onImport({ type: 'picked', file: e.target.files?.[0] })
              e.target.value = ''
            }}
          />
          {importing.step === 'confirm' ? (
            <ImportConfirm
              fileName={importing.file.name}
              backedUp={importing.backedUp}
              busy={busy}
              onBackup={() => void backUpFirst()}
              onConfirm={() => onImport({ type: 'confirmed' })}
              onCancel={() => onImport({ type: 'cancelled' })}
            />
          ) : (
            <Button data-testid="data-import" disabled={busy} onClick={() => fileRef.current?.click()}>
              Import from file…
            </Button>
          )}
        </div>
        <div>
          <div className="font-medium text-slate-200">Reset training data</div>
          {confirming ? (
            <>
              <p className="mb-2 text-xs text-red-300">{RESET_WARNING}</p>
              <div className="flex gap-2">
                <Button variant="danger" data-testid="data-reset-confirm" disabled={busy} onClick={doReset}>
                  Confirm
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">Start training from scratch.</p>
              <Button variant="danger" data-testid="data-reset" disabled={busy} onClick={() => setConfirming(true)}>
                Reset training data…
              </Button>
            </>
          )}
        </div>
        <p data-testid="data-status" aria-live="polite" className="min-h-4 text-xs text-muted">
          {status}
        </p>
      </div>
    </Card>
  )
}
