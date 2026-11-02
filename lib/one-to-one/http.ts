/** a02 M3: shared bits of the /api/one-to-one routes. Server-only. */

import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errorResponse, errors } from '@/lib/api-response'
import { OneToOneError } from './engine'

export async function oneToOneUser(action: 'read' | 'create' | 'update' | 'delete') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'one_to_one', action)) return { error: errors.forbidden() }
  return { user: { ...session.user, id: session.user.id, role } }
}

export function oneToOneError(e: unknown) {
  if (e instanceof OneToOneError) return errorResponse(e.code ?? (e.status === 403 ? 'FORBIDDEN' : e.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST'), e.message, e.status)
  throw e
}

export const httpCtx = (req: NextRequest) => ({ origin: req.nextUrl.origin, cookie: req.headers.get('cookie') ?? '' })
