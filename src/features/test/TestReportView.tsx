import { ArrowDown, ArrowUp, ClipboardCheck } from 'lucide-react'
import { Badge, Button, Card, PageHeader } from '../../components/ui'
import { instrumentOf, skillById } from '../../training/instruments'
import type { InstrumentId, TestRecord } from '../../training/types'
import { checkWords } from './taskResult'

export interface TestReportViewProps {
  record: TestRecord
  /** Extra notes, e.g. tasks skipped because a song was missing. */
  notes?: string[]
  onHome: () => void
  onProgress: () => void
  /** Whose check it was. Read from the record's own stamp when left out (no stamp = guitar). */
  instrument?: InstrumentId
}

const skillName = (id: string) => skillById(id)?.name ?? id

/**
 * One skill whose rating the check moved. The guitar report shows by how much. A singer's shows which
 * way, in words: a rating is a number a beginner has no use for.
 */
function DeltaRow({ skillId, value, placement, moved }: { skillId: string; value: number; placement: boolean; moved?: (up: boolean) => string }) {
  const rounded = Math.round(value * 10) / 10
  if (placement) {
    return (
      <li className="flex items-center justify-between text-sm">
        <span>{skillName(skillId)}</span>
        <span className="tabular-nums text-slate-300">0 → {Math.round(rounded)}</span>
      </li>
    )
  }
  const up = rounded > 0
  const flat = rounded === 0
  if (moved) {
    // Counted from the value itself, not the rounded one: a small move is still a move in that direction.
    const rising = value > 0
    return (
      <li className="flex items-center justify-between gap-3 text-sm">
        <span>{skillName(skillId)}</span>
        <span className={`inline-flex items-center gap-1 text-right ${rising ? 'text-green-300' : 'text-amber-200'}`}>
          {rising ? <ArrowUp className="h-3.5 w-3.5 shrink-0" /> : <ArrowDown className="h-3.5 w-3.5 shrink-0" />}
          {moved(rising)}
        </span>
      </li>
    )
  }
  return (
    <li className="flex items-center justify-between text-sm">
      <span>{skillName(skillId)}</span>
      <span className={`inline-flex items-center gap-1 tabular-nums ${flat ? 'text-muted' : up ? 'text-green-300' : 'text-red-300'}`}>
        {!flat && (up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}
        {up ? '+' : ''}
        {rounded}
      </span>
    </li>
  )
}

export function TestReportView({ record, notes = [], onHome, onProgress, instrument = instrumentOf(record) }: TestReportViewProps) {
  const { report, type } = record
  const words = checkWords(instrument)
  const placement = type === 'placement'
  // Placement reports carry the new rating as the "delta"; hide untouched zeros there.
  const deltas = Object.entries(report.ratingDeltas)
    .filter(([, v]) => (placement ? v > 0 : v !== 0))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  return (
    <div className="mx-auto max-w-xl" data-testid="test-report">
      <PageHeader title={words.title(type)} subtitle="Results" />
      <Card>
        <div className="mb-3 flex items-start gap-2">
          <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <h2 className="text-lg font-semibold">{report.headline}</h2>
        </div>
        {(report.lines.length > 0 || notes.length > 0) && (
          <ul className="mb-4 space-y-1 text-sm text-slate-300">
            {report.lines.map((l, i) => (
              <li key={`${i}-${l}`}>{l}</li>
            ))}
            {notes.map((n) => (
              <li key={n} className="text-amber-200">
                {n}
              </li>
            ))}
          </ul>
        )}
        {deltas.length > 0 && (
          <>
            <h3 className="mb-2 text-sm font-semibold">{words.changes(placement)}</h3>
            <ul className="mb-4 space-y-1.5 rounded-lg bg-panel-2 p-3">
              {deltas.map(([id, v]) => (
                <DeltaRow key={id} skillId={id} value={v} placement={placement} moved={instrument === 'voice' ? words.moved : undefined} />
              ))}
            </ul>
          </>
        )}
        {report.nextFocus.length > 0 && (
          <>
            <h3 className="mb-2 text-sm font-semibold">{words.nextFocus}</h3>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {report.nextFocus.map((id) => (
                <Badge key={id} tone="accent">
                  {skillName(id)}
                </Badge>
              ))}
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onHome}>
            Back to Today
          </Button>
          <Button onClick={onProgress}>See progress</Button>
        </div>
      </Card>
    </div>
  )
}
