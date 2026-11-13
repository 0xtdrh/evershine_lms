/**
 * Six phases 2-B (2026-11-13): a RECORDED session (the whole group, or one student attending it recorded) becomes
 * "present — watched" by itself once the student has watched enough of that session's videos. Pure
 * (tests/recorded-watch.test.ts); the engine is lib/attendance/recorded-watch.ts.
 *
 * Rules:
 *  - only when the student attends that session RECORDED (his own way that day, else the session's way);
 *  - the session date must have come (today or before) and, when a limit is set, the watching must be within
 *    `maxDays` after the session (0 = no limit);
 *  - percent = seconds watched of ALL the session's videos ÷ their total length (one video skipped lowers it);
 *  - no record → PRESENT + WATCHED; ABSENT / EXCUSED → PRESENT + WATCHED (watching later is attending);
 *    PRESENT / LATE without a detail → WATCHED added; a record already WATCHED is left alone.
 */

export type AutoAction = 'CREATE' | 'UPGRADE' | 'DETAIL'

export interface SessionVideoWatch { watchedSec: number; durationSec: number }

/** Percent of the whole session's videos watched (0 when no video has a known length). */
export function sessionWatchedPercent(videos: SessionVideoWatch[]): number {
  const total = videos.reduce((n, v) => n + Math.max(0, v.durationSec), 0)
  if (total <= 0) return 0
  const seen = videos.reduce((n, v) => n + Math.min(Math.max(0, v.watchedSec), Math.max(0, v.durationSec)), 0)
  return Math.min(100, Math.round((seen / total) * 100))
}

const dayMs = 86_400_000
const dayOf = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`)

export function recordedAttendanceAction(i: {
  mode: string | null
  percent: number
  threshold: number
  sessionDate: string
  today: string
  maxDays: number
  existing: { status: string; presenceDetail: string | null } | null
}): AutoAction | null {
  if (i.mode !== 'RECORDED') return null
  if (i.percent < i.threshold) return null
  if (dayOf(i.sessionDate) > dayOf(i.today)) return null
  if (i.maxDays > 0 && dayOf(i.today) - dayOf(i.sessionDate) > i.maxDays * dayMs) return null
  if (!i.existing) return 'CREATE'
  if (i.existing.status === 'ABSENT' || i.existing.status === 'EXCUSED') return 'UPGRADE'
  if ((i.existing.status === 'PRESENT' || i.existing.status === 'LATE') && !i.existing.presenceDetail) return 'DETAIL'
  return null
}

export const AUTO_REMARK = 'Watched the recorded session (automatic) · اتفرج على الحصة المسجلة (تلقائي)'
