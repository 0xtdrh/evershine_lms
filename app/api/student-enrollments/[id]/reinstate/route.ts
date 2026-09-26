/**
 * POST /api/student-enrollments/[id]/reinstate
 * Restores a WITHDRAWN enrollment to ACTIVE, reusing the same enrollment
 * row — so its attendance and grading history (tied to this
 * studentEnrollmentId) stays correctly linked when the student comes back,
 * instead of starting fresh under a brand-new enrollment.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'update')
  if (denied) return denied

  const { id } = await params
  const enrollment = await prisma.studentEnrollment.findUnique({
    where: { id },
    include: { classSection: { select: { campusId: true } } },
  })
  if (!enrollment) return errors.notFound('Enrollment')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && enrollment.classSection.campusId !== campusId) return errors.forbidden()

  if (enrollment.status !== 'WITHDRAWN') {
    return errors.conflict('This enrollment is not withdrawn, so there is nothing to reinstate')
  }

  const updated = await prisma.studentEnrollment.update({
    where: { id },
    data: { status: 'ACTIVE', withdrawalReason: null },
  })

  return successResponse(updated)
}
