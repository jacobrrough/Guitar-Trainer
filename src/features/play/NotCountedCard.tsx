import type { ReactNode } from 'react'
import { Button } from '../../components/ui'
import type { InstrumentId } from '../../training/types'
import { notCountedCopy, type RunVerdict } from './runVerdict'

/**
 * Shown over the player instead of a result when a run cannot count (see `runVerdict`). The words are
 * the guitar's unless the screen says the run was sung (`instrument="voice"`).
 */
export function NotCountedCard({
  verdict,
  onRetry,
  instrument = 'guitar',
  children,
}: {
  verdict: Exclude<RunVerdict, 'counted'>
  onRetry: () => void
  instrument?: InstrumentId
  children?: ReactNode
}) {
  const copy = notCountedCopy(verdict, instrument)
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-bg/85 p-4" data-testid="no-score" data-verdict={verdict}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 text-center shadow-xl sm:p-6">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted">{copy.body}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onRetry} data-testid="no-score-retry">
            Try again
          </Button>
          {children}
        </div>
      </div>
    </div>
  )
}
