/**
 * Phase C: everything that runs once a day, from ONE cron (Vercel Hobby allows
 * only 2 crons: db-backup + this). Each part is independent and never stops
 * the others. Safe to run twice: birthdays are greeted once per person per
 * year, the morning summary once per day (AppSetting jobs.daily.summaryDate).
 * Portable: any scheduler can call GET /api/cron/daily with the CRON_SECRET.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { cairoToday } from '@/lib/dates/cairo'
import { lowBalanceAlerts } from '@/lib/wallet/engine'
import { runBirthdayJob } from '@/lib/birthdays/birthdays'
import { notifyUsers, isEventOn } from '@/lib/notifications/events'
import { managerMetrics } from '@/lib/insights/insights'

/** Managers get today's key numbers once a day (Super Admin / Admin: their scope; branch managers: their branch). */
export async function morningSummary(force = false) {
  const today = cairoToday()
  if (!force && (await getSetting<string>('jobs.daily.summaryDate', '')) === today) return { skipped: true, sent: 0 }
  if (!(await isEventOn('MORNING_SUMMARY'))) return { skipped: true, sent: 0 }
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'] } },
    select: { id: true, role: true, admin: { select: { campusId: true } }, branchManager: { select: { campusId: true } } },
  })
  const cache = new Map<string, string>()
  let sent = 0
  for (const u of users) {
    const campusId = u.role === 'SUPER_ADMIN' ? null : u.admin?.campusId ?? u.branchManager?.campusId ?? null
    const k = campusId ?? 'ALL'
    if (!cache.has(k)) {
      const m = await managerMetrics(campusId)
      const pick = (key: string) => m.find((x) => x.key === key)
      // Short: a notification holds 190 characters.
      const s = pick('sessions')
      const lines = [
        `Sessions today: ${s?.value ?? 0}${s?.hint && !s.hint.startsWith('all') ? ` (${s.hint})` : ''}`,
        `Overdue invoices: ${pick('overdue')?.value ?? 0}`,
        `Waiting for you: ${pick('waiting')?.value ?? 0}`,
        `Collected: ${pick('collection')?.value ?? '—'}`,
      ]
      cache.set(k, lines.join(' · '))
    }
    sent += await notifyUsers([u.id], 'MORNING_SUMMARY', { title: `Good morning — ${today}`, message: cache.get(k)!, relatedId: null })
  }
  await setSetting('jobs.daily.summaryDate', today)
  return { skipped: false, sent }
}

export async function runDailyJobs(opts: { forceSummary?: boolean } = {}) {
  const out: Record<string, unknown> = { date: cairoToday() }
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn()
    } catch (err) {
      console.error(`[DAILY_JOB:${name}]`, err)
      out[name] = { error: true }
    }
  }
  await step('walletAlerts', () => lowBalanceAlerts())
  await step('birthdays', () => runBirthdayJob())
  await step('morningSummary', () => morningSummary(opts.forceSummary))
  return out
}
