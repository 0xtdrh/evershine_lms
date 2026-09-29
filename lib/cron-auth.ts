/**
 * Authorisation for /api/cron/* routes (Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>`).
 *
 * WHY trim: a CRON_SECRET pasted with a trailing space/newline in the Vercel
 * env UI never matched the header Vercel sends, so every cron was rejected
 * (seen 2026-09-29: "authorization header does not match CRON_SECRET").
 * Comparison is constant-time. Diagnostics log lengths only, never values.
 */

import { timingSafeEqual } from 'crypto'

export function isAuthorizedCronRequest(request: Request, jobName: string): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  const header = request.headers.get('authorization')?.trim() ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  if (!secret) {
    console.warn(`[CRON:${jobName}] rejected: CRON_SECRET is not configured`)
    return false
  }

  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  const ok = a.length === b.length && timingSafeEqual(a, b)
  if (!ok) {
    console.warn(`[CRON:${jobName}] rejected`, {
      hasAuthHeader: !!header,
      tokenLength: token.length,
      secretLength: secret.length,
      rawSecretLength: process.env.CRON_SECRET?.length ?? 0,
    })
  }
  return ok
}
