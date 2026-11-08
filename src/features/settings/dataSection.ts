/** Pure helpers for the "Your data" settings card. */

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** File name for a training-data export made on `date` (local calendar day). */
export function exportFileName(date: Date): string {
  return `guitar-trainer-training-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

/** Status message shown after a successful import. */
export function importStatusText(counts: { attempts: number; skills: number }): string {
  const a = counts.attempts === 1 ? 'attempt' : 'attempts'
  const s = counts.skills === 1 ? 'skill rating' : 'skill ratings'
  return `Imported ${counts.attempts} ${a} and ${counts.skills} ${s}.`
}

/** Human readable message for an unknown thrown value. */
export function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return 'Something went wrong.'
}
