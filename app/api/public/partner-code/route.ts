/** GET /api/public/partner-code?code= — six phases 1-C: the partner's name for a join code (sign-up page). No login; rate-limited. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { MINUTE, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { partnerByJoinCode } from '@/lib/partners/join'

export async function GET(request: NextRequest) {
  const limited = await rateLimit(`partner-code:ip:${requestIp(request)}`, 30, 10 * MINUTE)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const p = await partnerByJoinCode(request.nextUrl.searchParams.get('code'))
  return p ? successResponse({ name: p.name }) : errors.notFound('Partner code')
}
