/**
 * Dates in Egypt time (Africa/Cairo). The server runs in UTC, so "today" for a
 * birthday or a morning summary must be computed in Cairo (owner, 2026-10-03).
 * Pure functions: tests in tests/phase-c.test.ts.
 */

export interface Ymd { y: number; m: number; d: number }

/** Calendar date in Cairo for an instant. */
export function cairoYmd(at: Date = new Date()): Ymd {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

export const ymdKey = (v: Ymd) => `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`
export const cairoToday = (at: Date = new Date()) => ymdKey(cairoYmd(at))

export function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/**
 * Month/day of the birthday in a given year. A 29 February birthday is
 * celebrated on 28 February in non-leap years.
 * Birth dates are stored as @db.Date (midnight UTC), so read them in UTC.
 */
export function birthdayInYear(dob: Date, year: number): { m: number; d: number } {
  const m = dob.getUTCMonth() + 1
  const d = dob.getUTCDate()
  if (m === 2 && d === 29 && !isLeapYear(year)) return { m: 2, d: 28 }
  return { m, d }
}

export function isBirthdayOn(dob: Date | null | undefined, day: Ymd): boolean {
  if (!dob || isNaN(dob.getTime())) return false
  const b = birthdayInYear(dob, day.y)
  return b.m === day.m && b.d === day.d
}

/** Age the person turns on their birthday in `year`. */
export function ageInYear(dob: Date, year: number) {
  return year - dob.getUTCFullYear()
}

/** Age today (completed years) in Cairo. */
export function ageOn(dob: Date, day: Ymd): number {
  const b = birthdayInYear(dob, day.y)
  const had = day.m > b.m || (day.m === b.m && day.d >= b.d)
  return day.y - dob.getUTCFullYear() - (had ? 0 : 1)
}

/** Adds days to a Y-M-D (calendar maths in UTC, no time-zone drift). */
export function addDays(day: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/**
 * Next birthday on or after `from` within `days` days (0 = only today).
 * Returns how many days away it is, or null.
 */
export function daysUntilBirthday(dob: Date | null | undefined, from: Ymd, days: number): number | null {
  if (!dob || isNaN(dob.getTime())) return null
  for (let i = 0; i <= days; i++) if (isBirthdayOn(dob, addDays(from, i))) return i
  return null
}

/** The real moment of a Cairo wall-clock date + time ("2026-10-09", "16:30"), DST aware. */
export function cairoDateTimeToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(guess)).map((p) => [p.type, p.value])
  )
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  return new Date(guess - (shown - guess))
}
