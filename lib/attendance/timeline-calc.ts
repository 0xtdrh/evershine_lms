/**
 * Phase C: pure maths for a student's per-session attendance (tests in tests/phase-c.test.ts).
 * Attendance % = present + late over the sessions the student had (an excused
 * absence is still an absence; it only explains it). "Perfect attendance" = a
 * finished month with no absence at all (excused included).
 */

export type AttStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'

export interface SessionRow { n: number; of: number; date: string; status: AttStatus; excuseReason: string | null }

export interface AttendanceStats { sessions: number; present: number; late: number; absent: number; excused: number; pct: number | null }

export function attendanceStats(statuses: string[]): AttendanceStats {
  const c = { present: 0, late: 0, absent: 0, excused: 0 }
  for (const s of statuses) {
    if (s === 'PRESENT') c.present++
    else if (s === 'LATE') c.late++
    else if (s === 'ABSENT') c.absent++
    else if (s === 'EXCUSED') c.excused++
  }
  const sessions = c.present + c.late + c.absent + c.excused
  return { sessions, ...c, pct: sessions ? Math.round(((c.present + c.late) / sessions) * 100) : null }
}

/**
 * Numbers the student's sessions by the group's held dates ("3 of 8").
 * groupHeldDates: every date the group had a session (sorted or not).
 * studentRecords: the student's own records in that group.
 */
export function numberSessions(
  groupHeldDates: string[],
  studentRecords: { date: string; status: string }[],
  perCycle: number,
  excuses: Map<string, string> = new Map()
): SessionRow[] {
  const held = [...new Set(groupHeldDates)].sort()
  const no = new Map(held.map((d, i) => [d, i + 1]))
  return studentRecords
    .filter((r) => no.has(r.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({ n: no.get(r.date)!, of: Math.max(perCycle, held.length), date: r.date, status: r.status as AttStatus, excuseReason: excuses.get(r.date) ?? null }))
}

/** A finished month (group) where the student never missed a session. */
export function isPerfectAttendance(rows: { status: string }[], finished: boolean): boolean {
  return finished && rows.length > 0 && rows.every((r) => r.status === 'PRESENT' || r.status === 'LATE')
}
