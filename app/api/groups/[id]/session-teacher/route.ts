/**
 * POST /api/groups/[id]/session-teacher
 * Body: { date: string, teacherId: string | null }
 * Sets taughtByTeacherId on every attendance record for this group on this
 * date — separate from markedByTeacherId (who submitted the roster), since
 * a secretary or admin can record attendance on a teacher's behalf. This
 * never touches the attendance-saving flow itself; it's an independent,
 * optional correction step used for accurate per-session pay.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  date: z.string().min(1),
  teacherId: z.string().min(1).nullable(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'attendance', 'create')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.teacherId) {
    const teacher = await prisma.teacher.findUnique({ where: { id: parsed.data.teacherId }, select: { id: true } })
    if (!teacher) return errors.notFound('Teacher')
  }

  const result = await prisma.enrollmentAttendanceRecord.updateMany({
    where: {
      studentEnrollment: { classSectionId: id },
      attendanceDate: new Date(parsed.data.date),
    },
    data: { taughtByTeacherId: parsed.data.teacherId },
  })

  return successResponse({ updated: result.count })
}
