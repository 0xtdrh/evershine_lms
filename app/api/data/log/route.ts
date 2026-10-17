/**
 * GET /api/data/log — phase 6: the last imports / exports (who, which table, rows, done / failed).
 * Super Admin / everyone with every place: all; others with data_export: their own places' log; others: only their own.
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { loadPlaces } from '@/lib/places/server'
import { staffNames } from '@/lib/contacts/contact-log'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role
  if (!checkPermission(role, 'data_export', 'read') && !checkPermission(role, 'data_import', 'create')) return errors.forbidden()
  const places = await loadPlaces(session.user)
  const managers = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(role)
  const where = places.all && managers ? {} : managers ? { OR: [{ userId: session.user.id }, { campusId: { in: places.campusIds.length ? places.campusIds : ['__none__'] } }] } : { userId: session.user.id }
  const rows = await prisma.dataExchangeLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  const names = await staffNames(rows.map((r) => r.userId))
  return successResponse(rows.map((r) => ({ ...r, user: names.get(r.userId) ?? '' })))
}
