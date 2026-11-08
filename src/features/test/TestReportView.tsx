import { ArrowDown, ArrowUp, ClipboardCheck } from 'lucide-react'
import { Badge, Button, Card, PageHeader } from '../../components/ui'
import { SKILLS_BY_ID } from '../../training/skills'
import type { TestRecord } from '../../training/types'
import { TEST_TITLES } from './TaskIntro'

export interface TestReportViewProps {
  record: TestRecord
  /** Extra notes, e.g. tasks skipped because a song was missing. */
  notes?: string[]
  onHome: () => void
  onProgress: () => void
}

const skillName = (id: string) => SKILLS_BY_ID[id]?.name ?? id

function DeltaRow({ skillId, value, placement }: { skillId: string; value: number; placement: boolean }) {
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

export function TestReportView({ record, notes = [], onHome, onProgress }: TestReportViewProps) {
  const { report, type } = record
  const placement = type === 'placement'
  // Placement reports carry the new rating as the "delta"; hide untouched zeros there.
  const deltas = Object.entries(report.ratingDeltas)
    .filter(([, v]) => (placement ? v > 0 : v !== 0))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  return (
    <div className="mx-auto max-w-xl" data-testid="test-report">
      <PageHeader title={TEST_TITLES[type]} subtitle="Results" />
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
            <h3 className="mb-2 text-sm font-semibold">{placement ? 'Starting ratings' : 'Rating changes'}</h3>
            <ul className="mb-4 space-y-1.5 rounded-lg bg-panel-2 p-3">
              {deltas.map(([id, v]) => (
                <DeltaRow key={id} skillId={id} value={v} placement={placement} />
              ))}
            </ul>
          </>
        )}
        {report.nextFocus.length > 0 && (
          <>
            <h3 className="mb-2 text-sm font-semibold">Next focus</h3>
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
