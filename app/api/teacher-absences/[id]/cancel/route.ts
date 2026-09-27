/**
 * POST /api/teacher-absences/[id]/cancel
 * The teacher who submitted it can cancel their own PENDING or APPROVED
 * request (they no longer need it); an approver can cancel anyone's.
 * Also cancels/declines any linked substitute assignment.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import type { Role } from '@prisma/client'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role

  const { id } = await params
  const absence = await prisma.teacherAbsence.findUnique({ where: { id } })
  if (!absence) return errors.notFound('Absence request')
  if (absence.status === 'CANCELLED' || absence.status === 'REJECTED') {
    return errors.conflict('This request is already closed')
  }

  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher || teacher.id !== absence.teacherId) return errors.forbidden()
  } else {
    const denied = requirePermission(role, 'teacher_absences', 'approve')
    if (denied) return denied
  }

  const [updated] = await prisma.$transaction([
    prisma.teacherAbsence.update({ where: { id }, data: { status: 'CANCELLED' } }),
    prisma.substituteAssignment.updateMany({
      where: { teacherAbsenceId: id, status: { not: 'DECLINED' } },
      data: { status: 'DECLINED' },
    }),
  ])

  return successResponse(updated)
}
