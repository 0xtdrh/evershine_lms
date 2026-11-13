/**
 * Six phases 1-D (2026-11-13): group times are kept in Cairo time; a family abroad also sees them in its own time zone
 * (the browser's). Pure (tests/zones.test.ts). Egypt has summer time, so the offset is always read from Intl, never fixed.
 */

const CAIRO = 'Africa/Cairo'

/** Minutes the zone is ahead of UTC at this instant (Cairo: +120 in winter, +180 in summer). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'))
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000)
}

/** The instant of a Cairo wall time ('YYYY-MM-DD', 'HH:MM'). */
export function cairoInstant(day: string, time: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  const first = new Date(guess - zoneOffsetMinutes(new Date(guess), CAIRO) * 60_000)
  // around a clock change the first guess can be one hour off: correct once with the offset at the result
  return new Date(guess - zoneOffsetMinutes(first, CAIRO) * 60_000)
}

/** The next date (Cairo, from `today` 'YYYY-MM-DD') that falls on this weekday (0 = Sunday). */
export function nextCairoDay(today: string, dayOfWeek: number): string {
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const add = (dayOfWeek - base.getUTCDay() + 7) % 7
  return new Date(base.getTime() + add * 86_400_000).toISOString().slice(0, 10)
}

/** A weekly Cairo slot seen in another zone: the weekday and time there (null when the zone is Cairo's time anyway). */
export function slotInZone(slot: { dayOfWeek: number; time: string }, timeZone: string, today: string): { dayOfWeek: number; time: string } | null {
  if (!timeZone || timeZone === CAIRO) return null
  const at = cairoInstant(nextCairoDay(today, slot.dayOfWeek), slot.time)
  if (zoneOffsetMinutes(at, timeZone) === zoneOffsetMinutes(at, CAIRO)) return null
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(at)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '')
  const hh = String(Number(parts.find((p) => p.type === 'hour')?.value) % 24).padStart(2, '0')
  return { dayOfWeek: wd, time: `${hh}:${parts.find((p) => p.type === 'minute')?.value}` }
}

/** The browser's zone ('' when unknown). */
export const browserZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
}
