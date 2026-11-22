/** FIN-1: shared bits of the /api/treasury routes. Server-only. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { TreasuryError } from './engine'

export async function treasuryUser(action: 'read' | 'create' | 'update' | 'approve', opts: { countOnly?: boolean } = {}) {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  // J01: the cash-count routes also open for "cash_count" (count without balances)
  const ok = !!role && (checkPermission(role, 'treasury', action) || (!!opts.countOnly && (action === 'read' || action === 'create') && checkPermission(role, 'cash_count', action)))
  if (!ok || !role) return { error: errors.forbidden() }
  return { user: { id: session.user.id, role }, seesBalances: checkPermission(role, 'treasury', 'read') }
}

export function treasuryError(e: unknown) {
  if (e instanceof TreasuryError) return errors.badRequest(e.message)
  throw e
}
