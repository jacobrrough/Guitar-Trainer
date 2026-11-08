/** String-by-string guided tuning (filled in by the tuner package). */
export function GuidedTuner({ onDone }: { onDone?: () => void }) {
  return <div className="p-6 text-muted">Guided tuning is being prepared.{onDone ? '' : ''}</div>
}
