/**
 * POST /api/student-enrollments/[id]/reinstate
 * Restores an enrollment to ACTIVE. Only allowed when it was withdrawn
 * automatically for non-payment (withdrawalReason === 'UNPAID_AUTO') — a
 * deliberate manual removal has no reason stored and is never reinstated
 * this way, on purpose.
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

  if (enrollment.withdrawalReason !== 'UNPAID_AUTO') {
    return errors.conflict('This enrollment was not auto-withdrawn for non-payment, so it cannot be reinstated this way')
  }

  const updated = await prisma.studentEnrollment.update({
    where: { id },
    data: { status: 'ACTIVE', withdrawalReason: null },
  })

  return successResponse(updated)
}
