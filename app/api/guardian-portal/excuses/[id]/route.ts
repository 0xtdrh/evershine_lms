/** DELETE /api/guardian-portal/excuses/[id] — the parent withdraws an excuse (phase C). */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'
import { cancelExcuse } from '@/lib/excuses/engine'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const { id } = await params
  const e = await prisma.absenceExcuse.findUnique({ where: { id }, select: { studentId: true } })
  if (!e || !(await assertGuardianAccessToStudent(session.user.id, e.studentId))) return errors.notFound('Excuse')
  const r = await cancelExcuse(id, session.user.id)
  if (!r.ok) return errors.conflict(r.message)
  return successResponse(r, 'Excuse withdrawn')
}
