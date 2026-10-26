/** DELETE /api/fee-rules/[id] — FIN-2: remove an exception. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { successResponse } from '@/lib/api-response'
import { deleteFeeRule } from '@/lib/fees-extra/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

async function DELETE_(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'finance_settings', 'update')) return errors.forbidden()
  await deleteFeeRule((await params).id).catch(() => null)
  return successResponse({ ok: true })
}

// a03: a write into a closed month answers 409 with the reason
export const DELETE = withMonthLock(DELETE_)
