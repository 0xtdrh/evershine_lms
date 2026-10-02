/**
 * GET /api/refunds/suggest?invoiceId= — what the system suggests giving back
 * (paid - consumed sessions - admin fee) and whether refunds are allowed here.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { suggestRefund } from '@/lib/refunds/engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'refunds', 'create') && !checkPermission(role, 'refunds', 'approve')) return errors.forbidden()
  const invoiceId = new URL(request.url).searchParams.get('invoiceId')
  if (!invoiceId) return errors.badRequest('invoiceId is required')
  const s = await suggestRefund(invoiceId)
  if (!s) return errors.notFound('Invoice')
  return successResponse(s)
}
