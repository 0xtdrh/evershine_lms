/** L5: GET — the group's H5P activities with each student's best result (instructor / managers; not secretaries). */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { canManageGroupLessons } from '@/lib/lms/engine'
import { groupH5P } from '@/lib/h5p/engine'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, id))) return errors.forbidden()
  return successResponse(await groupH5P(id))
}
