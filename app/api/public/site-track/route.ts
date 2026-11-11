/**
 * POST /api/public/site-track — x01 analytics, sent by the public website (no login).
 *   { t: 'start', sid, vid?, consent, path, ref?, utm?: {source, medium, campaign}, lang? } → one SiteVisit per tab session
 *   { t: 'ping', sid, consent? }  → +15 s on the visit (while the tab is visible), and the IP if consent was given later
 *   { t: 'page', sid, path }      → +1 page
 *   { t: 'event', sid, kind, label?, path? } → a SiteEvent (FORM_SENT / WHATSAPP also mark the visit converted)
 * Bots are ignored; rate-limited per IP; the IP is kept only with consent (wiped after 90 days by the daily job).
 * Always answers 204 so the page never waits on it.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MINUTE, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { EVENT_KINDS, MAX_VISIT_SECONDS, PING_SECONDS, classifySource, deviceOf, isBot, type EventKind } from '@/lib/site/visit-rules'

const ok = () => new Response(null, { status: 204 })
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const ID = /^[A-Za-z0-9_-]{8,40}$/

export async function POST(request: NextRequest) {
  const ua = request.headers.get('user-agent')
  if (isBot(ua)) return ok()
  const ip = requestIp(request)
  const limited = await rateLimit(`site-track:ip:${ip}`, 400, 10 * MINUTE)
  if (!limited.ok) return ok()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const sid = str(body?.sid, 40)
  if (!body || !sid || !ID.test(sid)) return ok()
  const consent = body.consent === true
  const keptIp = consent && ip !== 'unknown' ? ip : null
  try {
    if (body.t === 'start') {
      const utm = (body.utm && typeof body.utm === 'object' ? body.utm : {}) as Record<string, unknown>
      const ref = str(body.ref, 300)
      const vid = consent ? str(body.vid, 40) : null
      const city = request.headers.get('x-vercel-ip-city')
      await prisma.siteVisit.upsert({
        where: { sessionId: sid },
        update: { lastSeenAt: new Date() },
        create: {
          sessionId: sid,
          visitorId: vid && ID.test(vid) ? vid : null,
          landing: str(body.path, 200) ?? '/',
          source: classifySource(ref, str(utm.source, 80), request.headers.get('host')),
          referrerHost: (() => { try { return ref ? new URL(ref).hostname.slice(0, 120) : null } catch { return null } })(),
          utmSource: str(utm.source, 80),
          utmMedium: str(utm.medium, 80),
          utmCampaign: str(utm.campaign, 80),
          device: deviceOf(ua),
          lang: str(body.lang, 4),
          country: str(request.headers.get('x-vercel-ip-country'), 4),
          city: city ? decodeURIComponent(city).slice(0, 80) : null,
          ip: keptIp,
          consent,
        },
      })
      return ok()
    }
    const visit = await prisma.siteVisit.findUnique({ where: { sessionId: sid }, select: { id: true, seconds: true, ip: true, visitorId: true } })
    if (!visit) return ok()
    if (body.t === 'ping') {
      await prisma.siteVisit.update({
        where: { id: visit.id },
        data: {
          lastSeenAt: new Date(),
          seconds: Math.min(MAX_VISIT_SECONDS, visit.seconds + PING_SECONDS),
          ...(consent && !visit.ip && keptIp ? { ip: keptIp, consent: true } : {}),
          // accepted the cookie notice during this visit: remember the device from now on
          ...(consent && !visit.visitorId && typeof body.vid === 'string' && ID.test(body.vid) ? { visitorId: body.vid, consent: true } : {}),
        },
      })
    } else if (body.t === 'page') {
      await prisma.siteVisit.update({ where: { id: visit.id }, data: { pages: { increment: 1 }, lastSeenAt: new Date() } })
    } else if (body.t === 'event') {
      const kind = str(body.kind, 12) as EventKind | null
      if (!kind || !EVENT_KINDS.includes(kind)) return ok()
      await prisma.siteEvent.create({ data: { sessionId: sid, kind, label: str(body.label, 80), page: str(body.path, 120) } })
      if (kind === 'FORM_SENT' || kind === 'WHATSAPP') await prisma.siteVisit.update({ where: { id: visit.id }, data: { converted: true, lastSeenAt: new Date() } })
    }
  } catch (e) {
    console.warn('[SITE_TRACK]', e)
  }
  return ok()
}
