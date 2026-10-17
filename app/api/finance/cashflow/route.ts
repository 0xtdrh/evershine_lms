/** GET /api/finance/cashflow?months&campusId — FIN-3: money in / out per month, the 30-day forecast and wallet money owed. */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { canSeeFinance, cashflow } from '@/lib/finance/engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !canSeeFinance(role)) return errors.forbidden()
  const sp = request.nextUrl.searchParams
  return successResponse(await cashflow({ id: session.user.id, role }, { months: Number(sp.get('months')) || 6, campusId: sp.get('campusId') || null }))
}
