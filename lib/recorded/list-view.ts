/**
 * Recorded courses — the "who is in which course" view (owner 17/11: "how do I know who is in a recorded course?").
 * Pure: a card per course (open / waiting for payment / ended / average progress) + filters, search and order.
 */

export type RecordedState = 'OPEN' | 'NOT_PAID' | 'EXPIRED'

export interface RecordedRowLike {
  id: string
  level: string
  state: RecordedState
  endsAt: string | null
  campus: { id: string; name: string }
  student: { id: string; name: string } | null
  progress: { pct: number } | null
}

export interface CourseSummary { level: string; open: number; waiting: number; ended: number; total: number; avgPct: number | null }

export function summarizeByCourse(rows: RecordedRowLike[]): CourseSummary[] {
  const by = new Map<string, RecordedRowLike[]>()
  for (const r of rows) by.set(r.level, [...(by.get(r.level) ?? []), r])
  return [...by.entries()]
    .map(([level, list]) => {
      const withPct = list.filter((r) => r.state === 'OPEN' && r.progress)
      return {
        level,
        open: list.filter((r) => r.state === 'OPEN').length,
        waiting: list.filter((r) => r.state === 'NOT_PAID').length,
        ended: list.filter((r) => r.state === 'EXPIRED').length,
        total: list.length,
        avgPct: withPct.length ? Math.round(withPct.reduce((a, r) => a + (r.progress?.pct ?? 0), 0) / withPct.length) : null,
      }
    })
    .sort((a, b) => b.open - a.open || a.level.localeCompare(b.level))
}

export interface RecordedFilter {
  level?: string
  state?: RecordedState | ''
  campusId?: string
  endingSoon?: boolean
  search?: string
  sort?: 'ENDS' | 'PROGRESS_LOW' | 'PROGRESS_HIGH' | 'NAME'
}

const DAY = 86_400_000

/** "ends within a week" = an open course whose end date is in the next 7 days. */
export function endsWithinWeek(r: RecordedRowLike, now: Date): boolean {
  if (r.state !== 'OPEN' || !r.endsAt) return false
  const left = new Date(r.endsAt).getTime() - now.getTime()
  return left >= 0 && left <= 7 * DAY
}

export function filterRecorded<T extends RecordedRowLike>(rows: T[], f: RecordedFilter, now: Date = new Date()): T[] {
  const q = (f.search ?? '').trim().toLowerCase()
  const out = rows.filter((r) =>
    (!f.level || r.level === f.level)
    && (!f.state || r.state === f.state)
    && (!f.campusId || r.campus.id === f.campusId)
    && (!f.endingSoon || endsWithinWeek(r, now))
    && (!q || (r.student?.name ?? '').toLowerCase().includes(q)),
  )
  const pct = (r: T) => r.progress?.pct ?? -1
  const ends = (r: T) => (r.endsAt ? new Date(r.endsAt).getTime() : Number.MAX_SAFE_INTEGER)
  switch (f.sort ?? 'ENDS') {
    case 'PROGRESS_LOW': return out.sort((a, b) => pct(a) - pct(b))
    case 'PROGRESS_HIGH': return out.sort((a, b) => pct(b) - pct(a))
    case 'NAME': return out.sort((a, b) => (a.student?.name ?? '').localeCompare(b.student?.name ?? ''))
    default: return out.sort((a, b) => ends(a) - ends(b))
  }
}
