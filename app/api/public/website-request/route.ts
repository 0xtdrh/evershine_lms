/**
 * POST /api/public/website-request — x01: a form sent from the public website (no login).
 * Saved in the same leads table as the old contact form (LandingInquiry, with kind / organisation / topic / page), so
 * staff see every website request in one place (/dashboard/leads) and in "Your work today".
 * Rate-limited per IP (DB limiter); a hidden "website" field catches bots.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createdResponse, errors } from '@/lib/api-response'
import { HOUR, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { KIND_LABEL, normalizePhone, websiteRequestSchema } from '@/lib/site/request-rules'
import { notifyUsers } from '@/lib/notifications/events'

export async function POST(request: NextRequest) {
  const ip = requestIp(request)
  const limited = await rateLimit(`website-request:ip:${ip}`, 6, HOUR)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const parsed = websiteRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  // a bot filled the hidden field: answer as if it worked, keep nothing
  if (v.website) return createdResponse({ ok: true }, 'Sent')

  try {
    const row = await prisma.landingInquiry.create({
      data: {
        kind: v.kind,
        name: v.name,
        phone: normalizePhone(v.phone)!,
        email: v.email || null,
        organisation: v.organisation || null,
        topic: v.topic || null,
        page: v.page || null,
        message: v.message || '',
        source: 'CONTACT_FORM',
        status: 'NEW',
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: request.headers.get('user-agent')?.slice(0, 250) || null,
      },
      select: { id: true },
    })
    try {
      const staff = await prisma.user.findMany({ where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'MARKETING'] } }, select: { id: true } })
      const k = KIND_LABEL[v.kind]
      const who = v.organisation ? `${v.name} (${v.organisation})` : v.name
      await notifyUsers(staff.map((u) => u.id), 'WEBSITE_REQUEST', {
        title: `New website request: ${k.en}`,
        message: `${who} · ${v.phone}${v.topic ? ` · ${v.topic}` : ''}`,
        titleAr: `طلب جديد من الموقع: ${k.ar}`,
        messageAr: `${who} · ${v.phone}${v.topic ? ` · ${v.topic}` : ''}`,
        relatedId: row.id,
      })
    } catch (e) {
      console.warn('[WEBSITE_REQUEST_NOTIFY]', e)
    }
    return createdResponse({ ok: true }, 'Sent')
  } catch (e) {
    console.error('[WEBSITE_REQUEST]', e)
    return errors.internal()
  }
}
