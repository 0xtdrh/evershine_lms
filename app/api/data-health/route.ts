/** GET /api/data-health — 2026-10-18 problems in the data with links to fix them (audit_logs:read; places-limited). */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { dataHealth } from '@/lib/health/checks'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'audit_logs', 'read')) return errors.forbidden()
  return successResponse(await dataHealth({ id: session.user.id, role }))
}
