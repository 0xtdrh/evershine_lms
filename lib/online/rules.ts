/**
 * L5 online classes, free first step (owner 2026-10-11): one meeting link per group (Zoom / Meet / any https link);
 * the student sees "Join" shortly before the session; joining is logged as provisional attendance the instructor
 * confirms. Pure (tests/online-rules.test.ts).
 */

export const OPEN_BEFORE_MIN = 10 // owner 2026-10-26: Join opens 10 minutes before
export const DEFAULT_SESSION_MIN = 90
export const LATE_JOIN_MIN = 30 // after the planned end, joining is still allowed for a while

/** Is the Join button open now? */
export function joinWindow(start: Date, durationMin: number | null | undefined, now: Date) {
  const opens = new Date(start.getTime() - OPEN_BEFORE_MIN * 60_000)
  const closes = new Date(start.getTime() + ((durationMin || DEFAULT_SESSION_MIN) + LATE_JOIN_MIN) * 60_000)
  return { open: now >= opens && now <= closes, opens, closes, upcoming: now < opens }
}

/** A meeting link we accept: https, normal length, no spaces. */
export function cleanMeetingUrl(input: string | null | undefined): { ok: boolean; url: string | null; message?: string } {
  const v = (input ?? '').trim()
  if (!v) return { ok: true, url: null }
  if (v.length > 500 || /\s/.test(v)) return { ok: false, url: null, message: 'The link is not valid' }
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return { ok: false, url: null, message: 'The link must start with https://' }
    return { ok: true, url: u.toString() }
  } catch {
    return { ok: false, url: null, message: 'The link is not valid' }
  }
}
