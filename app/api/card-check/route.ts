/**
 * GET /api/card-check?code= — 2026-10-19 public check of a scanned ID card. Anyone: valid / not valid only;
 * signed-in staff who may see the person: who it is. Rate-limited per IP.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { MINUTE, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { checkCard } from '@/lib/cards/engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const limited = await rateLimit(`card-check:ip:${requestIp(request)}`, 60, 10 * MINUTE)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const code = (request.nextUrl.searchParams.get('code') ?? '').trim()
  if (code.length < 5 || code.length > 200) return errors.badRequest('Card code is required')
  const session = await auth().catch(() => null)
  const viewer = session?.user ? { id: session.user.id, role: String(session.user.role) } : null
  return successResponse(await checkCard(code, viewer))
}
