/**
 * PATCH /api/groups/[id]/instructor-pay
 * Body: { fixedAmount?, percentOfStudentPayment?, perSessionAmount? } — any
 * combination, each nullable to clear it. Sets a pay rule specific to THIS
 * group for its current instructor, overriding their teacher-level default.
 * Requires an instructor to already be assigned (via /instructor).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  fixedAmount: z.number().min(0).optional().nullable(),
  percentOfStudentPayment: z.number().min(0).max(100).optional().nullable(),
  perSessionAmount: z.number().min(0).optional().nullable(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'update')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return errors.conflict('No active academic year is set')

  const offering = await prisma.subjectOffering.findFirst({
    where: { classSectionId: id, academicYearId: activeYear.id, teacherId: { not: null } },
    orderBy: { createdAt: 'desc' },
  })
  if (!offering) return errors.conflict('Assign an instructor to this group first')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const updated = await prisma.subjectOffering.update({
    where: { id: offering.id },
    data: {
      ...(parsed.data.fixedAmount !== undefined && { overrideFixedAmount: parsed.data.fixedAmount }),
      ...(parsed.data.percentOfStudentPayment !== undefined && { overridePercentOfStudentPayment: parsed.data.percentOfStudentPayment }),
      ...(parsed.data.perSessionAmount !== undefined && { overridePerSessionAmount: parsed.data.perSessionAmount }),
    },
  })

  return successResponse(updated)
}
