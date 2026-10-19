/** 2026-10-19 ID cards: shared bits of the /api/cards routes (documents permission). Server-only. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { CardError } from './engine'

export async function cardUser(action: 'read' | 'create' | 'update') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || ['STUDENT', 'PARENT', 'GUARDIAN', 'TEACHER'].includes(role) || !checkPermission(role, 'documents', action)) return { error: errors.forbidden() }
  return { user: { id: session.user.id, role } }
}

export function cardError(e: unknown) {
  if (e instanceof CardError) return errors.badRequest(e.message)
  throw e
}
