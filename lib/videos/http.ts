/** a02 M4 batch 3: shared bits of the /api/videos routes. Server-only. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errorResponse, errors } from '@/lib/api-response'
import { VideoError } from './engine'

export async function videoAdmin(action: 'read' | 'update') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'video_protection', action)) return { error: errors.forbidden() }
  return { user: { id: session.user.id, role } }
}

export function videoError(e: unknown) {
  if (e instanceof VideoError) return errorResponse(e.code ?? (e.status === 403 ? 'FORBIDDEN' : e.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST'), e.message, e.status)
  throw e
}
