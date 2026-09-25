/**
 * POST /api/groups/[id]/pay-adjustments
 * Body: { amount, reason, cycleNumber? }
 * amount is positive for a bonus, negative for a deduction. Always requires
 * a reason on record. Applies to whichever teacher is currently assigned to
 * this group.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  amount: z.number().refine((n) => n !== 0, 'Amount cannot be zero'),
  reason: z.string().min(3, 'Give a short reason'),
  cycleNumber: z.number().int().min(1).optional().nullable(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'create')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true, currentCycleNumber: true } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  const activeYear = await getActiveAcademicYear()
  const offering = activeYear
    ? await prisma.subjectOffering.findFirst({
        where: { classSectionId: id, academicYearId: activeYear.id, teacherId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { teacherId: true },
      })
    : null
  if (!offering?.teacherId) return errors.conflict('This group has no instructor assigned yet')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const adjustment = await prisma.teacherPayAdjustment.create({
    data: {
      teacherId: offering.teacherId,
      classSectionId: id,
      cycleNumber: parsed.data.cycleNumber ?? group.currentCycleNumber,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      createdBy: session.user.id,
    },
  })

  return createdResponse(adjustment, 'Adjustment recorded')
}
