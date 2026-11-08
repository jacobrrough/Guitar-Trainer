import { useRef, useState } from 'react'
import { isIOS } from '../../app/platform'
import { Button, Card } from '../../components/ui'
import { exportTrainingData, importTrainingData, resetTrainingData } from '../../training/store'
import { exportFileName, formatError, importStatusText } from './dataSection'

/** Settings card to export, import (merge) and reset training data. */
export function DataSection() {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      setStatus(await fn())
    } catch (err) {
      setStatus(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  const doExport = () =>
    run(async () => {
      const json = await exportTrainingData()
      const name = exportFileName(new Date())
      const blob = new Blob([json], { type: 'application/json' })
      const file = new File([blob], name, { type: 'application/json' })
      if (isIOS() && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name })
          return 'Export ready.'
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return ''
          throw err
        }
      }
      const url = URL.createObjectURL(blob)
      try {
        if (isIOS()) {
          window.open(url, '_blank')
          return 'Export opened in a new tab.'
        }
        const a = document.createElement('a')
        a.href = url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        return `Exported ${name}.`
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
    })

  const doImport = (file: File | undefined) => {
    if (!file) return
    void run(async () => importStatusText(await importTrainingData(await file.text())))
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
          <p className="mb-2 text-xs text-muted">Save attempts, sessions, tests and skill ratings as a JSON backup.</p>
          <Button data-testid="data-export" disabled={busy} onClick={() => void doExport()}>
            Export training data
          </Button>
        </div>
        <div>
          <div className="font-medium text-slate-200">Import</div>
          <p className="mb-2 text-xs text-muted">Merges a backup into your current data; nothing is deleted.</p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              doImport(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button data-testid="data-import" disabled={busy} onClick={() => fileRef.current?.click()}>
            Import from file…
          </Button>
        </div>
        <div>
          <div className="font-medium text-slate-200">Reset training data</div>
          {confirming ? (
            <>
              <p className="mb-2 text-xs text-red-300">This deletes attempts, sessions, tests, milestones and skill ratings. Songs are kept.</p>
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
