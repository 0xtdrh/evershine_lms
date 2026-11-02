/** a02 M4: shared bits of the /api/recorded routes. Server-only. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errorResponse, errors } from '@/lib/api-response'
import { RecordedError } from './engine'

export async function recordedUser(action: 'read' | 'create' | 'update') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'recorded_courses', action)) return { error: errors.forbidden() }
  return { user: { ...session.user, id: session.user.id, role } }
}

export function recordedError(e: unknown) {
  if (e instanceof RecordedError) return errorResponse(e.code ?? (e.status === 403 ? 'FORBIDDEN' : e.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST'), e.message, e.status)
  throw e
}
