/**
 * GET  /api/agreements/pending — the signed-in user's agreements still to accept (current version)
 * POST /api/agreements/pending { agreementId, version } — accept (stores IP + device as proof)
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { acceptAgreement, pendingAgreements } from '@/lib/agreements/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  return successResponse(await pendingAgreements(session.user))
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ agreementId: z.string().min(1), version: z.number().int().min(1) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')
  const r = await acceptAgreement({ agreementId: parsed.data.agreementId!, version: parsed.data.version!, userId: session.user.id, role: session.user.role, ip, userAgent: request.headers.get('user-agent') })
  if (!r.ok) return errors.conflict(r.message!)
  return successResponse({ ok: true }, 'Accepted')
}
