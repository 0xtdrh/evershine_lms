/** GET /api/finance/where?from&to&campusId — FIN-3: where every pound of the period came from and went, and where the money is now. */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { canSeeFinance, whereMoney } from '@/lib/finance/engine'

export const dynamic = 'force-dynamic'
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !canSeeFinance(role)) return errors.forbidden()
  const sp = request.nextUrl.searchParams
  const d = (k: string) => (DATE.test(sp.get(k) ?? '') ? sp.get(k) : null)
  return successResponse(await whereMoney({ id: session.user.id, role }, { from: d('from'), to: d('to'), campusId: sp.get('campusId') || null }))
}
