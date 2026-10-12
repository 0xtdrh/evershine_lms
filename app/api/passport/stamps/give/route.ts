/** P1: POST { stampId, studentIds[], note? } — give a MANUAL stamp (role must be one of the stamp's givers). */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { giveStamp } from '@/lib/passport/engine'

export async function POST(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (!checkPermission(role, 'passport', 'update')) return errors.forbidden()
  const parsed = z.object({ stampId: z.string().min(1), studentIds: z.array(z.string().min(1)).min(1).max(200), note: z.string().max(300).nullish() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await giveStamp({ id: session.user.id, role, campusId: session.user.campusId }, parsed.data.stampId!, parsed.data.studentIds!, parsed.data.note ?? null)
  if (!r.ok) return r.code === 'NOT_FOUND' ? errors.notFound('Stamp') : errors.forbidden(r.message)
  return successResponse(r.value)
}
