/**
 * Six phases E2 (2026-11-13): when a group with a minimum count may start, and next-month payment deadlines (pure, tested).
 */

export type StartState = 'NO_MINIMUM' | 'WAITING_COUNT' | 'READY' | 'STARTED' | 'CANCELLED'

export function startState(g: { minStudents: number | null; count: number; startDate: Date | string | null; cancelledAt: Date | string | null; startConfirmedAt: Date | string | null; startForced: boolean }): StartState {
  if (g.cancelledAt) return 'CANCELLED'
  if (g.startDate) return 'STARTED'
  if (!g.minStudents) return 'NO_MINIMUM'
  if (g.startForced || g.startConfirmedAt || g.count >= g.minStudents) return 'READY'
  return 'WAITING_COUNT'
}

/** Attendance may be taken unless the group is still waiting for its minimum (or was cancelled). */
export const canTakeAttendance = (s: StartState) => s !== 'WAITING_COUNT' && s !== 'CANCELLED'

/** The first weekly slot date (Cairo 'YYYY-MM-DD') on or after `from`; null without a schedule. */
export function nextSlotDate(slots: unknown, from: string): string | null {
  const days = Array.isArray(slots) ? [...new Set((slots as { dayOfWeek?: unknown }[]).map((s) => s?.dayOfWeek).filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6))] : []
  if (!days.length) return null
  const [y, m, d] = from.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  for (let i = 0; i < 7; i++) {
    const day = new Date(base + i * 86_400_000)
    if (days.includes(day.getUTCDay())) return day.toISOString().slice(0, 10)
  }
  return null
}

/** Days from `a` to `b` ('YYYY-MM-DD'), b - a. */
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((p(b) - p(a)) / 86_400_000)
}

/** The staff alert is due: waiting for the minimum, within `alertDays` of the expected start (or past it), not sent yet. */
export function startAlertDue(state: StartState, expected: string | null, today: string, alertDays: number, alreadyAlerted: boolean): boolean {
  if (state !== 'WAITING_COUNT' || alreadyAlerted || !expected) return false
  return daysBetween(today, expected) <= alertDays
}

/**
 * Next month in an "after payment" group (a continuing student with an unpaid invoice), from the first session of the
 * new month: 1 = remind 3 days before, 2 = remind on the day, 3 = lock (not in the group until paid). Never goes back.
 */
export function nextMonthStage(firstSession: string | null, today: string, current: number): number {
  if (!firstSession) return current
  const left = daysBetween(today, firstSession)
  const due = left < 0 ? 3 : left === 0 ? 2 : left <= 3 ? 1 : 0
  return Math.max(current, due)
}
