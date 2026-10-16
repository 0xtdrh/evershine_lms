/**
 * Rules & policies: GET /api/guardian-portal/group-rules — rules of my children's groups I still have to accept;
 * POST { groupId, studentId, hash } — accept (stores IP + device as proof). Mandatory: the portal waits for it.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { acceptGroupRules, pendingGroupRules } from '@/lib/rules/group-rules-engine'
import { acceptRulesSchema } from '@/lib/rules/validation'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  return successResponse(await pendingGroupRules(session.user))
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const parsed = acceptRulesSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip')
  const r = await acceptGroupRules({ userId: session.user.id, role: session.user.role, ...(parsed.data as { groupId: string; studentId: string; hash: string }), ip, userAgent: request.headers.get('user-agent') })
  if (!r.ok) return errors.conflict(r.message!)
  return successResponse({ ok: true }, 'Accepted')
}
