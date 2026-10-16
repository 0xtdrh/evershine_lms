/**
 * Partners part 1-B2: GET /api/partners/overview — numbers and things that need attention (contracts ending, signed but
 * not started, missing data, follow-ups due; money owed and statements waiting only with `partner_finance:read`).
 */

import type { Role } from '@prisma/client'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { partnersOverview } from '@/lib/partners/insights'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'partners', 'read')
  if (denied) return denied
  return successResponse(await partnersOverview({ withMoney: checkPermission(role, 'partner_finance', 'read') }))
}
