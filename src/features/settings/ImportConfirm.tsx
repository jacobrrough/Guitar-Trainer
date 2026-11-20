import { Button } from '../../components/ui'
import { BACKUP_DONE, BACKUP_OFFER, importWarning } from './importConfirm'

/** The question asked before a backup file replaces the training data. Settings and Progress both show it. */
export function ImportConfirm({
  fileName,
  backedUp,
  busy,
  onBackup,
  onConfirm,
  onCancel,
}: {
  fileName: string
  /** A backup of the current data was saved while this question was open. */
  backedUp: boolean
  busy: boolean
  onBackup: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-left" data-testid="import-confirm">
      <p className="mb-2 text-xs text-red-200">{importWarning(fileName)}</p>
      <p className="mb-3 text-xs text-muted" aria-live="polite">
        {backedUp ? BACKUP_DONE : BACKUP_OFFER}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="import-backup" disabled={busy} onClick={onBackup}>
          Save a backup first
        </Button>
        <Button variant="danger" data-testid="import-confirm-yes" disabled={busy} onClick={onConfirm}>
          Replace my data
        </Button>
        <Button variant="ghost" data-testid="import-cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
