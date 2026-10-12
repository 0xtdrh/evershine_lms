/** P1: POST { code } — event stamp by scanning (or typing) the student card on the event day. */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { scanEventStamp } from '@/lib/passport/engine'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (!checkPermission(role, 'passport', 'update')) return errors.forbidden()
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { code?: string } | null
  if (!body?.code) return errors.badRequest('code is required')
  const r = await scanEventStamp({ id: session.user.id, role, campusId: session.user.campusId }, id, body.code)
  if (!r.ok) return r.code === 'NOT_FOUND' ? errors.notFound(r.message ?? 'Not found') : r.code === 'FORBIDDEN' ? errors.forbidden(r.message) : errors.conflict(r.message ?? 'Cannot stamp')
  return successResponse(r.value)
}
