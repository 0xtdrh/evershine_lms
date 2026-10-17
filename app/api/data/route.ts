/**
 * GET /api/data — phase 6: the tables this person may export / import (Import & Export centre, screen buttons).
 */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { DATASETS, exchangeRights } from '@/lib/data-exchange/registry'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role) return errors.forbidden()
  const can = (r: Parameters<typeof checkPermission>[1], a: Parameters<typeof checkPermission>[2]) => checkPermission(role, r, a)
  return successResponse(DATASETS.map((d) => ({ key: d.key, ...exchangeRights(d, can) })).filter((x) => x.export || x.import))
}
