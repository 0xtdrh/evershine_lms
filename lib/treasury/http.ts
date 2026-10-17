/** FIN-1: shared bits of the /api/treasury routes. Server-only. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { TreasuryError } from './engine'

export async function treasuryUser(action: 'read' | 'create' | 'update' | 'approve') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'treasury', action)) return { error: errors.forbidden() }
  return { user: { id: session.user.id, role } }
}

export function treasuryError(e: unknown) {
  if (e instanceof TreasuryError) return errors.badRequest(e.message)
  throw e
}
