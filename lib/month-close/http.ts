/** a03: shared bits of the /api/month-close routes. Server-only. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errorResponse, errors } from '@/lib/api-response'
import { canReadMonthClose, MonthCloseError } from './engine'

/** read = month_close:read or financial_reports:read; update = settings (Super Admin / Admin who may close). */
export async function monthCloseUser(action: 'read' | 'create' | 'approve' | 'update') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role) return { error: errors.forbidden() }
  const ok = action === 'read'
    ? canReadMonthClose(role)
    : action === 'update'
      ? ['SUPER_ADMIN', 'ADMIN'].includes(role) && checkPermission(role, 'month_close', 'create')
      : checkPermission(role, 'month_close', action)
  if (!ok) return { error: errors.forbidden() }
  return { user: { id: session.user.id, role } }
}

export function monthCloseError(e: unknown) {
  if (e instanceof MonthCloseError) {
    const code = e.status === 403 ? 'FORBIDDEN' : e.status === 409 ? 'CONFLICT' : e.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST'
    return errorResponse(code, e.message, e.status)
  }
  throw e
}

/** `campusId` from a query / body: '' / 'ALL' / null = whole company. */
export const scopeParam = (v: unknown): string | null => (typeof v === 'string' && v && v !== 'ALL' ? v : null)
