/**
 * Simple rate limiter stored in our own database. Server-only.
 *
 * WHY not Upstash/in-memory: in-memory counters reset on every serverless
 * instance, and the owner will move from Vercel to Hostinger later, so no
 * external service. Used only on public endpoints, so the load is small.
 *
 *   const r = await rateLimit('forgot-password:ip:' + ip, 10, HOUR)
 *   if (!r.ok) return errors.rateLimited(...)
 *
 * Fails OPEN: a database error never blocks a real user.
 */

import { prisma } from '@/lib/prisma'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
const KEEP_MS = 24 * HOUR

export interface RateLimitResult { ok: boolean; resetAt: number }

/** Counts this request under `key`; ok=false when more than `limit` happened in `windowMs`. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const k = key.slice(0, 191)
  try {
    const since = new Date(Date.now() - windowMs)
    const recent = await prisma.rateLimitHit.findMany({
      where: { key: k, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
      take: limit,
    })
    if (recent.length >= limit) {
      return { ok: false, resetAt: recent[0].createdAt.getTime() + windowMs }
    }
    await prisma.rateLimitHit.create({ data: { key: k } })
    if (Math.random() < 0.05) {
      await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } })
    }
    return { ok: true, resetAt: Date.now() + windowMs }
  } catch (err) {
    console.error('[RATE_LIMIT_DB]', err)
    return { ok: true, resetAt: Date.now() }
  }
}

/** Client IP from the proxy headers (Vercel and Hostinger both set x-forwarded-for). */
export function requestIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown').slice(0, 64)
}
