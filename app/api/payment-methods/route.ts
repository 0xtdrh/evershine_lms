/**
 * GET /api/payment-methods — active methods staff can pick when recording a
 * payment (Settings > Payments).
 */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { listPaymentMethods } from '@/lib/fees/payment-settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'fees', 'read') && !checkPermission(role, 'fee_collection', 'read')) return errors.forbidden()
  const methods = await listPaymentMethods(true)
  return successResponse(methods.map((m) => ({ name: m.name, isSystem: m.isSystem })))
}
