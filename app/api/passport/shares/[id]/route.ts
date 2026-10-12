/** P1: DELETE — the parent stops a share link. */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { revokeShare } from '@/lib/passport/engine'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const r = await revokeShare({ id: session.user.id, role: session.user.role as Role }, id)
  if (!r.ok) return errors.notFound('Link')
  return successResponse({ revoked: true })
}
