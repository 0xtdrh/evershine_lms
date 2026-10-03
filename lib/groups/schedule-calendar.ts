/**
 * Groups calendar (weekly / monthly): every session of every group on its
 * real date, numbered "session N of M". Pure — the API loads the data.
 *
 * Same counting rules as the rest of the system (lib/teachers/schedule.ts,
 * end-estimates.ts): a session is "held" when attendance exists for that
 * date; upcoming sessions are projected from today on the weekly
 * scheduleSlots and numbered after the sessions held so far, up to the
 * cycle's session count (lib/groups/cycle-rules.ts). Cancelled dates are
 * shown but do not use a number.
 *
 * Statuses:
 *  HELD         attendance recorded
 *  MISSING      a scheduled day in the past with no attendance (forgotten?)
 *  SCHEDULED    upcoming session of a running group
 *  NOT_STARTED  upcoming session of a group that has not started yet
 *  CANCELLED    cancelled session (CancelledSession)
 *  HOLIDAY      branch / company holiday: the session moves to the next slot (phase A)
 * Extra sessions (ExtraSession, e.g. making up a holiday) count like normal ones.
 */

export interface Slot { dayOfWeek: number; time: string }
export type OccurrenceStatus = 'HELD' | 'MISSING' | 'SCHEDULED' | 'NOT_STARTED' | 'CANCELLED' | 'HOLIDAY'
export interface ExtraSlot { date: string; time: string }

export interface GroupForCalendar {
  id: string
  slots: Slot[]
  completed: boolean
  /** YYYY-MM-DD; null = not started yet */
  cycleStart: string | null
  sessionsPerCycle: number
  /** distinct attendance dates (YYYY-MM-DD) since cycleStart */
  heldDates: string[]
  cancelledDates: string[]
  /** holiday dates for this group's branch (YYYY-MM-DD) */
  holidayDates?: string[]
  /** one-off extra sessions */
  extras?: ExtraSlot[]
}

export interface Occurrence {
  groupId: string
  date: string
  time: string
  status: OccurrenceStatus
  sessionNumber: number | null
  totalSessions: number
  isLastOfCycle: boolean
  isExtra?: boolean
}

const DAY_MS = 86_400_000
export const toDay = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00.000Z`)
const addDays = (s: string, n: number) => toDay(new Date(parse(s).getTime() + n * DAY_MS))
const weekday = (s: string) => parse(s).getUTCDay()

export function cleanSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) return []
  return (raw as Slot[])
    .filter((s) => Number.isInteger(s?.dayOfWeek) && s.dayOfWeek >= 0 && s.dayOfWeek <= 6 && typeof s.time === 'string')
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time))
}

export function buildOccurrences(g: GroupForCalendar, from: string, to: string, today: string): Occurrence[] {
  const per = Math.max(1, g.sessionsPerCycle)
  const held = [...new Set(g.heldDates)].sort()
  const heldNo = new Map(held.map((d, i) => [d, i + 1]))
  const cancelled = new Set(g.cancelledDates)
  const holidays = new Set(g.holidayDates ?? [])
  const extraOn = (d: string) => (g.extras ?? []).filter((e) => e.date === d).map((e) => ({ dayOfWeek: weekday(d), time: e.time, extra: true }))
  const weeklyOn = (d: string) => g.slots.filter((s) => s.dayOfWeek === weekday(d)).map((s) => ({ ...s, extra: false }))
  const slotsOn = (d: string) => {
    const all = [...weeklyOn(d), ...extraOn(d)]
    return all.filter((s, i) => all.findIndex((x) => x.time === s.time) === i).sort((a, b) => a.time.localeCompare(b.time))
  }

  // Upcoming sessions from today, numbered after what was held.
  const projected = new Map<string, number>() // `${date}|${time}` -> number
  if (!g.completed && (g.slots.length || (g.extras ?? []).length)) {
    let n = g.cycleStart ? held.length + 1 : 1 // held dates are all today or earlier
    for (let d = today, guard = 0; n <= per && d <= to && guard < 400; d = addDays(d, 1), guard++) {
      if (heldNo.has(d) || cancelled.has(d)) continue
      for (const s of slotsOn(d)) {
        if (holidays.has(d) && !s.extra) continue
        if (n > per) break
        projected.set(`${d}|${s.time}`, n++)
      }
    }
  }

  const out: Occurrence[] = []
  const base = { groupId: g.id, totalSessions: per }
  for (let d = from, guard = 0; d <= to && guard < 400; d = addDays(d, 1), guard++) {
    const daySlots = slotsOn(d)
    if (heldNo.has(d)) {
      const n = heldNo.get(d)!
      out.push({ ...base, date: d, time: daySlots[0]?.time ?? '', status: 'HELD', sessionNumber: n, isLastOfCycle: n === per })
      continue
    }
    if (cancelled.has(d)) {
      out.push({ ...base, date: d, time: daySlots[0]?.time ?? '', status: 'CANCELLED', sessionNumber: null, isLastOfCycle: false })
      continue
    }
    if (g.completed) continue
    for (const s of daySlots) {
      if (holidays.has(d) && !s.extra) {
        out.push({ ...base, date: d, time: s.time, status: 'HOLIDAY', sessionNumber: null, isLastOfCycle: false })
        continue
      }
      if (d < today) {
        if (g.cycleStart && d >= g.cycleStart && held.length < per) {
          out.push({ ...base, date: d, time: s.time, status: 'MISSING', sessionNumber: null, isLastOfCycle: false })
        }
        continue
      }
      const n = projected.get(`${d}|${s.time}`)
      if (n === undefined) continue // after the cycle's last session
      out.push({ ...base, date: d, time: s.time, status: g.cycleStart ? 'SCHEDULED' : 'NOT_STARTED', sessionNumber: n, isLastOfCycle: n === per, ...(s.extra && { isExtra: true }) })
    }
  }
  return out
}

/** Same teacher, same date and time, more than once (cancelled ones ignored). */
export function findConflicts<T extends { teacherId: string | null; date: string; time: string; status: OccurrenceStatus }>(rows: T[]): Set<number> {
  const seen = new Map<string, number[]>()
  rows.forEach((r, i) => {
    if (!r.teacherId || !r.time || r.status === 'CANCELLED' || r.status === 'HOLIDAY') return
    const k = `${r.teacherId}|${r.date}|${r.time}`
    seen.set(k, [...(seen.get(k) ?? []), i])
  })
  const out = new Set<number>()
  for (const idx of seen.values()) if (idx.length > 1) idx.forEach((i) => out.add(i))
  return out
}

/**
 * The next `count` sessions from `from` (inclusive): weekly slots + extra
 * sessions, skipping holidays (sessions move to the next slot), cancelled and
 * already-held dates. Shared by remaining-session lists, end estimates and
 * renewal reminders so they all agree with the calendar.
 */
export function upcomingSessions(opts: {
  slots: Slot[]
  from: string
  count: number
  holidays?: Iterable<string>
  extras?: ExtraSlot[]
  skipDates?: Iterable<string>
  maxDays?: number
}): ExtraSlot[] {
  const holidays = new Set(opts.holidays ?? [])
  const skip = new Set(opts.skipDates ?? [])
  const out: ExtraSlot[] = []
  if (opts.count <= 0) return out
  for (let d = opts.from, guard = 0; out.length < opts.count && guard < (opts.maxDays ?? 800); d = addDays(d, 1), guard++) {
    if (skip.has(d)) continue
    const weekly = holidays.has(d) ? [] : opts.slots.filter((s) => s.dayOfWeek === weekday(d)).map((s) => s.time)
    const extra = (opts.extras ?? []).filter((e) => e.date === d).map((e) => e.time)
    for (const time of [...new Set([...weekly, ...extra])].sort()) {
      if (out.length >= opts.count) break
      out.push({ date: d, time })
    }
  }
  return out
}
