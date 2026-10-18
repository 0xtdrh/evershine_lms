/**
 * 2026-10-18 usage: how often each person (student, parent, instructor, staff) uses TechNova and for how long.
 * One row per person per Cairo day (UserActivityDay). The open dashboard sends a small ping every minute while the tab
 * is visible: more than 30 minutes since the last ping starts a new visit; otherwise the time since the last ping (at
 * most 2 minutes) is added as active time. Sign-ins are counted at login. Pure parts tested in tests/activity-usage.test.ts.
 */

import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'

export const NEW_VISIT_AFTER_MS = 30 * 60_000
export const MAX_GAP_MS = 2 * 60_000

/** What one ping adds to today's row. */
export function applyPing(lastAt: Date | null, now: Date): { newVisit: boolean; addSeconds: number } {
  if (!lastAt) return { newVisit: true, addSeconds: 0 }
  const gap = now.getTime() - lastAt.getTime()
  if (gap < 0) return { newVisit: false, addSeconds: 0 }
  if (gap > NEW_VISIT_AFTER_MS) return { newVisit: true, addSeconds: 0 }
  return { newVisit: false, addSeconds: Math.round(Math.min(gap, MAX_GAP_MS) / 1000) }
}

export interface UsageTotals { visits: number; activeSeconds: number; logins: number; days: number; lastAt: Date | null }

/** Sum of day rows; average visit length in minutes. */
export function summarize(rows: { visits: number; activeSeconds: number; logins: number; lastAt: Date }[]): UsageTotals & { avgVisitMin: number } {
  const t = rows.reduce<UsageTotals>((a, r) => ({ visits: a.visits + r.visits, activeSeconds: a.activeSeconds + r.activeSeconds, logins: a.logins + r.logins, days: a.days + (r.visits > 0 ? 1 : 0), lastAt: !a.lastAt || r.lastAt > a.lastAt ? r.lastAt : a.lastAt }), { visits: 0, activeSeconds: 0, logins: 0, days: 0, lastAt: null })
  return { ...t, avgVisitMin: t.visits ? Math.round(t.activeSeconds / t.visits / 6) / 10 : 0 }
}

const today = () => new Date(`${cairoToday()}T00:00:00.000Z`)

/** A ping from the open dashboard. Never throws. */
export async function recordPing(userId: string, role: string) {
  try {
    const now = new Date()
    const day = today()
    const row = await prisma.userActivityDay.findUnique({ where: { userId_day: { userId, day } }, select: { id: true, lastAt: true } })
    const p = applyPing(row?.lastAt ?? null, now)
    if (!row) await prisma.userActivityDay.create({ data: { userId, day, role: role.slice(0, 20), visits: 1, activeSeconds: 0, firstAt: now, lastAt: now } })
    else await prisma.userActivityDay.update({ where: { id: row.id }, data: { lastAt: now, ...(p.newVisit ? { visits: { increment: 1 } } : {}), ...(p.addSeconds ? { activeSeconds: { increment: p.addSeconds } } : {}) } })
  } catch (e) {
    console.error('[ACTIVITY_PING]', e instanceof Error ? e.message : e)
  }
}

/** A successful sign-in. Never throws. */
export async function recordLogin(userId: string, role: string) {
  try {
    const now = new Date()
    const day = today()
    await prisma.userActivityDay.upsert({
      where: { userId_day: { userId, day } },
      create: { userId, day, role: role.slice(0, 20), logins: 1, visits: 1, activeSeconds: 0, firstAt: now, lastAt: now },
      update: { logins: { increment: 1 } },
    })
  } catch (e) {
    console.error('[ACTIVITY_LOGIN]', e instanceof Error ? e.message : e)
  }
}
