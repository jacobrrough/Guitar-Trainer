/** Per-string colours (lowest string first), matching the CSS theme. Rocksmith-style palette. */
export const STRING_COLORS = ['#e5484d', '#f5c518', '#3b82f6', '#f97316', '#22c55e', '#a855f7', '#94a3b8', '#f472b6'] as const

export function stringColor(index: number): string {
  return STRING_COLORS[Math.min(index, STRING_COLORS.length - 1)]
}
