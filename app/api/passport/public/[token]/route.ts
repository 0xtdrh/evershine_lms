/** P1: GET — public page data of a share link (no sign-in; rate limited; expired / stopped links show nothing). */

import { errors, successResponse } from '@/lib/api-response'
import { rateLimit } from '@/lib/rate-limit-db'
import { publicShare } from '@/lib/passport/engine'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = await rateLimit(`passport-share:${ip}`, 60, 10 * 60_000)
  if (!rl.ok) return errors.rateLimited(rl.resetAt)
  const { token } = await params
  if (!/^[\w-]{20,64}$/.test(token)) return errors.notFound('Passport')
  const v = await publicShare(token)
  if (!v) return errors.notFound('Passport')
  return successResponse(v)
}
