/**
 * 2026-10-20 one way to show dates everywhere (owner rule: day / month / year, Egypt time).
 * dmy("2026-10-20T15:10:00Z") → "20/10/2026"; dmyTime(...) → "20/10/2026 18:10".
 * Pure: safe on server and client. Tested in tests/format-dates.test.ts.
 */

const TZ = 'Africa/Cairo'

function parts(value: string | number | Date) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]))
  return { day: p.day, month: p.month, year: p.year, hour: p.hour === '24' ? '00' : p.hour, minute: p.minute }
}

export function dmy(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const p = parts(value)
  return p ? `${p.day}/${p.month}/${p.year}` : '—'
}

export function dmyTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const p = parts(value)
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : '—'
}
