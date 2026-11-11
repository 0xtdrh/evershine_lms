/** x01 analytics: reads the visits for the "Website visitors" screen, and the daily IP clean-up. Server only. */

import { prisma } from '@/lib/prisma'
import { IP_KEEP_DAYS } from './visit-rules'
import { lastDays, summarize } from './analytics-calc'

export async function siteAnalytics(daysBack: number, now = new Date()) {
  const days = lastDays(daysBack, now)
  const since = new Date(now.getTime() - daysBack * 86_400_000)
  const [visits, events, requests, live] = await Promise.all([
    prisma.siteVisit.findMany({
      where: { startedAt: { gte: since } },
      select: { sessionId: true, visitorId: true, startedAt: true, seconds: true, pages: true, landing: true, source: true, device: true, city: true, utmCampaign: true, converted: true },
      take: 200_000,
    }),
    prisma.siteEvent.findMany({ where: { createdAt: { gte: since } }, select: { sessionId: true, kind: true, label: true }, take: 400_000 }),
    prisma.landingInquiry.findMany({ where: { createdAt: { gte: since }, kind: { not: null } }, select: { kind: true, visitSessionId: true } }),
    prisma.siteVisit.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 60_000) } } }),
  ])
  return { days: daysBack, live, ...summarize(visits, events, requests, days) }
}

/** Daily job: the IP of a visit is kept 90 days, then wiped (the visit itself stays for the counts). */
export async function wipeOldVisitorIps(now = new Date()) {
  const cutoff = new Date(now.getTime() - IP_KEEP_DAYS * 86_400_000)
  const r = await prisma.siteVisit.updateMany({ where: { ip: { not: null }, startedAt: { lt: cutoff } }, data: { ip: null } })
  return { wiped: r.count }
}
