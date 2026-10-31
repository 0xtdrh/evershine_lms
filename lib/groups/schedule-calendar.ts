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
 * a02 (2026-10-31): every session has a way (BRANCH / ONLINE / RECORDED): the slot's mode, or a one-off change for that
 * date (SessionModeOverride); a BRANCH holiday (not company-wide) does not stop online / recorded sessions.
 */

import type { Mode } from '@/lib/delivery/modes'

export interface Slot { dayOfWeek: number; time: string; mode?: Mode; /** a02 batch 3: the room of a BRANCH session (FIXED places) */ roomId?: string }
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
  /** holiday dates that are for the branch only (not company-wide): online / recorded sessions still happen */
  branchHolidayDates?: string[]
  /** a02: a session taught another way on that date */
  modeOverrides?: Record<string, Mode>
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
  /** a02: how the session is attended */
  mode: Mode
}

const DAY_MS = 86_400_000
export const toDay = (d: Date) => d.toISOString().slice(0, 10)
const parse = (s: string) => new Date(`${s}T00:00:00.000Z`)
const addDays = (s: string, n: number) => toDay(new Date(parse(s).getTime() + n * DAY_MS))
const weekday = (s: string) => parse(s).getUTCDay()

const MODE_SET = new Set(['BRANCH', 'ONLINE', 'RECORDED'])

export function cleanSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) return []
  return (raw as Slot[])
    .filter((s) => Number.isInteger(s?.dayOfWeek) && s.dayOfWeek >= 0 && s.dayOfWeek <= 6 && typeof s.time === 'string')
    .map((s) => ({ dayOfWeek: s.dayOfWeek, time: s.time, ...(s.mode && MODE_SET.has(s.mode) && s.mode !== 'BRANCH' && { mode: s.mode }), ...(typeof s.roomId === 'string' && s.roomId && (!s.mode || s.mode === 'BRANCH') && { roomId: s.roomId }) }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time))
}

export function buildOccurrences(g: GroupForCalendar, from: string, to: string, today: string): Occurrence[] {
  const per = Math.max(1, g.sessionsPerCycle)
  const held = [...new Set(g.heldDates)].sort()
  const heldNo = new Map(held.map((d, i) => [d, i + 1]))
  const cancelled = new Set(g.cancelledDates)
  const holidays = new Set(g.holidayDates ?? [])
  const branchOnly = new Set(g.branchHolidayDates ?? [])
  const modeOf = (d: string, s: { mode?: Mode }): Mode => g.modeOverrides?.[d] ?? s.mode ?? 'BRANCH'
  // a branch holiday stops branch sessions only (company holidays stop everything)
  const offOn = (d: string, s: { mode?: Mode; extra: boolean }) => !s.extra && holidays.has(d) && !(branchOnly.has(d) && modeOf(d, s) !== 'BRANCH')
  type DaySlot = Slot & { extra: boolean }
  const extraOn = (d: string): DaySlot[] => (g.extras ?? []).filter((e) => e.date === d).map((e) => ({ dayOfWeek: weekday(d), time: e.time, extra: true }))
  const weeklyOn = (d: string): DaySlot[] => g.slots.filter((s) => s.dayOfWeek === weekday(d)).map((s) => ({ ...s, extra: false }))
  const slotsOn = (d: string): DaySlot[] => {
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
        if (offOn(d, s)) continue
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
      out.push({ ...base, date: d, time: daySlots[0]?.time ?? '', status: 'HELD', sessionNumber: n, isLastOfCycle: n === per, mode: modeOf(d, daySlots[0] ?? {}) })
      continue
    }
    if (cancelled.has(d)) {
      out.push({ ...base, date: d, time: daySlots[0]?.time ?? '', status: 'CANCELLED', sessionNumber: null, isLastOfCycle: false, mode: modeOf(d, daySlots[0] ?? {}) })
      continue
    }
    if (g.completed) continue
    for (const s of daySlots) {
      const mode = modeOf(d, s)
      if (offOn(d, s)) {
        out.push({ ...base, date: d, time: s.time, status: 'HOLIDAY', sessionNumber: null, isLastOfCycle: false, mode })
        continue
      }
      if (d < today) {
        if (g.cycleStart && d >= g.cycleStart && held.length < per) {
          out.push({ ...base, date: d, time: s.time, status: 'MISSING', sessionNumber: null, isLastOfCycle: false, mode })
        }
        continue
      }
      const n = projected.get(`${d}|${s.time}`)
      if (n === undefined) continue // after the cycle's last session
      out.push({ ...base, date: d, time: s.time, status: g.cycleStart ? 'SCHEDULED' : 'NOT_STARTED', sessionNumber: n, isLastOfCycle: n === per, mode, ...(s.extra && { isExtra: true }) })
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
  /** a02: branch-only holidays (online / recorded sessions still happen) and one-off ways per date */
  branchHolidays?: Iterable<string>
  modeOverrides?: Record<string, Mode>
}): (ExtraSlot & { mode: Mode })[] {
  const holidays = new Set(opts.holidays ?? [])
  const branchOnly = new Set(opts.branchHolidays ?? [])
  const modeOf = (d: string, m?: Mode): Mode => opts.modeOverrides?.[d] ?? m ?? 'BRANCH'
  const skip = new Set(opts.skipDates ?? [])
  const out: (ExtraSlot & { mode: Mode })[] = []
  if (opts.count <= 0) return out
  for (let d = opts.from, guard = 0; out.length < opts.count && guard < (opts.maxDays ?? 800); d = addDays(d, 1), guard++) {
    if (skip.has(d)) continue
    const weekly = opts.slots
      .filter((s) => s.dayOfWeek === weekday(d))
      .filter((s) => !holidays.has(d) || (branchOnly.has(d) && modeOf(d, s.mode) !== 'BRANCH'))
      .map((s) => ({ time: s.time, mode: modeOf(d, s.mode) }))
    const extra = (opts.extras ?? []).filter((e) => e.date === d).map((e) => ({ time: e.time, mode: modeOf(d) }))
    const all = [...weekly, ...extra].filter((x, i, arr) => arr.findIndex((y) => y.time === x.time) === i).sort((a, b) => a.time.localeCompare(b.time))
    for (const x of all) {
      if (out.length >= opts.count) break
      out.push({ date: d, time: x.time, mode: x.mode })
    }
  }
  return out
}
